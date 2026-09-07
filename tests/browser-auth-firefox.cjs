const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createServer } = require('node:http')
const net = require('node:net')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const webpack = require('webpack')

test('Firefox authenticates HTTP and SOCKS5 proxies without direct or DNS fallback', { timeout: 40000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-firefox-auth-'))
  const profile = path.join(temporary, 'profile')
  const addon = path.join(temporary, 'addon')
  await Promise.all([profile, addon].map(directory => fs.mkdir(directory)))
  let report
  let directHits = 0
  const socksRequests = []
  const sockets = new Set()
  const origin = createServer((request, response) => {
    if (request.url.startsWith('/report?')) {
      report(JSON.parse(new URL(request.url, 'http://localhost').searchParams.get('data')))
    } else if (request.url === '/probe') {
      directHits++
    }
    response.end('DIRECT')
  })
  const httpProxy = createServer((request, response) => {
    if (request.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('alice:secret').toString('base64')) {
      response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="test"' })
      response.end('AUTH REQUIRED')
    } else {
      response.end('AUTH_HTTP')
    }
  })
  const socksProxy = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    let buffer = Buffer.alloc(0)
    let stage = 'greeting'
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data])
      if (stage === 'greeting' && buffer.length >= 2 + buffer[1]) {
        const methods = buffer.subarray(2, 2 + buffer[1])
        buffer = buffer.subarray(2 + buffer[1])
        if (!methods.includes(2)) { socket.end(Buffer.from([5, 255])); return }
        socket.write(Buffer.from([5, 2])); stage = 'auth'
      }
      if (stage === 'auth' && buffer.length >= 3 + buffer[1]) {
        const userLength = buffer[1]
        const passwordLength = buffer[2 + userLength]
        if (buffer.length < 3 + userLength + passwordLength) return
        const username = buffer.subarray(2, 2 + userLength).toString()
        const password = buffer.subarray(3 + userLength, 3 + userLength + passwordLength).toString()
        buffer = buffer.subarray(3 + userLength + passwordLength)
        if (username !== 'alice' || password !== 'secret') {
          socket.end(Buffer.from([1, 1])); return
        }
        socket.write(Buffer.from([1, 0])); stage = 'connect'
      }
      if (stage === 'connect' && buffer.length >= 5) {
        const length = buffer[3] === 3 ? 7 + buffer[4] : buffer[3] === 1 ? 10 : 22
        if (buffer.length < length) return
        socksRequests.push({ addressType: buffer[3], hostname: buffer.subarray(5, 5 + buffer[4]).toString() })
        buffer = buffer.subarray(length)
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); stage = 'request'
      }
      if (stage === 'request' && buffer.includes('\r\n\r\n')) {
        stage = 'done'
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nAUTH_SOCKS')
      }
    })
  })
  const servers = [origin, httpProxy, socksProxy]
  let child
  let remote
  let timer
  try {
    await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
    const root = path.resolve(__dirname, '../src/shared/js/background')
    const cases = [
      { protocol: 'HTTP', port: httpProxy.address().port, password: 'secret' },
      { protocol: 'SOCKS5', port: socksProxy.address().port, password: 'secret' },
      { protocol: 'SOCKS5', port: socksProxy.address().port, password: 'wrong' },
    ]
    const entry = path.join(temporary, 'entry.js')
    await fs.writeFile(entry, `
      import browser from ${JSON.stringify(path.join(root, 'browser-api.js'))};
      import manager from ${JSON.stringify(path.join(root, 'proxy.js'))};
      import { registerProxyAuth } from ${JSON.stringify(path.join(root, 'proxy-auth.js'))};
      import { setProbeRoute } from ${JSON.stringify(path.join(root, 'proxy-route.js'))};
      registerProxyAuth();
      (async () => {
        const results = [];
        const errors = [];
        console.error = (...args) => errors.push(args.join(' '));
        try {
          await browser.storage.local.set({domains: Array.from({length: 660000}, (_,i) => i === 659999 ? 'protected.example' : 'site' + i + '.large-registry.example')});
          for (const config of ${JSON.stringify(cases)}) {
            await browser.storage.local.set({ enableExtension: true, useProxy: true,
              customProxiedDomains: [], selectedProxyIds: ['test'],
              proxies: [{ id: 'test', host: '127.0.0.1', username: 'alice', ...config }] });
            if (!await manager.setProxyInBackground()) throw new Error('PAC was not applied: ' + errors.join('; '));
            const setting = await browser.proxy.settings.get({});
            if (setting.value.autoConfigUrl.length > 1000) throw new Error('Firefox needs a small fallback PAC');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            try {
              results.push(await fetch('http://protected.example:${origin.address().port}/probe',
                { signal: controller.signal, cache: 'no-store' }).then(response => response.text()));
            } catch (error) { results.push(error.name === 'AbortError' ? 'TIMEOUT' : 'BLOCKED'); }
            finally { clearTimeout(timeout); }
          }
          await browser.storage.local.set({ selectedProxyIds: [] });
          for (const config of ${JSON.stringify(cases.slice(0, 2))}) {
            setProbeRoute('protected.example', { id: 'probe', host: '127.0.0.1', username: 'alice', ...config });
            if (!await manager.setProxyInBackground({ ping: false })) throw new Error('Probe PAC was not applied');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            try {
              results.push(await fetch('http://protected.example:${origin.address().port}/probe',
                { signal: controller.signal, cache: 'no-store' }).then(response => response.text()));
            } catch (error) { results.push(error.name === 'AbortError' ? 'TIMEOUT' : 'BLOCKED'); }
            finally { clearTimeout(timeout); setProbeRoute('protected.example', null); }
          }
          await manager.setProxyInBackground({ ping: false });
        } catch (error) { results.push(error.message); }
        await fetch('http://127.0.0.1:${origin.address().port}/report?data=' + encodeURIComponent(JSON.stringify(results)));
      })();
    `)
    await new Promise((resolve, reject) => webpack({ mode: 'none', target: 'web', entry,
      output: { path: addon, filename: 'background.js' },
      resolve: { alias: { Background: root } },
    }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString())) : resolve()))
    await fs.writeFile(path.join(addon, 'manifest.json'), JSON.stringify({ manifest_version: 2,
      name: 'Isolated authentication test', version: '1', browser_action: {},
      browser_specific_settings: { gecko: { id: 'auth-test@censortracker.invalid' } },
      background: { scripts: ['background.js'] },
      permissions: ['<all_urls>', 'storage', 'proxy', 'webRequest', 'webRequestBlocking'],
    }))
    await fs.writeFile(path.join(profile, 'user.js'), Object.entries({
      'devtools.debugger.remote-enabled': true,
      'devtools.chrome.enabled': true,
      'devtools.debugger.prompt-connection': false,
      'network.dns.localDomains': 'protected.example',
      'network.trr.mode': 5,
      'datareporting.policy.dataSubmissionEnabled': false,
      'toolkit.telemetry.enabled': false,
    }).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'))
    await fs.writeFile(path.join(profile, 'extension-preferences.json'), JSON.stringify({
      'auth-test@censortracker.invalid': { permissions: ['internal:privateBrowsingAllowed'], origins: [] },
    }))
    const { connectWithMaxRetries, findFreeTcpPort } = await import('../node_modules/web-ext/lib/firefox/remote.js')
    const port = await findFreeTcpPort()
    const results = new Promise(resolve => { report = resolve })
    child = spawn(process.env.FIREFOX || 'firefox', ['--headless', '--no-remote', '--profile', profile,
      '--start-debugger-server', String(port), 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } })
    const failure = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', () => reject(new Error('Firefox exited early')))
      timer = setTimeout(() => reject(new Error('Firefox auth test timed out')), 25000)
    })
    const run = async () => {
      remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 100 })
      await remote.installTemporaryAddon(addon)
      return results
    }
    assert.deepEqual(await Promise.race([run(), failure]), ['AUTH_HTTP', 'AUTH_SOCKS', 'BLOCKED', 'AUTH_HTTP', 'AUTH_SOCKS'])
    assert.equal(directHits, 0)
    assert.ok(socksRequests.length > 0)
    assert.ok(socksRequests.every(request => request.addressType === 3 && request.hostname === 'protected.example'))
  } finally {
    clearTimeout(timer)
    if (remote) remote.disconnect()
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await new Promise(resolve => child.once('exit', resolve))
    }
    for (const socket of sockets) socket.destroy()
    for (const server of servers) { server.closeAllConnections?.(); server.close() }
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
