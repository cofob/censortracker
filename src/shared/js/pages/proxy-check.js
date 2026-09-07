import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'

export const mountProxyCheck = async (refreshProxies) => {
  const all = document.getElementById('proxyCheckAll')
  const selected = document.getElementById('proxyCheckSelected')
  const stop = document.getElementById('proxyCheckStop')
  const status = document.getElementById('proxyCheckStatus')
  const errorMessage = document.getElementById('proxyCheckError')
  const message = (key, values) => browser.i18n.getMessage(key, values)
  let timer
  const render = (run) => {
    all.disabled = run.running
    selected.disabled = run.running
    stop.disabled = !run.running
    status.textContent = run.total === undefined ? ''
      : message('proxyCheckProgress', [String(run.completed || 0), String(run.total)])
    if (run.cancelled) {
      status.textContent += ` ${message('proxyCheckCancelled')}`
    }
  }
  const start = async (onlySelected) => {
    errorMessage.hidden = true
    try {
      const { selectedProxyIds } = await callBackground('proxies', { operation: 'list' })

      render(await callBackground('startProxyChecks', onlySelected ? { ids: selectedProxyIds } : {}))
    } catch (error) {
      errorMessage.hidden = false
    }
  }

  all.addEventListener('click', () => start(false))
  selected.addEventListener('click', () => start(true))
  stop.addEventListener('click', async () => {
    stop.disabled = true
    try {
      await callBackground('stopProxyChecks')
      render((await callBackground('proxyCheckState')).run)
    } catch (error) {
      errorMessage.hidden = false
    }
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return
    }
    if (changes.proxyCheckRun) {
      render(changes.proxyCheckRun.newValue || { running: false })
    }
    if (changes.proxyChecks && !timer) {
      timer = setTimeout(async () => {
        timer = null
        await refreshProxies()
      }, 300)
    }
  })
  render((await callBackground('proxyCheckState')).run)
}
