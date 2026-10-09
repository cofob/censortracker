import { callBackground } from './background-rpc'
import browser from './browser-api'
import { ConsentRequiredError, hasDataConsent, isConsentError } from './data-consent'
import ProxyManager from './proxy'
import { refreshRegistrySource } from './registry-source'
import {
  getRegionConfig,
  validConfig, validCountry, validCustomRegistry, validDomain, validDomains,
  validORI, validProxies,
} from './service-config'
import { getServiceMirrors, requestMirroredService } from './service-mirrors'
import { requestService } from './service-request'

const fetchConfig = async (mirrors) => {
  const { currentRegionCode } = await browser.storage.local.get({
    currentRegionCode: '',
  })
  let countryCode = currentRegionCode
  let geoIPStatus = 'manual'

  if (!countryCode) {
    try {
      const { data } = await requestMirroredService(mirrors, 'geoip', validCountry)

      countryCode = data.countryCode.toUpperCase()
      geoIPStatus = 'direct'
    } catch (error) {
      if (isConsentError(error)) {
        throw error
      }
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
const fetchProxy = async (mirrors) => {
  const { badProxies } = await browser.storage.local.get({ badProxies: [] })

  console.group('[Proxy] Fetching proxy...')

  try {
    if (badProxies.length > 0) {
      console.log('Excluding bad proxies:')
      console.table(badProxies)
    }

    const { data: proxyList } =
      await requestMirroredService(mirrors, 'proxyList', validProxies)

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

const requestRegistry = async ({ registryUrl, countryCode }, mirrors) => {
  if (!registryUrl) {
    return []
  }
  const { data } = await requestMirroredService(
    mirrors, 'registry', validDomains, { countryCode },
  )

  return data
}

const requestCustomRegistry = async (config, mirrors) => {
  const result = await requestMirroredService(
    mirrors, 'config', validConfig, { countryCode: config.countryCode },
  ).catch((error) => {
    if (isConsentError(error)) {
      throw error
    }
    return null
  })

  if (!result) {
    return null
  }

  config.customRegistryUrl = result.data.customRegistryUrl || null
  await browser.storage.local.set({ localConfig: config })
  if (!config.customRegistryUrl) {
    return []
  }
  const { data: records } = await requestService(
    config.customRegistryUrl, validCustomRegistry,
  )

  return records.flatMap((record) => record.domains)
}

const fetchRegistry = async (config, mirrors) => {
  const { countryCode } = config
  const { registryRegionCode, registryCache, domains: previousDomains } =
    await browser.storage.local.get({
      registryRegionCode: '', registryCache: null, domains: [],
    })
  const cache = registryCache?.countryCode === countryCode ? registryCache : {
    countryCode,
    primary: registryRegionCode === countryCode ? previousDomains : [],
    custom: [],
  }

  cache.backend ||= []
  if (registryRegionCode !== countryCode) {
    await browser.storage.local.set({
      domains: [], registryRegionCode: countryCode,
    })
    await ProxyManager.setProxy()
  }
  await browser.storage.local.set({
    registryStatus: { state: 'loading', skipped: 0, error: '' },
  })
  const errors = []
  let skipped = 0

  for (const [source, request] of [
    ['primary', () => requestRegistry(config, mirrors)],
    ['custom', () => requestCustomRegistry(config, mirrors)],
    ['backend', async () => (await requestMirroredService(
      mirrors, 'domains', validDomains, { countryCode, maxRedirects: 5 },
    ).catch((error) => {
      if (isConsentError(error)) {
        throw error
      }
      return null
    }))?.data ?? null],
  ]) {
    try {
      const data = await request()

      if (data === null) {
        continue
      }
      cache[source] = data.filter(validDomain)
      skipped += data.length - cache[source].length
    } catch (error) {
      if (isConsentError(error)) {
        throw error
      }
      errors.push(`${source}: ${error.message}`)
    }
  }
  const domains = [...new Set([
    ...cache.primary, ...cache.custom, ...cache.backend,
  ])]
  const state = domains.length > 0 ? 'ready' : 'empty'

  if (errors.length === 0) {
    cache.updatedAt = Date.now()
  }
  await browser.storage.local.set({
    domains,
    registryCache: cache,
    registryRegionCode: countryCode,
    registryStatus: {
      state: errors.length > 0 ? 'unavailable' : state,
      skipped,
      error: errors.join('; '),
    },
  })
  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
}

let syncQueue = Promise.resolve()

export const synchronizeInBackground = (options = {}) => {
  const operation = async () => {
    if (!await hasDataConsent()) {
      throw new ConsentRequiredError()
    }
    const { syncRegistry = true, syncProxy = true, region } = options
    const mirrors = await getServiceMirrors()
    const failures = []
    const run = async (name, task) => {
      try {
        await task()
      } catch (error) {
        if (isConsentError(error)) {
          throw error
        }
        failures.push(`${name}: ${error.message}`)
        console.error(`[Service] ${name}: ${error.message}`)
      }
    }

    await browser.storage.local.remove('serviceRouteError')
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
      await run('Proxy list', () => fetchProxy(mirrors))
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
      const config = await fetchConfig(mirrors)

      await run('Registry', () => fetchRegistry(config, mirrors))
      await run('External registry', () => refreshRegistrySource({ automatic: true }))
      await run('ORI', async () => {
        const { data } = await requestMirroredService(mirrors, 'ori', validORI)

        await browser.storage.local.set({ disseminators: data })
      })
    }
    if (region) {
      await ProxyManager.setProxy()
    }
    const { serviceRouteError } = await browser.storage.local.get('serviceRouteError')

    if (serviceRouteError) {
      failures.push(serviceRouteError)
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
