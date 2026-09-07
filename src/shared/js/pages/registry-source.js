import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { registrySourceUrls } from 'Background/registry-source-data'

export const mountRegistrySource = async () => {
  const root = document.getElementById('registrySourceOptions')
  const form = document.getElementById('registrySourceForm')
  const kind = document.getElementById('registrySourceKind')
  const url = document.getElementById('registrySourceUrl')
  const enabled = document.getElementById('registrySourceEnabled')
  const automatic = document.getElementById('registrySourceAutoUpdate')
  const refresh = document.getElementById('registrySourceRefresh')
  const status = document.getElementById('registrySourceStatus')
  const errorMessage = document.getElementById('registrySourceError')
  let busy = false
  const showProvider = () => {
    url.readOnly = kind.value !== 'custom'
    document.getElementById('registrySourceAnticensority').hidden =
      kind.value !== 'anticensority'
  }
  const render = (state) => {
    kind.value = state.source.kind
    url.value = state.source.url
    showProvider()
    enabled.checked = state.source.enabled
    automatic.checked = state.source.autoUpdate
    status.textContent = browser.i18n.getMessage('registrySourceStatus', [
      String(state.count), state.updatedAt
        ? new Date(state.updatedAt).toLocaleString()
        : browser.i18n.getMessage('registrySourceNotDownloaded'),
    ])
  }
  const save = async (download) => {
    if (busy) {
      return
    }
    busy = true
    errorMessage.hidden = true
    for (const control of root.querySelectorAll('input, button, select')) {
      control.disabled = true
    }
    try {
      await callBackground('updateRegistrySource', {
        kind: kind.value,
        url: url.value.trim(),
        enabled: enabled.checked,
        autoUpdate: automatic.checked,
      })
      if (download) {
        await callBackground('refreshRegistrySource')
      }
    } catch (error) {
      errorMessage.hidden = false
    } finally {
      try {
        render(await callBackground('registrySourceState'))
      } finally {
        busy = false
        for (const control of root.querySelectorAll('input, button, select')) {
          control.disabled = false
        }
      }
    }
  }

  kind.addEventListener('change', () => {
    url.value = registrySourceUrls[kind.value] || ''
    enabled.checked = false
    automatic.checked = false
    showProvider()
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    save(false)
  })
  refresh.addEventListener('click', () => save(true))
  render(await callBackground('registrySourceState'))
  document.getElementById('registrySourceSave').disabled = false
  refresh.disabled = false
}
