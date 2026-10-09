const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

// Test-only scripts drive the real release bundle in an isolated browser profile.
for (const firefox of [false, true]) {
  test(`consent survives install, refusal, reload and update: Firefox=${firefox}`, { timeout: 60000 }, async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-consent-'))
    const addon = path.join(temporary, 'addon')
    const profile = path.join(temporary, 'profile')
    let child, remote, timer, report
    const server = createServer((req, res) => {
      if (req.url.startsWith('/report?')) report(JSON.parse(new URL(req.url, 'http://localhost').searchParams.get('data')))
      res.end('OK')
    })
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      await fs.mkdir(profile)
      await fs.cp(path.resolve(__dirname, `../dist/${firefox ? 'firefox' : 'chrome'}/prod`), addon, { recursive: true })
      const manifest = JSON.parse(await fs.readFile(path.join(addon, 'manifest.json')))
      // The test reads tab URLs to count consent pages.
      manifest.permissions.push('tabs')
      if (firefox) manifest.browser_specific_settings.gecko.id = 'consent@test.invalid'
      await fs.writeFile(path.join(addon, 'manifest.json'), JSON.stringify(manifest))
      const monitor = `
        const testBrowser = typeof browser === 'undefined' ? chrome : browser;
        const testRequests = [];
        testBrowser.webRequest.onBeforeRequest.addListener(details => {
          const source = details.initiator || details.originUrl || '';
          if (source.startsWith(testBrowser.runtime.getURL('')) && !details.url.startsWith('${base}/')) testRequests.push(details.url);
        }, {urls: ['http://*/*', 'https://*/*']});
        testBrowser.runtime.onMessage.addListener((message, sender, respond) => {
          if (message === 'ct-test-network') { respond(testRequests); return false; }
        });
      `
      const background = path.join(addon, 'background.js')
      await fs.writeFile(background, monitor + '\n' + await fs.readFile(background, 'utf8') +
        "\ntestBrowser.tabs.create({url: testBrowser.runtime.getURL('ct-test.html'), active: false});\n")
      await fs.writeFile(path.join(addon, 'ct-test.html'), '<!doctype html><meta charset="utf-8"><script src="ct-test.js"></script>')
      await fs.writeFile(path.join(addon, 'ct-test.js'), `
        const api = typeof browser === 'undefined' ? chrome : browser;
        const sleep = () => new Promise(resolve => setTimeout(resolve, 100));
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const rpc = async (action, args) => {
          const result = await api.runtime.sendMessage({type: 'ct-background', action, args});
          if (result.error) throw new Error(result.error);
          return result.value;
        };
        (async () => {
          try {
            for (let i = 0; i < 50; i++) {
              if ((await api.storage.local.get('consentPromptVersion')).consentPromptVersion === 1) break;
              await sleep();
            }
            const before = await api.storage.local.get(null);
            check(before.consentPromptVersion === 1, 'consent page was not opened');
            check(!before.dataConsent, 'unexpected initial consent');
            check((await api.proxy.settings.get({})).levelOfControl !== 'controlled_by_this_extension', 'CT still controls proxy');
            check((await api.runtime.sendMessage('ct-test-network')).length === 0, 'network before consent');
            if (!before.ctTestUpdate) {
              await rpc('setDataConsent', false);
              check((await rpc('dataConsent')).accepted === false, 'decline not saved');
              // Old settings must survive consent and must not be re-enabled.
              await api.storage.local.set({enableExtension: false, useProxy: false, ignoredHosts: ['kept.example']});
              await Promise.all([rpc('setDataConsent', true), rpc('setDataConsent', true)]);
              check((await rpc('dataConsent')).accepted === true, 'accept not saved');
              check((await api.runtime.sendMessage('ct-test-network')).length === 0, 'disabled settings caused network');
              await rpc('setDataConsent', false);
              check((await api.storage.local.get('ignoredHosts')).ignoredHosts[0] === 'kept.example', 'list lost');
              for (const action of ['synchronize', 'importAntizapret']) {
                let failed = false;
                try { await rpc(action); } catch { failed = true; }
                check(failed, action + ' bypassed consent');
              }
              check((await api.runtime.sendMessage('ct-test-network')).length === 0, 'network after withdrawal');
              // Recreate a legacy installation, then let the real update event run.
              await api.storage.local.set({ctTestUpdate: true, enableExtension: true, useProxy: true});
              await api.storage.local.remove(['dataConsent', 'consentPromptVersion', 'consentInstallPending']);
              await api.proxy.settings.set({value: ${JSON.stringify(firefox ? { proxyType: 'manual', http: '127.0.0.1:9' } : { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', host: '127.0.0.1', port: 9 } } })}});
              // Close harness tabs before reload to avoid duplicate test drivers.
              const tabs = await api.tabs.query({});
              const self = await api.tabs.getCurrent();
              await api.tabs.remove(tabs.filter(tab => tab.id !== self.id && tab.url?.startsWith(api.runtime.getURL(''))).map(tab => tab.id));
              await api.tabs.create({url: 'about:blank'});
              ${firefox ? 'api.runtime.reload();' : "await fetch('" + base + "/report?data=' + encodeURIComponent(JSON.stringify({reload: true})));"}
              return;
            }
            check(before.enableExtension === true && before.useProxy === true, 'update changed preferences');
            check(before.ignoredHosts[0] === 'kept.example', 'update lost lists');
            await sleep();
            const tabs = await api.tabs.query({});
            check(tabs.filter(tab => tab.url === api.runtime.getURL('consent.html')).length === 1, 'unexpected consent tabs: ' + JSON.stringify(tabs.map(tab => ({url:tab.url,pendingUrl:tab.pendingUrl}))));
            await fetch('${base}/report?data=' + encodeURIComponent(JSON.stringify({ok: true})));
          } catch (error) {
            await api.proxy.settings.clear({});
            await fetch('${base}/report?data=' + encodeURIComponent(JSON.stringify({error: error.stack || error.message})));
          }
        })();
      `)
      const results = new Promise(resolve => { report = resolve })
      const launchChrome = () => spawn(process.env.CHROMIUM || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update',
        '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', `--user-data-dir=${profile}`,
        `--disable-extensions-except=${addon}`, `--load-extension=${addon}`, 'about:blank'], { stdio: 'ignore' })
      if (firefox) {
        await fs.writeFile(path.join(profile, 'extension-preferences.json'), JSON.stringify({
          'consent@test.invalid': { permissions: ['internal:privateBrowsingAllowed'], origins: [] },
        }))
        await fs.writeFile(path.join(profile, 'user.js'), Object.entries({
          'devtools.debugger.remote-enabled': true, 'devtools.chrome.enabled': true,
          'devtools.debugger.prompt-connection': false, 'network.trr.mode': 5,
        }).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'))
        const { connectWithMaxRetries, findFreeTcpPort } = await import('../node_modules/web-ext/lib/firefox/remote.js')
        const port = await findFreeTcpPort()
        child = spawn(process.env.FIREFOX || 'firefox', ['--headless', '--no-remote', '--profile', profile,
          '--start-debugger-server', String(port), 'about:blank'],
        { stdio: 'ignore', env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' } })
        remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 100 })
        await remote.installTemporaryAddon(addon)
      } else {
        child = launchChrome()
      }
      let outcome = await Promise.race([results, new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('exit', () => reject(new Error('Browser exited before reporting')))
        timer = setTimeout(() => reject(new Error('Consent browser test timed out')), 35000)
      })])
      if (outcome.reload) {
        clearTimeout(timer)
        child.kill('SIGTERM')
        await new Promise(resolve => child.once('exit', resolve))
        manifest.version = '21.0.1'
        await fs.writeFile(path.join(addon, 'manifest.json'), JSON.stringify(manifest))
        const updated = new Promise(resolve => { report = resolve })
        child = launchChrome()
        outcome = await Promise.race([updated, new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Updated browser timed out')), 20000)
        })])
      }
      assert.deepEqual(outcome, { ok: true })
    } finally {
      clearTimeout(timer)
      remote?.disconnect()
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await new Promise(resolve => child.once('exit', resolve))
      }
      server.closeAllConnections()
      server.close()
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
}
