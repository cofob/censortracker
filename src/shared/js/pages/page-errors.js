import { getMessage } from 'Background/i18n'

// A failed background task must not leave the page blank or its loader active.
export const showPageError = (event) => {
  const loading = document.getElementById('loading')
  const success = document.getElementById('popupCompletedSuccessfully')
  let message = document.getElementById('pageError')

  if (success) {
    success.classList.remove('popup-show')
  }
  if (loading) {
    loading.style.display = 'none'
  }
  if (!message) {
    message = document.createElement('p')
    message.id = 'pageError'
    message.setAttribute('role', 'alert')
    const parent = document.querySelector('.main-page__info') || document.body

    parent.prepend(message)
  }
  message.textContent = getMessage('operationFailed')
  const detail = event?.reason?.message || event?.message

  if (detail) {
    message.textContent += ` ${detail}`
  }
}

window.addEventListener('unhandledrejection', showPageError)
