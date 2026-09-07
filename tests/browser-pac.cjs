const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createServer } = require('node:http')
const { createServer: createSecureServer } = require('node:https')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash } = require('node:crypto')
const { connect } = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const load = require('./load.cjs')

const within = (promise, milliseconds = 5000) => {
  let timer
  return Promise.race([promise, new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Browser test operation timed out')), milliseconds)
  })]).finally(() => clearTimeout(timer))
}

// An isolated browser and local servers: no public proxy or destination is used.
test('Chromium applies PAC rules and manages proxies', { timeout: 30000 }, async () => {
  const extension = path.resolve(__dirname, '../dist/chrome/prod')
  const id = createHash('sha256').update(extension).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)))
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-pac-test-'))
  let directHits = 0
  const origin = createServer((request, response) => { directHits++; response.end('DIRECT') })
  let authHits = 0
  const proxyHandler = (request, response) => {
    if (request.url.includes('auth.example')) {
      if (request.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('alice:secret').toString('base64')) {
        response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="test"' })
        response.end('AUTH REQUIRED')
        return
      }
      authHits++
    }
    response.end('PROXY')
  }
  const proxy = createServer(proxyHandler)
  let secureProxy
  let echo
  let echoHits = 0
  let slowEcho = false
  await Promise.all([origin, proxy].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
  const process = spawn(global.process.env.CHROMIUM || 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--ignore-certificate-errors', // Only the isolated test uses a self-signed proxy.
    '--disable-background-networking', '--disable-component-update',
    '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  let startError
  process.on('error', error => { startError = error })
  try {
    const key = path.join(profile, 'proxy-key.pem')
    const cert = path.join(profile, 'proxy-cert.pem')
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { timeout: 5000 })
    secureProxy = createSecureServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) }, proxyHandler)
    await new Promise(resolve => secureProxy.listen(0, '127.0.0.1', resolve))
    echo = createSecureServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) }, (request, response) => {
      echoHits++
      if (!slowEcho) response.end(JSON.stringify({ ip: '8.8.8.8', cc: 'US' }))
    })
    await new Promise(resolve => echo.listen(0, '127.0.0.1', resolve))
    const tunnel = (request, client, head) => {
      if (request.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('alice:secret').toString('base64')) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="probe"\r\nContent-Length: 0\r\n\r\n')
        return
      }
      const upstream = connect(echo.address().port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.write(head)
        client.pipe(upstream).pipe(client)
      })
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroy())
    }
    proxy.on('connect', tunnel)
    secureProxy.on('connect', tunnel)
    let port
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startError) throw startError
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(port, 'Chromium did not start')
    const endpoint = `http://localhost:${port}`
    const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(`chrome-extension://${id}/popup.html`)}`,
      { method: 'PUT', signal: AbortSignal.timeout(5000) }).then(response => response.json())
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await within(new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject }))
    let next = 0
    const pending = new Map()
    socket.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.id) { pending.get(data.id)(data); pending.delete(data.id) }
    }
    const command = async (method, params) => {
      const result = await within(new Promise(resolve => {
        const id = ++next
        pending.set(id, resolve)
        socket.send(JSON.stringify({ id, method, params }))
      }))
      assert.equal(result.error, undefined, JSON.stringify(result))
      return result.result
    }
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result))
      return result.result.value
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    const { getPacScript } = load('background/pac')
    const data = getPacScript({ domains: ['example.co.uk', 'api.example.com', 'example.com.br', 'printer.local', 'router'],
      ignoredHosts: ['api.example.co.uk', 'example.com.br'],
      proxies: [{ protocol: 'HTTP', host: '127.0.0.1', port: proxy.address().port }] })
    await evaluate(`chrome.proxy.settings.set(${JSON.stringify({ value: { mode: 'pac_script', pacScript: { data, mandatory: true } }, scope: 'regular' })})`)
    for (const [host, expected] of [
      ['example.co.uk', 'PROXY'], ['deep.api.example.com', 'PROXY'], ['a.example.com.br', 'DIRECT'],
      ['api.example.co.uk', 'DIRECT'],
      ['other.co.uk', 'DIRECT'], ['www.example.com', 'DIRECT'], ['badexample.com.br', 'DIRECT'],
      ['printer.local', 'DIRECT'], ['router', 'DIRECT'],
    ]) {
      assert.equal(await evaluate(`fetch(${JSON.stringify(`http://${host}:${origin.address().port}/`)}).then(response => response.text())`), expected, host)
    }
    const install = async data => evaluate(`chrome.proxy.settings.set(${JSON.stringify({
      value: { mode: 'pac_script', pacScript: { data, mandatory: true } }, scope: 'regular',
    })})`)
    await install(getPacScript({ domains: ['blocked.example'] }))
    const before = directHits
    assert.equal(await evaluate(`fetch('http://blocked.example:${origin.address().port}/').then(() => 'LEAK', () => 'BLOCKED')`), 'BLOCKED')
    assert.equal(directHits, before)
    await install('function FindProxyForURL() { return "PROXY 127.0.0.1:0; PROXY 127.0.0.1:' + proxy.address().port + '" }')
    assert.equal(await evaluate(`fetch('http://failover.example:${origin.address().port}/').then(response => response.text())`), 'PROXY')
    for (const [protocol, server] of [['HTTP', proxy], ['HTTPS', secureProxy]]) {
      const beforeAuth = authHits
      await evaluate(`chrome.storage.local.set(${JSON.stringify({ enableExtension: true, useProxy: true,
        proxies: [{ id: 'auth', name: 'Authenticated', protocol, host: '127.0.0.1', port: server.address().port, username: 'alice', password: 'secret' }],
        selectedProxyIds: ['auth'], customProxiedDomains: ['auth.example'],
      })})`)
      assert.equal(await evaluate("chrome.runtime.sendMessage({type: 'ct-background', action: 'setProxy'}).then(result => result.error || result.value)"), true)
      assert.equal(await evaluate(`fetch('http://auth.example:${origin.address().port}/${protocol}').then(response => response.text())`), 'PROXY')
      assert.ok(authHits > beforeAuth, protocol)
    }
    assert.equal(await evaluate("chrome.proxy.settings.get({}).then(({value}) => /alice|secret/.test(value.pacScript.data))"), false)
    const checkRecords = [['HTTP', proxy], ['HTTPS', secureProxy]].map(([protocol, server], index) => ({
      id: `check-${index}`, name: `Check ${index}`, protocol, host: '127.0.0.1', port: server.address().port, username: 'alice', password: 'secret',
    }))
    await evaluate(`chrome.storage.local.set(${JSON.stringify({ proxies: checkRecords, selectedProxyIds: ['check-0'] })})`)
    assert.equal(await evaluate("chrome.runtime.sendMessage({type: 'ct-background', action: 'startProxyChecks', args: {ids: ['check-0', 'check-1']}}).then(result => result.error || result.value.running)"), true)
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("chrome.storage.local.get('proxyCheckRun').then(data => data.proxyCheckRun?.running === false)")) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const results = await evaluate("chrome.storage.local.get('proxyChecks').then(data => data.proxyChecks)")
    assert.equal(results['check-0']?.status, 'ok', JSON.stringify(results))
    assert.equal(results['check-1']?.status, 'ok', JSON.stringify(results))
    assert.equal(results['check-0'].exitIP, '8.8.8.8')
    assert.equal(results['check-0'].exitCountry, 'US')
    assert.equal(await evaluate("chrome.proxy.settings.get({}).then(({value}) => value.pacScript.data.includes('api.ipify.org'))"), false)
    await evaluate(`chrome.storage.local.set({proxyFailures: {'check-0': {fingerprint: ${JSON.stringify(results['check-0'].fingerprint)}, retryAt: Date.now() + 300000}}})`)
    await evaluate("chrome.runtime.sendMessage({type: 'ct-background', action: 'setProxy'})")
    const beforeBlocked = directHits
    assert.equal(await evaluate(`fetch('http://auth.example:${origin.address().port}/cooldown').then(response => response.text(), () => 'BLOCKED')`), 'BLOCKED')
    assert.equal(directHits, beforeBlocked)
    await evaluate("chrome.runtime.sendMessage({type: 'ct-background', action: 'startProxyChecks', args: {ids: ['check-0']}})")
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("chrome.storage.local.get('proxyCheckRun').then(data => data.proxyCheckRun?.running === false)")) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(await evaluate("chrome.storage.local.get('proxyFailures').then(data => data.proxyFailures['check-0'])"), undefined)
    assert.equal(await evaluate(`fetch('http://auth.example:${origin.address().port}/recovered').then(response => response.text())`), 'PROXY')
    results['check-0'] = await evaluate("chrome.storage.local.get('proxyChecks').then(data => data.proxyChecks['check-0'])")
    const checkedAt = results['check-0'].checkedAt
    const beforeSlow = echoHits
    slowEcho = true
    await evaluate("chrome.runtime.sendMessage({type: 'ct-background', action: 'startProxyChecks', args: {ids: ['check-0']}})")
    for (let attempt = 0; echoHits === beforeSlow && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(echoHits > beforeSlow)
    await evaluate("chrome.runtime.sendMessage({type: 'ct-background', action: 'stopProxyChecks'})")
    assert.equal(await evaluate("chrome.storage.local.get('proxyChecks').then(data => data.proxyChecks['check-0'].checkedAt)"), checkedAt)
    assert.equal(await evaluate("chrome.storage.local.get('proxyProbeActive').then(data => data.proxyProbeActive)"), false)
    slowEcho = false
    await evaluate("chrome.storage.local.set({useProxy: false, proxies: [], selectedProxyIds: ['builtin']})")
    await evaluate("location.href = chrome.runtime.getURL('proxy-options.html')")
    const until = async expression => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await evaluate(expression)) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      assert.fail(`Page did not update: ${expression}`)
    }
    await until("document.querySelectorAll('#proxyRows tr').length === 1")
    assert.equal(await evaluate("document.querySelector('#proxyListOptions').open"), false)
    await evaluate(`document.querySelector('#proxyName').value = '<img src=x onerror=alert(1)>'; document.querySelector('#proxyServerInput').value = '127.0.0.1:${proxy.address().port}'; document.querySelector('#select-toggle').textContent = 'HTTP'; document.querySelector('#proxyUsername').value = 'alice'; document.querySelector('#proxyPassword').value = 'secret'; document.querySelector('#proxyForm').requestSubmit()`)
    await until("document.querySelectorAll('#proxyRows tr').length === 2")
    assert.equal(await evaluate("document.querySelector('#proxyRows img') === null"), true)
    assert.equal(await evaluate("document.querySelector('#proxyRows').textContent.includes('secret')"), false)
    assert.equal(await evaluate("chrome.storage.local.get('proxies').then(data => data.proxies[0].password)"), 'secret')
    await evaluate("chrome.storage.local.get(['proxies', 'proxyChecks']).then(({proxies, proxyChecks}) => chrome.storage.local.set({proxyChecks: {...proxyChecks, [proxies[0].id]: proxyChecks['check-0']}}))")
    await until("document.querySelector('#proxyRows').textContent.includes('Available')")
    if (global.process.env.CT_BROWSER_SCREENSHOT) {
      await evaluate("document.querySelector('#useProxyCheckbox').click(); document.querySelector('#proxyListOptions').open = true; document.querySelector('#proxyAuthOptions').open = true")
      await until("chrome.storage.local.get('useProxy').then(data => data.useProxy === true)")
      await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false })
      const { data } = await command('Page.captureScreenshot', { captureBeyondViewport: true })
      await fs.writeFile(global.process.env.CT_BROWSER_SCREENSHOT, Buffer.from(data, 'base64'))
      await evaluate("document.querySelector('#useProxyCheckbox').click()")
      await until("chrome.storage.local.get('useProxy').then(data => data.useProxy === false)")
    }
    await evaluate("document.querySelectorAll('#proxyRows input')[1].click()")
    await until("chrome.storage.local.get('selectedProxyIds').then(data => data.selectedProxyIds.length === 2)")
    await until("document.querySelectorAll('#proxyRows tr')[1].querySelector('button').disabled === false")
    await evaluate("document.querySelectorAll('#proxyRows tr')[1].querySelector('button').click(); document.querySelector('#proxyName').value = 'Renamed'; document.querySelector('#proxyForm').requestSubmit()")
    await until("document.querySelector('#proxyRows').textContent.includes('Renamed')")
    assert.equal(await evaluate("document.querySelector('#proxyRows').textContent.includes('Available')"), true)
    await evaluate("document.querySelectorAll('#proxyRows tr')[1].querySelector('button').click(); document.querySelector('#proxyPassword').value = 'changed'; document.querySelector('#proxyForm').requestSubmit()")
    await until("!document.querySelector('#proxyRows').textContent.includes('Available')")
    await evaluate("document.querySelectorAll('#proxyRows tr')[1].querySelectorAll('button')[1].click()")
    await until("document.querySelectorAll('#proxyRows tr').length === 1")
    assert.equal(await evaluate("chrome.storage.local.get('useProxy').then(data => data.useProxy)"), false)
    assert.equal(await evaluate("document.querySelector('#pageError') === null"), true)
    assert.equal(await evaluate("document.querySelector('#proxyAll') === null"), true)
    assert.equal(await evaluate("document.querySelector('#proxyImportOptions').open"), false)
    assert.equal(await evaluate("document.querySelector('#proxyCheckOptions').open"), false)
    assert.equal(await evaluate("document.querySelector('#proxyRecoveryEnabled').checked"), false)
    await evaluate("document.querySelector('#proxyRecoveryEnabled').click()")
    await until("chrome.storage.local.get('proxyRecoveryEnabled').then(data => data.proxyRecoveryEnabled === true)")
    assert.equal(await evaluate("chrome.storage.local.get('useProxy').then(data => data.useProxy)"), false)
    await until("document.querySelector('#proxyRecoveryEnabled').disabled === false")
    await evaluate("document.querySelector('#proxyRecoveryEnabled').click()")
    await until("chrome.storage.local.get('proxyRecoveryEnabled').then(data => data.proxyRecoveryEnabled === false)")
    await evaluate("document.querySelector('#proxyImportText').value = 'http://imported.example:8080'; document.querySelector('#proxyImportButton').click()")
    await until("document.querySelector('#proxyRows').textContent.includes('imported.example')")
    assert.deepEqual(await evaluate("chrome.storage.local.get('selectedProxyIds').then(data => data.selectedProxyIds)"), ['builtin'])
    assert.equal(await evaluate("document.querySelector('#proxySubscriptionsEnabled').checked"), false)
    await until("document.querySelector('#proxyImportButton').disabled === false")
    await evaluate("document.querySelector('#proxyImportUrl').value = 'https://subscription.example/list'; document.querySelector('#proxySubscribeButton').click()")
    await until("document.querySelector('#proxySubscriptions').textContent.includes('subscription.example')")
    assert.equal(await evaluate("chrome.storage.local.get('useProxy').then(data => data.useProxy)"), false)
    await evaluate("location.href = chrome.runtime.getURL('advanced-options.html')")
    await until("document.querySelector('#proxyAll')?.disabled === false")
    assert.equal(await evaluate("document.querySelector('#proxyAll').checked"), false)
    await evaluate("document.querySelector('#proxyAll').click()")
    await until("chrome.storage.local.get('proxyAll').then(data => data.proxyAll === true)")
    assert.equal(await evaluate("chrome.storage.local.get('useProxy').then(data => data.useProxy)"), false)
    await until("document.querySelector('#proxyAll').disabled === false")
    await evaluate("location.reload()")
    await until("document.querySelector('#proxyAll')?.checked === true")
  } finally {
    if (socket) socket.close()
    if (process.pid && process.exitCode === null && process.signalCode === null) {
      const exited = new Promise(resolve => process.once('exit', resolve))
      process.kill('SIGTERM')
      try { await within(exited, 2000) } catch {
        process.kill('SIGKILL')
        await within(exited, 2000)
      }
    }
    for (const server of [origin, proxy, secureProxy, echo].filter(Boolean)) { server.closeAllConnections(); server.close() }
    await fs.rm(profile, { recursive: true, force: true })
  }
})
