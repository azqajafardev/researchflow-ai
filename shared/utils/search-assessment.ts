import { z } from 'zod'
import { finalizeLearningsFromSearchResults } from '~~/shared/utils/search-learning'
import type { WebSearchResult } from '~~/shared/types/types'

export const searchAssessmentSchema = z.object({
  reason: z.enum([
    'verified',
    'no_results',
    'irrelevant',
    'no_findings',
    'unmatched_sources',
    'unmatched_quotes',
  ]),
  resultsCount: z.number().int().nonnegative(),
  relevantCount: z.number().int().nonnegative(),
  findingsCount: z.number().int().nonnegative(),
  verifiedCount: z.number().int().nonnegative(),
  extractionRetried: z.boolean(),
})

export type SearchAssessment = z.infer<typeof searchAssessmentSchema>

/** Relevance is model-assessed; source membership and excerpt matching are deterministic. */
export function assessSearchLearnings(
  drafts: Parameters<typeof finalizeLearningsFromSearchResults>[0],
  results: WebSearchResult[],
  relevantUrls: string[],
  extractionRetried = false,
) {
  const relevant = results.filter((item) => relevantUrls.includes(item.url))
  const candidates = finalizeLearningsFromSearchResults(drafts, relevant)
  const learnings = candidates.filter((item) => !!item.evidence)
  const assessment: SearchAssessment = {
    reason: learnings.length
      ? 'verified'
      : !results.length
        ? 'no_results'
        : relevantUrls.length && !relevant.length
          ? 'unmatched_sources'
          : !relevant.length
            ? 'irrelevant'
            : !drafts?.some((item) => item.learning?.trim())
              ? 'no_findings'
              : !candidates.length
                ? 'unmatched_sources'
                : 'unmatched_quotes',
    resultsCount: new Set(results.map((item) => item.url)).size,
    relevantCount: new Set(relevant.map((item) => item.url)).size,
    findingsCount: drafts?.length ?? 0,
    verifiedCount: learnings.length,
    extractionRetried,
  }
  return { learnings, assessment }
}
