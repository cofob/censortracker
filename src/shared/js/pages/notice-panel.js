import browser from 'Background/browser-api'
import { dismissNotice, pendingNotices } from 'Background/extension-notices'
import { getMessage, initializeLanguage } from 'Background/i18n'

export const mountNotices = async (host, onEmpty) => {
  await initializeLanguage()
  const section = document.createElement('section')
  const title = document.createElement('h2')
  const text = document.createElement('p')
  const button = document.createElement('button')
  const error = document.createElement('p')
  let current
  let revision = 0

  section.className = 'consent-status'
  section.hidden = true
  section.setAttribute('aria-live', 'polite')
  title.className = 'block__title'
  text.className = 'disclaimer__text'
  button.type = 'button'
  button.className = 'default-btn btn btn-dark'
  button.textContent = getMessage('noticeOkay')
  error.setAttribute('role', 'alert')
  section.append(title, text, button, error)
  host.prepend(section)
  const show = async () => {
    const request = ++revision
    const notices = await pendingNotices()

    if (request !== revision) {
      return
    }
    current = notices[0]
    section.hidden = !current
    if (current) {
      title.textContent = getMessage(current.title)
      text.textContent = getMessage(current.text)
      if (current.link) {
        const link = document.createElement('a')

        link.className = 'notice-link'
        link.textContent = getMessage(current.link.label)
        link.href = browser.runtime.getURL(current.link.path)
        link.target = '_blank'
        text.append(' ', link)
      }
    } else if (onEmpty) {
      await onEmpty()
    }
  }

  button.addEventListener('click', async () => {
    if (!current || button.disabled) {
      return
    }
    button.disabled = true
    error.textContent = ''
    try {
      await dismissNotice(current.id)
      await show()
    } catch {
      error.textContent = getMessage('operationFailed')
    } finally {
      button.disabled = false
    }
  })
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((key) =>
      key.startsWith('noticeActive:') || key.startsWith('noticeRead:'))) {
      show().catch(() => {
        error.textContent = getMessage('operationFailed')
      })
    }
  })
  await show()
}
