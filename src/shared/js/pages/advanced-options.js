import './page-errors'

import { callBackground } from 'Background/background-rpc'
import browser, { getBrowserInfo } from 'Background/browser-api'
import ProxyManager from 'Background/proxy'
import * as server from 'Background/server'
import Settings from 'Background/settings'

import { mountSiteRules } from './site-rules'

(async () => {
  const debugInfoJSON = document.getElementById('debugInfoJSON')
  const showDebugInfoBtn = document.getElementById('showDebugInfo')
  const confirmResetBtn = document.getElementById('confirmReset')
  const closeDebugInfoBtn = document.getElementById('closeDebugInfo')
  const copyDebugInfoBtn = document.getElementById('copyDebugInfoBtn')
  const closePopupResetBtn = document.getElementById('closePopupReset')
  const completedConfirmBtn = document.getElementById('completedConfirm')
  const cancelPopupResetBtn = document.getElementById('cancelPopupReset')
  const closePopupConfirmBtn = document.getElementById('closePopupConfirm')
  const updateLocalRegistryBtn = document.getElementById('updateLocalRegistry')
  const resetSettingsToDefaultBtn = document.getElementById('resetSettingsToDefault')
  const exportSettingsBtn = document.getElementById('exportSettings')
  const importSettingsInput = document.getElementById('importSettingsInput')
  const proxyAll = document.getElementById('proxyAll')

  proxyAll.checked = (await browser.storage.local.get({ proxyAll: false }))
    .proxyAll
  proxyAll.addEventListener('change', async () => {
    proxyAll.disabled = true
    try {
      await callBackground('setProxyAll', proxyAll.checked)
    } finally {
      proxyAll.checked = (await browser.storage.local.get({ proxyAll: false }))
        .proxyAll
      proxyAll.disabled = false
    }
  })
  proxyAll.disabled = false
  await mountSiteRules()

  const togglePopup = (id) => {
    const showPopupClass = 'popup-show'
    const popup = document.getElementById(id)

    if (popup) {
      if (popup.classList.contains(showPopupClass)) {
        popup.classList.remove(showPopupClass)
      } else {
        popup.classList.add(showPopupClass)
      }
    } else {
      console.error('Nothing to toggle.')
    }
  }

  copyDebugInfoBtn.addEventListener('click', (event) => {
    debugInfoJSON.select()
    document.execCommand('copy')
    event.target.innerHTML = '&check;'

    setTimeout(() => {
      togglePopup('popupDebugInformation')
    }, 500)
  })
  closeDebugInfoBtn.addEventListener('click', (event) => {
    togglePopup('popupDebugInformation')
  })
  resetSettingsToDefaultBtn.addEventListener('click', (event) => {
    togglePopup('popupConfirmReset')
  })
  closePopupResetBtn.addEventListener('click', (event) => {
    togglePopup('popupConfirmReset')
  })
  cancelPopupResetBtn.addEventListener('click', (event) => {
    togglePopup('popupConfirmReset')
  })
  closePopupConfirmBtn.addEventListener('click', (event) => {
    togglePopup('popupCompletedSuccessfully')
  })
  completedConfirmBtn.addEventListener('click', (event) => {
    togglePopup('popupCompletedSuccessfully')
  })

  updateLocalRegistryBtn.addEventListener('click', async (event) => {
    togglePopup('popupCompletedSuccessfully')
    ProxyManager.isEnabled().then(async (proxyingEnabled) => {
      await server.synchronize()

      if (proxyingEnabled) {
        await ProxyManager.removeBadProxies()
        await ProxyManager.setProxy()
        await ProxyManager.ping()
      } else {
        console.info('Registry updated, but proxying is disabled.')
      }
    })
  })

  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      for (const popup of document.getElementsByClassName('popup-show')) {
        popup.classList.remove('popup-show')
      }
    }
  })

  showDebugInfoBtn.addEventListener('click', async (event) => {
    const thisExtension = await browser.management.getSelf()
    const extensionsInfo = await browser.management.getAll()
    const { version: currentVersion } = browser.runtime.getManifest()

    const {
      localConfig = {},
      fallbackReason,
      fallbackProxyInUse = false,
      fallbackProxyError,
      proxyLastFetchTs,
      serviceErrors = [],
      geoIPStatus,
    } = await browser.storage.local.get([
      'localConfig',
      'fallbackReason',
      'fallbackProxyInUse',
      'fallbackProxyError',
      'proxyLastFetchTs',
      'serviceErrors',
      'geoIPStatus',
    ])

    if (extensionsInfo.length > 0) {
      localConfig.conflictingExtensions = extensionsInfo
        .filter(({ name }) => name !== thisExtension.name)
        .filter(({ enabled, permissions = [] }) =>
          permissions.includes('proxy') && enabled)
        .map(({ name }) => name.split(' - ')[0])
    }

    localConfig.version = currentVersion

    if (fallbackProxyInUse) {
      localConfig.fallbackReason = fallbackReason
      localConfig.fallbackProxyError = fallbackProxyError
      localConfig.fallbackProxyInUse = fallbackProxyInUse
    }
    localConfig.browser = getBrowserInfo()
    localConfig.proxyLastFetchTs = proxyLastFetchTs
    localConfig.serviceErrors = serviceErrors
    localConfig.geoIPStatus = geoIPStatus
    localConfig.badProxies = await ProxyManager.getBadProxies()
    localConfig.currentProxyURI = await ProxyManager.getProxyingRules()
    localConfig.proxyControlled = await ProxyManager.controlledByThisExtension()
    debugInfoJSON.textContent = JSON.stringify(localConfig, null, 2)
    togglePopup('popupDebugInformation')
  })

  confirmResetBtn.addEventListener('click', async (event) => {
    togglePopup('popupConfirmReset')
    togglePopup('popupCompletedSuccessfully')
    await server.synchronize()
    await Settings.enableExtension()
    await Settings.enableNotifications()
    await ProxyManager.removeBadProxies()
    await ProxyManager.enableProxy()
    await ProxyManager.setProxy()
    await ProxyManager.ping()
    console.info('Censor Tracker has been reset to default settings.')
  })

  exportSettingsBtn.addEventListener('click', (event) => {
    Settings.exportSettings().then((settings) => {
      const data = JSON.stringify(settings, null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = 'censortracker.settings.json'

      link.style.display = 'none'
      document.body.append(link)

      link.click()

      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    })
  })

  importSettingsInput.addEventListener('change', async (event) => {
    const file = event.target.files[0]

    event.target.value = ''
    if (!file) {
      return
    }
    if (file.size > 32 * 1024 * 1024) {
      throw new Error('Settings file is too large')
    }
    const data = JSON.parse(await file.text())

    await Settings.importSettings(data)
    await ProxyManager.setProxy()
    await server.synchronize({ syncRegistry: true })
    await ProxyManager.setProxy()
    window.location.reload()
  })
})()
