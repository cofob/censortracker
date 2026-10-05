import browser from 'Background/browser-api'
import Registry from 'Background/registry'

import { showPageError } from './page-errors'

export const mountRegistryStatus = async (warning) => {
  const summary = document.getElementById('builtinRegistryStatus')
  const refresh = async () => {
    const status = await Registry.getStatus()
    let text = browser.i18n.getMessage(`registryStatus_${status.state}`)

    if (status.skipped > 0) {
      text += ` ${browser.i18n.getMessage('registrySkipped', String(status.skipped))}`
    }
    if (status.error) {
      text += ` ${status.error}`
    }
    summary.textContent = text
    summary.hidden = status.state === 'ready' && !status.error
    if (warning) {
      const empty = await Registry.isEmpty()

      warning.classList.toggle('hidden', !empty && status.state !== 'unavailable')
      warning.querySelector('.extension__title').textContent =
        status.state === 'ready' ? browser.i18n.getMessage('optionsRegistryIsEmptyTitle')
          : browser.i18n.getMessage(`registryStatus_${status.state}`)
      warning.querySelector('.extension__text').textContent =
        status.error || (['ready', 'empty'].includes(status.state)
          ? browser.i18n.getMessage('optionsRegistryIsEmptyDesc') : text)
    }
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['registryStatus', 'domains', 'useRegistry',
      'customProxiedDomains', 'registrySource', 'externalRegistry']
      .some((key) => changes[key])) {
      refresh().catch(showPageError)
    }
  })
  await refresh()
}
