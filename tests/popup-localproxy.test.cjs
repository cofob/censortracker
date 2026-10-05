const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

test('the open popup refreshes when local routing changes', async () => {
  let changed
  let reloads = 0
  load('pages/popup', {
    'page-errors': {}, 'background-rpc': {}, ignore: {}, proxy: {}, registry: {},
    i18n: { initializeLanguage: async () => 'auto', getUILanguage: () => 'en' },
    settings: {}, utilities: {}, 'proxy-info': {}, 'related-domains': {},
    'private-browsing': { mountPrivateBrowsing: () => new Promise(() => {}) },
    'browser-api': { default: { storage: {
      onChanged: { addListener: listener => { changed = listener } },
    } } },
  }, {
    document: { documentElement: {}, getElementById: () => ({}), querySelectorAll: () => [] },
    window: { location: { reload: () => { reloads++ } } },
  })
  await new Promise(resolve => setImmediate(resolve))
  for (const key of ['useLocalProxy', 'localProxyAlive', 'useProxy']) {
    for (const [oldValue, newValue] of [[false, true], [true, false]]) {
      changed({ [key]: { oldValue, newValue } }, 'local')
    }
    changed({ [key]: { oldValue: true, newValue: true } }, 'local')
    changed({ [key]: { oldValue: false, newValue: true } }, 'sync')
  }
  changed({ localProxyURI: { newValue: '127.0.0.1:23456' } }, 'local')
  changed({ enableExtension: { oldValue: false, newValue: true } }, 'local')
  assert.equal(reloads, 6)
})
