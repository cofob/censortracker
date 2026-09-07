const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')
const { proxyFingerprint, publicIP, countryCode } = load('background/proxy-check-data')

const until = async condition => {
  const deadline = Date.now() + 2000
  while (!await condition()) {
    assert.ok(Date.now() < deadline, 'Check did not finish')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const fixture = (probe) => {
  const storage = { enableExtension: true, useProxy: true, proxyChecks: {},
    proxies: Array.from({ length: 8 }, (_, index) => ({ id: `proxy-${index}`, name: `Proxy ${index}`, protocol: 'HTTP', host: `${index}.proxy.example`, port: 8080 })),
    selectedProxyIds: ['builtin'],
  }
  const probes = new Map()
  const events = []
  const listeners = []
  const controlListeners = []
  let controlled = true
  let queue = Promise.resolve()
  let active = 0
  let maxActive = 0
  const browser = { storage: {
    local: {
      get: async defaults => JSON.parse(JSON.stringify({ ...defaults, ...storage })),
      set: async values => {
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: storage[key], newValue: value }]))
        Object.assign(storage, JSON.parse(JSON.stringify(values)))
        for (const listener of listeners) listener(changes, 'local')
      },
    }, onChanged: { addListener: listener => listeners.push(listener) },
  }, proxy: { settings: { onChange: { addListener: listener => controlListeners.push(listener) } } } }
  const manager = { ping: async () => {}, setProxyInBackground: async () => {
    events.push({ action: 'apply', probes: Array.from(probes.keys()), selected: [...storage.selectedProxyIds] })
    return true
  }, removeProxyInBackground: async () => events.push({ action: 'clear' }) }
  const api = load('background/proxy-check', {
    'browser-api': { default: browser }, proxy: { default: manager },
    'proxy-route': {
      withProxyLock: work => { const result = queue.then(work); queue = result.catch(() => {}); return result },
      proxyAllowed: async () => controlled && storage.enableExtension && storage.useProxy,
      mustUseDirect: async host => (storage.ignoredHosts || []).includes(host),
      getProbeRoutes: () => Array.from(probes.values()),
      setProbeRoute: (hostname, proxy) => proxy ? probes.set(hostname, { hostname, proxy }) : probes.delete(hostname),
    }, 'proxy-check-network': {
      CHECK_URLS: [0, 1, 2, 3].map(index => `https://echo${index}.example/`),
      probeProxy: async (url, signal) => {
        const record = probes.get(new URL(url).hostname)?.proxy
        assert.ok(record, 'No isolated proxy route')
        active++; maxActive = Math.max(maxActive, active)
        try {
          if (probe) return await probe(record, signal)
          await new Promise(resolve => setTimeout(resolve, 10))
          return { exitIP: '8.8.8.8', exitCountry: 'US', latency: 10 }
        } finally { active-- }
      }, locateProxy: async (proxy, result) => ({ ...result, serverIP: '9.9.9.9', serverCountry: 'DE' }),
    },
  })
  return { ...api, storage, probes, events, browser, manager, maxActive: () => maxActive,
    loseControl: () => { controlled = false; for (const listener of controlListeners) listener({ levelOfControl: 'controlled_by_other_extensions' }) } }
}

test('parallel checks are bounded, preserve choices, and save separate entry and exit metadata', async () => {
  const state = fixture()
  await state.registerProxyChecks()
  const ids = state.storage.proxies.map(proxy => proxy.id)
  assert.equal((await state.startProxyChecks({ ids })).running, true)
  await assert.rejects(state.startProxyChecks({ ids }))
  await until(() => state.storage.proxyCheckRun.running === false)
  assert.equal(state.maxActive(), 4)
  assert.equal(Object.keys(state.storage.proxyChecks).length, 8)
  assert.equal(state.storage.proxyChecks['proxy-0'].exitCountry, 'US')
  assert.equal(state.storage.proxyChecks['proxy-0'].serverCountry, 'DE')
  assert.equal(state.storage.proxyCheckRun.completed, 8)
  assert.deepEqual(state.storage.selectedProxyIds, ['builtin'])
  assert.equal(state.probes.size, 0)
  assert.deepEqual(state.events.at(-1).probes, [])
  assert.equal(state.storage.proxyProbeActive, false)
})

test('stop and loss of proxy control abort requests without marking proxies as failed', async () => {
  for (const loseControl of [false, true]) {
    const state = fixture((proxy, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
    }))
    await state.registerProxyChecks()
    await state.startProxyChecks({ ids: state.storage.proxies.map(proxy => proxy.id) })
    await until(() => state.maxActive() === 4)
    if (loseControl) state.loseControl()
    await state.stopProxyChecks()
    assert.equal(state.probes.size, 0)
    assert.equal(Object.keys(state.storage.proxyChecks).length, 0)
    assert.equal(state.storage.proxyCheckRun.cancelled, true)
    assert.equal(state.storage.selectedProxyIds[0], 'builtin')
    if (loseControl) assert.equal(state.events.at(-1).action, 'clear')
  }
})

test('settings changes cancel checks and cleanup uses the latest selection', async () => {
  const state = fixture((proxy, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
  }))
  await state.registerProxyChecks()
  await state.startProxyChecks({ ids: ['proxy-0'] })
  await until(() => state.maxActive() === 1)
  await state.browser.storage.local.set({ selectedProxyIds: ['proxy-1'] })
  await state.stopProxyChecks()
  assert.deepEqual(state.events.at(-1).selected, ['proxy-1'])
  assert.equal(Object.keys(state.storage.proxyChecks).length, 0)
})

test('automatic checks require consent and stop when that consent is removed', async () => {
  const state = fixture((proxy, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
  }))
  await state.registerProxyChecks()
  await assert.rejects(state.startProxyChecks({ ids: ['proxy-0'], automatic: true }))
  await state.browser.storage.local.set({ proxyRecoveryEnabled: true,
    selectedProxyIds: ['proxy-0'], proxyFailures: { 'proxy-0': {
      retryAt: 1, fingerprint: await proxyFingerprint(state.storage.proxies[0]),
    } } })
  await state.startProxyChecks({ ids: ['proxy-0'], automatic: true })
  await until(() => state.maxActive() === 1)
  await state.browser.storage.local.set({ proxyRecoveryEnabled: false })
  await state.stopProxyChecks()
  assert.equal(state.storage.proxyCheckRun.cancelled, true)
  assert.equal(Object.keys(state.storage.proxyChecks).length, 0)
})

test('automatic checks revalidate selection, credentials, and failure identity at job creation', async () => {
  for (const change of ['deselected', 'credentials', 'recovered', 'endpoint', 'cooldown', 'local']) {
    const state = fixture()
    const proxy = state.storage.proxies[0]
    state.storage.proxyRecoveryEnabled = true
    state.storage.selectedProxyIds = [proxy.id]
    state.storage.proxyFailures = { [proxy.id]: { retryAt: 1, fingerprint: await proxyFingerprint(proxy) } }
    if (change === 'deselected') state.storage.selectedProxyIds = ['builtin']
    if (change === 'credentials') Object.assign(proxy, { username: 'alice', password: 'secret' })
    if (change === 'recovered') state.storage.proxyFailures = {}
    if (change === 'endpoint') proxy.host = 'new.example'
    if (change === 'cooldown') state.storage.proxyFailures[proxy.id].retryAt = Date.now() + 60000
    if (change === 'local') state.storage.localProxyURI = '127.0.0.1:10808'
    await assert.rejects(state.startProxyChecks({ ids: [proxy.id], automatic: true }), undefined, change)
    assert.equal(state.maxActive(), 0)
  }
})

test('checks require enabled routing and skip restricted, unsupported, or excluded targets', async () => {
  const state = fixture()
  state.storage.useProxy = false
  await assert.rejects(state.startProxyChecks())
  assert.equal(state.storage.useProxy, false)
  state.storage.useProxy = true
  state.storage.proxies[0].restricted = true
  Object.assign(state.storage.proxies[1], { protocol: 'SOCKS5', username: 'alice', password: 'secret' })
  state.storage.ignoredHosts = ['echo0.example', 'echo1.example', 'echo2.example']
  await state.startProxyChecks({ ids: ['proxy-0', 'proxy-1', 'proxy-2'] })
  await until(() => state.storage.proxyCheckRun.running === false)
  assert.equal(state.storage.proxyChecks['proxy-0'].status, 'restricted')
  assert.equal(state.storage.proxyChecks['proxy-1'].status, 'unsupported')
  assert.equal(state.maxActive(), 1)
  assert.ok(state.events.every(event => !event.probes?.includes('echo0.example')))
})

test('restart cleanup restores normal routing and invalidates old endpoint or credential results', async () => {
  const state = fixture()
  state.storage.proxyProbeActive = true
  await state.registerProxyChecks()
  assert.equal(state.storage.proxyProbeActive, false)
  const proxy = state.storage.proxies[0]
  state.storage.proxyChecks[proxy.id] = { status: 'ok', fingerprint: await proxyFingerprint(proxy) }
  assert.equal((await state.getProxyCheckState()).checks[proxy.id].status, 'ok')
  proxy.name = 'New name'
  assert.equal((await state.getProxyCheckState()).checks[proxy.id].status, 'ok')
  proxy.password = 'new secret'
  assert.equal((await state.getProxyCheckState()).checks[proxy.id], undefined)
})

test('IP and country data reject private, malformed, and unknown service values', () => {
  for (const ip of ['10.0.0.1', '100.64.1.2', '[fd00::1]', 'https://8.8.8.8/', 'example.com', '134744072', null]) assert.equal(publicIP(ip), '', String(ip))
  assert.equal(publicIP('8.8.8.8'), '8.8.8.8')
  assert.equal(publicIP('2606:4700:4700::1111'), '2606:4700:4700::1111')
  for (const value of ['XX', 'ZZ', 'United States', 'us', null]) assert.equal(countryCode(value), '')
  assert.equal(countryCode('US'), 'US')
})

test('Firefox probe errors cannot mark the selected managed endpoint bad or trigger synchronization', async () => {
  let normalRecoveries = 0
  const { handleProxyError } = load('background/handlers', {
    'browser-api': { default: {} },
    'proxy-route': { getProbeRoutes: () => [{ hostname: 'echo.example' }], proxyAllowed: async () => true },
    proxy: { default: { getRouteForHost: async () => { normalRecoveries++; return { type: 'direct' } } } },
    server: {}, 'proxy-importer': {},
  })
  await handleProxyError({ error: 'NS_ERROR_UNKNOWN_PROXY_HOST', url: 'https://echo.example/', tabId: 1 })
  await handleProxyError({ error: 'NS_ERROR_UNKNOWN_PROXY_HOST', url: 'https://echo.example/', tabId: -1 })
  await handleProxyError({ error: 'NS_ERROR_UNKNOWN_PROXY_HOST', url: 'https://finished-check.example/', tabId: -1 })
  assert.equal(normalRecoveries, 0)
  await handleProxyError({ error: 'NS_ERROR_UNKNOWN_PROXY_HOST', url: 'https://normal.example/', tabId: 1 })
  assert.equal(normalRecoveries, 1)
})
