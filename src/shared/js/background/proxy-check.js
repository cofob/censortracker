import browser from './browser-api'
import ProxyManager from './proxy'
import { currentProxyCheck, proxyFingerprint } from './proxy-check-data'
import { CHECK_URLS, locateProxy, probeProxy } from './proxy-check-network'
import { recordProxyHealth, recoverableProxies } from './proxy-health'
import { readProxyState } from './proxy-list'
import { hasProxyAuth, proxyAuthSupported } from './proxy-record'
import { getProbeRoutes, mustUseDirect, proxyAllowed, setProbeRoute, withProxyLock } from './proxy-route'

let job
const runState = (current) => ({
  running: true,
  total: current.proxies.length,
  completed: current.completed,
  cancelled: current.controller.signal.aborted,
})

const restoreRouting = async () => {
  if (await proxyAllowed()) {
    if (!await ProxyManager.setProxyInBackground({ ping: false })) {
      throw new Error('Could not restore routing after checks')
    }
  } else {
    await ProxyManager.removeProxyInBackground()
  }
}

export const getProxyCheckState = async () => {
  const { proxies, builtin } = await readProxyState()
  const { proxyChecks, proxyCheckRun } = await browser.storage.local.get({
    proxyChecks: {}, proxyCheckRun: { running: false },
  })
  const checks = {}

  await Promise.all([builtin, ...proxies].map(async (proxy) => {
    const result = await currentProxyCheck(proxy, proxyChecks)

    if (result) {
      checks[proxy.id] = result
    }
  }))
  return {
    checks, run: job ? runState(job) : { ...proxyCheckRun, running: false },
  }
}

const checkOne = async (current, proxy, url) => {
  const { signal } = current.controller
  const hostname = new URL(url).hostname
  const fingerprint = await proxyFingerprint(proxy)
  let result

  if (!proxy.host || !proxy.port || proxy.restricted ||
    !proxyAuthSupported(proxy, browser.isFirefox)) {
    result = { status: proxy.restricted ? 'restricted' : 'unsupported' }
  } else {
    try {
      await withProxyLock(async () => {
        if (signal.aborted || !await proxyAllowed() ||
          await mustUseDirect(hostname)) {
          throw new Error('Proxy check cancelled')
        }
        setProbeRoute(hostname, proxy)
        if (!await ProxyManager.setProxyInBackground({ ping: false })) {
          current.controller.abort()
          throw new Error('Could not install check route')
        }
      })
      if (signal.aborted || !await proxyAllowed()) {
        current.controller.abort()
        return
      }
      result = { ...await probeProxy(url, signal), status: 'ok' }
    } catch (error) {
      result = {
        status: getProbeRoutes()
          .find((probe) => probe.hostname === hostname)?.authFailed
          ? 'auth' : 'failed',
      }
    } finally {
      await withProxyLock(async () => {
        setProbeRoute(hostname, null)
        await restoreRouting()
      })
    }
    if (result?.status === 'ok' && !signal.aborted) {
      result = await locateProxy(proxy, result, signal)
    }
  }
  if (!signal.aborted && await proxyAllowed()) {
    await withProxyLock(async () => {
      const { proxies, builtin } = await readProxyState()
      const record = [builtin, ...proxies].find(({ id }) => id === proxy.id)

      if (!record || await proxyFingerprint(record) !== fingerprint ||
        signal.aborted) {
        return
      }
      const { proxyChecks } = await browser.storage.local.get({
        proxyChecks: {},
      })

      proxyChecks[proxy.id] = { ...result, fingerprint, checkedAt: Date.now() }
      await browser.storage.local.set({ proxyChecks })
      if (result.status === 'ok' || (result.status === 'failed' && !hasProxyAuth(proxy))) {
        if (await recordProxyHealth(proxy, result.status !== 'ok')) {
          await ProxyManager.setProxyInBackground({ ping: false })
        }
      }
    })
  }
}

const runChecks = async (current, urls) => {
  try {
    await Promise.allSettled(urls.map(async (url) => {
      try {
        while (!current.controller.signal.aborted &&
          current.next < current.proxies.length) {
          const proxy = current.proxies[current.next++]

          await checkOne(current, proxy, url)
          if (current.controller.signal.aborted) {
            break
          }
          current.completed++
          await browser.storage.local.set({ proxyCheckRun: runState(current) })
        }
      } catch (error) {
        current.controller.abort()
        throw error
      }
    }))
  } finally {
    current.controller.abort()
    await withProxyLock(async () => {
      for (const { hostname } of getProbeRoutes()) {
        setProbeRoute(hostname, null)
      }
      await restoreRouting()
      await browser.storage.local.set({ proxyProbeActive: false })
    })
    await browser.storage.local.set({
      proxyCheckRun: {
        running: false,
        total: current.proxies.length,
        completed: current.completed,
        cancelled: current.completed < current.proxies.length,
      },
    })
    job = null
  }
}

export const startProxyChecks = async ({ ids, automatic = false } = {}) => {
  if (job) {
    throw new Error('A proxy check is already running')
  }
  const current = {
    controller: new AbortController(),
    proxies: [],
    next: 0,
    completed: 0,
    automatic,
  }

  job = current
  try {
    const { proxyRecoveryEnabled } = await browser.storage.local.get({
      proxyRecoveryEnabled: false,
    })

    if (automatic && !proxyRecoveryEnabled) {
      throw new Error('Automatic checks are disabled')
    }
    if (!await proxyAllowed()) {
      throw new Error('Enable proxy use before checking')
    }
    const { proxies, builtin, selectedProxyIds } = await readProxyState()
    const catalog = [builtin, ...proxies]
    const available = new Set(catalog.map(({ id }) => id))

    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 5001 ||
      ids.some((id) => !available.has(id)))) {
      throw new Error('Invalid check selection')
    }
    current.proxies = catalog.filter(({ id }) =>
      ids === undefined || ids.includes(id))
    if (automatic) {
      const { proxyFailures, localProxyURI, proxyRecoveryEnabled: enabled } =
        await browser.storage.local.get({
          proxyFailures: {}, localProxyURI: null, proxyRecoveryEnabled: false,
        })

      current.proxies = enabled && !localProxyURI
        ? (await recoverableProxies(current.proxies.filter(({ id }) =>
          selectedProxyIds.includes(id)), proxyFailures)).slice(0, 4) : []
    }
    const urls = []

    for (const url of CHECK_URLS) {
      if (!await mustUseDirect(new URL(url).hostname)) {
        urls.push(url)
      }
    }
    if (urls.length === 0 || current.proxies.length === 0) {
      throw new Error('No proxies or permitted check services')
    }
    if (current.proxies.some(({ id }) => id === 'builtin')) {
      await ProxyManager.ping(true)
    }
    await browser.storage.local.set({
      proxyProbeActive: true, proxyCheckRun: runState(current),
    })
    current.done = runChecks(current, urls).catch(() => {
      current.controller.abort()
      job = null
      console.warn('Proxy check stopped; routing recovery may be required')
    })
    return runState(current)
  } catch (error) {
    current.controller.abort()
    job = null
    throw error
  }
}

export const stopProxyChecks = async () => {
  const current = job

  if (current) {
    current.controller.abort()
    await current.done
  }
}

export const registerProxyChecks = async () => {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && job?.automatic &&
      changes.proxyRecoveryEnabled?.newValue === false) {
      job.controller.abort()
    }
    if (area === 'local' && ['enableExtension', 'useProxy', 'proxies',
      'selectedProxyIds', 'ignoredHosts', 'localProxyURI'].some((key) => changes[key])) {
      if (job) {
        job.controller.abort()
      }
    }
  })
  if (browser.proxy.settings.onChange) {
    browser.proxy.settings.onChange.addListener(({ levelOfControl }) => {
      if (job && levelOfControl !== 'controlled_by_this_extension') {
        job.controller.abort()
      }
    })
  }
  await withProxyLock(async () => {
    const { proxyProbeActive } = await browser.storage.local.get(
      'proxyProbeActive',
    )

    if (proxyProbeActive) {
      await restoreRouting()
      await browser.storage.local.set({
        proxyProbeActive: false,
        proxyCheckRun: { running: false, cancelled: true },
      })
    }
  })
}
