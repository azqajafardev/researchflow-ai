import { computed, shallowRef } from 'vue'
import type { useResearchSession } from './useResearchSession'
import type { useResearchOperationRuntime } from './useResearchOperationRuntime'
import type { ResearchHistoryGraph } from '~/types/history'
import {
  createRefinementGraph,
  runResearchRefinement,
  type RefinementRequest,
  type RefinementStage,
} from '~/utils/research-refinement'
import { getCombinedQuery } from '~/utils/prompt'
import { useServerMode } from './useServerMode'
import { useHistory } from './useHistory'

export function useResearchRefinement(options: {
  session: ReturnType<typeof useResearchSession>
  runtime: ReturnType<typeof useResearchOperationRuntime>
  getGraph: () => ResearchHistoryGraph | undefined
  onComplete: (report: string, graph: ResearchHistoryGraph) => void
}) {
  const { t, locale } = useI18n()
  const { config } = storeToRefs(useConfigStore())
  const services = useServerMode()
  const { addHistoryItem } = useHistory()
  const stage = shallowRef<RefinementStage>()
  const error = shallowRef('')
  const success = shallowRef('')
  const pending = computed(() => !!stage.value)

  async function refine(request: RefinementRequest) {
    const previous = options.session.state.value
    if (pending.value || !previous.report || !previous.input) return
    const lease = options.session.beginResearchRetry()
    if (!lease) return
    const signal = options.runtime.start(lease, 'research')
    error.value = ''
    success.value = ''
    try {
      const outcome = await runResearchRefinement({
        request,
        originalQuery: getCombinedQuery(lease.input, [...lease.feedback]),
        result: lease.result,
        report: previous.report,
        languageCode: locale.value,
        searchLanguageCode: config.value.webSearch.searchLanguage,
        aiConfig: { ...config.value.ai },
        signal,
        services,
        onStage(value) {
          stage.value = value
        },
      })
      if (!options.session.isCurrentOperation(lease.sessionId, lease.operationId)) return
      const graph = createRefinementGraph({
        graph: options.getGraph(),
        query: lease.input.query,
        result: lease.result,
        findings: outcome.findings,
        request,
      })
      const history = addHistoryItem({
        ...lease.input,
        title: t('researchEvidence.historyTitle', { query: lease.input.query }),
        feedback: [...lease.feedback],
        learnings: outcome.result.learnings,
        report: outcome.report,
        graph,
      })
      options.session.completeRefinement(lease, outcome.result, outcome.report, history.id)
      options.onComplete(outcome.report, graph)
      success.value = t('researchEvidence.saved')
    } catch (cause) {
      if (options.session.state.value.id !== lease.sessionId) return
      if (signal.aborted) {
        error.value = t('researchEvidence.cancelled')
      } else {
        error.value = t('researchEvidence.failed', {
          message: cause instanceof Error ? cause.message : String(cause),
        })
        options.session.failResearchRetry(lease)
      }
    } finally {
      options.runtime.finish(lease)
      stage.value = undefined
    }
  }

  function reset() {
    error.value = ''
    success.value = ''
  }
  return { refine, pending, stage, error, success, reset }
}
