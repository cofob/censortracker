// Keep the deadline active until the entire response has been read.
export const requestText = async (url, {
  timeout = 15000, signal, maxBytes = 32 * 1024 * 1024, ...options
} = {}) => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, timeout)

  if (signal) {
    signal.addEventListener('abort', abort, { once: true })
  }
  if (signal?.aborted) {
    abort()
  }
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      ...options,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let text = ''

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        return text + decoder.decode()
      }
      size += value.byteLength
      if (size > maxBytes) {
        throw new Error('Response is too large')
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    clearTimeout(timer)
    if (signal) {
      signal.removeEventListener('abort', abort)
    }
    abort()
  }
}
