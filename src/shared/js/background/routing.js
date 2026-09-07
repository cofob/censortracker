import { normalizeHostname } from './hostname'
import { proxyDirective } from './proxy-address'

export const routingConfig = ({
  domains = [], ignoredHosts = [], proxies = [], proxyAll = false, probes = [],
}) => ({
  proxyAll,
  domains: Array.from(new Set(domains.map(normalizeHostname).filter(Boolean))),
  ignoredHosts: ignoredHosts.map(normalizeHostname).filter(Boolean),
  proxies: proxies.map(({ id, protocol, host, port }) => ({
    id, route: proxyDirective(protocol, `${host}:${port}`),
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
  const probes = new Map(config.probes.map((probe) => [probe.hostname, probe]))

  return (host) => {
    host = host.toLowerCase().replace(/\.$/, '')
    if (privateHost(host) || matchHost(host, ignored)) {
      return { type: 'direct', proxies: [], route: 'DIRECT' }
    }
    const probe = probes.get(host)

    if (probe) {
      return Date.now() < probe.expiresAt
        ? { type: 'probe', proxies: [probe.id], route: probe.route }
        : { type: 'blocked', proxies: [], route: 'PROXY 127.0.0.1:0' }
    }
    if (!(config.proxyAll || host.endsWith('.onion') || host.endsWith('.i2p') ||
      matchHost(host, domains))) {
      return { type: 'direct', proxies: [], route: 'DIRECT' }
    }
    if (config.proxies.length === 0) {
      return { type: 'blocked', proxies: [], route: 'PROXY 127.0.0.1:0' }
    }
    let hash = 0

    for (let index = 0; index < host.length; index++) {
      hash = (hash * 31 + host.charCodeAt(index)) % 2147483647
    }
    const offset = hash % config.proxies.length
    const proxies = config.proxies.slice(offset)
      .concat(config.proxies.slice(0, offset))

    return {
      type: 'proxy',
      proxies: proxies.map(({ id }) => id),
      route: `${proxies.map(({ route }) => route).join('; ')};`,
    }
  }
}
