import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { MAX_IMPORT_BYTES } from 'Background/proxy-import'

export const mountProxyImport = async (refreshProxies) => {
  const root = document.getElementById('proxyImportOptions')
  const text = document.getElementById('proxyImportText')
  const file = document.getElementById('proxyImportFile')
  const url = document.getElementById('proxyImportUrl')
  const protocol = document.getElementById('proxyImportProtocol')
  const enabled = document.getElementById('proxySubscriptionsEnabled')
  const sources = document.getElementById('proxySubscriptions')
  const status = document.getElementById('proxyImportStatus')
  const message = (key, values) => browser.i18n.getMessage(key, values)
  const render = async () => {
    const state = await callBackground('subscriptions', { operation: 'list' })

    enabled.checked = state.proxySubscriptionsEnabled
    sources.replaceChildren()
    for (const source of state.proxySubscriptions) {
      const row = document.createElement('li')
      const label = document.createElement('span')

      label.textContent = `${source.protocol} — ${new URL(source.url).hostname} `
      row.append(label)
      for (const [key, action] of [
        ['proxyRefresh', () => callBackground('refreshSubscription', { id: source.id })],
        ['proxyDelete', () => callBackground('subscriptions', { operation: 'remove', id: source.id })],
      ]) {
        const button = document.createElement('button')

        button.type = 'button'
        button.textContent = message(key)
        button.addEventListener('click', () => run(action))
        row.append(button)
      }
      sources.append(row)
    }
  }
  const run = async (action) => {
    for (const control of root.querySelectorAll('input, button, textarea, select')) {
      control.disabled = true
    }
    status.textContent = message('proxyImportWorking')
    try {
      const result = await action()

      status.textContent = result?.added !== undefined
        ? message('proxyImportResult', [String(result.added), String(result.skipped)])
        : ''
      if (result?.truncated) {
        status.textContent += ` ${message('proxyImportLimit')}`
      }
      if (result?.fromPac) {
        status.textContent += ` ${message('proxyPacWarning')}`
      }
      await refreshProxies()
    } catch (error) {
      status.textContent = message('proxyImportFailed')
    } finally {
      for (const control of root.querySelectorAll('input, button, textarea, select')) {
        control.disabled = false
      }
      await render()
    }
  }

  document.getElementById('proxyImportButton').addEventListener('click', () => run(async () => {
    const selected = file.files[0]

    if (selected?.size > MAX_IMPORT_BYTES) {
      throw new Error('Proxy file is too large')
    }
    return callBackground('importProxies', {
      text: selected ? await selected.text() : text.value,
      pac: Boolean(selected?.name.toLowerCase().endsWith('.pac')),
      protocol: protocol.value,
    })
  }))
  document.getElementById('proxyImportUrlButton').addEventListener('click', () => run(
    () => callBackground('importProxies', { url: url.value.trim(), protocol: protocol.value }),
  ))
  document.getElementById('proxySubscribeButton').addEventListener('click', () => run(
    () => callBackground('subscriptions', { operation: 'add', url: url.value.trim(), protocol: protocol.value }),
  ))
  enabled.addEventListener('change', () => run(() => callBackground('subscriptions', {
    operation: 'enable', enabled: enabled.checked,
  })))
  await render()
}
