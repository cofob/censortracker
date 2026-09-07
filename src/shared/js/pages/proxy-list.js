import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { parseProxyAddress } from 'Background/proxy-address'
import { hasProxyAuth, proxyAuthSupported } from 'Background/proxy-record'

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
  const message = (key) => browser.i18n.getMessage(key)
  let state
  let checks = {}
  let editingId
  let page = 0

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
    restriction.hidden = !proxy.restricted
    unrestricted.checked = !proxy.restricted
    cancel.hidden = false
    addressInput.focus()
  }
  const render = () => {
    const catalog = [state.builtin, ...state.proxies]
    const selected = new Set(state.selectedProxyIds)

    const selectedNames = catalog.filter(({ id }) => selected.has(id))
      .map(({ name }) => name)

    summary.textContent = selectedNames.slice(0, 3).join(', ') ||
      message('proxyNoneSelected')
    if (selectedNames.length > 3) {
      summary.textContent += ` (+${selectedNames.length - 3})`
    }
    page = Math.min(page, Math.floor((catalog.length - 1) / 100))
    rows.replaceChildren()
    for (const proxy of catalog.slice(page * 100, (page + 1) * 100)) {
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
      if (proxy.restricted) {
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
    previous.disabled = page === 0
    next.disabled = (page + 1) * 100 >= catalog.length
  }
  const run = async (args) => {
    errorMessage.hidden = true
    for (const control of root.querySelectorAll('input, button')) {
      control.disabled = true
    }
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
      for (const control of root.querySelectorAll('input, button')) {
        control.disabled = false
      }
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
  const refresh = async () => {
    state = await callBackground('proxies', { operation: 'list' })
    checks = (await callBackground('proxyCheckState')).checks
    render()
  }

  await refresh()
  return refresh
}
