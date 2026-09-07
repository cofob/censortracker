import { normalizeHostname } from './hostname'
import { parseProxyAddress, proxyProtocols } from './proxy-address'
import { proxyStateFromSettings } from './proxy-record'

export const settingsDefaults = {
  enableExtension: false,
  useProxy: true,
  proxyAll: false,
  useRegistry: true,
  showNotifications: true,
  useOwnProxy: false,
  useLocalProxy: false,
  ignoredHosts: [],
  customProxiedDomains: [],
  currentRegionCode: '',
  currentRegionName: '',
  customProxyProtocol: 'HTTPS',
  customProxyServerURI: '',
}
const booleanKeys = new Set(Object.keys(settingsDefaults)
  .filter((key) => typeof settingsDefaults[key] === 'boolean'))
const hostKeys = new Set(['ignoredHosts', 'customProxiedDomains'])
const isObject = (value) => value !== null && typeof value === 'object' &&
  !Array.isArray(value)

export const validateSettings = (input) => {
  if (!isObject(input) || (input.formatVersion !== undefined &&
    input.formatVersion !== 1)) {
    throw new Error('Invalid settings format')
  }
  const settings = input.formatVersion === 1 ? input.settings : input
  const result = {}

  if (!isObject(settings)) {
    throw new Error('Invalid settings')
  }
  for (const [key, value] of Object.entries(settings)) {
    let valid = true

    if (key === 'proxies' || key === 'selectedProxyIds') {
      if (!Array.isArray(value)) {
        throw new TypeError('Invalid proxy selection')
      }
      result[key] = value
      continue
    } else if (booleanKeys.has(key)) {
      valid = typeof value === 'boolean'
    } else if (hostKeys.has(key)) {
      if (!Array.isArray(value) || value.length > 100000) {
        throw new Error(`Invalid setting: ${key}`)
      }
      const names = value.map((name) => normalizeHostname(
        typeof name === 'string' ? name.trim() : name,
      ))

      if (names.some((name) => !name)) {
        throw new Error(`Invalid setting: ${key}`)
      }
      result[key] = Array.from(new Set(names))
      continue
    } else if (key === 'currentRegionCode') {
      valid = typeof value === 'string' && /^(?:[A-Z]{2})?$/.test(value)
    } else if (key === 'currentRegionName') {
      valid = typeof value === 'string' && value.length <= 100
    } else if (key === 'customProxyServerURI') {
      if (value !== '') {
        parseProxyAddress(value)
      }
    } else if (key === 'customProxyProtocol') {
      valid = proxyProtocols.includes(value)
    } else {
      continue
    }
    if (!valid) {
      throw new Error(`Invalid setting: ${key}`)
    }
    result[key] = value
  }
  return { ...result, ...proxyStateFromSettings(result) }
}
