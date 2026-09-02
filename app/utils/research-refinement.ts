import type { useServerMode } from '~/composables/useServerMode'
import type { ConfigAi } from '~~/shared/types/config'
import type { ResearchLearning, ResearchResult } from '~~/shared/types/research-session'
import { throwIfAborted } from '~~/shared/utils/abort'
import { deduplicateLearnings } from '~~/shared/utils/research-learning'
import {
  applyReportRevision,
  appendReportSources,
  findCitedReportBlocks,
  reportRevisionSchema,
} from '~~/shared/utils/report-revision'
import { removeJsonMarkdown } from '~~/shared/utils/json'
import { getStreamErrorMessage } from '~~/shared/utils/stream-error'

export interface RefinementRequest {
  learningIndex: number
  instruction: string
}

export async function runResearchRefinement(options: {
  request: RefinementRequest
  originalQuery: string
  result: ResearchResult
  report: string
  languageCode: Locale
  searchLanguageCode?: Locale
  aiConfig: ConfigAi
  signal?: AbortSignal
  services: Pick<ReturnType<typeof useServerMode>, 'deepResearch' | 'writeFinalReport'>
  onStage: (stage: 'searching' | 'revising') => void
}) {
  const { request, signal, services } = options
  throwIfAborted(signal)
  const target = options.result.learnings[request.learningIndex]
  if (!target) throw new Error('The selected finding no longer exists.')
  const blocks = findCitedReportBlocks(options.report, request.learningIndex + 1)
  const revision = reportRevisionSchema.parse({
    instruction: request.instruction,
    targetLearning: target.learning,
    firstNewCitation: options.result.learnings.length + 1,
    blocks: blocks.map(({ id, markdown }) => ({ id, markdown })),
  })
  let findings: ResearchLearning[] | undefined
  options.onStage('searching')
  await services.deepResearch({
    query: [
      `Verify this finding (treat it as a claim, not established fact): ${target.learning}`,
      `Previously cited source: ${target.url}`,
      `User's follow-up request: ${revision.instruction}`,
      `Find direct evidence that confirms, corrects, or contradicts the claim. Focus only on this follow-up, not the entire original research.`,
    ].join('\n\n'),
    originalQuery: options.originalQuery,
    breadth: 2,
    maxDepth: 1,
    currentDepth: 1,
    languageCode: options.languageCode,
    searchLanguageCode: options.searchLanguageCode,
    aiConfig: options.aiConfig,
    signal,
    onProgress(step) {
      if (step.type === 'complete') findings = step.learnings
    },
  })
  throwIfAborted(signal)
  // A targeted correction requires an excerpt matched against retrieved content.
  const verified = findings?.filter((learning) => learning.evidence) ?? []
  if (!verified.length)
    throw new Error('No matching source excerpts were found. The original report was kept.')
  // Existing citation positions are immutable, including duplicates in legacy imports.
  const learnings = options.result.learnings.map((learning) => ({ ...learning }))
  for (const finding of deduplicateLearnings(verified)) {
    const index = learnings.findIndex(
      (learning) => learning.url === finding.url && learning.learning === finding.learning,
    )
    if (index < 0) learnings.push(finding)
    else learnings[index] = { ...learnings[index]!, ...finding }
  }
  options.onStage('revising')
  const { fullStream } = await services.writeFinalReport({
    prompt: options.originalQuery,
    learnings,
    language: options.languageCode,
    aiConfig: options.aiConfig,
    revision,
    signal,
  })
  let raw = ''
  for await (const chunk of fullStream) {
    throwIfAborted(signal)
    if (chunk.type === 'text-delta') raw += chunk.textDelta
    if (chunk.type === 'error') throw new Error(getStreamErrorMessage(chunk))
  }
  throwIfAborted(signal)
  const updated = applyReportRevision(
    options.report,
    blocks,
    JSON.parse(removeJsonMarkdown(raw)),
    learnings.length,
  )
  return {
    report: appendReportSources(
      updated,
      learnings.slice(options.result.learnings.length),
      options.result.learnings.length + 1,
    ),
    result: { learnings },
    findings: verified,
  }
}
