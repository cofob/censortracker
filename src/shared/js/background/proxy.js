import { getPacScript } from 'Background/pac'

import { callBackground } from './background-rpc'
import browser from './browser-api'
import { readProxyState } from './proxy-list'
import { applyPac, getRouteRevision, proxyAllowed } from './proxy-route'
import registry from './registry'

class ProxyManager {
  async getProxyingRules () {
    const { localProxyURI } = await browser.storage.local.get('localProxyURI')

    // When Censor Tracker Proxy Server is used
    if (localProxyURI) {
      console.log(`Using local proxy server: ${localProxyURI}`)
      return {
        id: 'local',
        proxyServerProtocol: 'SOCKS5',
        proxyServerURI: localProxyURI,
      }
    }

    const { proxies, selectedProxyIds, builtin } = await readProxyState()
    const catalog = new Map(
      [builtin, ...proxies].map((proxy) => [proxy.id, proxy]),
    )
    const selected = selectedProxyIds.map((id) => catalog.get(id))
      .find((proxy) => proxy?.host && proxy.port)

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

  async setProxyInBackground () {
    const revision = getRouteRevision()

    if (!await proxyAllowed()) {
      return false
    }
    const domains = await registry.getDomains()
    const { ignoredHosts } =
      await browser.storage.local.get({ ignoredHosts: [] })

    if (revision !== getRouteRevision()) {
      return this.setProxyInBackground()
    }

    if (domains.length === 0) {
      console.info('No domains to proxy; clearing proxy settings.')
      await this.removeProxyInBackground()
      if (revision !== getRouteRevision()) {
        return this.setProxyInBackground()
      }
      return false
    }

    const {
      proxyServerURI,
      proxyServerProtocol,
    } = await this.getProxyingRules()

    await this.ping()

    if (!await proxyAllowed()) {
      return false
    }

    if (revision !== getRouteRevision()) {
      return this.setProxyInBackground()
    }

    try {
      const pacData = getPacScript({
        domains,
        ignoredHosts,
        proxyServerURI,
        proxyServerProtocol,
      })

      await applyPac(pacData)
      if (!await proxyAllowed()) {
        await this.removeProxyInBackground()
        return false
      }
      if (revision !== getRouteRevision()) {
        return this.setProxyInBackground()
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

  async ping () {
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

    if (!usesBuiltin || localProxyURI || !proxyPingURI) {
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)

    try {
      await fetch(`https://${proxyPingURI}`, {
        method: 'POST',
        signal: controller.signal,
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
    }

    console.log(`Knocked ${proxyPingURI}!`)
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
    await browser.storage.local.set({ useLocalProxy: false })
    await browser.storage.local.remove(['localProxyURI'])
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
