const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

const url = 'https://missing.example/path?next=%3Cscript%3E'
const details = { url, tabId: 1, requestId: 'first', type: 'main_frame', frameId: 0,
  method: 'GET', error: 'net::ERR_CONNECTION_RESET' }
const page = target => 'chrome-extension://test/unavailable.html#' + encodeURIComponent(target)

function fixture(session = true) {
  const storage = { enableExtension: true, useProxy: true }
  const temporary = {}
  const listeners = {}
  const updates = []
  const tabs = new Map([[1, { id: 1, url }]])
  const status = { blocked: false, custom: false, ignored: false }
  let route = 'direct'
  let check = async () => status
  const local = {
    get: async defaults => ({ ...defaults, ...storage }),
    set: async values => Object.assign(storage, structuredClone(values)),
    remove: async key => { delete storage[key] },
  }
  const browser = { runtime: { getURL: name => 'chrome-extension://test/' + name },
    storage: { local, onChanged: { addListener: () => {} } },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('Tab closed'); return { ...tabs.get(id) } },
      update: async (id, options) => { updates.push([id, options.url]); tabs.get(id).url = options.url },
      onRemoved: { addListener: handler => { listeners.removed = handler } },
    },
    webRequest: Object.fromEntries(['onBeforeRequest', 'onErrorOccurred', 'onCompleted'].map(name =>
      [name, { addListener: (handler, filter, options) => {
        assert.deepEqual(Array.from(filter.types), ['main_frame'])
        assert.equal(options, undefined, 'MV3 listeners must not block requests')
        listeners[name] = handler
      } }])),
    webNavigation: { onBeforeNavigate: { addListener: handler => { listeners.navigation = handler } } },
  }
  if (session) browser.storage.session = {
    get: async key => ({ [key]: temporary[key] }),
    set: async values => Object.assign(temporary, structuredClone(values)),
    remove: async key => { delete temporary[key] },
  }
  const mocks = { 'browser-api': { default: browser },
    registry: { default: { getDomainStatus: hostname => {
      assert.equal(hostname, 'missing.example'); return check()
    } } },
    proxy: { default: { getRouteForHost: async () => ({ type: route }) } },
    'proxy-route': { proxyAllowed: async () => storage.enableExtension && storage.useProxy },
  }
  const restart = () => load('background/failed-sites', mocks, {
    fetch: () => { throw new Error('Domain reports must not be sent') },
  })
  const api = restart()
  api.registerFailedSites()
  return { ...api, restart, browser, storage, temporary, listeners, updates, tabs, status,
    setRoute: value => { route = value }, setCheck: value => { check = value } }
}

test('resets, timeouts and DNS failures offer a proxy without changing lists or sending reports', async () => {
  for (const error of ['net::ERR_CONNECTION_RESET', 'ERR_CONNECTION_TIMED_OUT',
    'net::ERR_TIMED_OUT', 'NS_ERROR_NET_RESET', 'NS_ERROR_NET_TIMEOUT',
    'net::ERR_NAME_NOT_RESOLVED', 'NS_ERROR_UNKNOWN_HOST']) {
    const state = fixture()
    await state.handleFailedSite({ ...details, error })
    assert.deepEqual(state.updates, [[1, page(url)]])
    assert.deepEqual(state.storage, { enableExtension: true, useProxy: true })
    assert.deepEqual(state.temporary, {})
  }
})

test('unrelated requests and errors do not offer a proxy', async () => {
  for (const changes of [{ tabId: -1 }, { type: 'sub_frame', frameId: 2 },
    { type: 'xmlhttprequest' }, { frameId: 1 }, { method: 'POST' },
    { error: 'net::ERR_ABORTED' }, { error: 'NS_BINDING_ABORTED' },
    { error: 'net::ERR_CERT_DATE_INVALID' }, { error: 'net::ERR_PROXY_CONNECTION_FAILED' },
    { error: 'net::ERR_INTERNET_DISCONNECTED' }, { error: null }]) {
    const state = fixture()
    await state.handleFailedSite({ ...details, ...changes })
    assert.deepEqual(state.updates, [])
  }
})

test('disabled choices, existing lists and non-direct routes prevent offers', async () => {
  for (const key of ['enableExtension', 'useProxy', 'useDPIDetection']) {
    const state = fixture()
    state.storage[key] = false
    await state.handleFailedSite(details)
    assert.deepEqual(state.updates, [])
  }
  for (const key of ['blocked', 'custom', 'ignored']) {
    const state = fixture()
    state.status[key] = true
    await state.handleFailedSite(details)
    assert.deepEqual(state.updates, [])
  }
  for (const route of ['proxy', 'blocked', 'probe']) {
    const state = fixture()
    state.setRoute(route)
    await state.handleFailedSite(details)
    assert.deepEqual(state.updates, [])
  }
})

test('a new navigation, a closed tab and repeated events do not replace the current page', async () => {
  const changed = fixture()
  changed.setCheck(async () => {
    changed.noteSiteNavigation({ tabId: 1, requestId: 'new' })
    return changed.status
  })
  await changed.handleFailedSite(details)
  assert.deepEqual(changed.updates, [])
  for (const tab of [{ id: 1, url: 'https://other.example/' },
    { id: 1, url, pendingUrl: 'https://other.example/' }]) {
    const state = fixture()
    state.tabs.set(1, tab)
    await state.handleFailedSite(details)
    assert.deepEqual(state.updates, [])
  }
  const closed = fixture()
  closed.tabs.clear()
  await closed.listeners.onErrorOccurred(details)
  assert.deepEqual(closed.updates, [])
  const repeated = fixture()
  await Promise.all([repeated.handleFailedSite(details), repeated.handleFailedSite(details)])
  await repeated.handleFailedSite(details)
  assert.equal(repeated.updates.length, 1)
})

test('one direct retry survives worker restarts and does not change user lists', async () => {
  for (const session of [true, false]) {
    const state = fixture(session)
    state.tabs.get(1).url = page(url)
    await state.retryFailedSite({ tabId: 1, url })
    const api = session ? state.restart() : state
    await api.handleFailedSite(details)
    assert.deepEqual(state.updates, [[1, url]])
    assert.deepEqual(state.temporary, {})
    assert.deepEqual(state.storage, { enableExtension: true, useProxy: true })
    await api.handleFailedSite({ ...details, requestId: 'second' })
    api.noteSiteNavigation({ tabId: 1, requestId: 'second' })
    await api.handleFailedSite({ ...details, requestId: 'second' })
    assert.equal(state.updates.at(-1)[1], page(url))
  }
})

test('navigation tracking permits Firefox error placeholders and rejects a later blank page', async () => {
  const state = fixture()
  state.tabs.get(1).url = 'about:blank'
  state.listeners.navigation({ tabId: 1, frameId: 0, url })
  state.noteSiteNavigation(details)
  await state.handleFailedSite(details)
  assert.deepEqual(state.updates, [[1, page(url)]])
  const changed = fixture()
  changed.noteSiteNavigation(details)
  changed.setCheck(async () => {
    changed.listeners.navigation({ tabId: 1, frameId: 0, url: 'about:blank' })
    changed.tabs.get(1).url = 'about:blank'
    return changed.status
  })
  await changed.handleFailedSite(details)
  assert.deepEqual(changed.updates, [])
})

test('direct retries ignore URL fragments and stop when the route or page changes', async () => {
  const state = fixture()
  const target = url + '#section'
  state.tabs.get(1).url = page(target)
  await state.retryFailedSite({ tabId: 1, url: target })
  await state.handleFailedSite(details)
  assert.equal(state.updates.length, 1)
  const routed = fixture()
  routed.tabs.get(1).url = page(url)
  routed.setRoute('proxy')
  await assert.rejects(routed.retryFailedSite({ tabId: 1, url }), /direct route/)
  const changed = fixture()
  changed.tabs.get(1).url = page(url)
  changed.browser.storage.session.set = async values => {
    Object.assign(changed.temporary, values)
    changed.tabs.get(1).url = 'https://other.example/'
  }
  await assert.rejects(changed.retryFailedSite({ tabId: 1, url }), /page has changed/)
  assert.deepEqual(changed.updates, [])
  assert.deepEqual(changed.temporary, {})
})

test('direct retry state expires and clears on completion or tab closure', async () => {
  for (const finish of ['complete', 'removed', 'expire']) {
    const state = fixture()
    state.tabs.get(1).url = page(url)
    await state.retryFailedSite({ tabId: 1, url })
    if (finish === 'complete') await state.restart().finishSiteRequest(details)
    if (finish === 'removed') {
      state.listeners.removed(1)
      await new Promise(resolve => setImmediate(resolve))
    }
    if (finish === 'expire') state.temporary['failedSiteRetry:1'].expiresAt = 0
    await state.handleFailedSite(details)
    assert.equal(state.updates.at(-1)[1], page(url))
    assert.deepEqual(state.temporary, {})
  }
})

test('direct retry rejects stale tabs and invalid URLs, and clears failed updates', async () => {
  const state = fixture()
  await assert.rejects(state.retryFailedSite({ tabId: 1, url }), /page has changed/)
  state.tabs.get(1).url = page(url)
  state.tabs.get(1).pendingUrl = 'https://other.example/'
  await assert.rejects(state.retryFailedSite({ tabId: 1, url }), /page has changed/)
  delete state.tabs.get(1).pendingUrl
  await assert.rejects(state.retryFailedSite({ tabId: -1, url }), /Invalid site tab/)
  await assert.rejects(state.retryFailedSite({ tabId: 1, url: 'javascript:alert(1)' }))
  state.browser.tabs.update = async () => { throw new Error('Tab closed') }
  await assert.rejects(state.retryFailedSite({ tabId: 1, url }), /Tab closed/)
  assert.deepEqual(state.temporary, {})
})

test('site URLs reject private hosts, credentials, unsupported schemes and malformed input', () => {
  const { parseFailedSiteUrl } = load('background/failed-site-data')
  for (const value of ['http://127.0.0.1/', 'https://[::1]/', 'http://server.local/',
    'file:///tmp/page', 'javascript:alert(1)', 'https://user:secret@missing.example/',
    'https://bad_host.example/', 'not a URL', null, 'https://' + 'a'.repeat(8192)]) {
    assert.throws(() => parseFailedSiteUrl(value))
  }
  assert.equal(parseFailedSiteUrl(url).href, url)
  assert.equal(parseFailedSiteUrl('http://ПРИМЕР.РФ/').hostname, 'xn--e1afmkfd.xn--p1ai')
})

async function pageFixture(failed = false, value = url) {
  const storage = { customProxiedDomains: [] }
  const registry = load('background/registry', { 'browser-api': { default: {
    storage: { local: {
      get: async defaults => ({ ...defaults, ...storage }),
      set: async values => Object.assign(storage, structuredClone(values)),
    } },
  } } }).default
  const calls = []
  const errors = []
  const opened = []
  const elements = Object.fromEntries(['openThroughProxy', 'retryDirect', 'failedSiteUrl'].map(id =>
    [id, { disabled: true, addEventListener: (event, handler) => { elements[id].click = handler } }]))
  load('pages/unavailable', {
    'browser-api': { default: { tabs: { getCurrent: async () => ({ id: 1 }) } } },
    'page-errors': { showPageError: error => errors.push(error.message) },
    i18n: { getMessage: key => key, initializeLanguage: async () => {} },
    'background-rpc': { callBackground: async (action, args) => {
      calls.push([action, structuredClone(args)])
      if (action === 'setSiteChoice') {
        assert.equal(args.choice, 'always')
        await registry.add(args.url)
      }
      if (action === 'proxyRouteInfo') return { type: failed ? 'blocked' : 'proxy' }
      return undefined
    } },
  }, { window: { location: { hash: '#' + encodeURIComponent(value), replace: target => opened.push(target) } },
    document: { getElementById: id => elements[id] } })
  await new Promise(resolve => setImmediate(resolve))
  return { elements, storage, calls, errors, opened }
}

test('the page saves the domain only on proxy choice and opens the original URL', async () => {
  const state = await pageFixture()
  assert.deepEqual(state.storage.customProxiedDomains, [])
  assert.equal(state.elements.failedSiteUrl.textContent, url)
  await state.elements.openThroughProxy.click()
  await state.elements.openThroughProxy.click()
  assert.deepEqual(state.storage.customProxiedDomains, ['missing.example'])
  assert.deepEqual(state.opened, [url, url])
  const direct = await pageFixture()
  await direct.elements.retryDirect.click()
  assert.deepEqual(direct.calls, [['retryFailedSite', { tabId: 1, url }]])
  assert.deepEqual(direct.storage.customProxiedDomains, [])
})

test('the page keeps a saved choice after routing failure and disables invalid targets', async () => {
  const failed = await pageFixture(true)
  await failed.elements.openThroughProxy.click()
  assert.deepEqual(failed.storage.customProxiedDomains, ['missing.example'])
  assert.deepEqual(failed.opened, [])
  assert.deepEqual(failed.errors, ['proxySetupFailed'])
  const invalid = await pageFixture(false, 'javascript:alert(1)')
  assert.equal(invalid.elements.openThroughProxy.disabled, true)
  assert.equal(invalid.elements.retryDirect.disabled, true)
  assert.equal(invalid.errors.length, 1)
})
