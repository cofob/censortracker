import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'

export const mountRelatedDomains = (tabId, url) => {
  const root = document.getElementById('relatedDomains')
  const scan = document.getElementById('relatedDomainsScan')
  const add = document.getElementById('relatedDomainsAdd')
  const list = document.getElementById('relatedDomainsList')
  const status = document.getElementById('relatedDomainsStatus')
  let busy = false
  const selected = () => Array.from(list.querySelectorAll('input:checked'),
    (input) => input.value)
  const update = () => {
    scan.disabled = busy
    add.disabled = busy || selected().length === 0
    for (const input of list.querySelectorAll('input')) {
      input.disabled = busy
    }
  }
  const run = async (action, errorKey = 'relatedDomainsError') => {
    if (busy) {
      return
    }
    busy = true
    status.textContent = browser.i18n.getMessage('relatedDomainsWorking')
    update()
    try {
      await action()
    } catch (error) {
      status.textContent = browser.i18n.getMessage(errorKey)
    } finally {
      busy = false
      update()
    }
  }

  scan.addEventListener('click', () => run(async () => {
    list.replaceChildren()
    const hosts = await callBackground('findRelatedDomains', { tabId, url })

    for (const host of hosts) {
      const label = document.createElement('label')
      const input = document.createElement('input')

      input.type = 'checkbox'
      input.value = host
      label.append(input, document.createTextNode(host))
      list.append(label)
    }
    status.textContent = browser.i18n.getMessage('relatedDomainsFound', String(hosts.length))
  }))
  add.addEventListener('click', () => run(async () => {
    const count = await callBackground('addRelatedDomains', selected())

    list.replaceChildren()
    status.textContent = browser.i18n.getMessage('relatedDomainsAdded', String(count))
  }, 'relatedDomainsSaveError'))
  list.addEventListener('change', update)
  root.hidden = false
  update()
}
