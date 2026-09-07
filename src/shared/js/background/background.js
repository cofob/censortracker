import {
  handleBeforeRequest,
  handleCustomProxiedDomainsChange,
  handleIgnoredHostsChange,
  handleInstalled,
  handleOnAlarm,
  handleOnUpdateAvailable,
  handleProxyError,
  handleStartup,
  handleStorageChanged,
  handleTabCreate,
  handleTabState,
} from 'Background/handlers'

import { registerBackground } from './background-rpc'
import browser from './browser-api'
import ProxyManager from './proxy'
import { registerProxyAuth } from './proxy-auth'
import { importProxies, refreshSubscription, scheduleSubscriptions, updateSubscriptions } from './proxy-importer'
import { updateProxyList } from './proxy-list'
import { proxyAllowed, withProxyLock } from './proxy-route'
import { synchronizeInBackground } from './server'
import Settings from './settings'

registerProxyAuth()

const rescheduleSubscriptions = () => scheduleSubscriptions().catch(() => {
  console.warn('Could not schedule proxy subscriptions')
})

rescheduleSubscriptions()
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.proxySubscriptions || changes.proxySubscriptionsEnabled || changes.enableExtension)) {
    rescheduleSubscriptions()
  }
})

withProxyLock(() => {}).catch((error) => {
  console.error('[Service] Route recovery failed', error)
})

registerBackground({
  importProxies,
  subscriptions: updateSubscriptions,
  refreshSubscription: ({ id }) => refreshSubscription({ id }),
  setProxyAll: (enabled) => withProxyLock(async () => {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('Invalid proxy-all option')
    }
    await browser.storage.local.set({ proxyAll: enabled })
    if (!await ProxyManager.setProxyInBackground() && await proxyAllowed()) {
      throw new Error('Proxy mode saved, but routing could not be applied')
    }
  }),
  importSettings: (args) => withProxyLock(async () => {
    await Settings.importSettingsInBackground(args)
    await ProxyManager.setProxyInBackground()
  }),
  proxies: (args) => withProxyLock(async () => {
    const state = await updateProxyList(args)

    if (args.operation !== 'list') {
      await ProxyManager.setProxyInBackground()
    }
    return state
  }),
  synchronize: synchronizeInBackground,
  setProxy: () => withProxyLock(() => ProxyManager.setProxyInBackground()),
  removeProxy: () => withProxyLock(
    () => ProxyManager.removeProxyInBackground(),
  ),
})

const registerListener = (event, eventName, listener, ...args) => {
  if (typeof event?.addListener !== 'function') {
    console.warn(`[Background] ${eventName} is unavailable.`)
    return
  }

  event.addListener(listener, ...args)
}

// Handle alarms for async tasks
registerListener(browser.alarms?.onAlarm, 'alarms.onAlarm', handleOnAlarm)
// Handle extension lifecycle events
registerListener(browser.runtime?.onStartup, 'runtime.onStartup', handleStartup)
registerListener(browser.runtime?.onInstalled, 'runtime.onInstalled', handleInstalled)
registerListener(
  browser.runtime?.onUpdateAvailable,
  'runtime.onUpdateAvailable',
  handleOnUpdateAvailable,
)
// Handle tab changes (e.g. new tab, tab closed)
registerListener(browser.tabs?.onUpdated, 'tabs.onUpdated', handleTabState)
registerListener(browser.tabs?.onCreated, 'tabs.onCreated', handleTabCreate)
// Handle storage changes (e.g. settings)
registerListener(browser.storage?.onChanged, 'storage.onChanged', handleStorageChanged)
registerListener(browser.storage?.onChanged, 'storage.onChanged', handleIgnoredHostsChange)
registerListener(
  browser.storage?.onChanged,
  'storage.onChanged',
  handleCustomProxiedDomainsChange,
)

if (browser.isFirefox) {
  // Firefox-specific handlers
  registerListener(browser.proxy?.onError, 'proxy.onError', handleProxyError)
  registerListener(
    browser.webRequest?.onBeforeRequest,
    'webRequest.onBeforeRequest',
    handleBeforeRequest,
    {
      urls: [
        'http://*/*',
        'https://*/*',
      ],
      types: [
        'main_frame',
      ],
    },
  )
  registerListener(
    browser.webRequest?.onErrorOccurred,
    'webRequest.onErrorOccurred',
    handleProxyError,
    {
      urls: [
        '<all_urls>',
      ],
    },
  )
} else {
  // Chrome-specific handlers
  registerListener(
    browser.webNavigation?.onBeforeNavigate,
    'webNavigation.onBeforeNavigate',
    handleBeforeRequest,
    {
      urls: [
        'http://*/*',
        'https://*/*',
      ],
      types: [
        'main_frame',
      ],
    },
  )
  // «onProxyError» only reports errors in the PAC script itself.
  // Connection failures are reported by webNavigation.
  registerListener(browser.proxy?.onProxyError, 'proxy.onProxyError', handleProxyError)
  registerListener(
    browser.webNavigation?.onErrorOccurred,
    'webNavigation.onErrorOccurred',
    handleProxyError,
  )
}
