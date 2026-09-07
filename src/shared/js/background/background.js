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
import { withProxyLock } from './proxy-route'
import { synchronizeInBackground } from './server'

withProxyLock(() => {}).catch((error) => {
  console.error('[Service] Route recovery failed', error)
})

registerBackground({
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
