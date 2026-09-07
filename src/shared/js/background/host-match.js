// Accepts a Set or Map of canonical hostnames. Also used inside PAC.
export const findHostMatch = (hostname, rules) => {
  if (!hostname) {
    return null
  }
  let host = hostname.toLowerCase().replace(/\.$/, '')
  const address = host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)

  while (host) {
    if (rules.has(host)) {
      return host
    }
    const dot = host.indexOf('.')

    if (address || dot < 0) {
      return null
    }
    host = host.slice(dot + 1)
  }
  return null
}
