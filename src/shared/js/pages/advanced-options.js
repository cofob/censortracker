import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { getMessage, getUILanguage, initializeLanguage } from 'Background/i18n'
import ProxyManager from 'Background/proxy'
import * as server from 'Background/server'
import Settings from 'Background/settings'

import { mountKeySequence } from './key-sequence'
import { showPageError } from './page-errors'
import { mountRegistryStatus } from './registry-status'
import { mountSiteRules } from './site-rules'

(async () => {
  await initializeLanguage()
  document.documentElement.lang = getUILanguage()
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
  const exportSupportBtn = document.getElementById('exportSupport')
  const importSettingsInput = document.getElementById('importSettingsInput')

  document.getElementById('importSettings').addEventListener('click', () => {
    importSettingsInput.click()
  })
  await mountSiteRules()
  await mountRegistryStatus()

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

  const proxyAllCheckbox = document.getElementById('proxyAll')
  const refreshProxyAll = async () => {
    const { proxyAll } = await browser.storage.local.get({ proxyAll: false })

    proxyAllCheckbox.checked = proxyAll
  }

  await refreshProxyAll()
  mountKeySequence(() => {
    document.getElementById('extendedSettings').hidden = false
  })
  proxyAllCheckbox.addEventListener('change', async () => {
    proxyAllCheckbox.disabled = true
    try {
      await callBackground('setProxyAll', proxyAllCheckbox.checked)
    } catch (error) {
      showPageError(error)
    } finally {
      try {
        await refreshProxyAll()
      } finally {
        proxyAllCheckbox.disabled = false
      }
    }
  })

  updateLocalRegistryBtn.addEventListener('click', async (event) => {
    updateLocalRegistryBtn.disabled = true
    try {
      await server.synchronize()
      const { serviceErrors = [] } = await browser.storage.local.get('serviceErrors')

      if (await ProxyManager.isEnabled()) {
        await ProxyManager.removeBadProxies()
        if (!await ProxyManager.setProxy()) {
          throw new Error(getMessage('proxySetupFailed'))
        }
        await ProxyManager.ping()
      }
      if (serviceErrors.length > 0) {
        throw new Error(serviceErrors.join('; '))
      }
      togglePopup('popupCompletedSuccessfully')
    } catch (error) {
      showPageError(error)
    } finally {
      updateLocalRegistryBtn.disabled = false
    }
  })

  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      for (const popup of document.getElementsByClassName('popup-show')) {
        popup.classList.remove('popup-show')
      }
    }
  })

  showDebugInfoBtn.addEventListener('click', async (event) => {
    showDebugInfoBtn.disabled = true
    try {
      const info = await callBackground('diagnosticInfo')

      debugInfoJSON.value = JSON.stringify(info, null, 2)
      copyDebugInfoBtn.textContent = getMessage('copyButton')
      togglePopup('popupDebugInformation')
    } catch (error) {
      showPageError(error)
    } finally {
      showDebugInfoBtn.disabled = false
    }
  })

  confirmResetBtn.addEventListener('click', async (event) => {
    await Settings.importSettings({ enableExtension: true })
    await ProxyManager.removeBadProxies()
    await server.synchronize()
    if (!await ProxyManager.setProxy()) {
      throw new Error(getMessage('proxySetupFailed'))
    }
    const { serviceErrors = [] } = await browser.storage.local.get('serviceErrors')

    if (serviceErrors.length > 0) {
      throw new Error(serviceErrors.join('; '))
    }
    await ProxyManager.ping()
    togglePopup('popupConfirmReset')
    togglePopup('popupCompletedSuccessfully')
    console.info('Censor Tracker has been reset to default settings.')
  })

  const exportFile = async (button, read, filename) => {
    button.disabled = true
    try {
      const data = JSON.stringify(await read(), null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      try {
        link.href = url
        link.download = filename
        link.style.display = 'none'
        document.body.append(link)
        link.click()
      } finally {
        link.remove()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      showPageError(error)
    } finally {
      button.disabled = false
    }
  }

  exportSettingsBtn.addEventListener('click', () => {
    return exportFile(exportSettingsBtn, () => Settings.exportSettings(),
      'censortracker.settings.json')
  })
  exportSupportBtn.addEventListener('click', () => {
    return exportFile(exportSupportBtn, () => callBackground('diagnosticInfo'),
      'censortracker.diagnostics.json')
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
