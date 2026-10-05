import browser from 'Background/browser-api'
import { getMessage, getUILanguage, initializeLanguage } from 'Background/i18n'
import ProxyManager from 'Background/proxy'
import * as server from 'Background/server'

import { mountPrivateBrowsing } from './private-browsing'
import { mountRegistryStatus } from './registry-status'

(async () => {
  const uiLanguage = await initializeLanguage()

  document.documentElement.lang = getUILanguage()
  // For debugging purposes.
  window.server = server

  const languageSelect = document.getElementById('uiLanguage')

  languageSelect.value = uiLanguage
  languageSelect.addEventListener('change', async () => {
    await browser.storage.local.set({ uiLanguage: languageSelect.value })
    window.location.reload()
  })

  const proxyingEnabled = await ProxyManager.isEnabled()
  const version = document.getElementById('version')
  const proxyStatus = document.getElementById('proxyStatus')
  const showNotificationsCheckbox = document.getElementById(
    'showNotificationsCheckbox',
  )
  const howToGrantIncognitoAccess = document.getElementById(
    'howToGrantIncognitoAccess',
  )
  const grantPrivateBrowsingPermissionsButton = document.getElementById(
    'grantPrivateBrowsingPermissionsButton',
  )
  const privateBrowsingPermissionsRequiredMessage = document.getElementById(
    'privateBrowsingPermissionsRequiredMessage',
  )
  const optionsRegistryIsEmptyWarning = document.getElementById(
    'optionsRegistryIsEmptyWarning',
  )
  const optionsRegistryUpdateDatabaseButton = document.getElementById(
    'optionsRegistryUpdateDatabaseButton',
  )
  const optionsRegistryProxyingListButton = document.getElementById(
    'optionsRegistryProxyingListButton',
  )
  const backendIsIntermittentAlert = document.getElementById('backendIsIntermittentAlert')
  const updateAvailableAlert = document.getElementById('updateAvailableAlert')
  const updateExtensionButton = document.getElementById('updateExtensionButton')

  browser.storage.local.get({
    updateAvailable: false,
    backendIsIntermittent: false,
    botDetection: false,
  }).then(({ updateAvailable, backendIsIntermittent, botDetection }) => {
    if (updateAvailable) {
      updateAvailableAlert.classList.remove('hidden')
    }

    if (backendIsIntermittentAlert) {
      backendIsIntermittentAlert.hidden = !backendIsIntermittent
    }
  })

  updateExtensionButton.addEventListener('click', async (event) => {
    browser.storage.local.set({ updateAvailable: false })
      .then(() => {
        browser.runtime.reload()
      })
  })

  optionsRegistryUpdateDatabaseButton.addEventListener('click', () => {
    window.location.href = 'advanced-options.html'
  })
  optionsRegistryProxyingListButton.addEventListener('click', () => {
    window.location.href = 'proxy-list.html'
  })
  await mountRegistryStatus(optionsRegistryIsEmptyWarning)

  if (proxyStatus) {
    let proxyStatusMessage = 'optionsProxyStatusTurnedOff'

    if (proxyingEnabled) {
      proxyStatusMessage = 'optionsProxyStatusTurnedOn'
    }
    proxyStatus.innerText = getMessage(proxyStatusMessage)
    proxyStatus.hidden = false
  }

  if (browser.isFirefox) {
    await mountPrivateBrowsing({
      warning: privateBrowsingPermissionsRequiredMessage,
      button: grantPrivateBrowsingPermissionsButton,
      onSuccess: () => {
        proxyStatus.innerText = getMessage('optionsProxyStatusTurnedOn')
      },
    })

    if (howToGrantIncognitoAccess) {
      howToGrantIncognitoAccess.addEventListener('click', async () => {
        await browser.tabs.create({
          url: getMessage('howToGrantIncognitoAccessLink'),
        })
      })
    }
  }

  if (showNotificationsCheckbox) {
    showNotificationsCheckbox.addEventListener('change', async () => {
      await browser.storage.local.set({
        showNotifications: showNotificationsCheckbox.checked,
      })
    },
    false,
    )

    const { showNotifications } = await browser.storage.local.get({
      showNotifications: true,
    })

    showNotificationsCheckbox.checked = showNotifications
  }

  const { version: currentVersion } = browser.runtime.getManifest()

  if (version) {
    version.textContent = await getMessage('optionsVersion', currentVersion)
  }
})()
