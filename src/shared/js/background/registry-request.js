import { isConsentError } from './data-consent'

export const isRegistryCancellation = (error) => isConsentError(error) ||
  error?.name === 'AbortError' ||
  Boolean(error?.name !== 'TimeoutError' && error?.cause &&
    isRegistryCancellation(error.cause))

// Metadata is committed by the caller only after the body is validated.
export const requestRegistry = async (url, cache, request, signal) => {
  signal?.throwIfAborted()
  if (cache?.url === url && cache.etag) {
    try {
      const result = await request('HEAD')

      signal?.throwIfAborted()

      if (result.etag === cache.etag && result.finalUrl === cache.finalUrl) {
        return { unchanged: true }
      }
    } catch (error) {
      if (isRegistryCancellation(error)) {
        throw error
      }
    }
  }
  signal?.throwIfAborted()
  const result = await request('GET')

  return {
    ...result, cache: { url, finalUrl: result.finalUrl, etag: result.etag },
  }
}
