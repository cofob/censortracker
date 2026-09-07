const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')
const { proxyFingerprint } = load('background/proxy-check-data')
const plain = value => JSON.parse(JSON.stringify(value))

const fixture = async () => {
  const proxy = { id: 'one', name: 'My proxy', protocol: 'HTTP', host: 'proxy.example', port: 8080,
    username: 'alice', password: 'secret' }
  const storage = { proxyChecks: { one: { status: 'ok', checkedAt: 123456,
    fingerprint: await proxyFingerprint(proxy), exitIP: '8.8.8.8', exitCountry: 'US', serverCountry: 'DE' } } }
  let enabled = true
  let route = { type: 'proxy', proxies: [proxy, { ...proxy, id: 'two' }] }
  let revision = 0
  let beforeRead = () => {}
  const api = load('background/proxy-info', {
    'browser-api': { default: { storage: { local: { get: async defaults => { beforeRead(); return { ...defaults, ...storage } } } } } },
    'proxy-route': { proxyAllowed: async () => enabled, getRouteRevision: () => revision },
    proxy: { default: { getRouteForHost: async () => route } },
    registry: { default: { getDomains: async () => ['protected.example'] } },
  }, { fetch: () => { throw new Error('Popup must not request the network') } })
  return { ...api, proxy, storage, setEnabled: value => { enabled = value },
    setRoute: value => { route = value; revision++ }, beforeRead: fn => { beforeRead = fn } }
}

test('public route information exposes the planned primary and last checked exit, without secrets', async () => {
  const state = await fixture()
  const info = plain(await state.describeProxyRoute({ url: 'https://protected.example/path' }))
  assert.equal(info.proxy.name, 'My proxy')
  assert.equal(info.fallbackCount, 1)
  assert.equal(info.check.exitIP, '8.8.8.8')
  assert.equal(info.check.exitCountry, 'US')
  assert.equal(info.check.checkedAt, 123456)
  assert.doesNotMatch(JSON.stringify(info), /alice|secret|fingerprint|username|password|serverCountry/)
  state.proxy.password = 'changed'
  assert.equal((await state.describeProxyRoute({ url: 'protected.example' })).check, null)
})

test('direct, blocked, and inactive routes never show an unrelated proxy IP', async () => {
  const state = await fixture()
  for (const type of ['direct', 'blocked']) {
    state.setRoute({ type, proxies: [] })
    const info = await state.describeProxyRoute({ url: 'protected.example' })
    assert.equal(info.type, type)
    assert.equal(info.proxy, null)
    assert.equal(info.check, null)
  }
  state.setEnabled(false)
  assert.deepEqual(plain(await state.describeProxyRoute({ url: 'protected.example' })), { type: 'disabled' })
  assert.deepEqual(plain(await state.describeProxyRoute({ url: 'about:blank' })), { type: 'unavailable' })
})

test('route descriptions discard a snapshot if routing changes while metadata is read', async () => {
  const state = await fixture()
  state.beforeRead(() => { state.beforeRead(() => {}); state.setRoute({ type: 'blocked', proxies: [] }) })
  const info = await state.describeProxyRoute({ url: 'protected.example' })
  assert.equal(info.type, 'blocked')
  assert.equal(info.proxy, null)
})

test('popup renders text safely and clears the old exit when another extension takes proxy control', async () => {
  class Element {
    children = []
    textContent = ''
    set innerHTML(value) { throw new Error('Must not parse HTML') }
    replaceChildren() { this.children = [] }
    append(node) { this.children.push(node) }
  }
  const elements = Object.fromEntries(['proxyRouteSummary', 'proxyRouteExit', 'proxyingDetailsText'].map(id => [id, new Element()]))
  let info = { type: 'proxy', proxy: { name: '<img src=x>', protocol: 'HTTP', host: 'proxy.example', port: 80 },
    check: { status: 'ok', checkedAt: 123456, exitIP: '8.8.8.8', exitCountry: 'US' },
    region: '<script>bad()</script>', domainCount: 42, fallbackCount: 1 }
  let controlChanged
  let scheduled
  const { mountProxyInfo } = load('pages/proxy-info', {
    'browser-api': { default: { i18n: { getUILanguage: () => 'en', getMessage: (key, values) => `${key} ${[].concat(values || []).join(' ')}` },
      proxy: { settings: { onChange: { addListener: handler => { controlChanged = handler } } } },
      storage: { onChanged: { addListener() {} } } } },
    'background-rpc': { callBackground: async () => info },
  }, { document: { getElementById: id => elements[id], createElement: () => new Element() },
    setTimeout: callback => { scheduled = callback; return 1 }, clearTimeout() {},
    fetch: () => { throw new Error('Popup must not request the network') },
  })
  await mountProxyInfo('https://protected.example')
  assert.match(elements.proxyRouteSummary.textContent, /<img src=x>/)
  assert.match(elements.proxyRouteExit.textContent, /8\.8\.8\.8.*United States/)
  assert.ok(elements.proxyingDetailsText.children.some(node => node.textContent.includes('<script>bad()</script>')))
  assert.ok(elements.proxyingDetailsText.children.some(node => node.textContent.includes('popupRouteCheckedAt')))
  info = { type: 'disabled' }
  controlChanged({ levelOfControl: 'controlled_by_other_extensions' })
  await scheduled()
  assert.equal(elements.proxyRouteExit.textContent, '')
  assert.match(elements.proxyRouteSummary.textContent, /popupRoute_disabled/)
})
