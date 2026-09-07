import browser from './browser-api'

let actions = null

export const callBackground = async (action, args) => {
  if (actions) {
    return actions[action](args)
  }
  const result = await browser.runtime.sendMessage({
    type: 'ct-background', action, args,
  })

  if (!result || result.error) {
    throw new Error(result?.error || 'Background request failed')
  }
  return result.value
}

export const registerBackground = (handlers) => {
  actions = handlers
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'ct-background' || sender.id !== browser.runtime.id) {
      return false
    }
    if (!Object.prototype.hasOwnProperty.call(actions, message.action)) {
      respond({ error: 'Unknown background action' })
      return false
    }
    Promise.resolve().then(() => actions[message.action](message.args))
      .then((value) => respond({ value }),
        (error) => respond({ error: error.message }))
    return true
  })
}
