import type { ResearchLearning, ResearchResult } from '~~/shared/types/research-session'
import { deduplicateLearnings } from '~~/shared/utils/research-learning'

export function collectResearchResult(
  results: Array<{ learnings?: Array<Partial<ResearchLearning>> }>,
): ResearchResult {
  const learnings = results
    .flatMap((result) => result.learnings ?? [])
    .filter(
      (learning): learning is ResearchLearning =>
        typeof learning.url === 'string' && typeof learning.learning === 'string',
    )

  return {
    learnings: deduplicateLearnings(learnings),
  }
}
