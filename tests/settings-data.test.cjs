const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')
const { settingsDefaults, validateSettings } = load('background/settings-data')
const plain = value => JSON.parse(JSON.stringify(value))
const defaultProxies = { proxies: [], selectedProxyIds: ['builtin'] }

test('settings imports allow only user choices, not runtime state or code', () => {
  const input = JSON.parse('{"useProxy":false,"domains":["evil.example"],"serviceRouteSnapshot":{"owned":true},"proxyServerURI":"evil:80","__proto__":{"polluted":true},"constructor":{}}')
  assert.deepEqual(plain(validateSettings(input)), { useProxy: false, ...defaultProxies })
  assert.equal({}.polluted, undefined)
  assert.deepEqual(plain(validateSettings({ formatVersion: 1, settings: {
    ignoredHosts: [' ПРИМЕР.РФ ', 'xn--e1afmkfd.xn--p1ai'], currentRegionCode: 'BY',
  } })), { ignoredHosts: ['xn--e1afmkfd.xn--p1ai'], currentRegionCode: 'BY', ...defaultProxies })
})

test('settings API keeps runtime state and exports a versioned user-only backup', async () => {
  const storage = { domains: ['cached.example'], serviceRouteSnapshot: { owned: true },
    useProxy: true, currentRegionCode: 'BY', proxyIsAlive: false }
  let writes = 0
  const browser = { storage: { local: {
    get: async () => storage,
    set: async values => { writes++; Object.assign(storage, plain(values)) },
    clear: () => { throw new Error('Must not clear storage') },
  } } }
  const settings = load('background/settings', {
    'browser-api': { default: browser },
    'background-rpc': { callBackground: (method, input) => {
      assert.equal(method, 'importSettings')
      return settings.importSettingsInBackground(input)
    } },
  }).default
  const backup = plain(await settings.exportSettings())
  assert.deepEqual(backup, { formatVersion: 1, settings: { ...plain(settingsDefaults), ...defaultProxies, useProxy: true, currentRegionCode: 'BY' } })
  await assert.rejects(settings.importSettings({ useProxy: false, ignoredHosts: [null] }))
  assert.equal(writes, 0)
  await settings.importSettings({ formatVersion: 1, settings: { useProxy: false, serviceRouteSnapshot: {} } })
  assert.equal(storage.useProxy, false)
  assert.deepEqual(storage.domains, ['cached.example'])
  assert.deepEqual(storage.serviceRouteSnapshot, { owned: true })
  storage.customProxyProtocol = 'HTTP'
  storage.customProxyServerURI = 'old.example:80'
  storage.ignoredHosts = ['old.example']
  storage.localProxyURI = '127.0.0.1:10808'
  await settings.importSettings({ useOwnProxy: false, useLocalProxy: false })
  assert.equal(storage.customProxyServerURI, '')
  assert.deepEqual(storage.ignoredHosts, [])
  assert.equal(storage.localProxyURI, null)
  await settings.importSettings({ useLocalProxy: true, localProxyURI: 'evil.example:80' })
  assert.equal(storage.localProxyURI, null)
  assert.equal(storage.localProxyAlive, false)
  assert.deepEqual(storage.domains, ['cached.example'])
})

test('export migrates a legacy selection before it applies defaults', async () => {
  const settings = load('background/settings', {
    'browser-api': { default: { storage: { local: { get: async () => ({
      customProxyProtocol: 'HTTP', customProxyServerURI: 'legacy.example:80',
    }) } } } },
  }).default
  assert.deepEqual(Array.from((await settings.exportSettings()).settings.selectedProxyIds), ['legacy'])
})

test('invalid known settings reject the full import before any write', () => {
  for (const input of [null, [], { formatVersion: 2 }, { formatVersion: 1, settings: [] },
    { useProxy: 'false' }, { proxyAll: 'true' }, { ignoredHosts: 'example.com' }, { customProxiedDomains: [null] },
    { currentRegionCode: 'Russia' }, { customProxyProtocol: 'DIRECT' },
    { customProxyServerURI: "host:1'; alert(1);'" }]) {
    assert.throws(() => validateSettings(input))
  }
})
