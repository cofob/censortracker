import browser from 'Background/browser-api'
import { getMessage } from 'Background/i18n'
import ProxyManager from 'Background/proxy'
import Settings from 'Background/settings'

export const mountPrivateBrowsing = async (
  { warning, button, onSuccess } = {},
) => {
  if (!browser.isFirefox) {
    return
  }
  const message = (key) => getMessage(key)
  const status = document.createElement('p')
  const parent = warning || button
  let busy = false

  status.hidden = true
  parent.after(status)
  const report = (text, failed = false) => {
    status.textContent = text
    status.hidden = false
    status.setAttribute('role', failed ? 'alert' : 'status')
  }
  const apply = async () => {
    if (!await ProxyManager.setProxy()) {
      const { proxySetupError = '' } = await browser.storage.local.get('proxySetupError')

      throw new Error(`${message('proxySetupFailed')} ${proxySetupError}`.trim())
    }
  }
  const refresh = async () => {
    const { privateBrowsingPermissionsRequired } =
      await browser.storage.local.get({
        privateBrowsingPermissionsRequired: false,
      })
    const allowed = await ProxyManager.requestIncognitoAccess()

    button?.classList.toggle('hidden', allowed)
    if (warning) {
      warning.hidden = allowed
    }
    if (!busy && allowed && privateBrowsingPermissionsRequired &&
      await Settings.extensionEnabled() && await ProxyManager.isEnabled()) {
      await apply()
    }
  }
  const refreshSafely = () => refresh().catch((error) => {
    report(error.message, true)
  })

  window.addEventListener('focus', refreshSafely)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshSafely()
    }
  })
  button?.addEventListener('click', async () => {
    if (busy) {
      return
    }
    busy = true
    button.disabled = true
    report(message('proxySetupRunning'))
    try {
      if (!await ProxyManager.requestIncognitoAccess()) {
        throw new Error(message('privateBrowsingStillRequired'))
      }
      if (!await Settings.extensionEnabled()) {
        throw new Error(message('proxySetupExtensionDisabled'))
      }
      await ProxyManager.enableProxy()
      await apply()
      await refresh()
      report(message('proxySetupDone'))
      onSuccess?.()
    } catch (error) {
      report(error.message, true)
    } finally {
      busy = false
      button.disabled = false
    }
  })
  await refreshSafely()
}
