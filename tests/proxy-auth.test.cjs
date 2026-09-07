const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')
const plain = value => JSON.parse(JSON.stringify(value))
const record = { id: 'one', protocol: 'HTTP', host: 'proxy.example', port: 80,
  username: 'alice', password: 'secret' }
const fixture = (firefox = false) => {
  const listeners = {}
  let override = null
  let enabled = true
  const event = name => ({ addListener: (fn, filter, flags) => { listeners[name] = { fn, flags } } })
  const browser = { isFirefox: firefox,
    webRequest: { onAuthRequired: event('auth'), onCompleted: event('done'), onErrorOccurred: event('error') },
    proxy: { onRequest: event('proxy') } }
  const api = load('background/proxy-auth', {
    'browser-api': { default: browser },
    'proxy-route': { proxyRequestAllowed: async () => enabled, getServiceRoute: () => override },
    proxy: { default: { getSelectedProxies: async () => [record],
      getRouteForHost: async host => ({ proxies: host === 'protected.example' ? [record] : [] }) } },
  })
  return { ...api, listeners, setOverride: value => { override = value }, disable: () => { enabled = false } }
}

test('proxy credentials validate types, protocol limits, backup retention, and PAC secrecy', () => {
  const { validateProxy, proxyAuthSupported } = load('background/proxy-record')
  const { validateSettings } = load('background/settings-data')
  const { getPacScript } = load('background/pac')
  assert.equal(validateProxy(record).password, 'secret')
  assert.equal(validateSettings({ proxies: [record], selectedProxyIds: ['one'] }).proxies[0].username, 'alice')
  assert.doesNotMatch(getPacScript({ domains: ['example.com'], proxies: [record] }), /alice|secret|password|username/)
  for (const change of [{ username: null }, { password: {} }, { username: 'a:b' },
    { password: 'line\nbreak' }, { protocol: 'SOCKS4' },
    { protocol: 'SOCKS5', password: '' }, { protocol: 'SOCKS5', username: 'ю'.repeat(128) }]) {
    assert.throws(() => validateProxy({ ...record, ...change }))
  }
  assert.equal(proxyAuthSupported({ ...record, protocol: 'SOCKS5' }, false), false)
  assert.equal(proxyAuthSupported({ ...record, protocol: 'SOCKS5' }, true), true)
  assert.equal(validateProxy({ ...record, protocol: 'SOCKS5', username: 'alice:session' }).username, 'alice:session')
})

test('HTTP auth matches the selected challenger and never answers origin authentication', async () => {
  const { createAuthHandler } = fixture()
  const { handle, clear } = createAuthHandler(async () => [record])
  const details = { requestId: 'request', isProxy: true, challenger: { host: 'proxy.example', port: 80 } }
  assert.deepEqual(plain(await handle({ ...details, isProxy: false })), {})
  assert.deepEqual(plain(await handle({ ...details, challenger: { host: 'evil.example', port: 80 } })), {})
  assert.deepEqual(plain(await handle({ ...details, challenger: { host: 'proxy.example', port: 81 } })), {})
  assert.deepEqual(plain(await handle(details)), { authCredentials: { username: 'alice', password: 'secret' } })
  assert.deepEqual(plain(await handle(details)), { cancel: true })
  clear(details)
  assert.ok((await handle(details)).authCredentials)
})

test('auth honors direct service overrides and disabled proxy use', async () => {
  const state = fixture()
  const { handle } = state.createAuthHandler()
  const details = { requestId: 'one', url: 'https://protected.example/', isProxy: true,
    challenger: { host: 'proxy.example', port: 80 } }
  state.setOverride({ hostname: 'protected.example', route: 'DIRECT' })
  assert.deepEqual(plain(await handle(details)), {})
  state.setOverride({ hostname: 'protected.example', route: 'PROXY proxy.example:80' })
  assert.ok((await handle(details)).authCredentials)
  state.disable()
  assert.deepEqual(plain(await handle({ ...details, requestId: 'two' })), {})
})

test('HTTP authentication accepts an unbracketed IPv6 browser challenger', async () => {
  const { createAuthHandler } = fixture(true)
  const { handle } = createAuthHandler(async () => [{ ...record, host: '[::1]' }])
  const result = await handle({ requestId: 'ipv6', isProxy: true,
    challenger: { host: '::1', port: 80 } })
  assert.equal(result.authCredentials.username, 'alice')
})

test('browser auth registration uses Chrome callbacks and Firefox promises with cleanup', async () => {
  for (const firefox of [false, true]) {
    const state = fixture(firefox)
    state.registerProxyAuth()
    assert.deepEqual(Array.from(state.listeners.auth.flags), [firefox ? 'blocking' : 'asyncBlocking'])
    const details = { requestId: 'one', url: 'https://protected.example/', isProxy: true,
      challenger: { host: 'proxy.example', port: 80 } }
    const result = firefox ? await state.listeners.auth.fn(details)
      : await new Promise(resolve => assert.equal(state.listeners.auth.fn(details, resolve), undefined))
    assert.ok(result.authCredentials)
    state.listeners.done.fn(details)
    assert.equal(Boolean(state.listeners.proxy), firefox)
  }
})

test('Firefox SOCKS authentication uses remote DNS and a terminal null failover', async () => {
  const socks = { ...record, protocol: 'SOCKS5', host: '[::1]' }
  const state = load('background/proxy-auth', {
    'browser-api': { default: {} },
    'proxy-route': { proxyRequestAllowed: async () => true, getServiceRoute: () => null },
    proxy: { default: { getRouteForHost: async host => ({ proxies: host === 'protected.example' ? [socks, record] : [] }) } },
  })
  const result = plain(await state.handleFirefoxProxy({ url: 'https://protected.example/' }))
  assert.equal(result[0].type, 'socks')
  assert.equal(result[0].host, '::1')
  assert.equal(result[0].proxyDNS, true)
  assert.equal(result[0].username, 'alice')
  assert.equal(result[1].username, undefined)
  assert.equal(result.at(-1), null)
  assert.equal(await state.handleFirefoxProxy({ url: 'https://direct.example/' }), undefined)
})
