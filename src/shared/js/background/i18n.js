import en from '../../_locales/en/messages.json'
import ru from '../../_locales/ru/messages.json'
import uk from '../../_locales/uk/messages.json'
import browser from './browser-api'

const catalogs = { en, ru, uk }
let language = 'auto'
let pending
let revision = 0

export const getUILanguage = () => language === 'auto'
  ? browser.i18n.getUILanguage?.() || 'en' : language

export const initializeLanguage = () => {
  if (!pending) {
    pending = (async () => {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.uiLanguage) {
          revision++
          language = Object.hasOwn(catalogs, changes.uiLanguage.newValue)
            ? changes.uiLanguage.newValue : 'auto'
        }
      })
      const initialRevision = revision
      const { uiLanguage } = await browser.storage.local.get({ uiLanguage: 'auto' })

      if (revision === initialRevision) {
        language = Object.hasOwn(catalogs, uiLanguage) ? uiLanguage : 'auto'
      }
      return language
    })().catch(() => 'auto')
  }
  return pending
}

export const getMessage = (key, substitutions) => {
  if (language === 'auto') {
    const native = browser.i18n.getMessage(key, substitutions)

    if (native) {
      return native
    }
  }
  const catalog = catalogs[getUILanguage().split('-')[0].toLowerCase()] || en
  const entry = catalog[key] || en[key]

  if (!entry) {
    return ''
  }
  const values = [].concat(substitutions ?? [])
  const substitute = (text) => text.replace(/\$\$|\$([1-9]\d*)/g,
    (match, index) => index ? String(values[Number(index) - 1] ?? '') : '$')

  return entry.message.replace(/\$\$|\$([1-9]\d*)|\$(\w+)\$/g,
    (match, index, name) => {
      if (name) {
        return substitute(entry.placeholders?.[name.toLowerCase()]?.content || '')
      }
      return index ? String(values[Number(index) - 1] ?? '') : '$'
    })
}
