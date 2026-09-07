const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
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
  const proxy = createServer((request, response) => response.end('PROXY'))
  await Promise.all([origin, proxy].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
  const process = spawn(global.process.env.CHROMIUM || 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-component-update',
    '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  let startError
  process.on('error', error => { startError = error })
  try {
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
    const evaluate = async expression => {
      const result = await within(new Promise(resolve => {
        const id = ++next
        pending.set(id, resolve)
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true } }))
      }))
      assert.equal(result.error, undefined, JSON.stringify(result))
      assert.equal(result.result.exceptionDetails, undefined, JSON.stringify(result))
      return result.result.result.value
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
    await evaluate(`document.querySelector('#proxyName').value = '<img src=x onerror=alert(1)>'; document.querySelector('#proxyServerInput').value = '127.0.0.1:${proxy.address().port}'; document.querySelector('#select-toggle').textContent = 'HTTP'; document.querySelector('#proxyForm').requestSubmit()`)
    await until("document.querySelectorAll('#proxyRows tr').length === 2")
    assert.equal(await evaluate("document.querySelector('#proxyRows img') === null"), true)
    await evaluate("document.querySelectorAll('#proxyRows input')[1].click()")
    await until("chrome.storage.local.get('selectedProxyIds').then(data => data.selectedProxyIds.length === 2)")
    await evaluate("document.querySelectorAll('#proxyRows tr')[1].querySelector('button').click(); document.querySelector('#proxyName').value = 'Renamed'; document.querySelector('#proxyForm').requestSubmit()")
    await until("document.querySelector('#proxyRows').textContent.includes('Renamed')")
    await evaluate("document.querySelectorAll('#proxyRows tr')[1].querySelectorAll('button')[1].click()")
    await until("document.querySelectorAll('#proxyRows tr').length === 1")
    assert.equal(await evaluate("chrome.storage.local.get('useProxy').then(data => data.useProxy)"), false)
    assert.equal(await evaluate("document.querySelector('#pageError') === null"), true)
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
    for (const server of [origin, proxy]) { server.closeAllConnections(); server.close() }
    await fs.rm(profile, { recursive: true, force: true })
  }
})
