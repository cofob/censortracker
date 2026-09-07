import { callBackground } from './background-rpc'
import browser from './browser-api'
import ProxyManager from './proxy'
import { refreshRegistrySource } from './registry-source'
import {
  GEOIP_URL, getRegionConfig, ORI_URL, PROXY_LIST_URL,
  validCountry, validDomains, validORI, validProxies,
} from './service-config'
import { requestService } from './service-request'

const fetchConfig = async () => {
  const { currentRegionCode } = await browser.storage.local.get({
    currentRegionCode: '',
  })
  let countryCode = currentRegionCode
  let geoIPStatus = 'manual'

  if (!countryCode) {
    try {
      const { data, viaProxy } = await requestService(GEOIP_URL, validCountry)

      if (viaProxy) {
        throw new Error('GeoIP returned the proxy country, not the user country')
      }
      countryCode = data.countryCode.toUpperCase()
      geoIPStatus = 'direct'
    } catch (error) {
      console.warn(`[GeoIP] Using RU fallback: ${error.message}`)
      countryCode = 'RU'
      geoIPStatus = `RU fallback: ${error.message}`
    }
  }
  const config = getRegionConfig(countryCode)

  await browser.storage.local.set({
    localConfig: config,
    backendIsIntermittent: false,
    unsupportedCountry: false,
    geoIPStatus,
  })
  return config
}

const selectProxy = (proxies) => {
  const totalWeight = proxies.reduce((total, { weight }) => {
    return total + Math.max(Number(weight) || 0, 0)
  }, 0)

  if (totalWeight === 0) {
    return null
  }

  let randomWeight = Math.random() * totalWeight

  for (const proxy of proxies) {
    randomWeight -= Math.max(Number(proxy.weight) || 0, 0)

    if (randomWeight < 0) {
      return proxy
    }
  }

  return proxies[proxies.length - 1]
}

/**
 * Fetches available configurations and selects a proxy server.
 * @returns {Promise<void>} Resolves when the proxy is selected.
 */
const fetchProxy = async () => {
  const { badProxies } = await browser.storage.local.get({ badProxies: [] })

  console.group('[Proxy] Fetching proxy...')

  try {
    if (badProxies.length > 0) {
      console.log('Excluding bad proxies:')
      console.table(badProxies)
    }

    const { data: proxyList } =
      await requestService(PROXY_LIST_URL, validProxies)

    const activeProxies = proxyList.filter(({ active, weight }) => {
      return active && Number(weight) > 0
    })

    let availableProxies = activeProxies.filter(({ server }) => {
      return !badProxies.includes(server)
    })

    if (
      availableProxies.length === 0 &&
      activeProxies.length > 0 &&
      badProxies.length > 0
    ) {
      console.warn('All active proxies were excluded. Retrying the active pool.')
      availableProxies = activeProxies
      await browser.storage.local.set({ badProxies: [] })
    }

    const proxy = selectProxy(availableProxies)

    if (!proxy) {
      throw new Error('No active proxy servers are available')
    }

    const {
      server,
      port,
      pingHost,
      pingPort,
    } = proxy

    const proxyPingURI = `${pingHost}:${pingPort}`
    const proxyServerURI = `${server}:${port}`

    console.log(`Proxy server fetched: ${proxyServerURI}!`)

    await browser.storage.local.set({ proxyIsAlive: true })
    await browser.storage.local.remove([
      'fallbackReason',
      'fallbackProxyInUse',
      'fallbackProxyError',
    ])

    await browser.storage.local.set({
      proxyPingURI,
      proxyServerURI,
      currentProxyServer: server,
      proxyLastFetchTs: Date.now(),
    })
  } finally {
    console.groupEnd()
  }
}

const fetchRegistry = async (config) => {
  const { countryCode, registryUrl } = config
  const { registryRegionCode } = await browser.storage.local.get({
    registryRegionCode: '',
  })

  if (registryRegionCode !== countryCode) {
    await browser.storage.local.set({
      domains: [], registryRegionCode: countryCode,
    })
    await ProxyManager.setProxy()
  }
  const { data } = registryUrl
    ? await requestService(registryUrl, validDomains)
    : { data: [] }

  await browser.storage.local.set({
    domains: data, registryRegionCode: countryCode,
  })
}

let syncQueue = Promise.resolve()

export const synchronizeInBackground = (options = {}) => {
  const operation = async () => {
    const { syncRegistry = true, syncProxy = true, region } = options
    const failures = []
    const run = async (task) => {
      try {
        await task()
      } catch (error) {
        failures.push(error.message)
        console.error(`[Service] ${error.message}`)
      }
    }

    if (region) {
      const { registryRegionCode, localConfig = {} } =
        await browser.storage.local.get(['registryRegionCode', 'localConfig'])
      const previousRegion = registryRegionCode || localConfig.countryCode

      await browser.storage.local.set({
        currentRegionCode: region.countryCode,
        currentRegionName: region.countryName,
        ...(region.countryCode && region.countryCode !== previousRegion ? {
          domains: [], registryRegionCode: region.countryCode,
        } : {}),
      })
      await ProxyManager.setProxy()
    }
    if (syncProxy) {
      await run(fetchProxy)
    }
    if (syncRegistry) {
      // Remember the previous region before replacing diagnostic configuration.
      const { localConfig = {}, registryRegionCode } =
        await browser.storage.local.get(['localConfig', 'registryRegionCode'])

      if (!registryRegionCode && localConfig.countryCode) {
        await browser.storage.local.set({
          registryRegionCode: localConfig.countryCode,
        })
      }
      const config = await fetchConfig()

      await run(() => fetchRegistry(config))
      await run(() => refreshRegistrySource({ automatic: true }))
      await run(async () => {
        const { data } = await requestService(ORI_URL, validORI)

        await browser.storage.local.set({ disseminators: data })
      })
    }
    if (region) {
      await ProxyManager.setProxy()
    }
    await browser.storage.local.set({
      serviceErrors: failures,
      backendIsIntermittent: false,
    })
  }
  const result = syncQueue.then(operation)

  syncQueue = result.catch(() => {})
  return result
}

export const synchronize = (options = {}) => {
  return callBackground('synchronize', options)
}

export default { synchronize }
