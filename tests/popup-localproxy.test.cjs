const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

test('the open popup refreshes when local routing changes', () => {
  let changed
  let reloads = 0
  load('pages/popup', {
    'page-errors': {}, 'background-rpc': {}, ignore: {}, proxy: {}, registry: {},
    settings: {}, utilities: {}, 'proxy-info': {}, 'related-domains': {},
    'private-browsing': { mountPrivateBrowsing: () => new Promise(() => {}) },
    'browser-api': { default: { storage: {
      onChanged: { addListener: listener => { changed = listener } },
    } } },
  }, {
    document: { getElementById: () => ({}), querySelectorAll: () => [] },
    window: { location: { reload: () => { reloads++ } } },
  })
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
