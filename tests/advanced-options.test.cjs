const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const load = require('./load.cjs')

const source = fs.readFileSync(path.join(__dirname, '../src/shared/js/pages/advanced-options.js'), 'utf8')
const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']

async function fixture(saved = false, apply = async () => {}) {
  const listeners = {}
  const checkbox = { addEventListener: (name, handler) => { listeners.change = handler } }
  const extended = { hidden: true }
  const errors = []
  const calls = []
  const elements = { proxyAll: checkbox, extendedSettings: extended }
  const state = { saved, checkbox, extended, errors, calls }
  const setup = source.slice(source.indexOf('  const proxyAllCheckbox'), source.indexOf('  updateLocalRegistryBtn.addEventListener'))
  const keyboard = source.slice(source.indexOf("  document.addEventListener('keydown'"), source.indexOf('  showDebugInfoBtn.addEventListener'))
  const keyHandlers = []
  const document = { getElementById: id => elements[id], getElementsByClassName: () => [],
    addEventListener: (name, handler) => { keyHandlers.push(handler) } }
  await vm.runInNewContext('(async () => {' + setup + keyboard + '})()', {
    document,
    mountKeySequence: load('pages/key-sequence', {}, { document }).mountKeySequence,
    browser: { storage: { local: { get: async () => ({ proxyAll: state.saved }) } } },
    callBackground: async (action, value) => {
      calls.push([action, value])
      await apply(state, value)
      state.saved = value
    },
    showPageError: error => errors.push(error.message),
  })
  state.key = (key, options = {}) => Promise.all(keyHandlers.map(handler => handler({ key, repeat: false,
    target: { closest: () => null, isContentEditable: false }, ...options })))
  state.enter = async (keys = sequence, options) => {
    for (const key of keys) await state.key(key, options)
  }
  state.change = listeners.change
  return state
}

test('only the complete sequence reveals extended settings without changing preferences', async () => {
  const state = await fixture(true)
  assert.equal(state.checkbox.checked, true)
  await state.enter(sequence.slice(0, -1))
  assert.equal(state.extended.hidden, true)
  await state.key('x')
  await state.key('a')
  assert.equal(state.extended.hidden, true)
  await state.enter(sequence.map(key => key.length === 1 ? key.toUpperCase() : key))
  assert.equal(state.extended.hidden, false)
  await state.enter()
  assert.equal(state.extended.hidden, false)
  assert.deepEqual(state.calls, [])
  assert.equal((await fixture(state.saved)).extended.hidden, true)
})

test('the other-page key sequence opens the bundled animation in a tab', async () => {
  let keydown
  const tabs = []
  load('pages/easter-egg', { 'browser-api': { default: {
    runtime: { getURL: page => 'chrome-extension://test/' + page },
    tabs: { create: options => tabs.push(options) },
  } } }, { document: { addEventListener: (name, handler) => { keydown = handler } } })
  for (const key of sequence) keydown({ key, target: {} })
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].url, 'chrome-extension://test/animation.html')
})

test('held keys are ignored and text input clears sequence progress', async () => {
  const state = await fixture()
  await state.key(sequence[0])
  await state.key(sequence[0], { repeat: true })
  await state.enter(sequence.slice(1))
  assert.equal(state.extended.hidden, false)
  for (const target of [{ closest: () => ({}), isContentEditable: false },
    { closest: () => null, isContentEditable: true }]) {
    const input = await fixture()
    await input.enter(sequence.slice(0, 2))
    await input.key('ArrowDown', { target })
    await input.enter(sequence.slice(2))
    await input.enter(sequence, { target })
    assert.equal(input.extended.hidden, true)
    await input.enter()
    assert.equal(input.extended.hidden, false)
  }
})

test('proxy changes use the background action and restore saved state after errors', async () => {
  for (const fail of [false, true]) {
    let finish
    const state = await fixture(false, async () => {
      await new Promise(resolve => { finish = resolve })
      if (fail) throw new Error('Routing failed')
    })
    state.checkbox.checked = true
    const pending = state.change()
    assert.equal(state.checkbox.disabled, true)
    finish()
    await pending
    assert.deepEqual(state.calls, [['setProxyAll', true]])
    assert.equal(state.checkbox.checked, !fail)
    assert.equal(state.checkbox.disabled, false)
    assert.deepEqual(state.errors, fail ? ['Routing failed'] : [])
    state.checkbox.checked = false
    const disabled = state.change()
    finish()
    await disabled
    assert.deepEqual(state.calls[1], ['setProxyAll', false])
  }
})
