import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { consentAccepted } from 'Background/data-consent'
import { getMessage, initializeLanguage } from 'Background/i18n'

(async () => {
  await initializeLanguage()
  const section = document.getElementById('consentStatus')
  const revoke = document.getElementById('revokeConsent')
  const show = async () => {
    const accepted = consentAccepted(await callBackground('dataConsent'))

    section.hidden = accepted && !revoke
    document.getElementById('consentStatusText').textContent = getMessage(
      accepted ? 'consentGranted' : 'consentPaused',
    )
    if (revoke) {
      revoke.hidden = !accepted
    }
  }

  document.getElementById('reviewConsent').addEventListener('click', () => {
    callBackground('openDataConsent')
  })
  revoke?.addEventListener('click', async () => {
    revoke.disabled = true
    try {
      await callBackground('setDataConsent', false)
      await show()
    } finally {
      revoke.disabled = false
    }
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dataConsent) {
      show()
    }
  })
  await show()
})()
