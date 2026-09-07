const protocols = {
  HTTP: 'PROXY',
  PROXY: 'PROXY',
  HTTPS: 'HTTPS',
  SOCKS: 'SOCKS',
  SOCKS4: 'SOCKS4',
  SOCKS5: 'SOCKS5',
}

export const parseProxyAddress = (address) => {
  if (typeof address !== 'string' || address.length > 300) {
    throw new Error('Invalid proxy address')
  }
  const match = /^(\[[0-9a-f:.]+\]|[^\s:;/\\@?#%'"`]+):(\d{1,5})$/i.exec(address)

  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    throw new Error('Invalid proxy address')
  }
  const host = new URL(`http://${match[1]}`).hostname.toLowerCase()
  const port = Number(match[2])

  if (!host.startsWith('[') && (host.length > 253 ||
    !host.replace(/\.$/, '').split('.').every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) {
    throw new Error('Invalid proxy address')
  }
  return { host: host.replace(/\.$/, ''), port }
}

export const proxyDirective = (protocol, address) => {
  if (!Object.prototype.hasOwnProperty.call(protocols, protocol)) {
    throw new Error('Invalid proxy protocol')
  }
  const { host, port } = parseProxyAddress(address)

  return `${protocols[protocol]} ${host}:${port}`
}
