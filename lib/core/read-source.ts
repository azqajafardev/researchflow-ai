import { isReadableUrl } from '~~/shared/utils/source-url'
import pLimit from 'p-limit'
import { abortable, throwIfAborted } from '~~/shared/utils/abort'
import type { WebSearchResult } from '~~/shared/types/types'

export type ReadSourceFunction = (
  url: string,
  options: { signal?: AbortSignal },
) => Promise<WebSearchResult | undefined>

export const sourceReadLimits = { perNode: 2, perRun: 6, concurrency: 2, timeoutMs: 20_000 }

/** A fresh runtime per research operation, shared by all recursive branches. */
export function createSourceReader(readSource?: ReadSourceFunction, signal?: AbortSignal) {
  const pages = new Map<string, WebSearchResult>()
  const requests = new Map<string, Promise<WebSearchResult | undefined>>()
  const limit = pLimit(sourceReadLimits.concurrency)
  const key = (url: string) => {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href
  }
  return {
    available: !!readSource,
    remember(results: WebSearchResult[]) {
      for (const source of results) {
        if (source.sourceType === 'page' && source.content.trim() && isReadableUrl(source.url))
          pages.set(key(source.url), source)
      }
    },
    async read(source: Pick<WebSearchResult, 'url' | 'title'>) {
      throwIfAborted(signal)
      if (!isReadableUrl(source.url)) return undefined
      const id = key(source.url)
      const cached = pages.get(id)
      if (cached) return { ...cached, url: source.url }
      if (!readSource) return undefined
      if (!requests.has(id)) {
        if (requests.size >= sourceReadLimits.perRun) return undefined
        // Reserve synchronously, including failures, before any asynchronous work.
        requests.set(
          id,
          limit(async () => {
            throwIfAborted(signal)
            const controller = new AbortController()
            const cancel = () => controller.abort(signal?.reason)
            signal?.addEventListener('abort', cancel, { once: true })
            const timer = setTimeout(() => controller.abort(), sourceReadLimits.timeoutMs)
            try {
              const result = await abortable(
                readSource(source.url, { signal: controller.signal }),
                controller.signal,
              )
              throwIfAborted(signal)
              if (!result?.content.trim()) return undefined
              const page: WebSearchResult = {
                ...result,
                url: source.url,
                title: result.title ?? source.title,
                sourceType: 'page',
                finalUrl: result.finalUrl ?? result.url,
              }
              pages.set(id, page)
              if (page.finalUrl && isReadableUrl(page.finalUrl)) pages.set(key(page.finalUrl), page)
              return page
            } catch {
              throwIfAborted(signal)
              // Unreadable pages and timeouts preserve the search evidence.
              return undefined
            } finally {
              clearTimeout(timer)
              signal?.removeEventListener('abort', cancel)
            }
          }),
        )
      }
      const result = await abortable(requests.get(id)!, signal)
      throwIfAborted(signal)
      return result ? { ...result, url: source.url } : undefined
    },
  }
}

export type SourceReader = ReturnType<typeof createSourceReader>
