import browser from './browser-api'
import { findHostMatch } from './host-match'
import { normalizeHostname } from './hostname'
import { isPrivateHost } from './private-host'

let queue = Promise.resolve()
let revision = 0
let serviceRoute = null
let permissionCache
let watchingControl = false
const routeKeys = new Set([
  'enableExtension', 'useProxy', 'domains', 'useRegistry', 'ignoredHosts',
  'customProxiedDomains', 'proxyServerURI', 'customProxyProtocol',
  'customProxyServerURI', 'localProxyURI',
  'proxies', 'selectedProxyIds', 'proxyAll',
])

browser.storage.onChanged.addListener((changes, area) => {
  if ((!area || area === 'local') &&
    Object.keys(changes).some((key) => routeKeys.has(key))) {
    revision++
    permissionCache = null
  }
})

export const getRouteRevision = () => revision
export const getServiceRoute = () => serviceRoute

export const mustUseDirect = async (hostname) => {
  const { ignoredHosts } = await browser.storage.local.get({ ignoredHosts: [] })

  return isPrivateHost(hostname) || Boolean(findHostMatch(hostname,
    new Set(ignoredHosts.map(normalizeHostname))))
}

export const withProxyLock = (operation) => {
  const result = queue.then(async () => {
    await restoreServiceRoute()
    return operation()
  })

  queue = result.catch(() => {})
  return result
}

export const proxyAllowed = async () => {
  const { enableExtension, useProxy } = await browser.storage.local.get({
    enableExtension: false, useProxy: true,
  })
  const { levelOfControl } = await browser.proxy.settings.get({})

  return enableExtension && useProxy &&
    ['controllable_by_this_extension', 'controlled_by_this_extension']
      .includes(levelOfControl)
}

// Request listeners must not copy the full PAC from browser settings each time.
export const proxyRequestAllowed = async () => {
  const changed = browser.proxy.settings.onChange

  if (!changed) {
    return proxyAllowed()
  }
  if (!watchingControl) {
    changed.addListener(() => {
      permissionCache = null
    })
    watchingControl = true
  }
  const pending = permissionCache || proxyAllowed()

  permissionCache = pending
  let allowed

  try {
    allowed = await pending
  } catch (error) {
    if (permissionCache === pending) {
      permissionCache = null
    }
    throw error
  }

  return permissionCache === pending ? allowed : proxyRequestAllowed()
}

export const applyPac = async (data, mandatory = false) => {
  const value = browser.isFirefox
    ? {
      proxyType: 'autoConfig',
      autoConfigUrl: `data:application/x-ns-proxy-autoconfig,${encodeURIComponent(data)}`,
    }
    : { mode: 'pac_script', pacScript: { data, mandatory } }

  await browser.proxy.settings.set(browser.isFirefox
    ? { value } : { value, scope: 'regular' })
}

export const restoreServiceRoute = async () => {
  const { serviceRouteSnapshot } = await browser.storage.local.get(
    'serviceRouteSnapshot',
  )

  if (!serviceRouteSnapshot) {
    serviceRoute = null
    return
  }
  const { levelOfControl } = await browser.proxy.settings.get({})

  if (levelOfControl === 'controlled_by_this_extension' &&
    serviceRouteSnapshot.owned && await proxyAllowed()) {
    const { value } = serviceRouteSnapshot

    await browser.proxy.settings.set(browser.isFirefox
      ? { value } : { value, scope: 'regular' })
  } else {
    // Clear only CT's setting, not the other extension's setting.
    await browser.proxy.settings.clear({})
  }
  await browser.storage.local.remove('serviceRouteSnapshot')
  serviceRoute = null
}

// Caller holds the lock until the request and restoration have finished.
export const setServiceRoute = async (hostname, route) => {
  if (route !== 'DIRECT' && await mustUseDirect(hostname)) {
    throw new Error('Local or excluded services cannot use proxy retry')
  }
  if (!await proxyAllowed()) {
    throw new Error('Service routing unavailable: proxy disabled or not controlled')
  }
  const original = await browser.proxy.settings.get({})
  const { serviceRouteSnapshot } = await browser.storage.local.get(
    'serviceRouteSnapshot',
  )
  const snapshot = serviceRouteSnapshot || {
    value: original.value,
    owned: original.levelOfControl === 'controlled_by_this_extension',
  }
  let base = 'function FindProxyForURL(url, host) { return "DIRECT"; }'

  if (snapshot.owned) {
    if (browser.isFirefox) {
      const url = snapshot.value.autoConfigUrl

      if (!url || !/^(blob:|data:)/.test(url)) {
        throw new Error('Cannot safely override the current Firefox proxy')
      }
      base = await (await fetch(url)).text()
      snapshot.value = {
        proxyType: 'autoConfig',
        autoConfigUrl: `data:application/x-ns-proxy-autoconfig,${encodeURIComponent(base)}`,
      }
    } else if (snapshot.value.pacScript?.data) {
      base = snapshot.value.pacScript.data
    } else {
      throw new Error('Cannot safely override the current proxy configuration')
    }
  } else if (!['direct', 'none'].includes(
    snapshot.value.mode || snapshot.value.proxyType,
  )) {
    return false
  }

  await browser.storage.local.set({ serviceRouteSnapshot: snapshot })
  serviceRoute = { hostname, route }
  await applyPac(`${base}
    var normalRoute = FindProxyForURL;
    FindProxyForURL = function(url, host) {
      if (host.toLowerCase().replace(/\\.$/, '') === ${JSON.stringify(hostname)}) {
        return ${JSON.stringify(route)};
      }
      return normalRoute(url, host);
    };`, true)
  return true
}
