import browser from './browser-api'
import { findHostMatch } from './host-match'
import { normalizeHostname } from './hostname'
import ProxyManager from './proxy'
import {
  getServiceRoute, mustUseDirect, proxyAllowed, restoreServiceRoute,
  setServiceRoute, withProxyLock,
} from './proxy-route'

const siteChoice = async (hostname) => {
  if (await mustUseDirect(hostname)) {
    return 'never'
  }
  const { customProxiedDomains } = await browser.storage.local.get({
    customProxiedDomains: [],
  })

  const names = new Set(customProxiedDomains.map(normalizeHostname))

  return findHostMatch(hostname, names) ? 'always' : 'auto'
}

const proxyRoute = async (hostname) => {
  if (!await proxyAllowed()) {
    throw new Error('Proxy use is disabled or unavailable')
  }
  if (await mustUseDirect(hostname)) {
    throw new Error('Proxy request blocked by an exclusion or a private host')
  }
  const decision = await ProxyManager.getServiceProxyRoute(hostname)

  if (decision.type !== 'proxy') {
    throw new Error('No eligible proxy: check selection, health, and country rules')
  }
  return decision.route.split(';')[0].trim()
}

const attempt = async (url, validate, viaProxy = false) => {
  const hostname = new URL(url).hostname
  const controller = new AbortController()
  let abortReason = ''
  let stage = 'route check'
  const timeout = setTimeout(() => {
    abortReason = 'Timeout after 15 seconds'
    controller.abort()
  }, 15000)
  const onSettingsChanged = (changes) => {
    if (changes.enableExtension?.newValue === false ||
      changes.useProxy?.newValue === false || changes.customProxiedDomains ||
      (viaProxy && ['ignoredHosts', 'siteCountryRules', 'proxies',
        'selectedProxyIds', 'proxyChecks', 'proxyFailures', 'useLocalProxy',
        'localProxyAlive', 'localProxyURI', 'proxyServerURI',
        'customProxyServerURI', 'customProxyProtocol', 'useOwnProxy',
        'antizapret'].some((key) => changes[key]))) {
      abortReason = 'Cancelled because routing settings changed'
      controller.abort()
    }
  }

  browser.storage.onChanged.addListener(onSettingsChanged)
  try {
    if (viaProxy) {
      if (await proxyRoute(hostname) !== getServiceRoute()?.route) {
        throw new Error('Proxy route changed before the request')
      }
    } else if (await siteChoice(hostname) === 'always') {
      throw new Error('Direct request blocked by the always-proxy rule')
    }
    if (controller.signal.aborted) {
      throw new Error(abortReason)
    }
    stage = 'fetch'
    const response = await fetch(url, {
      signal: controller.signal, cache: 'no-store', redirect: 'error',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    stage = 'JSON parsing'
    const data = await response.json()

    stage = 'response validation'
    if (controller.signal.aborted) {
      throw new Error(abortReason)
    }
    if (!validate(data)) {
      throw new Error('Response does not match the expected service data')
    }
    return data
  } catch (error) {
    throw new Error(`${stage}: ${abortReason || error.message}`, { cause: error })
  } finally {
    clearTimeout(timeout)
    browser.storage.onChanged.removeListener(onSettingsChanged)
  }
}

const requestDirect = async (url, validate) => {
  const setting = browser.proxy.settings
  const { levelOfControl } = await setting.get({})
  let direct = false

  if (await proxyAllowed()) {
    direct = await setServiceRoute(new URL(url).hostname, 'DIRECT')
  } else if (levelOfControl === 'controlled_by_this_extension') {
    await setting.clear({})
  }
  let routeChanged = false
  const onRouteChange = () => {
    routeChanged = true
  }

  setting.onChange?.addListener(onRouteChange)
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
    setting.onChange?.removeListener(onRouteChange)
  }
}

const requestProxy = async (url, validate) => {
  const hostname = new URL(url).hostname

  await proxyRoute(hostname)
  await ProxyManager.pingInBackground()
  const route = await proxyRoute(hostname)

  if (!await setServiceRoute(hostname, route)) {
    throw new Error('Proxy request cannot preserve existing browser routes')
  }
  return { data: await attempt(url, validate, true), viaProxy: true }
}

export const requestService = (
  url, validate, { allowProxyRetry = true } = {},
) => {
  const parsed = new URL(url)
  const endpoint = `${parsed.origin}${parsed.pathname}`

  return withProxyLock(async () => {
    let directError

    try {
      const choice = await siteChoice(parsed.hostname)

      if (choice === 'always' && !allowProxyRetry) {
        throw new Error('DIRECT: blocked by the always-proxy rule')
      }
      if (choice !== 'always') {
        try {
          return await requestDirect(url, validate)
        } catch (error) {
          directError = new Error(`DIRECT: ${error.message}`, { cause: error })
        }
        if (!allowProxyRetry) {
          throw directError
        }
        if (choice === 'never') {
          throw new Error(`${directError.message}; proxy retry blocked by an exclusion or a private host`, {
            cause: directError,
          })
        }
      }
      try {
        return await requestProxy(url, validate)
      } catch (error) {
        const errors = [directError?.message, `PROXY: ${error.message}`]

        throw new Error(errors.filter(Boolean).join('; '), { cause: error })
      }
    } finally {
      try {
        await restoreServiceRoute()
      } catch (error) {
        await browser.storage.local.set({
          serviceRouteError: `${endpoint}: route restoration failed: ${error.message}`,
        })
      }
    }
  }).catch((error) => {
    throw new Error(`${endpoint}: ${error.message}`, { cause: error })
  })
}
