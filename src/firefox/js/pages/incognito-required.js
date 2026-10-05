import { mountPrivateBrowsing } from '../../../shared/js/pages/private-browsing'

(async () => {
  const closeTab = document.querySelector('#closeTab')
  const backToPopup = document.querySelector('#backToPopup')
  const howToGrantIncognitoAccess = document.querySelector('#howToGrantIncognitoAccess')
  const grantPrivateBrowsingPermissionsButton = document.querySelector('#grantPrivateBrowsingPermissionsButton')

  const [tab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const popupUrl = browser.runtime.getURL('popup.html')

  await mountPrivateBrowsing({
    warning: document.getElementById('privateBrowsingPermissionsRequiredMessage'),
    button: grantPrivateBrowsingPermissionsButton,
    onSuccess: () => {
      window.location.href = popupUrl
    },
  })

  if (backToPopup) {
    backToPopup.addEventListener('click', () => {
      window.location.href = popupUrl
    })
  }

  if (closeTab) {
    closeTab.addEventListener('click', () => {
      browser.tabs.remove(tab.id)
    })
  }

  howToGrantIncognitoAccess.addEventListener('click', async () => {
    await browser.tabs.create({
      url: browser.i18n.getMessage('howToGrantIncognitoAccessLink'),
    })
  })
})()
