import { findHostMatch } from './host-match'
import { normalizeHostname } from './hostname'
import { proxyDirective } from './proxy-address'

export const getPacScript = ({
  domains = [], proxyServerURI, proxyServerProtocol,
}) => {
  const route = JSON.stringify(`${proxyDirective(proxyServerProtocol, proxyServerURI)};`)
  const names = Array.from(new Set(
    domains.map(normalizeHostname).filter(Boolean),
  ))

  return `
    var ctDomains = new Set(${JSON.stringify(names)});
    var ctMatch = ${findHostMatch.toString()};
    function FindProxyForURL(url, host) {
      host = host.toLowerCase().replace(/\\.$/, '');
      if (host.endsWith('.onion') || host.endsWith('.i2p') || ctMatch(host, ctDomains)) {
        return ${route};
      }
      return 'DIRECT';
    }`
}
