const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const webpack = require('webpack')

for (const firefox of [false, true]) {
  test(`service redirects work across hosts in ${firefox ? 'Firefox' : 'Chrome'}`, { timeout: 60000 }, async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-service-browser-'))
    const addon = path.join(temporary, 'addon')
    const profile = path.join(temporary, 'profile')
    await Promise.all([addon, profile].map(directory => fs.mkdir(directory)))
    let report
    let child
    let remote
    let timer
    let proxyHits = 0
    const handler = (request, response) => {
      const url = new URL(request.url, 'http://first.api.example')
      response.setHeader('Access-Control-Allow-Origin', '*')
      if (url.pathname === '/report') {
        report(JSON.parse(url.searchParams.get('data')))
        response.end('OK')
        return
      }
      const hops = Number(url.pathname.split('/')[2])
      if (url.pathname.startsWith('/status/')) {
        response.writeHead(hops, { Location: `http://second.api.example:${origin.address().port}/final` })
      } else if (url.pathname.startsWith('/hop/') && hops > 0) {
        response.writeHead(302, { Location: hops % 2
          ? `http://second.api.example:${origin.address().port}/hop/${hops - 1}` : `/hop/${hops - 1}` })
      } else if (url.pathname === '/cycle') {
        response.writeHead(302, { Location: '/cycle' })
      } else if (url.pathname === '/missing') {
        response.writeHead(302)
      } else {
        response.setHeader('Content-Type', 'application/json')
        response.end('["added.example"]')
        return
      }
      response.end()
    }
    const origin = createServer(handler)
    const proxy = createServer((request, response) => { proxyHits++; handler(request, response) })
    try {
      await Promise.all([origin, proxy].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
      const root = path.resolve(__dirname, '../src/shared/js/background')
      const entry = path.join(temporary, 'entry.js')
      await fs.writeFile(entry, `
        import browser from ${JSON.stringify(path.join(root, 'browser-api.js'))};
        import { requestService } from ${JSON.stringify(path.join(root, 'service-request.js'))};
        const base = 'http://first.api.example:${origin.address().port}';
        (async () => {
          const results = [];
          try {
            await browser.storage.local.set({ enableExtension: true, useProxy: true,
              proxies: [{ id: 'test', protocol: 'HTTP', host: '127.0.0.1', port: ${proxy.address().port} }],
              selectedProxyIds: ['test'], customProxiedDomains: [] });
            await browser.proxy.settings.set({value: ${JSON.stringify(firefox
              ? { proxyType: 'autoConfig', autoConfigUrl: 'data:application/x-ns-proxy-autoconfig,' + encodeURIComponent('function FindProxyForURL() { return "DIRECT"; }') }
              : { mode: 'pac_script', pacScript: { data: 'function FindProxyForURL() { return "DIRECT"; }' } })}});
            for (const status of [301, 302, 303, 307, 308]) {
              results.push((await requestService(base + '/status/' + status, Array.isArray, {maxRedirects: 5})).data);
            }
            results.push((await requestService(base + '/hop/5', Array.isArray, {maxRedirects: 5})).data);
            for (const route of ['/hop/6', '/cycle', '/missing']) {
              try { await requestService(base + route, Array.isArray, {maxRedirects: 5}); results.push('unexpected success'); }
              catch (error) { results.push(error.message); }
            }
            try { await requestService(base + '/status/302', Array.isArray); results.push('unexpected success'); }
            catch (error) { results.push('redirect rejected by default'); }
            await browser.storage.local.set({customProxiedDomains: ['second.api.example']});
            const proxied = await requestService(base + '/status/302', Array.isArray, {maxRedirects: 5});
            results.push(proxied.viaProxy, proxied.data);
            results.push((await browser.storage.local.get('serviceRouteSnapshot')).serviceRouteSnapshot || null);
          } catch (error) { results.push(error.stack || error.message || String(error)); }
          await fetch('http://127.0.0.1:${origin.address().port}/report?data=' + encodeURIComponent(JSON.stringify(results)));
        })();
      `)
      await new Promise((resolve, reject) => webpack({ mode: 'none', target: 'web', entry,
        output: { path: addon, filename: 'background.js' }, resolve: { alias: { Background: root } },
      }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()))
      await fs.writeFile(path.join(addon, 'manifest.json'), JSON.stringify({
        name: 'Isolated service test', version: '1',
        manifest_version: firefox ? 2 : 3,
        background: firefox ? { scripts: ['background.js'] } : { service_worker: 'background.js' },
        ...(firefox ? { browser_action: {}, browser_specific_settings: { gecko: { id: 'services@censortracker.invalid' } } }
          : { host_permissions: ['<all_urls>'] }),
        permissions: ['storage', 'proxy', 'webRequest', ...(firefox ? ['<all_urls>'] : [])],
      }))
      const results = new Promise(resolve => { report = resolve })
      let port
      if (firefox) {
        await fs.writeFile(path.join(profile, 'extension-preferences.json'), JSON.stringify({
          'services@censortracker.invalid': { permissions: ['internal:privateBrowsingAllowed'], origins: [] },
        }))
        await fs.writeFile(path.join(profile, 'user.js'), Object.entries({
          'devtools.debugger.remote-enabled': true, 'devtools.chrome.enabled': true,
          'devtools.debugger.prompt-connection': false, 'network.trr.mode': 5,
          'network.dns.localDomains': 'first.api.example,second.api.example',
        }).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'))
        const { connectWithMaxRetries, findFreeTcpPort } = await import('../node_modules/web-ext/lib/firefox/remote.js')
        port = await findFreeTcpPort()
        child = spawn(process.env.FIREFOX || 'firefox', ['--headless', '--no-remote', '--profile', profile,
          '--start-debugger-server', String(port), 'about:blank'],
        { stdio: 'ignore', env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } })
        remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 100 })
        await remote.installTemporaryAddon(addon)
      } else {
        child = spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu',
          '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update',
          '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', `--user-data-dir=${profile}`,
          `--disable-extensions-except=${addon}`, `--load-extension=${addon}`, 'about:blank'], { stdio: 'ignore' })
      }
      const outcome = await Promise.race([results, new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('exit', () => reject(new Error('Browser exited before reporting')))
        timer = setTimeout(() => reject(new Error('Service browser test timed out')), 20000)
      })])
      assert.deepEqual(outcome.slice(0, 6), Array.from({ length: 6 }, () => ['added.example']), JSON.stringify(outcome))
      assert.match(outcome[6], /Redirect limit/)
      assert.match(outcome[7], /Redirect cycle/)
      assert.match(outcome[8], /no Location/)
      assert.deepEqual(outcome.slice(9), ['redirect rejected by default', true, ['added.example'], null])
      assert.ok(proxyHits > 0)
    } finally {
      clearTimeout(timer)
      if (remote) remote.disconnect()
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await new Promise(resolve => child.once('exit', resolve))
      }
      for (const server of [origin, proxy]) { server.closeAllConnections(); server.close() }
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
}
