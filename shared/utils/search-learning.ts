type LearningDraft = {
  url?: string
  learning?: string
  title?: string
  quote?: string
}

export type FinalizedLearning = {
  url: string
  learning: string
  title?: string
  evidence?: import('../types/research-session').ResearchLearning['evidence']
}

/**
 * Keep only learnings whose URL appears in the search results, and attach titles.
 */
export function finalizeLearningsFromSearchResults(
  learnings: LearningDraft[] | undefined,
  results: Array<{
    url: string
    title?: string
    content?: string
    sourceType?: 'page' | 'search-result'
  }>,
  retrievedAt = new Date().toISOString(),
): FinalizedLearning[] {
  if (!learnings?.length) return []

  const allowed = new Map(results.map((result) => [result.url, result.title]))

  return learnings.flatMap((learning) => {
    if (typeof learning.url !== 'string' || typeof learning.learning !== 'string') return []
    if (!allowed.has(learning.url)) return []
    const text = learning.learning.trim()
    if (!text) return []

    const quote =
      typeof learning.quote === 'string' ? learning.quote.trim().replace(/\s+/g, ' ') : undefined
    // Keep search snippets and page bodies separate, even for the same citation URL.
    const source = results.find(
      (result) =>
        result.url === learning.url &&
        quote &&
        result.content?.replace(/\s+/g, ' ').includes(quote),
    )
    const content = source?.content?.replace(/\s+/g, ' ')
    // A model-proposed excerpt becomes evidence only after matching retrieved text.
    const evidence =
      quote && quote.length >= 8 && quote.length <= 1500 && content?.includes(quote)
        ? {
            excerpt: quote,
            retrievedAt,
            sourceType: source?.sourceType ?? ('search-result' as const),
          }
        : undefined
    return [
      {
        url: learning.url,
        learning: text,
        title: allowed.get(learning.url),
        ...(evidence ? { evidence } : {}),
      },
    ]
  })
}

export function escapePromptAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
