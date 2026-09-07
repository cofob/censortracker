import { getPacScript } from 'Background/pac'

import { callBackground } from './background-rpc'
import browser from './browser-api'
import { applyPac, getRouteRevision, proxyAllowed } from './proxy-route'
import registry from './registry'

class ProxyManager {
  async getProxyingRules () {
    const {
      proxyServerURI,
      customProxyProtocol,
      customProxyServerURI,
      localProxyURI,
    } = await browser.storage.local.get([
      'proxyServerURI',
      'customProxyProtocol',
      'customProxyServerURI',
      'localProxyURI',
    ])

    // When Censor Tracker Proxy Server is used
    if (localProxyURI) {
      console.log(`Using local proxy server: ${localProxyURI}`)
      return {
        proxyServerProtocol: 'SOCKS5',
        proxyServerURI: localProxyURI,
      }
    }

    if (
      customProxyServerURI &&
      customProxyProtocol
    ) {
      return {
        proxyServerProtocol: customProxyProtocol,
        proxyServerURI: customProxyServerURI,
      }
    }
    return {
      proxyServerProtocol: 'HTTPS',
      proxyServerURI,
    }
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
    } = await browser.storage.local.get({
      localProxyURI: null,
      proxyPingURI: null,
      useOwnProxy: false,
    })

    if (useOwnProxy || localProxyURI || !proxyPingURI) {
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
    const { useOwnProxy } =
      await browser.storage.local.get({
        useOwnProxy: false,
      })

    return useOwnProxy
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

  async removeCustomProxy () {
    await browser.storage.local.set({
      useOwnProxy: false,
    })
    await browser.storage.local.remove([
      'customProxyProtocol',
      'customProxyServerURI',
    ])
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
