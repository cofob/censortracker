import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'

export const mountRegistrySource = async () => {
  const root = document.getElementById('registrySourceOptions')
  const form = document.getElementById('registrySourceForm')
  const url = document.getElementById('registrySourceUrl')
  const enabled = document.getElementById('registrySourceEnabled')
  const automatic = document.getElementById('registrySourceAutoUpdate')
  const refresh = document.getElementById('registrySourceRefresh')
  const status = document.getElementById('registrySourceStatus')
  const errorMessage = document.getElementById('registrySourceError')
  let busy = false
  const render = (state) => {
    url.value = state.source.url
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
    for (const control of root.querySelectorAll('input, button')) {
      control.disabled = true
    }
    try {
      await callBackground('updateRegistrySource', {
        kind: 'custom',
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
        for (const control of root.querySelectorAll('input, button')) {
          control.disabled = false
        }
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    save(false)
  })
  refresh.addEventListener('click', () => save(true))
  render(await callBackground('registrySourceState'))
  document.getElementById('registrySourceSave').disabled = false
  refresh.disabled = false
}
