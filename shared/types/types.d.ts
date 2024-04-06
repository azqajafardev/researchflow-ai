import type { NuxtApp } from '#app'

export type AvailableLocales = NuxtApp['$i18n']['availableLocales']
export type Locale = AvailableLocales[number]

export type WebSearchResult = {
  content: string
  url: string
  title?: string
}
