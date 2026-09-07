import { normalizeHostname } from './hostname'
import { isPrivateHost } from './private-host'
import { validateSourceUrl } from './proxy-source'

export const registrySourceDefaults = {
  kind: 'custom', url: '', enabled: false, autoUpdate: false,
}
export const MAX_REGISTRY_BYTES = 32 * 1024 * 1024

export const validateRegistrySource = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
    source.kind !== 'custom' || typeof source.enabled !== 'boolean' ||
    typeof source.autoUpdate !== 'boolean' || typeof source.url !== 'string') {
    throw new TypeError('Invalid registry source')
  }
  const url = source.url === '' ? '' : validateSourceUrl(source.url)

  if (!url && (source.enabled || source.autoUpdate)) {
    throw new TypeError('A registry source URL is required')
  }
  return {
    kind: source.kind,
    url,
    enabled: source.enabled,
    autoUpdate: source.autoUpdate,
  }
}

export const registrySourceKey = (source) => JSON.stringify([
  source.kind, source.url,
])

export const externalRegistryDomains = ({ registrySource, externalRegistry }) =>
  registrySource?.enabled &&
  externalRegistry?.source === registrySourceKey(registrySource)
    ? externalRegistry.domains : []

export const normalizeRegistryDomains = async (input, signal) => {
  if (!Array.isArray(input) || input.length === 0 || input.length > 1000000) {
    throw new TypeError('Invalid registry list')
  }
  const domains = new Set()

  for (let index = 0; index < input.length; index++) {
    if (signal?.aborted) {
      throw new Error('Registry download cancelled')
    }
    const entry = input[index]

    if (typeof entry !== 'string' || entry.length > 253 ||
      /[\s/\\@?#%]/.test(entry) ||
      (entry.includes(':') && !/^\[[0-9a-f:.]+\]$/i.test(entry))) {
      throw new TypeError('Invalid registry hostname')
    }
    const host = normalizeHostname(entry)

    if (!host) {
      throw new TypeError('Invalid registry hostname')
    }
    if (!isPrivateHost(host)) {
      domains.add(host)
    }
    if (index > 0 && index % 2000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (domains.size === 0) {
    throw new TypeError('Empty registry list')
  }
  return Array.from(domains)
}

export const parseRegistryList = (text, signal) => {
  if (typeof text !== 'string' || text.length > MAX_REGISTRY_BYTES) {
    throw new TypeError('Invalid registry response')
  }
  text = text.trim()
  let domains

  if (text.startsWith('[') || text.startsWith('{')) {
    const value = JSON.parse(text)

    domains = Array.isArray(value) ? value : value.domains
  } else {
    domains = text.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
  }
  return normalizeRegistryDomains(domains, signal)
}
