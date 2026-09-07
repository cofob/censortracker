import { findHostMatch } from './host-match'
import { normalizeHostname } from './hostname'
import { isPrivateHost } from './private-host'
import { proxyDirective } from './proxy-address'

export const getPacScript = ({
  domains = [], ignoredHosts = [], proxyServerURI, proxyServerProtocol,
}) => {
  const route = JSON.stringify(`${proxyDirective(proxyServerProtocol, proxyServerURI)};`)
  const names = Array.from(new Set(
    domains.map(normalizeHostname).filter(Boolean),
  ))

  return `
    var ctDomains = new Set(${JSON.stringify(names)});
    var ctIgnored = new Set(${JSON.stringify(ignoredHosts.map(normalizeHostname).filter(Boolean))});
    var ctMatch = ${findHostMatch.toString()};
    var ctPrivate = ${isPrivateHost.toString()};
    function FindProxyForURL(url, host) {
      host = host.toLowerCase().replace(/\\.$/, '');
      if (ctPrivate(host) || ctMatch(host, ctIgnored)) {
        return 'DIRECT';
      }
      if (host.endsWith('.onion') || host.endsWith('.i2p') || ctMatch(host, ctDomains)) {
        return ${route};
      }
      return 'DIRECT';
    }`
}
