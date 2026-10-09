const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

function fixture() {
  const state = {}
  const listeners = []
  const tabs = []
  const focus = []
  let failWrite = false
  const browser = {
    storage: {
      local: {
        get: async keys => Object.fromEntries(keys.map(key => [key, state[key]])),
        set: async values => {
          if (failWrite) throw new Error('Storage failed')
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) =>
            [key, { oldValue: state[key], newValue: value }]))
          Object.assign(state, values)
          listeners.forEach(listener => listener(changes, 'local'))
        },
      },
      onChanged: { addListener: listener => listeners.push(listener) },
    },
    runtime: { getURL: path => `extension://${path}` },
    tabs: {
      query: async () => tabs,
      create: async tab => tabs.push({ ...tab, id: 1, windowId: 2 }),
      update: async (id, options) => focus.push({ id, ...options }),
    },
    windows: { update: async (id, options) => focus.push({ id, ...options }) },
  }
  const mocks = { 'browser-api': { default: browser } }
  const api = load('background/extension-notices', mocks)
  return { state, browser, api, mocks, tabs, focus,
    fail: value => { failWrite = value } }
}

for (const reason of ['install', 'update']) {
  test(`${reason} activates notices once and keeps dismissal across updates`, async () => {
    const { api, state } = fixture()
    assert.equal(await api.activateNotices(reason), true)
    assert.equal((await api.pendingNotices())[0].id, 'release-21')
    assert.equal(await api.activateNotices(reason), false)
    await api.dismissNotice('release-21')
    assert.equal(await api.activateNotices('update'), false)
    assert.equal((await api.pendingNotices()).length, 0)
    assert.equal(state['noticeRead:release-21'], true)
  })
}

test('browser updates do not activate notices; catalog order sets the queue', async () => {
  const { api } = fixture()
  api.extensionNotices.push({ id: 'next', title: 'title', text: 'text', events: ['update'] })
  assert.equal(await api.activateNotices('browser_update'), false)
  await api.activateNotices('install')
  await api.activateNotices('update')
  assert.equal((await api.pendingNotices()).map(n => n.id).join(), 'release-21,next')
  await Promise.all([api.dismissNotice('next'), api.dismissNotice('release-21')])
  assert.equal((await api.pendingNotices()).length, 0)
})

test('opening notices reuses and focuses their existing tab', async () => {
  const { api, tabs, focus } = fixture()
  await api.openNotices()
  await api.openNotices()
  assert.equal(tabs.length, 1)
  assert.equal(focus[0].active, true)
  assert.equal(focus[1].focused, true)
})

function element() {
  return {
    children: [], listeners: {}, hidden: false, disabled: false,
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes) },
    prepend(node) { this.children.unshift(node) },
    addEventListener(event, listener) { this.listeners[event] = listener },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

function view(f, closeWhenEmpty = false) {
  let closed = 0
  const host = element()
  const { mountNotices } = load('pages/notice-panel', {
    ...f.mocks,
    'extension-notices': f.api,
    i18n: { initializeLanguage: async () => {}, getMessage: key => key },
  }, {
    document: { createElement: element },
    window: { close: () => { closed++ } },
  })
  return { host, closed: () => closed,
    mount: () => mountNotices(host, closeWhenEmpty) }
}

test('dismissal advances all views, persists, and closes only the dedicated page', async () => {
  const f = fixture()
  f.api.extensionNotices.push({ id: 'next', title: 'nextTitle', text: 'nextText', events: ['install'] })
  await f.api.activateNotices('install')
  const popup = view(f)
  const consent = view(f)
  const page = view(f, true)
  await Promise.all([popup.mount(), consent.mount(), page.mount()])
  const [title, , button] = popup.host.children[0].children
  assert.equal(title.textContent, 'release21Title')
  await button.listeners.click()
  await flush()
  assert.equal(title.textContent, 'nextTitle')
  assert.equal(consent.host.children[0].children[0].textContent, 'nextTitle')
  assert.equal(page.host.children[0].children[0].textContent, 'nextTitle')
  assert.equal(page.closed(), 0)
  await button.listeners.click()
  await flush()
  assert.equal(popup.host.children[0].hidden, true)
  assert.equal(consent.closed(), 0)
  assert.ok(page.closed() > 0)
  const reopened = view(f)
  await reopened.mount()
  assert.equal(reopened.host.children[0].hidden, true)
  assert.equal(f.state.dataConsent, undefined)
})

test('failed dismissal leaves the notice visible and permits retry', async () => {
  const f = fixture()
  await f.api.activateNotices('update')
  const popup = view(f)
  await popup.mount()
  const section = popup.host.children[0]
  const [, , button, error] = section.children
  f.fail(true)
  await button.listeners.click()
  assert.equal(section.hidden, false)
  assert.equal(button.disabled, false)
  assert.equal(error.textContent, 'operationFailed')
  f.fail(false)
  await button.listeners.click()
  assert.equal(section.hidden, true)
})
