import type { NuxtApp } from '#app'

export type AvailableLocales = NuxtApp['$i18n']['availableLocales']
export type Locale = AvailableLocales[number]

export type WebSearchResult = {
  content: string
  url: string
  /** Redirect destination; url remains the stable citation identity. */
  finalUrl?: string
  title?: string
  /** Provider publication metadata; not necessarily the event date. */
  publishedAt?: string
  /** Provider-local relevance score; never compare across providers. */
  score?: number
  sourceType?: 'page' | 'search-result'
}
