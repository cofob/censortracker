import browser from 'Background/browser-api'
import { CONSENT_VERSION, getDataConsent } from 'Background/data-consent'
import { getUILanguage, initializeLanguage } from 'Background/i18n'

import { mountNotices } from './notice-panel'

(async () => {
  await initializeLanguage()
  document.documentElement.lang = getUILanguage()
  await mountNotices(document.getElementById('notices'), async () => {
    if (!await getDataConsent()) {
      await browser.storage.local.set({ consentPromptVersion: CONSENT_VERSION })
      window.location.replace('consent.html')
    } else {
      window.close()
    }
  })
})()
