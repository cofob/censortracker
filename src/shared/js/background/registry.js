import browser from './browser-api'
import { findHostMatch } from './host-match'
import {
  extractDomainFromUrl,
  extractHostnameFromUrl,
} from './utilities'

class Registry {
  /**
   * Returns array of banned domains from the registry.
   */

  async getDomains () {
    const {
      domains,
      useRegistry,
      ignoredHosts,
      customProxiedDomains,
    } = await browser.storage.local.get({
      domains: [],
      useRegistry: true,
      ignoredHosts: [],
      customProxiedDomains: [],
    })

    if (!useRegistry) {
      if (customProxiedDomains.length > 0) {
        return customProxiedDomains
      }
      return []
    }

    const allDomains = [
      ...domains,
      ...customProxiedDomains,
    ].filter((element) => {
      return !ignoredHosts.includes(element)
    })

    if (allDomains.length > 0) {
      return allDomains
    }
    return []
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
    const {
      domains,
      ignoredHosts,
      customProxiedDomains,
    } = await browser.storage.local.get({
      domains: [],
      ignoredHosts: [],
      customProxiedDomains: [],
    })

    const matches = (names) => Boolean(findHostMatch(domain,
      new Set(names.map(extractHostnameFromUrl))))

    return {
      blocked: matches(domains),
      custom: matches(customProxiedDomains),
      ignored: matches(ignoredHosts),
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
