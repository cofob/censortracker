const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

test('old profiles derive registry status from their cache', async () => {
  for (const domains of [[], ['cached.example']]) {
    const registry = load('background/registry', { 'browser-api': { default: { storage: { local: {
      get: async defaults => ({ ...defaults, domains }),
    } } } } }).default
    const status = await registry.getStatus()
    assert.equal(status.state, domains.length ? 'ready' : 'not_loaded')
    assert.equal(status.skipped, 0)
    assert.equal(status.error, '')
  }
})

test('registry UI separates source failure from an empty list and updates skipped counts', async () => {
  let status = { state: 'empty', skipped: 0, error: '' }
  let changed
  let hidden
  const summary = {}
  const title = {}
  const description = {}
  const warning = { classList: { toggle: (name, value) => { hidden = value } },
    querySelector: selector => selector === '.extension__title' ? title : description }
  const page = load('pages/registry-status', {
    'browser-api': { default: { i18n: { getMessage: (key, value) => value ? `${key}: ${value}` : key },
      storage: { onChanged: { addListener: fn => { changed = fn } } } } },
    'background-rpc': { callBackground: async action => action === 'registryStatus' ? status : status.state !== 'ready' },
    'page-errors': { showPageError: error => { throw error } },
  }, { document: { getElementById: () => summary } })
  await page.mountRegistryStatus(warning)
  assert.equal(title.textContent, 'registryStatus_empty')
  status = { state: 'unavailable', skipped: 0, error: 'Registry: HTTP 503' }
  changed({ registryStatus: {} }, 'local')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(title.textContent, 'registryStatus_unavailable')
  assert.equal(description.textContent, 'Registry: HTTP 503')
  assert.equal(hidden, false)
  status = { state: 'ready', skipped: 1, error: '' }
  changed({ registryStatus: {} }, 'local')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(summary.textContent, /registrySkipped: 1/)
  assert.equal(hidden, true)
  assert.equal(summary.hidden, true)
  status = { state: 'unavailable', skipped: 0, error: 'Registry: HTTP 503' }
  changed({ registryStatus: {} }, 'local')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(summary.hidden, false)
})
