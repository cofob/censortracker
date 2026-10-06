import { normalizeHostname } from './hostname'
import { isPrivateHost } from './private-host'

export const parseFailedSiteUrl = (value) => {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new TypeError('Invalid site URL')
  }
  const url = new URL(value)
  const host = normalizeHostname(url.href)

  if (!['http:', 'https:'].includes(url.protocol) || !host ||
    isPrivateHost(host) || url.username || url.password) {
    throw new TypeError('Invalid site URL')
  }
  return url
}
