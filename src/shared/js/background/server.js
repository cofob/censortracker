import browser from './browser-api'

const PROXY_LIST_URL = 'https://cozyquokka.net/api/proxy-list/'

const getConfigAPIEndpoints = () => {
  return [
    {
      endpointName: 'GitHub',
      endpointUrl: 'https://raw.githubusercontent.com/censortracker/ctconf/main/config.json',
    },
    {
      endpointName: 'jsDelivr',
      endpointUrl: 'https://cdn.jsdelivr.net/gh/censortracker/ctconf/config.json',
    },
    {
      endpointName: 'Google',
      endpointUrl: 'https://storage.googleapis.com/censortracker/config.json',
    },
  ]
}

const FALLBACK_COUNTRY_CODE = 'RU'

/**
 * Fetches the country code from the given GeoIP API Endpoint.
 * @param geoIPServiceURL {string} API endpoint for fetching country code.
 * @returns {Promise<string|*>} Resolves with the country code.
 */
const inquireCountryCode = async (geoIPServiceURL) => {
  try {
    const response = await fetch(geoIPServiceURL)
    const { countryCode } = await response.json()

    return countryCode
  } catch (error) {
    console.warn('[GeoIP] Error on fetching country code. Using fallback.')
    return FALLBACK_COUNTRY_CODE
  }
}

/**
 * Fetches config from the server.
 * @returns {Promise<{}|*>} Resolves with the config.
 */
const fetchConfig = async () => {
  const { currentRegionCode } = await browser.storage.local.get({
    currentRegionCode: '',
  })

  for (const { endpointName, endpointUrl } of getConfigAPIEndpoints()) {
    try {
      const response = await fetch(endpointUrl)

      if (response.ok) {
        const { meta, data = {} } = await response.json()

        if (data.length === 0) {
          console.warn(`[Config] Skipping ${endpointName}...`)
          continue
        }

        let countryCode = FALLBACK_COUNTRY_CODE

        if (currentRegionCode) {
          countryCode = currentRegionCode
        } else if (meta.geoIPServiceURL) {
          countryCode = await inquireCountryCode(meta.geoIPServiceURL)
        }

        const config = data.find((cfg) => {
          return cfg.countryCode === countryCode
        })

        if (!config) {
          await browser.storage.local.set({ unsupportedCountry: true })
        }

        // For debugging purposes
        config.configEndpointUrl = endpointUrl
        config.configEndpointSource = endpointName

        await browser.storage.local.set({
          localConfig: config,
          backendIsIntermittent: false,
        })

        return config
      }
      console.error(
        `[Config] Error on fetching config from: ${endpointName}`,
      )
    } catch (error) {
      console.error(`[Config] Failed to fetch config from ${endpointName}: ${error}`)
    }
  }
  return {}
}

/**
 * Selects a proxy at random according to its weight.
 * @param proxies {Array<Object>} Available proxy configurations.
 * @returns {Object|null} Selected proxy configuration.
 */
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

    const response = await fetch(PROXY_LIST_URL)

    if (!response.ok) {
      throw new Error(`Proxy list request failed with status ${response.status}`)
    }

    const proxyList = await response.json()

    if (!Array.isArray(proxyList)) {
      throw new TypeError('Proxy list response must be an array')
    }

    const activeProxies = proxyList.filter(({
      active,
      server,
      port,
      pingHost,
      pingPort,
      weight,
    }) => {
      return active &&
        server &&
        port &&
        pingHost &&
        pingPort &&
        Number(weight) > 0
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

    console.warn(`Status: ${response.status}`)

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
  } catch (error) {
    console.error(
      `Error on fetching proxy server: ${error}`,
    )
  }
  console.groupEnd()
}
/**
 * Fetches database of blocked websites from registry.
 * @param registryUrl Registry URL.
 * @param specifics Specific attributes.
 * @returns {Promise<void>} Resolves when the database is fetched.
 */
const fetchRegistry = async ({ registryUrl, specifics = {} } = {}) => {
  if (!registryUrl) {
    console.warn('[Registry] «registryUrl» is not present in config.')
    return
  }

  console.warn('[Registry] Fetching registry...')

  const apis = [{
    url: registryUrl,
    storageKey: 'domains',
  }]

  if ('cooperationRefusedORIUrl' in specifics) {
    apis.push({
      url: specifics.cooperationRefusedORIUrl,
      storageKey: 'disseminators',
    })
  }

  for (const { storageKey, url } of apis) {
    try {
      const response = await fetch(url)
      const data = await response.json()

      console.log(`Fetched: ${url}`)

      await browser.storage.local.set({ [storageKey]: data })
    } catch (error) {
      console.error(`Error on fetching data from: ${url}`)
    }
  }
}

/**
 * Fetches the ignored domains from the server.
 * @param ignoreUrl {string} API endpoint for fetching ignored domains.
 * @returns {Promise<void>} Resolves when the ignored domains are fetched.
 */
const fetchIgnore = async ({ ignoreUrl } = {}) => {
  if (!ignoreUrl) {
    console.warn('[Ignore] «ignoreUrl» is not present in config.')
    return
  }

  fetch(ignoreUrl)
    .then((response) => response.json())
    .then((domains) => {
      browser.storag.local.get({ ignoredHosts: [] })
        .then(({ ignoredHosts }) => {
          for (const domain of domains) {
            if (!ignoredHosts.includes(domain)) {
              ignoredHosts.push(domain)
            }
          }
          browser.storag.local.set({ ignoredHosts })
            .then(() => {
              console.log('[Ignore] Globally ignored domains fetched.')
            })
        })
    })
    .catch((error) => {
      console.error(`[Ignore] Error on fetching ignored hosts: ${error}`)
    })
}

export const synchronize = async ({
  syncRegistry = true,
  syncIgnore = true,
  syncProxy = true,
} = {}) => {
  console.group('[Server] Synchronizing config...')

  const config = await fetchConfig()

  if (Object.keys(config).length > 0) {
    const { ignoreUrl, registryUrl, specifics } = config

    if (syncIgnore) {
      await fetchIgnore({ ignoreUrl })
    }

    if (syncProxy) {
      await fetchProxy()
    }

    if (syncRegistry) {
      await fetchRegistry({ registryUrl, specifics })
    }
  } else {
    await browser.storage.local.set({ backendIsIntermittent: true })
  }
  console.groupEnd()
}

export default {
  synchronize,
}
