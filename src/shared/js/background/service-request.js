import browser from './browser-api'
import ProxyManager from './proxy'
import { proxyDirective } from './proxy-address'
import {
  mustUseDirect, proxyAllowed, restoreServiceRoute,
  setServiceRoute, withProxyLock,
} from './proxy-route'
import { hasSiteRestriction } from './site-rules'

const attempt = async (url, validate, viaProxy = false) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const onSettingsChanged = (changes) => {
    if (changes.enableExtension?.newValue === false ||
      changes.useProxy?.newValue === false ||
      (viaProxy && (changes.ignoredHosts || changes.siteCountryRules))) {
      controller.abort()
    }
  }

  browser.storage.onChanged.addListener(onSettingsChanged)

  try {
    const { siteCountryRules } = await browser.storage.local.get({
      siteCountryRules: {},
    })

    if (viaProxy && (!await proxyAllowed() ||
      await mustUseDirect(new URL(url).hostname) ||
      hasSiteRestriction(new URL(url).hostname, siteCountryRules))) {
      throw new Error('Proxy retry disabled before request')
    }
    const response = await fetch(url, {
      signal: controller.signal, cache: 'no-store', redirect: 'error',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = await response.json()

    if (!validate(data)) {
      throw new Error('Invalid service response')
    }
    return data
  } finally {
    clearTimeout(timeout)
    browser.storage.onChanged.removeListener(onSettingsChanged)
  }
}

export const requestService = (url, validate) => withProxyLock(async () => {
  const hostname = new URL(url).hostname
  let directError

  try {
    try {
      const { levelOfControl } = await browser.proxy.settings.get({})
      let direct = false

      if (await proxyAllowed()) {
        direct = await setServiceRoute(hostname, 'DIRECT')
      } else if (levelOfControl === 'controlled_by_this_extension') {
        // A disabled CT can still have a PAC pending removal.
        await browser.proxy.settings.clear({})
      }
      let routeChanged = false
      const onRouteChange = () => {
        routeChanged = true
      }
      const setting = browser.proxy.settings

      if (setting.onChange) {
        setting.onChange.addListener(onRouteChange)
      }
      try {
        const before = await setting.get({})
        const data = await attempt(url, validate)
        const after = await setting.get({})
        const knownDirect = ['direct', 'none'].includes(
          before.value.mode || before.value.proxyType,
        ) || (direct && before.levelOfControl === 'controlled_by_this_extension')

        return {
          data,
          viaProxy: !knownDirect || routeChanged ||
            before.levelOfControl !== after.levelOfControl ||
            JSON.stringify(before.value) !== JSON.stringify(after.value),
        }
      } finally {
        if (setting.onChange) {
          setting.onChange.removeListener(onRouteChange)
        }
      }
    } catch (error) {
      directError = error
      console.warn(`[Service] Direct request failed for ${hostname}: ${error}`)
    }

    if (!await proxyAllowed()) {
      throw new Error(`${directError.message}; proxy retry disabled or unavailable`)
    }
    const { proxyServerURI, proxyServerProtocol } =
      await ProxyManager.getProxyingRules()

    if (!proxyServerURI || !proxyServerProtocol) {
      throw new Error(`${directError.message}; no cached proxy for retry`)
    }
    const route = proxyDirective(proxyServerProtocol, proxyServerURI)

    await ProxyManager.pingInBackground()

    if (!await setServiceRoute(hostname, route)) {
      throw new Error('Proxy retry cannot preserve existing browser routes')
    }
    const data = await attempt(url, validate, true)

    console.info(`[Service] Proxy retry succeeded for ${hostname}`)
    return { data, viaProxy: true }
  } finally {
    await restoreServiceRoute()
  }
})
