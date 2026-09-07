export const normalizeHostname = (value) => {
  if (typeof value !== 'string' ||
    Array.from(value).some((char) => char <= ' ' || char === '\u007F')) {
    return null
  }
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')

    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !host ||
      host.length > 253 || (!host.startsWith('[') && !host.split('.').every(
      (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ))) {
      return null
    }
    return host
  } catch (error) {
    return null
  }
}
