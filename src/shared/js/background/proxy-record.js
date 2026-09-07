import { parseProxyAddress, proxyProtocols } from './proxy-address'

export const MAX_PROXIES = 5000

export const newProxyId = () => Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, '0'),
).join('')

export const proxyKey = ({ protocol, host, port }) => `${protocol} ${host}:${port}`

export const validateProxy = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    typeof input.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(input.id) ||
    input.id === 'builtin' || typeof input.host !== 'string' ||
    !Number.isInteger(input.port) || !proxyProtocols.includes(input.protocol)) {
    throw new Error('Invalid proxy')
  }
  const protocol = { PROXY: 'HTTP', SOCKS: 'SOCKS4' }[input.protocol] ||
    input.protocol
  const address = input.host.includes(':') && !input.host.startsWith('[')
    ? `[${input.host}]` : input.host
  const { host, port } = parseProxyAddress(`${address}:${input.port}`)
  const name = input.name === undefined ? `${protocol} ${host}:${port}` : input.name

  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    throw new Error('Invalid proxy name')
  }
  return { id: input.id, name: name.trim(), protocol, host, port }
}

export const validateProxyList = (proxies) => {
  if (!Array.isArray(proxies) || proxies.length > MAX_PROXIES) {
    throw new Error('Invalid proxy list')
  }
  const result = proxies.map(validateProxy)

  if (new Set(result.map(({ id }) => id)).size !== result.length ||
    new Set(result.map(proxyKey)).size !== result.length) {
    throw new Error('Duplicate proxy')
  }
  return result
}

export const proxyStateFromSettings = (settings) => {
  let proxies = settings.proxies
  let selectedProxyIds = settings.selectedProxyIds

  if (proxies === undefined || proxies === null) {
    proxies = []
    if (settings.customProxyServerURI && settings.customProxyProtocol) {
      try {
        proxies.push(validateProxy({
          id: 'legacy',
          protocol: settings.customProxyProtocol,
          ...parseProxyAddress(settings.customProxyServerURI),
        }))
      } catch (error) {
        // A bad legacy endpoint must not select a different proxy.
      }
    }
    if (selectedProxyIds === undefined || selectedProxyIds === null) {
      selectedProxyIds = settings.customProxyServerURI &&
        settings.useOwnProxy !== false
        ? proxies.map(({ id }) => id) : ['builtin']
    }
  }
  proxies = validateProxyList(proxies)
  const available = new Set(['builtin', ...proxies.map(({ id }) => id)])

  selectedProxyIds = selectedProxyIds ?? ['builtin']
  if (!Array.isArray(selectedProxyIds) ||
    selectedProxyIds.length > MAX_PROXIES + 1 ||
    selectedProxyIds.some((id) => !available.has(id))) {
    throw new Error('Invalid proxy selection')
  }
  return { proxies, selectedProxyIds: Array.from(new Set(selectedProxyIds)) }
}
