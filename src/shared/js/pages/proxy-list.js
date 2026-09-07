import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { parseProxyAddress } from 'Background/proxy-address'
import { hasProxyAuth, proxyAuthSupported } from 'Background/proxy-record'

import { checkedCountry, filterProxies } from './proxy-filter'

export const mountProxyList = async () => {
  const root = document.getElementById('proxyListOptions')
  const rows = document.getElementById('proxyRows')
  const form = document.getElementById('proxyForm')
  const nameInput = document.getElementById('proxyName')
  const addressInput = document.getElementById('proxyServerInput')
  const protocolInput = document.getElementById('select-toggle')
  const username = document.getElementById('proxyUsername')
  const password = document.getElementById('proxyPassword')
  const authOptions = document.getElementById('proxyAuthOptions')
  const unrestricted = document.getElementById('proxyUnrestricted')
  const restriction = document.getElementById('proxyRestriction')

  document.getElementById('proxySocksUnsupported').hidden = browser.isFirefox
  const cancel = document.getElementById('cancelProxyEdit')
  const errorMessage = document.getElementById('proxyListError')
  const summary = document.getElementById('proxySelectionSummary')
  const previous = document.getElementById('proxyPrevious')
  const next = document.getElementById('proxyNext')
  const filters = document.getElementById('proxyFilters')
  const removeFiltered = document.getElementById('proxyRemoveFiltered')
  const count = document.getElementById('proxyFilteredCount')
  const countryNames = new Intl.DisplayNames([browser.i18n.getUILanguage()], {
    type: 'region',
  })
  const message = (key) => browser.i18n.getMessage(key)
  let state
  let checks = {}
  let editingId
  let page = 0
  let visible = []
  let busy = false

  const viewOptions = () => Object.fromEntries(
    Array.from(filters.querySelectorAll('select'), (input) =>
      [input.name, input.value]),
  )

  const resetForm = () => {
    editingId = undefined
    form.reset()
    protocolInput.textContent = 'HTTPS'
    cancel.hidden = true
    authOptions.open = false
    restriction.hidden = true
  }
  const editProxy = (proxy) => {
    editingId = proxy.id
    nameInput.value = proxy.name
    addressInput.value = `${proxy.host}:${proxy.port}`
    protocolInput.textContent = proxy.protocol
    username.value = proxy.username || ''
    password.value = proxy.password || ''
    authOptions.open = hasProxyAuth(proxy)
    restriction.hidden = !proxy.restricted || Boolean(proxy.provider)
    unrestricted.checked = !proxy.restricted
    cancel.hidden = false
    addressInput.focus()
  }
  const render = () => {
    const catalog = [state.builtin, ...state.proxies]
    const selected = new Set(state.selectedProxyIds)
    const currentChecks = checks

    const selectedNames = catalog.filter(({ id }) => selected.has(id))
      .map(({ name }) => name)

    summary.textContent = selectedNames.slice(0, 3).join(', ') ||
      message('proxyNoneSelected')
    if (selectedNames.length > 3) {
      summary.textContent += ` (+${selectedNames.length - 3})`
    }
    for (const field of ['serverCountry', 'exitCountry']) {
      const input = filters.querySelector(`[name="${field}"]`)
      const value = input.value
      const countries = new Set(catalog.map(({ id }) =>
        checkedCountry(currentChecks[id], field)))

      if (value) {
        countries.add(value)
      }
      input.replaceChildren(new Option(message('proxyFilterAny'), ''))
      for (const code of Array.from(countries).sort()) {
        input.add(new Option(code === '?' ? message('proxyFilterUnknown')
          : `${countryNames.of(code)} (${code})`, code))
      }
      input.value = value
    }
    visible = filterProxies(catalog, checks, viewOptions())
    count.textContent = browser.i18n.getMessage('proxyFilteredCount',
      [String(visible.length), String(catalog.length)])
    page = Math.max(0, Math.min(page, Math.floor((visible.length - 1) / 100)))
    rows.replaceChildren()
    for (const proxy of visible.slice(page * 100, (page + 1) * 100)) {
      const row = document.createElement('tr')
      const choice = document.createElement('input')
      const cells = Array.from({ length: 5 }, () => document.createElement('td'))

      choice.type = 'checkbox'
      choice.checked = selected.has(proxy.id)
      choice.setAttribute('aria-label', proxy.name)
      choice.addEventListener('change', () => run({
        operation: 'toggle', id: proxy.id, selected: choice.checked,
      }))
      cells[0].append(choice)
      cells[1].textContent = proxy.name
      cells[2].textContent = proxy.host
        ? `${proxy.protocol} ${proxy.host}:${proxy.port}`
        : message('proxyUnavailable')
      if (!proxyAuthSupported(proxy, browser.isFirefox)) {
        cells[2].textContent += ` — ${message('proxySocksUnsupported')}`
      }
      if (proxy.provider) {
        cells[2].textContent += ` — ${message('proxyAntizapretLimited')}`
      } else if (proxy.restricted) {
        cells[2].textContent += ` — ${message('proxyRestricted')}`
      }
      const check = checks[proxy.id]

      cells[3].textContent = message(`proxyStatus_${check?.status || 'unchecked'}`)
      if (check) {
        cells[3].title = new Date(check.checkedAt).toLocaleString()
        if (check.status === 'ok') {
          cells[3].textContent += ` · ${check.latency} ms`
          const location = document.createElement('div')

          location.textContent = `${message('proxyServerCountry')}: ${check.serverCountry || '?'}; ` +
            `${message('proxyExitCountry')}: ${check.exitCountry || '?'} (${check.exitIP})`
          cells[3].append(location)
        }
      }
      if (proxy.id !== 'builtin') {
        const edit = document.createElement('button')
        const remove = document.createElement('button')

        edit.type = 'button'
        remove.type = 'button'
        edit.textContent = message('proxyEdit')
        remove.textContent = message('proxyDelete')
        edit.addEventListener('click', () => editProxy(proxy))
        remove.addEventListener('click', () => run({
          operation: 'remove', ids: [proxy.id],
        }))
        cells[4].append(edit, remove)
      }
      row.append(...cells)
      rows.append(row)
    }
    for (const control of root.querySelectorAll(
      '#proxyRows input, #proxyRows button, #proxyForm input, #proxyForm button, #proxyFilters select',
    )) {
      control.disabled = busy
    }
    previous.disabled = busy || page === 0
    next.disabled = busy || (page + 1) * 100 >= visible.length
    removeFiltered.disabled = busy || !visible.some(({ id }) => id !== 'builtin')
  }
  const run = async (args) => {
    if (busy) {
      return
    }
    busy = true
    errorMessage.hidden = true
    render()
    try {
      state = await callBackground('proxies', args)
      checks = (await callBackground('proxyCheckState')).checks
      if (args.operation === 'save' || args.operation === 'remove') {
        resetForm()
      }
    } catch (error) {
      errorMessage.textContent = message('proxyListInvalid')
      errorMessage.hidden = false
    } finally {
      busy = false
      render()
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    try {
      const endpoint = parseProxyAddress(addressInput.value.trim())

      run({
        operation: 'save',
        proxy: {
          id: editingId,
          name: nameInput.value.trim() || undefined,
          protocol: protocolInput.textContent.trim(),
          username: username.value,
          password: password.value,
          restricted: !unrestricted.checked,
          ...endpoint,
        },
      })
    } catch (error) {
      errorMessage.textContent = message('proxyListInvalid')
      errorMessage.hidden = false
    }
  })
  cancel.addEventListener('click', resetForm)
  previous.addEventListener('click', () => {
    page--; render()
  })
  next.addEventListener('click', () => {
    page++; render()
  })
  filters.addEventListener('change', () => {
    page = 0; render()
  })
  removeFiltered.addEventListener('click', () => {
    const ids = visible.filter(({ id }) => id !== 'builtin').map(({ id }) => id)

    // Bulk deletion needs explicit confirmation, including off-page records.
    // eslint-disable-next-line no-alert
    if (ids.length > 0 && window.confirm(browser.i18n.getMessage(
      'proxyRemoveConfirm', String(ids.length),
    ))) {
      run({ operation: 'remove', ids })
    }
  })
  const refresh = async () => {
    state = await callBackground('proxies', { operation: 'list' })
    checks = (await callBackground('proxyCheckState')).checks
    render()
  }

  await refresh()
  return refresh
}
