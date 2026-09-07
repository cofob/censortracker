import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'

export const mountSiteRules = async () => {
  const root = document.getElementById('siteRuleOptions')
  const form = document.getElementById('siteRuleForm')
  const host = document.getElementById('siteRuleHost')
  const countries = document.getElementById('siteRuleCountries')
  const rows = document.getElementById('siteRuleRows')
  const errorMessage = document.getElementById('siteRuleError')
  const names = new Intl.DisplayNames([browser.i18n.getUILanguage()], {
    type: 'region',
  })
  let rules = (await browser.storage.local.get({ siteCountryRules: {} }))
    .siteCountryRules
  let busy = false

  const render = () => {
    rows.replaceChildren()
    for (const [hostname, codes] of Object.entries(rules)) {
      const row = document.createElement('li')
      const edit = document.createElement('button')
      const remove = document.createElement('button')

      row.textContent = `${hostname}: ${codes.length > 0
        ? codes.map((code) => `${names.of(code)} (${code})`).join(', ')
        : browser.i18n.getMessage('siteRuleUnrestricted')} `
      edit.type = 'button'
      edit.textContent = browser.i18n.getMessage('proxyEdit')
      remove.type = 'button'
      remove.textContent = browser.i18n.getMessage('proxyDelete')
      edit.addEventListener('click', () => {
        host.value = hostname
        countries.value = codes.join(', ')
        host.focus()
      })
      remove.addEventListener('click', () => save(hostname, null))
      row.append(edit, remove)
      rows.append(row)
    }
  }
  const save = async (hostname, codes) => {
    if (busy) {
      return
    }
    busy = true
    errorMessage.hidden = true
    for (const control of root.querySelectorAll('input, button')) {
      control.disabled = true
    }
    try {
      rules = await callBackground('siteCountryRule', {
        host: hostname, countries: codes,
      })
      form.reset()
      render()
    } catch (error) {
      errorMessage.hidden = false
      rules = (await browser.storage.local.get({ siteCountryRules: {} }))
        .siteCountryRules
      render()
    } finally {
      busy = false
      for (const control of root.querySelectorAll('input, button')) {
        control.disabled = false
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    save(host.value.trim(), countries.value.toUpperCase()
      .split(/[\s,]+/).filter(Boolean))
  })
  render()
  document.getElementById('siteRuleSave').disabled = false
}
