import browser from './browser-api'
import { parseProxyAddress } from './proxy-address'
import {
  newProxyId, proxyStateFromSettings, validateProxy, validateProxyList,
} from './proxy-record'

export const readProxyState = async () => {
  const storage = await browser.storage.local.get({
    proxies: null,
    selectedProxyIds: null,
    customProxyServerURI: null,
    customProxyProtocol: null,
    proxyServerURI: null,
    useOwnProxy: null,
  })
  const builtin = { id: 'builtin', name: 'Censor Tracker', protocol: 'HTTPS' }

  try {
    Object.assign(builtin, parseProxyAddress(storage.proxyServerURI))
  } catch (error) {
    // The managed endpoint may be unavailable before its first successful sync.
  }
  return { ...proxyStateFromSettings(storage), builtin }
}

// The background caller holds the proxy lock across this write and PAC update.
export const updateProxyList = async ({
  operation, proxy, ids, id: proxyId, selected,
} = {}) => {
  const state = await readProxyState()

  if (operation === 'list') {
    return state
  }
  if (operation === 'save') {
    const record = validateProxy({ ...proxy, id: proxy?.id || newProxyId() })
    const index = state.proxies.findIndex(({ id }) => id === record.id)

    if (index < 0) {
      state.proxies.push(record)
    } else {
      state.proxies[index] = record
    }
  } else if (operation === 'remove') {
    if (!Array.isArray(ids) || ids.includes('builtin')) {
      throw new Error('Cannot remove the managed proxy')
    }
    state.proxies = state.proxies.filter(({ id }) => !ids.includes(id))
    state.selectedProxyIds = state.selectedProxyIds.filter(
      (id) => !ids.includes(id),
    )
  } else if (operation === 'select' || operation === 'toggle') {
    const available = new Set(['builtin', ...state.proxies.map(({ id }) => id)])

    if (operation === 'toggle') {
      if (!available.has(proxyId) || typeof selected !== 'boolean') {
        throw new Error('Invalid proxy selection')
      }
      ids = selected ? [...state.selectedProxyIds, proxyId]
        : state.selectedProxyIds.filter((entry) => entry !== proxyId)
    }
    if (!Array.isArray(ids) || ids.some((id) => !available.has(id))) {
      throw new Error('Invalid proxy selection')
    }
    state.selectedProxyIds = Array.from(new Set(ids))
  } else {
    throw new Error('Unknown proxy operation')
  }
  await browser.storage.local.set({
    proxies: validateProxyList(state.proxies),
    selectedProxyIds: state.selectedProxyIds,
    useOwnProxy: state.selectedProxyIds.some((id) => id !== 'builtin'),
    customProxyProtocol: 'HTTPS',
    customProxyServerURI: '',
  })
  return state
}
