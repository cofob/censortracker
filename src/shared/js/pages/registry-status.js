import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { getMessage } from 'Background/i18n'

import { showPageError } from './page-errors'

export const mountRegistryStatus = async (warning) => {
  const summary = document.getElementById('builtinRegistryStatus')
  const refresh = async () => {
    const status = await callBackground('registryStatus')
    let text = getMessage(`registryStatus_${status.state}`)

    if (status.skipped > 0) {
      text += ` ${getMessage('registrySkipped', String(status.skipped))}`
    }
    if (status.error) {
      text += ` ${status.error}`
    }
    summary.textContent = text
    summary.hidden = status.state === 'ready' && !status.error
    if (warning) {
      const empty = await callBackground('registryEmpty')

      warning.classList.toggle('hidden', !empty && status.state !== 'unavailable')
      warning.querySelector('.extension__title').textContent =
        status.state === 'ready' ? getMessage('optionsRegistryIsEmptyTitle')
          : getMessage(`registryStatus_${status.state}`)
      warning.querySelector('.extension__text').textContent =
        status.error || (['ready', 'empty'].includes(status.state)
          ? getMessage('optionsRegistryIsEmptyDesc') : text)
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
