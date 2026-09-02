import { computed, shallowRef } from 'vue'
import type { useResearchSession } from './useResearchSession'
import type { useResearchOperationRuntime } from './useResearchOperationRuntime'
import type { ResearchHistoryGraph } from '~/types/history'
import { runResearchRefinement, type RefinementRequest } from '~/utils/research-refinement'
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
  const stage = shallowRef<'searching' | 'revising'>()
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
      const existing = options.getGraph()
      const nodes = existing?.nodes.length
        ? [...existing.nodes]
        : [{ id: '0', label: lease.input.query, learnings: lease.result.learnings }]
      const nextIndex =
        Math.max(
          0,
          ...nodes.map((node) => (/^0-\d+$/.test(node.id) ? Number(node.id.slice(2)) : 0)),
        ) + 1
      const id = `0-${nextIndex}`
      const graph: ResearchHistoryGraph = {
        nodes: [
          ...nodes,
          {
            id,
            label: request.instruction.trim(),
            researchGoal: lease.result.learnings[request.learningIndex]!.learning,
            learnings: outcome.findings,
            searchResults: outcome.findings.map(({ url, title }) => ({ url, title })),
            status: 'node_complete',
          },
        ],
        selectedNodeId: existing?.selectedNodeId,
      }
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
