import { normalizeHostname } from './hostname'
import { proxyDirective } from './proxy-address'
import { countryCode } from './proxy-check-data'
import { validateSiteRules } from './site-rules'

export const routingConfig = ({
  domains = [], ignoredHosts = [], proxies = [], proxyAll = false, probes = [],
  siteCountryRules = {},
}) => ({
  proxyAll,
  siteCountryRules: validateSiteRules(siteCountryRules),
  domains: Array.from(new Set(domains.map(normalizeHostname).filter(Boolean))),
  ignoredHosts: ignoredHosts.map(normalizeHostname).filter(Boolean),
  proxies: proxies.map(({
    id, protocol, host, port, retryAt, exitCountry, countryExpiresAt,
  }) => ({
    id,
    route: proxyDirective(protocol, `${host}:${port}`),
    retryAt: Number.isFinite(retryAt) ? retryAt : 0,
    exitCountry: countryCode(exitCountry),
    countryExpiresAt: Number.isFinite(countryExpiresAt) ? countryExpiresAt : 0,
  })),
  probes: probes.map(({ hostname, proxy, expiresAt }) => ({
    hostname: normalizeHostname(hostname),
    id: proxy.id,
    expiresAt,
    route: proxyDirective(proxy.protocol, `${proxy.host}:${proxy.port}`),
  })),
})

// Self-contained so PAC and extension code use the same route decision.
export const createRouter = (config, matchHost, privateHost) => {
  const domains = new Set(config.domains)
  const ignored = new Set(config.ignoredHosts)
  const ruleHosts = new Set(Object.keys(config.siteCountryRules))
  const probes = new Map(config.probes.map((probe) => [probe.hostname, probe]))

  return (host) => {
    host = host.toLowerCase().replace(/\.$/, '')
    if (privateHost(host) || matchHost(host, ignored)) {
      return { type: 'direct', proxies: [], route: 'DIRECT' }
    }
    const probe = probes.get(host)
    const rule = matchHost(host, ruleHosts)
    const forbidden = rule ? config.siteCountryRules[rule] : []

    if (probe) {
      return forbidden.length === 0 && Date.now() < probe.expiresAt
        ? { type: 'probe', proxies: [probe.id], route: probe.route }
        : { type: 'blocked', proxies: [], route: 'PROXY 127.0.0.1:0' }
    }
    if (!(config.proxyAll || host.endsWith('.onion') || host.endsWith('.i2p') ||
      matchHost(host, domains))) {
      return { type: 'direct', proxies: [], route: 'DIRECT' }
    }
    const available = config.proxies.filter((proxy) =>
      proxy.retryAt <= Date.now() && (forbidden.length === 0 ||
        (proxy.exitCountry && proxy.countryExpiresAt > Date.now() &&
          !forbidden.includes(proxy.exitCountry))))

    if (available.length === 0) {
      return { type: 'blocked', proxies: [], route: 'PROXY 127.0.0.1:0' }
    }
    let hash = 0

    for (let index = 0; index < host.length; index++) {
      hash = (hash * 31 + host.charCodeAt(index)) % 2147483647
    }
    const offset = hash % available.length
    const proxies = available.slice(offset).concat(available.slice(0, offset))

    return {
      type: 'proxy',
      proxies: proxies.map(({ id }) => id),
      route: `${proxies.map(({ route }) => route).join('; ')};`,
    }
  }
}
