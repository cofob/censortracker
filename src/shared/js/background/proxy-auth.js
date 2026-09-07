import browser from './browser-api'
import { normalizeHostname } from './hostname'
import ProxyManager from './proxy'
import { proxyDirective } from './proxy-address'
import { hasProxyAuth, proxyKey } from './proxy-record'
import { getServiceRoute, proxyRequestAllowed } from './proxy-route'

const requestProxies = async (url) => {
  const hostname = normalizeHostname(url)

  if (!hostname || !await proxyRequestAllowed()) {
    return []
  }
  const override = getServiceRoute()

  if (override?.hostname === hostname) {
    return (await ProxyManager.getSelectedProxies()).filter((proxy) =>
      proxyDirective(proxy.protocol, `${proxy.host}:${proxy.port}`) === override.route)
  }
  return (await ProxyManager.getRouteForHost(hostname)).proxies
}

export const createAuthHandler = (getProxies = requestProxies) => {
  const attempts = new Map()
  const handle = async (details) => {
    if (!details.isProxy || !details.challenger) {
      return {}
    }
    const host = normalizeHostname(details.challenger.host) ||
      normalizeHostname(`[${details.challenger.host}]`)
    const candidates = await getProxies(details.url)
    const proxy = candidates.find((entry) => hasProxyAuth(entry) &&
      ['HTTP', 'HTTPS'].includes(entry.protocol) && entry.host === host &&
      entry.port === details.challenger.port)

    if (!proxy) {
      return {}
    }
    const tried = attempts.get(details.requestId) || new Set()
    const key = proxyKey(proxy)

    if (tried.has(key) || tried.size >= 10 ||
      (!attempts.has(details.requestId) && attempts.size >= 1024)) {
      return { cancel: true }
    }
    tried.add(key)
    attempts.set(details.requestId, tried)
    return {
      authCredentials: { username: proxy.username, password: proxy.password },
    }
  }

  return { handle, clear: ({ requestId }) => attempts.delete(requestId) }
}

export const firefoxProxyInfo = (proxy) => {
  const type = { HTTP: 'http', HTTPS: 'https', SOCKS4: 'socks4', SOCKS5: 'socks' }[proxy.protocol]

  return {
    type,
    host: proxy.host.replace(/^\[|\]$/g, ''),
    port: proxy.port,
    failoverTimeout: 8,
    ...(['SOCKS4', 'SOCKS5'].includes(proxy.protocol) ? { proxyDNS: true } : {}),
    ...(proxy.protocol === 'SOCKS5' && hasProxyAuth(proxy)
      ? { username: proxy.username, password: proxy.password } : {}),
  }
}

export const handleFirefoxProxy = async ({ url }) => {
  const proxies = await requestProxies(url)

  if (proxies.some((proxy) => proxy.protocol === 'SOCKS5' && hasProxyAuth(proxy))) {
    // null prevents fallback to a browser-defined route after the last proxy.
    return [...proxies.map(firefoxProxyInfo), null]
  }
  return undefined
}

export const registerProxyAuth = () => {
  const { handle, clear } = createAuthHandler()
  const filter = { urls: ['<all_urls>'] }

  browser.webRequest.onAuthRequired.addListener(browser.isFirefox
    ? (details) => handle(details).catch(() => ({ cancel: true }))
    : (details, respond) => {
      handle(details).then(respond, () => respond({ cancel: true }))
    }, filter, [browser.isFirefox ? 'blocking' : 'asyncBlocking'])
  browser.webRequest.onCompleted.addListener(clear, filter)
  browser.webRequest.onErrorOccurred.addListener(clear, filter)
  if (browser.isFirefox) {
    browser.proxy.onRequest.addListener(handleFirefoxProxy, filter)
  }
}
