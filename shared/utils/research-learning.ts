import { z } from 'zod'
import type { ResearchLearning } from '../types/research-session'

export const researchLearningSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  learning: z.string(),
  evidence: z
    .object({
      excerpt: z.string().min(1).max(1500),
      retrievedAt: z.string(),
      sourceType: z.enum(['page', 'search-result']),
    })
    .optional(),
})

/** Deduplicate identical findings, never distinct facts from the same page. */
export function deduplicateLearnings(learnings: ResearchLearning[]): ResearchLearning[] {
  const unique = new Map<string, ResearchLearning>()
  for (const learning of learnings) {
    const key = JSON.stringify([learning.url, learning.learning.trim().replace(/\s+/g, ' ')])
    const previous = unique.get(key)
    unique.set(key, { ...previous, ...learning, evidence: learning.evidence ?? previous?.evidence })
  }
  return [...unique.values()].map((learning) => {
    if (!learning.evidence) delete learning.evidence
    return learning
  })
}
