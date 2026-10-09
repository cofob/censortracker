import { getUILanguage, initializeLanguage } from 'Background/i18n'

import { mountNotices } from './notice-panel'

(async () => {
  await initializeLanguage()
  document.documentElement.lang = getUILanguage()
  await mountNotices(document.getElementById('notices'), true)
})()
