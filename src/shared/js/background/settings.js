import { callBackground } from './background-rpc'
import browser from './browser-api'
import { LOCAL_PROXY_URI } from './proxy-address'
import { settingsDefaults, validateSettings } from './settings-data'

class Settings {
  getName () {
    return 'Censor Tracker'
  }

  getDangerIcon () {
    return browser.runtime.getURL('images/icons/128x128/danger.png')
  }

  changePageIcon (tabId, filename) {
    const title = this.getName()
    const path = browser.runtime.getURL(`images/icons/128x128/${filename}.png`)

    if (browser.isFirefox) {
      browser.browserAction.setIcon({ tabId, path })
      browser.browserAction.setTitle({ title, tabId })
    } else {
      browser.action.setIcon({ tabId, path })
      browser.action.setTitle({ title, tabId })
    }
  }

  async showInstalledPage (tabId) {
    await browser.tabs.create({ url: 'installed.html' })
  }

  setDisableIcon (tabId) {
    this.changePageIcon(tabId, 'disabled')
  }

  setDefaultIcon (tabId) {
    this.changePageIcon(tabId, 'default')
  }

  setDangerIcon (tabId) {
    this.changePageIcon(tabId, 'danger')
  }

  setBlockedIcon (tabId) {
    this.changePageIcon(tabId, 'blocked')
  }

  async extensionEnabled () {
    const { enableExtension } =
      await browser.storage.local.get({ enableExtension: false })

    return enableExtension
  }

  async enableExtension () {
    await browser.storage.local.set({ enableExtension: true })
    console.log('Settings.enableExtension()')
  }

  async disableExtension () {
    await browser.storage.local.set({
      useProxy: false,
      enableExtension: false,
      showNotifications: false,
    })

    if (browser.isFirefox) {
      await browser.browserAction.setBadgeText({ text: '' })
    }

    console.log('Settings.disableExtension()')
  }

  async enableNotifications () {
    await browser.storage.local.set({ showNotifications: true })
  }

  async disableNotifications () {
    await browser.storage.local.set({ showNotifications: false })
  }

  async exportSettings () {
    return {
      formatVersion: 1,
      settings: {
        ...settingsDefaults,
        ...validateSettings(await browser.storage.local.get(null)),
      },
    }
  }

  async importSettings (settings) {
    return callBackground('importSettings', settings)
  }

  async importSettingsInBackground (settings) {
    const values = { ...settingsDefaults, ...validateSettings(settings) }

    await browser.storage.local.set({
      ...values,
      // A backup cannot grant consent for periodic network requests.
      proxySubscriptionsEnabled: false,
      useOwnProxy: values.selectedProxyIds.some((id) => id !== 'builtin'),
      localProxyURI: values.useLocalProxy ? LOCAL_PROXY_URI : null,
    })
  }
}

export default new Settings()
