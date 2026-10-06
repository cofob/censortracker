import browser from './browser-api'
import { parseFailedSiteUrl } from './failed-site-data'
import ProxyManager from './proxy'
import { proxyAllowed } from './proxy-route'
import Registry from './registry'

const errors = new Set([
  'ERR_CONNECTION_RESET', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT',
  'NS_ERROR_NET_RESET', 'NS_ERROR_NET_TIMEOUT',
  'ERR_NAME_NOT_RESOLVED', 'NS_ERROR_UNKNOWN_HOST',
])
const navigations = new Map()
const retries = new Map()
const retryKey = (tabId) => `failedSiteRetry:${tabId}`
const pageUrl = (url) => browser.runtime.getURL(
  `unavailable.html#${encodeURIComponent(url)}`,
)
const currentTabUrl = async (tabId) => {
  const tab = await browser.tabs.get(tabId)

  return tab.pendingUrl || tab.url
}
const clearRetry = async (tabId) => {
  retries.delete(tabId)
  await browser.storage.session?.remove(retryKey(tabId))
}
const takeRetry = async (tabId, url) => {
  const key = retryKey(tabId)
  const retry = browser.storage.session
    ? (await browser.storage.session.get(key))[key] : retries.get(tabId)

  if (!retry) {
    return false
  }
  const target = new URL(url)

  target.hash = ''
  await clearRetry(tabId)
  return retry.url === target.href && retry.expiresAt > Date.now()
}

export const noteSiteNavigation = ({ tabId, requestId, url }) => {
  if (tabId >= 0) {
    navigations.set(tabId, { requestId, url, handling: false })
  }
}

export const finishSiteRequest = async ({ tabId, requestId }) => {
  if (!navigations.has(tabId) ||
    navigations.get(tabId).requestId === requestId) {
    navigations.delete(tabId)
    await clearRetry(tabId)
  }
}

export const handleFailedSite = async (details) => {
  const { tabId, requestId, error, type, method, frameId, url } = details

  if (!Number.isInteger(tabId) || tabId < 0 ||
    type !== 'main_frame' || frameId !== 0) {
    return
  }
  const navigation = navigations.get(tabId) || { requestId, handling: false }

  if ((navigation.requestId && navigation.requestId !== requestId) ||
    (navigation.url && navigation.url !== url) || navigation.handling) {
    return
  }
  navigations.set(tabId, navigation)
  navigation.handling = true
  try {
    if (await takeRetry(tabId, url) || method !== 'GET' ||
      !errors.has(String(error).replace(/^net::/, ''))) {
      return
    }
    const target = parseFailedSiteUrl(url)
    const { useDPIDetection } = await browser.storage.local.get({
      useDPIDetection: true,
    })

    if (!useDPIDetection || !await proxyAllowed()) {
      return
    }
    const { blocked, custom, ignored } =
      await Registry.getDomainStatus(target.hostname)

    if (blocked || custom || ignored ||
      (await ProxyManager.getRouteForHost(target.hostname)).type !== 'direct') {
      return
    }
    const tab = await browser.tabs.get(tabId)
    const current = new URL(
      tab.pendingUrl || navigation.url || tab.url || 'about:blank',
    )

    current.hash = ''
    target.hash = ''
    if (navigations.get(tabId) !== navigation || current.href !== target.href) {
      return
    }
    await browser.tabs.update(tabId, { url: pageUrl(url) })
  } finally {
    navigation.handling = false
  }
}

export const retryFailedSite = async ({ tabId, url } = {}) => {
  const target = parseFailedSiteUrl(url)

  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new TypeError('Invalid site tab')
  }
  if (await currentTabUrl(tabId) !== pageUrl(url)) {
    throw new Error('The page has changed')
  }
  if (await proxyAllowed() &&
    (await ProxyManager.getRouteForHost(target.hostname)).type !== 'direct') {
    throw new Error('The site no longer uses a direct route')
  }
  target.hash = ''
  const retry = { url: target.href, expiresAt: Date.now() + 5 * 60 * 1000 }

  if (browser.storage.session) {
    await browser.storage.session.set({ [retryKey(tabId)]: retry })
  } else {
    retries.set(tabId, retry)
  }
  try {
    if (await currentTabUrl(tabId) !== pageUrl(url)) {
      throw new Error('The page has changed')
    }
    await browser.tabs.update(tabId, { url })
  } catch (error) {
    await clearRetry(tabId)
    throw error
  }
}

export const registerFailedSites = () => {
  const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }
  const reportError = () => console.warn('Failed site check could not complete')

  browser.webNavigation?.onBeforeNavigate?.addListener((details) => {
    if (details.frameId === 0) {
      const navigation = navigations.get(details.tabId)

      if (navigation?.url !== details.url || navigation.handling) {
        noteSiteNavigation(details)
      }
    }
  })
  browser.webRequest?.onBeforeRequest?.addListener(noteSiteNavigation, filter)
  browser.webRequest?.onErrorOccurred?.addListener(
    (details) => handleFailedSite(details).catch(reportError), filter,
  )
  browser.webRequest?.onCompleted?.addListener(
    (details) => finishSiteRequest(details).catch(reportError), filter,
  )
  browser.tabs?.onRemoved?.addListener((tabId) => {
    navigations.delete(tabId)
    clearRetry(tabId).catch(reportError)
  })
}
