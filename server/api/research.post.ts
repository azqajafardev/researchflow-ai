import { deepResearch } from '~~/lib/core/deep-research'
import pLimit from 'p-limit'
import type { ConfigAi, ConfigWebSearch } from '~~/shared/types/config'
import { RuntimeConfig } from 'nuxt/schema'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody(event)
  
  const {
    query,
    breadth,
    depth,
    languageCode,
    searchLanguageCode,
    learnings = [],
    currentDepth = 1,
    nodeId = '0',
    retryNode,
  } = body

  // Validate required parameters
  if (!query || !breadth || !depth || !languageCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required parameters',
    })
  }

  // Create server-side configuration
  const serverConfig: ConfigAi = {
    provider: runtimeConfig.public.aiProvider as ConfigAi['provider'],
    apiKey: runtimeConfig.aiApiKey,
    apiBase: runtimeConfig.aiApiBase,
    model: runtimeConfig.public.aiModel,
    contextSize: runtimeConfig.public.aiContextSize,
  }

  // Create server-side web search function
  const serverWebSearch = await createServerWebSearch(runtimeConfig)
  
  // Create server-side pLimit instance
  const serverPLimit = pLimit(runtimeConfig.public.webSearchConcurrencyLimit)

  // Set response headers for streaming
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const onProgress = (step: any) => {
        const data = `data: ${JSON.stringify(step)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      deepResearch({
        query,
        breadth,
        maxDepth: depth,
        languageCode,
        aiConfig: serverConfig,
        searchLanguageCode,
        learnings,
        currentDepth,
        nodeId,
        retryNode,
        onProgress,
        webSearchFunction: serverWebSearch,
        pLimitInstance: serverPLimit,
      })
        .then((result) => {
          controller.close()
        })
        .catch((error) => {
          const errorData = `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`
          controller.enqueue(encoder.encode(errorData))
          controller.close()
        })
    },
  })

  return sendStream(event, stream)
})

async function createServerWebSearch(runtimeConfig: RuntimeConfig) {
  // Import server-side web search implementation
  const { tavily } = await import('@tavily/core')
  const { default: Firecrawl } = await import('@mendable/firecrawl-js')

  return async (query: string, options: { maxResults?: number; lang?: string }) => {
    const provider = runtimeConfig.public.webSearchProvider
    const apiKey = runtimeConfig.webSearchApiKey
    const apiBase = runtimeConfig.webSearchApiBase

    switch (provider) {
      case 'firecrawl': {
        const fc = new Firecrawl({
          apiKey,
          apiUrl: apiBase || 'https://api.firecrawl.dev',
        })
        const results = await fc.search(query, {
          maxResults: options.maxResults || 5,
          scrapeOptions: {
            formats: ['markdown'],
          },
        })
        if (results.error) {
          throw new Error(results.error)
        }
        return results.data
          .filter((x: any) => !!x?.markdown && !!x.url)
          .map((r: any) => ({
            content: r.markdown!,
            url: r.url!,
            title: r.title,
          }))
      }
      
      case 'google-pse': {
        const pseId = runtimeConfig.public.googlePseId
        if (!apiKey || !pseId) {
          throw new Error('Google PSE API key or ID not set')
        }

        const searchParams = new URLSearchParams({
          key: apiKey,
          cx: pseId,
          q: query,
          num: (options.maxResults || 5).toString(),
        })
        if (options.lang) {
          searchParams.append('lr', `lang_${options.lang}`)
        }

        const apiUrl = `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`
        const response = await $fetch(apiUrl, { method: 'GET' }) as any

        if (!response.items) {
          return []
        }

        return response.items.map((item: any) => ({
          content: item.snippet,
          url: item.link,
          title: item.title,
        }))
      }
      
      case 'tavily':
      default: {
        const tvly = tavily({
          apiKey,
        })
        const results = await tvly.search(query, {
          maxResults: options.maxResults || 5,
          searchDepth: runtimeConfig.public.tavilyAdvancedSearch ? 'advanced' : 'basic',
          topic: runtimeConfig.public.tavilySearchTopic as ConfigWebSearch['tavilySearchTopic'],
        })
        return results.results
          .filter((x: any) => !!x?.content && !!x.url)
          .map((r: any) => ({
            content: r.content,
            url: r.url,
            title: r.title,
          }))
      }
    }
  }
}