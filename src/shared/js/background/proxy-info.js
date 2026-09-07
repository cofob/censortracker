import browser from './browser-api'
import { normalizeHostname } from './hostname'
import ProxyManager from './proxy'
import { countryCode, currentProxyCheck, publicIP } from './proxy-check-data'
import { getRouteRevision, proxyAllowed } from './proxy-route'
import Registry from './registry'

// Public route descriptions must never include credentials or a PAC script.
export const describeProxyRoute = async ({ url } = {}) => {
  const revision = getRouteRevision()
  const hostname = normalizeHostname(url)

  if (!hostname) {
    return { type: 'unavailable' }
  }
  if (!await proxyAllowed()) {
    return { type: 'disabled' }
  }
  const route = await ProxyManager.getRouteForHost(hostname)
  const proxy = route.proxies[0]
  const { proxyChecks, currentRegionName, activeProxyConfigName } =
    await browser.storage.local.get({
      proxyChecks: {}, currentRegionName: '', activeProxyConfigName: '',
    })
  const check = proxy ? await currentProxyCheck(proxy, proxyChecks) : null
  const domains = await Registry.getDomains()

  if (revision !== getRouteRevision()) {
    return describeProxyRoute({ url })
  }
  return {
    type: route.type,
    proxy: proxy ? {
      name: proxy.name || activeProxyConfigName || 'Censor Tracker Proxy Server',
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
    } : null,
    fallbackCount: Math.max(0, route.proxies.length - 1),
    check: check && Number.isFinite(check.checkedAt) ? {
      status: check.status,
      checkedAt: check.checkedAt,
      exitIP: check.status === 'ok' ? publicIP(check.exitIP) : '',
      exitCountry: check.status === 'ok' ? countryCode(check.exitCountry) : '',
    } : null,
    region: currentRegionName,
    domainCount: domains.length,
  }
}
