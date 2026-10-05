import { callBackground } from 'Background/background-rpc'
import browser from 'Background/browser-api'
import { getMessage, getUILanguage } from 'Background/i18n'

export const mountProxyInfo = async (url) => {
  const summary = document.getElementById('proxyRouteSummary')
  const exit = document.getElementById('proxyRouteExit')
  const details = document.getElementById('proxyingDetailsText')
  const message = (key, values) => getMessage(key, values)
  const names = new Intl.DisplayNames([getUILanguage()], {
    type: 'region',
  })
  let pending = 0
  let timer

  const refresh = async () => {
    const revision = ++pending

    try {
      const info = await callBackground('proxyRouteInfo', { url })

      if (revision !== pending) {
        return
      }
      summary.textContent = info.proxy
        ? message('popupRouteProxy', info.proxy.name)
        : message(`popupRoute_${info.type}`)
      exit.textContent = ''
      details.replaceChildren()
      const line = (text) => {
        const element = document.createElement('code')

        element.textContent = text
        details.append(element)
      }

      const builtin = info.proxy?.id === 'builtin' || info.proxy?.name === 'Censor Tracker'

      if (builtin && info.check?.exitCountry) {
        const code = info.check.exitCountry

        exit.textContent = `${message('proxyExitCountry')}: ${names.of(code)} (${code})`
      }
      if (info.proxy && !builtin) {
        line(`${info.proxy.protocol} ${info.proxy.host}:${info.proxy.port}`)
        line(message('popupRouteFallbacks', String(info.fallbackCount)))
        if (info.check) {
          line(message('popupRouteCheckedAt',
            new Date(info.check.checkedAt).toLocaleString(getUILanguage())))
          line(message(`proxyStatus_${info.check.status}`))
          if (info.check.exitIP) {
            const code = info.check.exitCountry
            const country = code ? `${names.of(code)} (${code})`
              : message('proxyFilterUnknown')

            exit.textContent = message('popupRouteExit',
              [info.check.exitIP, country])
          }
        } else {
          line(message('proxyStatus_unchecked'))
        }
      }
      if (info.domainCount !== undefined) {
        const region = info.regionCode ? names.of(info.regionCode)
          : info.region || message('popupAutoMessage')

        line(`${message('popupYourRegion')}: ${region}`)
        line(`${message('popupTotalBlocked')}: ${info.domainCount}`)
      }
      line(message('popupRouteHelp'))
    } catch (error) {
      if (revision === pending) {
        summary.textContent = message('popupRoute_unavailable')
        exit.textContent = ''
        details.replaceChildren()
      }
    }
  }

  const schedule = () => {
    pending++
    clearTimeout(timer)
    timer = setTimeout(refresh, 300)
  }

  if (browser.proxy.settings.onChange) {
    browser.proxy.settings.onChange.addListener(schedule)
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['enableExtension', 'useProxy', 'proxyAll', 'proxies',
      'selectedProxyIds', 'proxyServerURI', 'proxyChecks', 'proxyFailures',
      'siteCountryRules', 'ignoredHosts', 'domains', 'useRegistry',
      'customProxiedDomains', 'localProxyURI', 'currentRegionName',
      'currentRegionCode', 'registryRegionCode',
      'activeProxyConfigName', 'registrySource', 'externalRegistry', 'antizapret']
      .some((key) => changes[key])) {
      schedule()
    }
  })
  await refresh()
}
