import browser from './browser-api'
import { TaskType } from './constants'
import Ignore from './ignore'
import ProxyManager from './proxy'
import { refreshNextSubscription, SUBSCRIPTION_ALARM } from './proxy-importer'
import { recoverProxy, RECOVERY_ALARM, retryFailedProxies } from './proxy-recovery'
import { withProxyLock } from './proxy-route'
import Registry from './registry'
import * as server from './server'
import Settings from './settings'
import Task from './task'
import * as utilities from './utilities'

export const showDisseminatorWarning = async (url) => {
  const hostname = utilities.extractDomainFromUrl(url)
  const {
    notifiedHosts,
    showNotifications,
  } = await browser.storage.local.get({
    notifiedHosts: [],
    showNotifications: true,
  })

  if (showNotifications && !notifiedHosts.includes(hostname)) {
    await browser.notifications.create(hostname, {
      type: 'basic',
      title: Settings.getName(),
      iconUrl: Settings.getDangerIcon(),
      message: browser.i18n.getMessage('cooperationAcceptedMessage', hostname),
    })

    try {
      notifiedHosts.push(hostname)
      await browser.storage.local.set({ notifiedHosts })
    } catch (error) {
      console.error(error)
    }
  }
}

export const handleOnAlarm = async ({ name }) => {
  console.log(`Task received: ${name}`)

  if (name === 'checkLocalProxy') {
    await ProxyManager.syncLocalProxy()
  } else if (name === RECOVERY_ALARM) {
    try {
      await retryFailedProxies()
    } catch (error) {
      console.warn('Proxy recovery check failed')
    }
  } else if (name === SUBSCRIPTION_ALARM) {
    try {
      await refreshNextSubscription()
    } catch (error) {
      console.warn('Proxy subscription download failed')
    }
  } else if (name === TaskType.PING) {
    await ProxyManager.ping()
  } else if (name === TaskType.REMOVE_BAD_PROXIES) {
    await ProxyManager.removeBadProxies()
  } else if (name === TaskType.SET_PROXY) {
    const proxyingEnabled = await ProxyManager.isEnabled()

    if (proxyingEnabled && await Settings.extensionEnabled()) {
      await server.synchronize()
      await ProxyManager.setProxy()
    }
  } else {
    console.warn(`Unknown task: ${name}`)
  }
}

export const handleBeforeRequest = async (_details) => {
  if (await Settings.extensionEnabled() && await ProxyManager.isEnabled()) {
    await ProxyManager.ping()
    await ProxyManager.requestIncognitoAccess()
  }
}

export const handleStartup = async () => {
  console.groupCollapsed('onStartup')

  const proxyingEnabled = await ProxyManager.isEnabled()

  if (proxyingEnabled && await Settings.extensionEnabled()) {
    await ProxyManager.setProxy()
  }

  await Task.schedule([
    { name: TaskType.PING, minutes: 10 },
    { name: TaskType.SET_PROXY, minutes: 15 },
    { name: TaskType.REMOVE_BAD_PROXIES, minutes: 20 },
  ])
  console.groupEnd()
}

export const handleIgnoredHostsChange = async (
  { ignoredHosts } = {},
  areaName,
) => {
  if ((areaName && areaName !== 'local') || !ignoredHosts) {
    return
  }
  if (await Settings.extensionEnabled() && await ProxyManager.isEnabled()) {
    await ProxyManager.setProxy()
  }
}

export const handleCustomProxiedDomainsChange = async (
  { customProxiedDomains } = {},
  areaName,
) => {
  if ((areaName && areaName !== 'local') || !customProxiedDomains) {
    return
  }
  if (await Settings.extensionEnabled() && await ProxyManager.isEnabled()) {
    await ProxyManager.setProxy()
  }
}

/**
 * Fired when one or more items change.
 * @param changes Object describing the change. This contains one property for each key that changed.
 * @param areaName The storage area in which the changes were made.
 */
export const handleStorageChanged = async (
  { enableExtension, useProxy } = {},
  areaName,
) => {
  if ((areaName && areaName !== 'local') || (!enableExtension && !useProxy)) {
    return
  }
  // Read current choices inside the queue; old events must not undo new choices.
  await withProxyLock(async () => {
    if (await Settings.extensionEnabled() && await ProxyManager.isEnabled()) {
      await ProxyManager.setProxyInBackground()
    } else {
      await ProxyManager.removeProxyInBackground()
    }
  })

  if (enableExtension) {
    const tabs = await browser.tabs.query({})
    const enabled = await Settings.extensionEnabled()

    for (const { id } of tabs) {
      if (enabled) {
        Settings.setDefaultIcon(id)
      } else {
        Settings.setDisableIcon(id)
      }
    }
  }
}

/**
 * Fired when the extension is first installed, when the extension is
 * updated to a new version, and when the browser is updated to a new version.
 * @param reason The reason that the runtime.onInstalled event is being dispatched.
 * @returns {Promise<void>}
 */
export const handleInstalled = async ({ reason }) => {
  const UPDATED = reason === browser.runtime.OnInstalledReason.UPDATE
  const INSTALLED = reason === browser.runtime.OnInstalledReason.INSTALL

  if (UPDATED) {
    await handleStartup()
  } else if (INSTALLED) {
    await Registry.enableRegistry()
    await Settings.enableExtension()
    await Settings.enableNotifications()

    await server.synchronize()
    await ProxyManager.enableProxy()
    await ProxyManager.requestIncognitoAccess()
    await ProxyManager.setProxy()
    await ProxyManager.ping()

    // Schedule tasks to run in the background.
    await Task.schedule([
      { name: TaskType.SET_PROXY, minutes: 15 },
      { name: TaskType.REMOVE_BAD_PROXIES, minutes: 5 },
    ])
  }
}

export const handleTabState = async (
  tabId,
  { status = 'loading' } = {},
  { url } = {},
) => {
  if (url && status === browser.tabs.TabStatus.LOADING) {
    Settings.extensionEnabled().then((enabled) => {
      if (enabled) {
        Ignore.contains(url).then(async (isIgnored) => {
          Registry.retrieveDisseminator(url).then(
            async ({ url: disseminatorUrl, cooperationRefused }) => {
              if (disseminatorUrl) {
                if (!cooperationRefused) {
                  Settings.setDangerIcon(tabId)
                  await showDisseminatorWarning(url)
                }
              }
            },
          )

          if (!isIgnored) {
            Registry.contains(url).then((blocked) => {
              if (blocked) {
                Settings.setBlockedIcon(tabId)
              }
            })
          }
        })
      } else {
        Settings.setDisableIcon(tabId)
      }
    })
  }
}

export const handleTabCreate = async (tab) => {
  Settings.extensionEnabled()
    .then((enabled) => {
      if (enabled) {
        Settings.setDefaultIcon(tab.id)
      } else {
        Settings.setDisableIcon(tab.id)
      }
    })
}

export const handleProxyError = async (details) => {
  try {
    if (await ProxyManager.usingLocalProxy()) {
      await ProxyManager.syncLocalProxy()
    } else {
      await recoverProxy(details)
    }
  } catch {
    console.warn('Proxy recovery failed; selected proxies were kept')
  }
}

export const handleOnUpdateAvailable = async ({ version }) => {
  await browser.storage.local.set({ updateAvailable: true })
  console.info(`Update available: ${version}`)
}
