import { getPacScript } from 'Background/pac'

import { callBackground } from './background-rpc'
import browser from './browser-api'
import { findHostMatch } from './host-match'
import { isPrivateHost } from './private-host'
import { parseProxyAddress } from './proxy-address'
import { countryCode, currentProxyCheck } from './proxy-check-data'
import { readProxyState } from './proxy-list'
import { proxyAuthSupported, proxyKey } from './proxy-record'
import {
  applyPac, getProbeRoutes, getRouteRevision, proxyAllowed,
  restoreServiceRoute, setServiceRoute,
} from './proxy-route'
import registry from './registry'
import { createRouter, routingConfig } from './routing'

let cachedRouter

class ProxyManager {
  async getSelectedProxies () {
    const { localProxyURI } = await browser.storage.local.get('localProxyURI')

    // When Censor Tracker Proxy Server is used
    if (localProxyURI) {
      return [{
        id: 'local',
        protocol: 'SOCKS5',
        ...parseProxyAddress(localProxyURI),
      }]
    }

    const { proxies, selectedProxyIds, builtin } = await readProxyState()
    const catalog = new Map(
      [builtin, ...proxies].map((proxy) => [proxy.id, proxy]),
    )

    const selected = selectedProxyIds.map((id) => catalog.get(id))
      .filter((proxy) => proxy?.host && proxy.port &&
        (!proxy.restricted || proxy.provider) &&
        proxyAuthSupported(proxy, browser.isFirefox))
    const { proxyFailures, proxyChecks, antizapret } =
      await browser.storage.local.get({
        proxyFailures: {}, proxyChecks: {}, antizapret: null,
      })

    return Promise.all(selected.map(async (proxy) => {
      const failure = await currentProxyCheck(proxy, proxyFailures)
      const check = await currentProxyCheck(proxy, proxyChecks)

      return {
        ...proxy,
        retryAt: proxy.provider &&
          !antizapret?.proxyKeys.includes(proxyKey(proxy))
          ? Number.MAX_SAFE_INTEGER : failure?.retryAt || 0,
        exitCountry: check?.status === 'ok' ? countryCode(check.exitCountry) : '',
        countryExpiresAt: Number.isFinite(check?.checkedAt)
          ? check.checkedAt + 24 * 60 * 60 * 1000 : 0,
      }
    }))
  }

  async getRoutingOptions () {
    const domains = await registry.getDomains()
    const { ignoredHosts, proxyAll, siteCountryRules, antizapret } =
      await browser.storage.local.get({
        ignoredHosts: [],
        proxyAll: false,
        siteCountryRules: {},
        antizapret: null,
      })
    const proxies = await this.getSelectedProxies()
    const providerDomains = proxies.some((proxy) => proxy.provider)
      ? antizapret?.domains || [] : []

    return {
      domains,
      providerDomains,
      ignoredHosts,
      proxyAll,
      siteCountryRules,
      probes: getProbeRoutes(),
      proxies,
    }
  }

  async getRouteForHost (host) {
    const revision = getRouteRevision()

    if (!cachedRouter || cachedRouter.revision !== revision) {
      cachedRouter = {
        revision,
        pending: this.getRoutingOptions().then((options) => ({
          resolve: createRouter(
            routingConfig(options), findHostMatch, isPrivateHost,
          ),
          proxies: new Map([
            ...options.proxies,
            ...options.probes.map(({ proxy }) => proxy),
          ].map((proxy) => [proxy.id, proxy])),
        })),
      }
    }
    const snapshot = cachedRouter
    let router

    try {
      router = await snapshot.pending
    } catch (error) {
      if (cachedRouter === snapshot) {
        cachedRouter = null
      }
      throw error
    }
    if (revision !== getRouteRevision()) {
      return this.getRouteForHost(host)
    }
    const decision = router.resolve(host)

    return {
      ...decision,
      proxies: decision.proxies.map((id) => {
        const proxy = router.proxies.get(id)

        return decision.type === 'probe' ? { ...proxy, checking: true } : proxy
      }),
    }
  }

  async getProxyingRules () {
    const selected = (await this.getSelectedProxies())
      .find(({ retryAt = 0, provider }) => !provider && retryAt <= Date.now())

    return selected ? {
      id: selected.id,
      proxyServerProtocol: selected.protocol,
      proxyServerURI: `${selected.host}:${selected.port}`,
    } : {}
  }

  async requestIncognitoAccess () {
    if (browser.isFirefox) {
      const isAllowedIncognitoAccess =
        await browser.extension.isAllowedIncognitoAccess()

      if (!isAllowedIncognitoAccess) {
        await browser.browserAction.setBadgeText({ text: '✕' })
        await browser.storage.local.set({
          privateBrowsingPermissionsRequired: true,
        })
        console.info('Private browsing permissions requested.')
      }
    }
  }

  async grantIncognitoAccess () {
    if (browser.isFirefox) {
      await browser.browserAction.setBadgeText({ text: '' })
      await browser.storage.local.set({
        privateBrowsingPermissionsRequired: false,
      })
    }
  }

  async setProxy () {
    return callBackground('setProxy')
  }

  async setProxyInBackground ({ ping = true } = {}) {
    const revision = getRouteRevision()

    if (!await proxyAllowed()) {
      return false
    }
    const options = browser.isFirefox ? null : await this.getRoutingOptions()

    if (revision !== getRouteRevision()) {
      return this.setProxyInBackground({ ping })
    }

    const retryPing = ping && await this.pingInBackground() === false

    if (!await proxyAllowed()) {
      return false
    }

    if (revision !== getRouteRevision()) {
      return this.setProxyInBackground({ ping })
    }

    try {
      // Firefox's PAC runtime cannot reliably load very large registries.
      // Its request listener uses the same router; the PAC is a fail-closed guard.
      const pacData = browser.isFirefox
        ? 'function FindProxyForURL() { return "PROXY 127.0.0.1:0"; }'
        : getPacScript(options)

      await applyPac(pacData, true)
      // An inherited system/manual proxy cannot accept an exact-host override.
      // Retry the knock once CT owns the new PAC.
      if (retryPing) {
        await this.pingInBackground()
      }
      if (!await proxyAllowed()) {
        await this.removeProxyInBackground()
        return false
      }
      if (revision !== getRouteRevision()) {
        return this.setProxyInBackground({ ping })
      }
      await browser.storage.local.set({ proxyIsAlive: true })
      await this.grantIncognitoAccess()
      console.info('PAC has been set successfully!')
      return true
    } catch (error) {
      console.error(`PAC could not be set: ${error}`)
      await browser.storage.local.set({ proxyIsAlive: false })
      await this.requestIncognitoAccess()
      return false
    }
  }

  async removeProxy () {
    return callBackground('removeProxy')
  }

  async removeProxyInBackground () {
    await browser.proxy.settings.clear({})
    console.info('Proxy settings removed.')
  }

  async alive () {
    const { proxyIsAlive } =
      await browser.storage.local.get({ proxyIsAlive: true })

    return proxyIsAlive
  }

  async ping (force = false) {
    return callBackground('ping', force)
  }

  // The caller holds the route lock until the direct knock route is restored.
  // Return false only when proxy setup must take control before the knock.
  async pingInBackground (force = false) {
    if (typeof force !== 'boolean') {
      throw new TypeError('Invalid proxy ping option')
    }
    if (!await proxyAllowed()) {
      return undefined
    }
    const {
      localProxyURI,
      proxyPingURI,
      useOwnProxy,
      selectedProxyIds,
    } = await browser.storage.local.get({
      localProxyURI: null,
      proxyPingURI: null,
      useOwnProxy: false,
      selectedProxyIds: null,
    })

    const usesBuiltin = selectedProxyIds
      ? selectedProxyIds.includes('builtin') : !useOwnProxy

    if ((!force && (!usesBuiltin || localProxyURI)) || !proxyPingURI) {
      return undefined
    }

    const controller = new AbortController()
    let timeout

    try {
      const { host, port } = parseProxyAddress(proxyPingURI)

      // The knock must reach the server from the user's IP, even when the
      // current PAC uses proxy-all or still points to an old managed endpoint.
      if (!await setServiceRoute(host, 'DIRECT')) {
        return false
      }
      if (!await proxyAllowed()) {
        return undefined
      }
      timeout = setTimeout(() => controller.abort(), 1000)
      await fetch(`https://${host}:${port}`, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          'Content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          type: 'ping',
        }),
      })
    } catch (error) {
      // The knock port can reject the connection after it receives the packet.
    } finally {
      clearTimeout(timeout)
      await restoreServiceRoute()
    }

    console.log(`Knocked ${proxyPingURI}!`)
    return undefined
  }

  async usingCustomProxy () {
    const { id } = await this.getProxyingRules()

    return id !== 'builtin'
  }

  async isEnabled () {
    const { useProxy } = await browser.storage.local.get({ useProxy: true })

    return useProxy
  }

  async enableProxy () {
    console.log('Proxying enabled.')
    await browser.storage.local.set({ useProxy: true, proxyIsAlive: true })
  }

  async disableProxy () {
    console.info('Proxying disabled.')
    await browser.storage.local.set({ useProxy: false })
  }

  async controlledByOtherExtensions () {
    const { levelOfControl } = await browser.proxy.settings.get({})

    return levelOfControl === 'controlled_by_other_extensions'
  }

  async controlledByThisExtension () {
    const { levelOfControl } = await browser.proxy.settings.get({})

    return levelOfControl === 'controlled_by_this_extension'
  }

  async takeControl () {
    const self = await browser.management.getSelf()
    const extensions = await browser.management.getAll()

    for (const { id, name, permissions } of extensions) {
      if (permissions.includes('proxy') && name !== self.name) {
        console.warn(`Disabling ${name}...`)
        await browser.management.setEnabled(id, false)
      }
    }
  }

  async removeLocalProxy () {
    await browser.storage.local.set({
      useLocalProxy: false, localProxyURI: null,
    })
  }

  async removeBadProxies () {
    await browser.storage.local.set({ badProxies: [] })
  }

  async getBadProxies () {
    const { badProxies } =
      await browser.storage.local.get({ badProxies: [] })

    return badProxies
  }
}

export default new ProxyManager()
