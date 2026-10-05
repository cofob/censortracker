import { getMessage, getUILanguage, initializeLanguage } from 'Background/i18n'

(async () => {
  await initializeLanguage()
  document.documentElement.lang = getUILanguage()
  const howToGrantIncognitoAccess = document.querySelector('#howToGrantIncognitoAccess')

  howToGrantIncognitoAccess.addEventListener('click', async () => {
    await browser.tabs.create({
      url: getMessage('howToGrantIncognitoAccessLink'),
    })
  })
})()
