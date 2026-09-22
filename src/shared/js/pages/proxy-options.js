import './page-errors'

import browser from 'Background/browser-api'
import ProxyManager from 'Background/proxy'

import { mountProxyCheck } from './proxy-check'
import { mountProxyImport } from './proxy-import'
import { mountProxyList } from './proxy-list'

(async () => {
  const useProxyCheckbox = document.getElementById('useProxyCheckbox')
  const radioGroup = document.getElementById('proxyCustomOptionsRadioGroup')
  let pendingRefresh = Promise.resolve()
  let pollTimer

  const render = async () => {
    const { useLocalProxy, useProxy, localProxyAlive, proxyIsAlive } =
      await browser.storage.local.get({
        useLocalProxy: false,
        useProxy: true,
        localProxyAlive: false,
        proxyIsAlive: true,
      })

    useProxyCheckbox.checked = useProxy
    document.getElementById('proxyCustomOptions').hidden = !useProxy
    document.getElementById('useLocalProxy').checked = useLocalProxy
    document.getElementById('useDefaultProxy').checked = !useLocalProxy
    document.getElementById('proxyListOptions').hidden = useLocalProxy
    document.getElementById('proxySelectionSummary').hidden = useLocalProxy
    document.getElementById('proxyIsDown').hidden = !useProxy || useLocalProxy || proxyIsAlive
    document.getElementById('localProxyOptions').classList.toggle(
      'hidden', !useProxy || !useLocalProxy || localProxyAlive,
    )
    document.getElementById('localProxyStatus').textContent =
      useProxy && useLocalProxy && localProxyAlive
        ? browser.i18n.getMessage('successLocalProxySet') : ''
  }
  const refresh = () => {
    pendingRefresh = pendingRefresh.then(render).catch(console.error)
    return pendingRefresh
  }
  const poll = () => {
    clearTimeout(pollTimer)
    if (document.visibilityState !== 'visible') {
      return
    }
    pollTimer = setTimeout(async () => {
      try {
        await ProxyManager.syncLocalProxy()
      } finally {
        poll()
      }
    }, 3000)
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['useLocalProxy', 'useProxy', 'localProxyAlive', 'proxyIsAlive']
      .some((key) => key in changes)) {
      refresh()
    }
  })
  document.addEventListener('visibilitychange', () => {
    refresh()
    poll()
  })
  for (const [id, key] of [
    ['moreAboutAmneziaPremiumLink', 'moreAboutAmneziaPremium'],
    ['whereToFindAddressLink', 'whereToFindAddressLink'],
  ]) {
    document.getElementById(id).href = browser.i18n.getMessage(key)
    document.getElementById(id).target = '_blank'
    document.getElementById(id).rel = 'noopener noreferrer'
  }
  radioGroup.addEventListener('change', async (event) => {
    if (event.target.name !== 'proxy-radio') {
      return
    }
    await ProxyManager.setLocalProxy(event.target.value === 'local')
    await refresh()
  })
  useProxyCheckbox.addEventListener('change', async () => {
    if (useProxyCheckbox.checked) {
      await ProxyManager.enableProxy()
      await ProxyManager.syncLocalProxy({ startIfMissing: true })
    } else {
      await ProxyManager.disableProxy()
    }
    await refresh()
  })
  useProxyCheckbox.disabled = await ProxyManager.controlledByOtherExtensions()
  await refresh()
  const refreshProxies = await mountProxyList()

  await mountProxyImport(refreshProxies)
  await mountProxyCheck(refreshProxies)
  await ProxyManager.syncLocalProxy()
  await refresh()
  poll()
})()
