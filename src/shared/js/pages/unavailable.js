import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { parseFailedSiteUrl } from 'Background/failed-site-data'
import { getMessage, initializeLanguage } from 'Background/i18n'

import { showPageError } from './page-errors'

(async () => {
  const proxyButton = document.getElementById('openThroughProxy')
  const directButton = document.getElementById('retryDirect')

  try {
    await initializeLanguage()
    const url = decodeURIComponent(window.location.hash.slice(1))
    const target = parseFailedSiteUrl(url)
    const tab = await browser.tabs.getCurrent()

    document.getElementById('failedSiteUrl').textContent = url
    const retry = async (proxy) => {
      proxyButton.disabled = true
      directButton.disabled = true
      try {
        if (proxy) {
          await callBackground('setSiteChoice', {
            url: target.hostname, choice: 'always',
          })
          const route = await callBackground('proxyRouteInfo', { url })

          if (route.type !== 'proxy') {
            throw new Error(getMessage('proxySetupFailed'))
          }
          window.location.replace(url)
        } else {
          await callBackground('retryFailedSite', { tabId: tab.id, url })
        }
      } catch (error) {
        showPageError(error)
      } finally {
        proxyButton.disabled = false
        directButton.disabled = false
      }
    }

    proxyButton.addEventListener('click', () => retry(true))
    directButton.addEventListener('click', () => retry(false))
    proxyButton.disabled = false
    directButton.disabled = false
  } catch (error) {
    showPageError(error)
  }
})()
