import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { getMessage, getUILanguage, initializeLanguage } from 'Background/i18n'
import { translateDocument } from 'Background/utilities'

(async () => {
  await initializeLanguage()
  document.documentElement.lang = getUILanguage()
  translateDocument(document)
  const buttons = [...document.querySelectorAll('button')]
  const error = document.getElementById('consentError')
  const act = async (operation) => {
    buttons.forEach((button) => {
      button.disabled = true
    })
    error.textContent = ''
    try {
      await operation()
    } catch {
      error.textContent = getMessage('operationFailed')
    } finally {
      buttons.forEach((button) => {
        button.disabled = false
      })
    }
  }

  for (const [id, accepted] of [['acceptConsent', true], ['declineConsent', false]]) {
    document.getElementById(id).addEventListener('click', () => act(async () => {
      await callBackground('setDataConsent', accepted)
      window.location.href = 'options.html'
    }))
  }
  document.getElementById('uninstallConsent').addEventListener('click', () => act(
    () => browser.management.uninstallSelf({ showConfirmDialog: true }),
  ))
  buttons.forEach((button) => {
    button.disabled = false
  })
})()
