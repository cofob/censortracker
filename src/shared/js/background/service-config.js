export const GEOIP_URL = 'https://geo.ctreserve.de/get-iso/'
export const ORI_URL = 'https://registry.ctreserve.de/api/v3/disseminators/refused/'
export const PROXY_LIST_URL = 'https://cozyquokka.net/api/proxy-list/'

export const getRegionConfig = (code) => {
  const countryCode = code.toUpperCase()
  const countries = ['AZ', 'BY', 'GE', 'KG', 'KZ', 'TR', 'UA', 'UZ']
  let registryUrl = null

  if (countryCode === 'RU') {
    registryUrl = 'https://registry.ctreserve.de/api/v3/ct-domains/'
  } else if (countries.includes(countryCode)) {
    registryUrl = `https://censortracker.github.io/ctconf/registry/${countryCode.toLowerCase()}.json`
  }
  return {
    countryCode,
    registryUrl,
    configSource: 'built-in',
  }
}

export const validCountry = (data) => {
  return typeof data?.countryCode === 'string' &&
    /^[a-z]{2}$/i.test(data.countryCode)
}

export const validDomains = (data) => {
  return Array.isArray(data) && data.every((domain) => {
    return typeof domain === 'string' && domain.length > 0 &&
      !/[\s/:;]/.test(domain)
  })
}

export const validORI = (data) => {
  return Array.isArray(data) && data.every((entry) => {
    return entry && typeof entry.url === 'string' && entry.url.length > 0 &&
      typeof entry.cooperationRefused === 'boolean'
  })
}

const validHost = (value) => {
  return typeof value === 'string' && /^[a-z0-9.-]+$/i.test(value)
}

const validPort = (value) => {
  return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 65535
}

export const validProxies = (data) => {
  return Array.isArray(data) && data.every((entry) => {
    return entry && validHost(entry.server) && validHost(entry.pingHost) &&
      validPort(entry.port) && validPort(entry.pingPort) &&
      typeof entry.active === 'boolean' &&
      Number.isFinite(Number(entry.weight)) && Number(entry.weight) >= 0
  }) && data.some(({ active, weight }) => active && Number(weight) > 0)
}
