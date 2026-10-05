import { getUILanguage, initializeLanguage } from 'Background/i18n'
import { translateDocument } from 'Background/utilities'

(async () => {
  await initializeLanguage()
  document.documentElement.lang = getUILanguage()
  translateDocument(document)
})()
