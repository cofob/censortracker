const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const load = require('./load.cjs')

const source = fs.readFileSync(path.join(__dirname, '../src/shared/js/pages/advanced-options.js'), 'utf8')
const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']

function diagnosticPage() {
  const button = () => ({ addEventListener(name, handler) { this.click = handler } })
  const showDebugInfoBtn = button()
  const exportSettingsBtn = button()
  const exportSupportBtn = button()
  const debugInfoJSON = {}
  const copyDebugInfoBtn = {}
  const downloads = []
  const errors = []
  const revoked = []
  const popups = []
  let data = { reportType: 'censortracker-diagnostics', generatedAt: 'first' }
  let failure
  const debug = source.slice(source.indexOf('  showDebugInfoBtn.addEventListener'),
    source.indexOf('  confirmResetBtn.addEventListener'))
  const exports = source.slice(source.indexOf('  const exportFile'),
    source.indexOf('  importSettingsInput.addEventListener'))
  vm.runInNewContext(debug + exports, {
    showDebugInfoBtn, exportSettingsBtn, exportSupportBtn, debugInfoJSON, copyDebugInfoBtn,
    getMessage: key => key,
    callBackground: async action => {
      assert.equal(action, 'diagnosticInfo')
      if (failure) throw failure
      return data
    },
    Settings: { exportSettings: async () => ({ formatVersion: 1, settings: { useProxy: true } }) },
    togglePopup: id => popups.push(id), showPageError: error => errors.push(error.message),
    Blob, URL: { createObjectURL: blob => blob, revokeObjectURL: url => revoked.push(url) },
    document: { body: { append() {} }, createElement: () => ({ style: {},
      click() { downloads.push({ filename: this.download, blob: this.href }) }, remove() {},
    }) },
  })
  return { showDebugInfoBtn, exportSettingsBtn, exportSupportBtn, debugInfoJSON,
    copyDebugInfoBtn, downloads, revoked, errors, popups,
    update: value => { data = value }, fail: error => { failure = error } }
}

test('debug information refreshes the textarea and restores its button after errors', async () => {
  const page = diagnosticPage()
  await page.showDebugInfoBtn.click()
  assert.equal(JSON.parse(page.debugInfoJSON.value).generatedAt, 'first')
  page.update({ generatedAt: 'second' })
  await page.showDebugInfoBtn.click()
  assert.equal(JSON.parse(page.debugInfoJSON.value).generatedAt, 'second')
  assert.equal(page.copyDebugInfoBtn.textContent, 'copyButton')
  assert.equal(page.popups.length, 2)
  page.fail(new Error('Background unavailable'))
  await page.showDebugInfoBtn.click()
  assert.equal(page.showDebugInfoBtn.disabled, false)
  assert.deepEqual(page.errors, ['Background unavailable'])
})

test('exports download the correct documents and release each download URL', async () => {
  const page = diagnosticPage()
  await page.exportSettingsBtn.click()
  await page.exportSupportBtn.click()
  assert.deepEqual(page.downloads.map(({ filename }) => filename),
    ['censortracker.settings.json', 'censortracker.diagnostics.json'])
  assert.equal(JSON.parse(await page.downloads[0].blob.text()).formatVersion, 1)
  assert.equal(JSON.parse(await page.downloads[1].blob.text()).reportType, 'censortracker-diagnostics')
  assert.equal(page.revoked.length, 2)
  assert.equal(page.exportSettingsBtn.disabled, false)
  assert.equal(page.exportSupportBtn.disabled, false)
  page.fail(new Error('Background unavailable'))
  await page.exportSupportBtn.click()
  assert.equal(page.exportSupportBtn.disabled, false)
  assert.equal(page.downloads.length, 2)
  assert.deepEqual(page.errors, ['Background unavailable'])
})

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

test('reset shows success or a visible error and restores its button', async () => {
  for (const failure of [null, 'import', 'sync', 'proxy', 'services', 'ping', 'private-permission']) {
    const button = { addEventListener(name, handler) { this.click = handler } }
    const visible = new Set(['popupConfirmReset'])
    const allowed = failure !== 'private-permission'
    const failed = failure !== null && allowed
    const errors = []
    let finish
    const reset = source.slice(source.indexOf('  confirmResetBtn.addEventListener'),
      source.indexOf('  const exportFile'))
    vm.runInNewContext(reset, {
      confirmResetBtn: button,
      Settings: { importSettings: async settings => {
        assert.equal(settings.enableExtension, true)
        await new Promise(resolve => { finish = resolve })
        if (failure === 'import') throw new Error('Import failed')
      } },
      ProxyManager: { removeBadProxies: async () => {},
        requestIncognitoAccess: async () => allowed,
        setProxy: async () => {
          assert.equal(allowed, true)
          return failure !== 'proxy'
        },
        ping: async () => {
          assert.equal(allowed, true)
          if (failure === 'ping') throw new Error('Ping failed')
        } },
      server: { synchronize: async () => {
        if (failure === 'sync') throw new Error('Download failed')
      } },
      browser: { storage: { local: { get: async () => ({
        serviceErrors: failure === 'services' ? ['Service failed'] : [],
      }) } } },
      getMessage: key => key,
      togglePopup: id => visible.has(id) ? visible.delete(id) : visible.add(id),
      document: { getElementById: id => ({ classList: { remove: () => visible.delete(id) } }) },
      showPageError: error => {
        assert.equal(visible.has('popupConfirmReset'), false)
        errors.push(error.message)
      },
      console: { info() {} },
    })
    const pending = button.click()
    assert.equal(button.disabled, true)
    finish()
    await pending
    assert.equal(button.disabled, false)
    assert.equal(visible.has('popupConfirmReset'), false)
    assert.equal(visible.has('popupCompletedSuccessfully'), !failed)
    assert.equal(errors.length, failed ? 1 : 0)
  }
})
