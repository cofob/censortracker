import browser from './browser-api'
import { findHostMatch } from './host-match'
import { externalRegistryDomains, registrySourceDefaults } from './registry-source-data'
import {
  extractDomainFromUrl,
  extractHostnameFromUrl,
} from './utilities'

let membership
const membershipKeys = [
  'domains', 'customProxiedDomains', 'ignoredHosts',
  'registrySource', 'externalRegistry',
]

if (browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && membershipKeys.some((key) => changes[key])) {
      membership = null
    }
  })
}

const loadMembership = async () => {
  const state = await browser.storage.local.get({
    domains: [],
    customProxiedDomains: [],
    ignoredHosts: [],
    registrySource: registrySourceDefaults,
    externalRegistry: null,
  })
  const lists = [state.domains, externalRegistryDomains(state),
    state.customProxiedDomains, state.ignoredHosts]
  const indexes = []

  for (const names of lists) {
    const index = new Set()

    for (let offset = 0; offset < names.length; offset++) {
      const host = extractHostnameFromUrl(names[offset])

      if (host) {
        index.add(host)
      }
      if (offset > 0 && offset % 2000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    indexes.push(index)
  }
  return indexes
}

class Registry {
  /**
   * Returns array of banned domains from the registry.
   */

  async getDomains () {
    const {
      domains,
      useRegistry,
      customProxiedDomains,
      registrySource,
      externalRegistry,
    } = await browser.storage.local.get({
      domains: [],
      useRegistry: true,
      customProxiedDomains: [],
      registrySource: registrySourceDefaults,
      externalRegistry: null,
    })

    return [
      ...(useRegistry ? domains : []),
      ...customProxiedDomains,
      ...externalRegistryDomains({ registrySource, externalRegistry }),
    ]
  }

  async isEmpty () {
    const domains = await this.getDomains()

    return domains.length === 0
  }

  async add (url) {
    const domain = extractHostnameFromUrl(url)
    const { customProxiedDomains } =
      await browser.storage.local.get({ customProxiedDomains: [] })

    if (!domain) {
      return false
    }
    if (!customProxiedDomains.includes(domain)) {
      customProxiedDomains.push(domain)
      await browser.storage.local.set({ customProxiedDomains })
      console.debug(`${domain} added to the custom registry.`)
    }
    return true
  }

  async remove (url) {
    const domain = extractHostnameFromUrl(url)
    const { customProxiedDomains } =
      await browser.storage.local.get({ customProxiedDomains: [] })

    const remaining = customProxiedDomains.filter((name) =>
      !findHostMatch(domain, new Set([extractHostnameFromUrl(name)])))

    await browser.storage.local.set({ customProxiedDomains: remaining })
    return true
  }

  /**
   * Checks if the given URL is in the registry of banned websites.
   */
  async contains (url) {
    const { blocked, custom, ignored } = await this.getDomainStatus(url)

    return !ignored && (blocked || custom)
  }

  /**
   * Returns list membership, independent of proxy settings.
   */
  async getDomainStatus (url) {
    const domain = extractHostnameFromUrl(url)
    const pending = membership || (membership = loadMembership())

    try {
      const [builtin, external, custom, ignored] = await pending

      if (membership !== pending) {
        return this.getDomainStatus(url)
      }
      const matches = (index) => Boolean(findHostMatch(domain, index))

      return {
        blocked: matches(builtin) || matches(external),
        custom: matches(custom),
        ignored: matches(ignored),
      }
    } catch (error) {
      if (membership === pending) {
        membership = null
      }
      throw error
    }
  }

  /**
   * Checks if the given URL is in registry of IDO (Information Dissemination Organizer).
   * This method makes sense only for some countries (Russia).
   */
  async retrieveDisseminator (url) {
    const domain = extractDomainFromUrl(url)
    const { disseminators } =
      await browser.storage.local.get({ disseminators: [] })

    const dataObject = disseminators.find(
      ({ url: innerUrl }) => domain === innerUrl,
    )

    if (dataObject) {
      return dataObject
    }
    return {}
  }

  async enableRegistry () {
    await browser.storage.local.set({ useRegistry: true })
  }

  async disableRegistry () {
    await browser.storage.local.set({ useRegistry: false })
  }

  async clearRegistry () {
    await browser.storage.local.set({ domains: [] })
  }
}

export default new Registry()
