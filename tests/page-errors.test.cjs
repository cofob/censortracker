const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load.cjs')

test('a failed task stops the loader and displays one accessible error', () => {
  const loading = { style: { display: 'flex' } }
  let message
  let handler
  let count = 0
  let successVisible = true
  load('pages/page-errors', {
    'browser-api': { default: { i18n: { getMessage: () => 'Operation failed' } } },
  }, {
    window: { addEventListener: (event, fn) => { handler = fn } },
    document: {
      getElementById: id => id === 'loading' ? loading
        : id === 'popupCompletedSuccessfully'
          ? { classList: { remove: () => { successVisible = false } } } : message,
      createElement: () => ({ setAttribute: (key, value) => assert.equal(value, 'alert') }),
      querySelector: () => ({ prepend: node => { message = node; count++ } }),
    },
  })
  handler()
  handler()
  assert.equal(loading.style.display, 'none')
  assert.equal(message.textContent, 'Operation failed')
  assert.equal(count, 1)
  assert.equal(successVisible, false)
})
