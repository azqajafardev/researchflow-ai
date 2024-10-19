import { tavily } from '@tavily/core'
import Firecrawl, {
  type Document,
  type SearchResultWeb,
  type SearchResultNews,
} from '@mendable/firecrawl-js'
import {
  searchConstraintsSchema,
  resolveSearchPlan,
  type SearchConstraints,
  type SearchLimitation,
} from '~~/shared/utils/search-plan'
import { abortable, isAbortError } from '~~/shared/utils/abort'
import type { ConfigWebSearchProvider } from '~~/shared/types/config'
import type { WebSearchResult } from '~~/shared/types/types'

export type WebSearchOptions = SearchConstraints & {
  maxResults?: number
  /** Search language. Unsupported provider filters are reported through onNotice. */
  lang?: string
  signal?: AbortSignal
  onNotice?: (limitations: SearchLimitation[]) => void
}

export type WebSearchFunction = ((
  query: string,
  options: WebSearchOptions,
) => Promise<WebSearchResult[]>) & { provider?: ConfigWebSearchProvider }

export type WebSearchConfig = {
  provider: ConfigWebSearchProvider
  apiKey?: string
  apiBase?: string
  googlePseId?: string
  tavilyAdvancedSearch?: boolean
  tavilySearchTopic?: 'general' | 'news' | 'finance'
}

const FIRECRAWL_DEFAULT_API_BASE = 'https://api.firecrawl.dev'
const CRW_DEFAULT_API_BASE = 'https://fastcrw.com/api'

export function resolveWebSearchApiBase(
  provider: ConfigWebSearchProvider,
  apiBase?: string,
): string | undefined {
  if (provider === 'firecrawl') {
    return apiBase || FIRECRAWL_DEFAULT_API_BASE
  }
  if (provider === 'crw') {
    return apiBase || CRW_DEFAULT_API_BASE
  }
  // tavily / google-pse do not use a configurable API base in this project
  return undefined
}

export function mapFirecrawlResults(
  items: Array<Document | SearchResultWeb | SearchResultNews> | undefined,
): WebSearchResult[] {
  return (items ?? []).flatMap((item) => {
    const r = item as Document & SearchResultWeb & SearchResultNews
    const url = r.url ?? r.metadata?.sourceURL
    const content = r.markdown || r.snippet || r.description
    if (!url || !content) return []
    return [
      {
        content,
        url,
        title: r.title ?? r.metadata?.title,
        sourceType: r.markdown ? ('page' as const) : ('search-result' as const),
        publishedAt: r.date,
      },
    ]
  })
}

/** Build only filters supported by the selected provider; never silently pretend parity. */
export function buildSearchFilters(provider: ConfigWebSearchProvider, options: WebSearchOptions) {
  const limits: SearchLimitation[] = []
  const time = options.timeRange
  const hasDates = !!(options.startDate || options.endDate)
  const domains = options.includeDomains?.length ? options.includeDomains : undefined
  const date = (value: string) => {
    const [year, month, day] = value.split('-')
    return `${month}/${day}/${year}`
  }
  const tbs = hasDates
    ? `cdr:1${options.startDate ? `,cd_min:${date(options.startDate)}` : ''}${options.endDate ? `,cd_max:${date(options.endDate)}` : ''}`
    : time
      ? `qdr:${{ day: 'd', week: 'w', month: 'm', year: 'y' }[time]}`
      : undefined
  const google: Record<string, string> = {}
  if (options.lang) google.lr = `lang_${options.lang === 'zh' ? 'zh-CN' : options.lang}`
  if (time && !hasDates)
    google.dateRestrict = { day: 'd1', week: 'w1', month: 'm1', year: 'y1' }[time]
  if (hasDates) limits.push('time') // PSE has no equivalent publication-date interval filter.
  if (domains?.length === 1) {
    google.siteSearch = domains[0]!
    google.siteSearchFilter = 'i'
  } else if (domains) limits.push('domains')
  if (options.intent === 'news') limits.push('news')
  if (provider === 'google-pse') return { google, firecrawl: {}, tavily: {}, limitations: limits }
  if (provider === 'crw')
    return {
      google: {},
      firecrawl: {},
      tavily: {},
      limitations: [
        ...(options.intent === 'news' ? ['news' as const] : []),
        ...(time || hasDates ? ['time' as const] : []),
        ...(domains ? ['domains' as const] : []),
        ...(options.lang ? ['language' as const] : []),
      ],
    }
  if (provider === 'firecrawl')
    return {
      google: {},
      tavily: {},
      firecrawl: {
        sources: [options.intent === 'news' ? ('news' as const) : ('web' as const)],
        tbs,
        includeDomains: domains,
      },
      limitations: options.lang ? ['language' as const] : [],
    }
  return {
    google: {},
    firecrawl: {},
    tavily: {
      topic: options.intent,
      timeRange: hasDates ? undefined : time,
      start_date: options.startDate,
      end_date: options.endDate,
      includeDomains: domains,
      language: options.lang,
    },
    limitations: [],
  }
}

async function searchWithFirecrawlCompatible(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const apiUrl = resolveWebSearchApiBase(config.provider, config.apiBase)
  if (!apiUrl) {
    throw new Error(`API base URL is required for provider ${config.provider}`)
  }

  const fc = new Firecrawl({
    apiKey: config.apiKey,
    apiUrl,
  })

  // v2 SDK: `search` throws on error and returns results grouped by
  // source (`web`/`news`/`images`); `maxResults` was renamed to `limit`.
  const results = await abortable(
    fc.search(query, {
      ...buildSearchFilters(config.provider, options).firecrawl,
      limit: options.maxResults ?? 5,
      scrapeOptions: {
        formats: ['markdown'],
      },
    }),
    options.signal,
  )

  return mapFirecrawlResults([...(results.web ?? []), ...(results.news ?? [])])
}

async function searchWithGooglePse(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const apiKey = config.apiKey
  const pseId = config.googlePseId
  if (!apiKey || !pseId) {
    throw new Error('Google PSE API key or ID not set')
  }

  // Ref: https://developers.google.com/custom-search/v1/using_rest
  const searchParams = new URLSearchParams({
    key: apiKey,
    cx: pseId,
    q: query,
    num: (options.maxResults ?? 5).toString(),
  })
  for (const [key, value] of Object.entries(buildSearchFilters('google-pse', options).google)) {
    searchParams.set(key, value)
  }

  const apiUrl = `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`

  try {
    const response = await fetch(apiUrl, { signal: options.signal })
    const data = (await response.json()) as {
      items?: Array<{ title: string; link: string; snippet: string }>
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`)
    }

    if (!data.items) {
      return []
    }

    return data.items.map((item) => ({
      content: item.snippet,
      sourceType: 'search-result' as const,
      url: item.link,
      title: item.title,
    }))
  } catch (error: unknown) {
    if (options.signal?.aborted || isAbortError(error)) throw error
    console.error('Google PSE search failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Google PSE Error: ${message}`)
  }
}

async function searchWithTavily(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const tvly = tavily({
    apiKey: config.apiKey,
  })
  const results = await abortable(
    tvly.search(query, {
      maxResults: options.maxResults ?? 5,
      searchDepth: config.tavilyAdvancedSearch ? 'advanced' : 'basic',
      ...buildSearchFilters('tavily', options).tavily,
      topic: options.intent ?? config.tavilySearchTopic,
    }),
    options.signal,
  )
  return results.results
    .filter((x) => !!x?.content && !!x.url)
    .map((r) => ({
      content: r.content,
      sourceType: 'search-result' as const,
      url: r.url,
      title: r.title,
      publishedAt: r.publishedDate,
      score: r.score,
    }))
}

/** Run a single web search with the given provider config. */
export async function searchWeb(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult[]> {
  const constraints = searchConstraintsSchema.parse(options)
  options = { ...options, ...resolveSearchPlan({ ...constraints, query, researchGoal: '' }) }
  options.onNotice?.(buildSearchFilters(config.provider, options).limitations)
  switch (config.provider) {
    case 'firecrawl':
    case 'crw':
      return searchWithFirecrawlCompatible(config, query, options)
    case 'google-pse':
      return searchWithGooglePse(config, query, options)
    case 'tavily':
    default:
      return searchWithTavily(config, query, options)
  }
}

/** Create a reusable search function bound to a fixed config snapshot. */
export function createWebSearch(config: WebSearchConfig): WebSearchFunction {
  const search: WebSearchFunction = (query, options) => searchWeb(config, query, options)
  search.provider = config.provider
  return search
}
