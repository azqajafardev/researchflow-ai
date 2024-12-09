import { deepResearch as clientDeepResearch } from '~~/lib/core/deep-research'
import { generateFeedback as clientGenerateFeedback } from '~~/lib/core/feedback'
import { writeFinalReport as clientWriteFinalReport } from '~~/lib/core/deep-research'
import type { ResearchStep } from '~~/lib/core/deep-research'

async function* parseSSEStream(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    
    const chunk = decoder.decode(value)
    const lines = chunk.split('\n\n')
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        
        try {
          const step = JSON.parse(data)
          yield step
        } catch (e) {
          console.error('Failed to parse SSE data:', e)
        }
      }
    }
  }
}

export function useServerMode() {
  const runtimeConfig = useRuntimeConfig()
  const isServerMode = computed(() => runtimeConfig.public.serverMode)

  // Server-side implementations
  const serverDeepResearch = async (params: {
    query: string
    breadth: number
    maxDepth: number
    languageCode: Locale
    searchLanguageCode?: Locale
    learnings?: Array<{ url: string; learning: string }>
    currentDepth: number
    nodeId?: string
    retryNode?: any
    onProgress: (step: ResearchStep) => void
  }) => {
    const { query, breadth, maxDepth, languageCode, searchLanguageCode, learnings, currentDepth, nodeId, retryNode, onProgress } = params
    
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        breadth,
        depth: maxDepth,
        languageCode,
        searchLanguageCode,
        learnings,
        currentDepth,
        nodeId,
        retryNode,
      }),
    })

    for await (const step of parseSSEStream(response)) {
      onProgress(step)
    }
  }

  const serverGenerateFeedback = async function* (params: {
    query: string
    language: string
    numQuestions: number
    aiConfig: ConfigAi
  }) {
    const { query, language, numQuestions } = params
    
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        language,
        numQuestions,
      }),
    })

    for await (const step of parseSSEStream(response)) {
      yield step
    }
  }

  const serverWriteFinalReport = async (params: {
    prompt: string
    learnings: Array<{ url: string; learning: string }>
    language: string
    aiConfig: ConfigAi
  }) => {
    const { prompt, learnings, language } = params
    
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        learnings,
        language,
      }),
    })

    return {
      fullStream: parseSSEStream(response)
    }
  }

  return {
    isServerMode,
    deepResearch: isServerMode.value
      ? serverDeepResearch
      : (params: {
          query: string
          breadth: number
          maxDepth: number
          languageCode: Locale
          aiConfig: ConfigAi
          searchLanguageCode?: Locale
          learnings?: Array<{ url: string; learning: string }>
          currentDepth: number
          nodeId?: string
          retryNode?: any
          onProgress: (step: ResearchStep) => void
        }) => clientDeepResearch({
          ...params,
          webSearchFunction: useWebSearch(),
          pLimitInstance: usePLimit()
        }),
    generateFeedback: isServerMode.value ? serverGenerateFeedback : clientGenerateFeedback,
    writeFinalReport: isServerMode.value ? serverWriteFinalReport : clientWriteFinalReport,
  }
}