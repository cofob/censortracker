const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

function fixture(values = {}) {
  const storage = { enableExtension: true, useProxy: true, ...values }
  const events = []
  let queue = Promise.resolve()
  const withProxyLock = operation => {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }
  const proxy = {
    isEnabled: async () => storage.useProxy ?? true,
    setProxy: async () => events.push('apply'),
    setProxyInBackground: async () => events.push('apply'),
    removeProxy: async () => events.push('remove'),
    removeProxyInBackground: async () => events.push('remove'),
    disableProxy: async () => { storage.useProxy = false; events.push('preference changed') },
  }
  const browser = { tabs: { query: async () => [{ id: 1 }] } }
  const handlers = load('background/handlers', {
    'browser-api': { default: browser },
    proxy: { default: proxy },
    'proxy-route': { withProxyLock },
    settings: { default: {
      extensionEnabled: async () => storage.enableExtension ?? false,
      setDefaultIcon: () => events.push('enabled icon'),
      setDisableIcon: () => events.push('disabled icon'),
    } },
    ignore: { default: {} }, registry: { default: {} },
    server: {}, task: { default: {} }, utilities: {},
    'proxy-importer': {}, 'proxy-recovery': {},
  })
  return { storage, events, proxy, browser, handlers, withProxyLock }
}

for (const [handler, key] of [
  ['handleIgnoredHostsChange', 'ignoredHosts'],
  ['handleCustomProxiedDomainsChange', 'customProxiedDomains'],
]) {
  test(`${handler} waits for the routing update`, async () => {
    const state = fixture()
    let release
    let settled = false
    state.proxy.setProxy = () => {
      state.events.push('apply')
      return new Promise(resolve => { release = resolve })
    }
    const pending = state.handlers[handler]({ [key]: { newValue: [] } }, 'local')
      .then(() => { settled = true })
    await new Promise(resolve => setImmediate(resolve))
    try {
      assert.deepEqual(state.events, ['apply'])
      assert.equal(settled, false)
    } finally {
      release?.()
      await pending
    }
    assert.equal(settled, true)
  })
}

test('storage changes reconcile the latest switches without changing user choices', async () => {
  for (const [values, changes, expected] of [
    [{ useProxy: false }, { enableExtension: { newValue: true }, useProxy: { newValue: false } }, ['remove', 'enabled icon']],
    [{ enableExtension: false, useProxy: true }, { enableExtension: { oldValue: true, newValue: false } }, ['remove', 'disabled icon']],
    [{ enableExtension: false, useProxy: false }, { useProxy: { oldValue: true, newValue: false } }, ['remove']],
    [{ enableExtension: undefined }, { enableExtension: { oldValue: true } }, ['remove', 'disabled icon']],
    [{}, { useProxy: { oldValue: false, newValue: true } }, ['apply']],
  ]) {
    const state = fixture(values)
    const before = { ...state.storage }
    await state.handlers.handleStorageChanged(changes, 'local')
    assert.deepEqual(state.events, expected)
    assert.deepEqual(state.storage, before)
  }
})

test('unrelated storage areas and fields do not change proxy routing', async () => {
  const state = fixture()
  for (const area of ['sync', 'session']) {
    await state.handlers.handleStorageChanged({ useProxy: { newValue: false } }, area)
    await state.handlers.handleIgnoredHostsChange({ ignoredHosts: { newValue: [] } }, area)
    await state.handlers.handleCustomProxiedDomainsChange({ customProxiedDomains: { newValue: [] } }, area)
  }
  await state.handlers.handleStorageChanged({ showNotifications: { newValue: false } }, 'local')
  assert.deepEqual(state.events, [])
})

test('removing a manual list updates routing only while proxying is enabled', async () => {
  for (const [handler, key] of [
    ['handleIgnoredHostsChange', 'ignoredHosts'],
    ['handleCustomProxiedDomainsChange', 'customProxiedDomains'],
  ]) {
    const state = fixture()
    await state.handlers[handler]({ [key]: { oldValue: ['example.com'] } }, 'local')
    assert.deepEqual(state.events, ['apply'])
    state.events.length = 0
    state.storage.enableExtension = false
    await state.handlers[handler]({ [key]: { newValue: [] } }, 'local')
    state.storage.enableExtension = true
    state.storage.useProxy = false
    await state.handlers[handler]({ [key]: { newValue: [] } }, 'local')
    assert.deepEqual(state.events, [])
  }
})

test('a queued settings event reads current choices after it acquires the route lock', async () => {
  for (const [previous, current, action] of [[false, true, 'apply'], [true, false, 'remove']]) {
    const state = fixture({ useProxy: previous })
    let release
    const blocked = state.withProxyLock(() => new Promise(resolve => { release = resolve }))
    await new Promise(resolve => setImmediate(resolve))
    const update = state.handlers.handleStorageChanged({ useProxy: { newValue: previous } }, 'local')
    state.storage.useProxy = current
    release()
    await blocked
    await update
    assert.deepEqual(state.events, [action])
  }
})
