import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runResearchRefinement } from '../app/utils/research-refinement.ts'
import {
  createInitialResearchSession,
  researchSessionReducer,
  canRegenerateReportFromSession,
} from '../app/composables/useResearchSession.ts'

const finding = {
  url: 'https://example.com/pricing',
  learning: 'Price is 12',
  evidence: {
    excerpt: 'The current price is 12 per month.',
    sourceType: 'page' as const,
    retrievedAt: '2026-09-07T00:00:00Z',
  },
}
const result = { learnings: [{ url: 'https://example.com/old', learning: 'Price is 10' }] }
const report =
  'Price is 10 [1].\n\nKeep this paragraph unchanged.\n\n## Sources\n\n1. [Old](https://example.com/old)'
const base = {
  request: { learningIndex: 0, instruction: 'Check the latest price' },
  originalQuery: 'Compare pricing',
  result,
  report,
  languageCode: 'en',
  aiConfig: { provider: 'openai-compatible', model: 'test', contextSize: 128000 },
  onStage: () => {},
}

function services(overrides: Record<string, unknown> = {}) {
  return {
    async deepResearch(params: any) {
      assert.equal(params.breadth, 2)
      assert.equal(params.maxDepth, 1)
      assert.equal(params.learnings, undefined)
      params.onProgress({ type: 'complete', learnings: [finding] })
    },
    async writeFinalReport(params: any) {
      assert.equal(params.revision.firstNewCitation, 2)
      return {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            textDelta: JSON.stringify({
              patches: params.revision.blocks.map((block: any) => ({
                id: block.id,
                markdown: 'Price is 12 [2].',
              })),
            }),
          }
        })(),
      }
    },
    ...overrides,
  } as any
}

describe('research follow-up transaction', () => {
  it('searches a bounded question, patches only cited blocks and appends evidence', async () => {
    const stages: string[] = []
    const outcome = await runResearchRefinement({
      ...base,
      services: services(),
      onStage: (stage) => stages.push(stage),
    } as any)
    assert.deepEqual(stages, ['searching', 'revising'])
    assert.equal(outcome.result.learnings.length, 2)
    assert.deepEqual(outcome.result.learnings[1].evidence, finding.evidence)
    assert.match(outcome.report, /^Price is 12 \[2\]/)
    assert.ok(outcome.report.includes('Keep this paragraph unchanged.'))
    assert.match(outcome.report, /2\. \[https:\/\/example.com\/pricing\]/)
    assert.equal(result.learnings.length, 1)
    assert.match(report, /^Price is 10/)
  })

  it('preserves existing citation positions even for duplicate legacy findings', async () => {
    const legacy = { learnings: [...result.learnings, ...result.learnings] }
    const outcome = await runResearchRefinement({
      ...base,
      result: legacy,
      services: services({
        async writeFinalReport(params: any) {
          assert.equal(params.learnings.length, 3)
          return {
            fullStream: (async function* () {
              yield {
                type: 'text-delta',
                textDelta: JSON.stringify({
                  patches: params.revision.blocks.map((block: any) => ({
                    id: block.id,
                    markdown: 'Price is 12 [3].',
                  })),
                }),
              }
            })(),
          }
        },
      }),
    } as any)
    assert.deepEqual(outcome.result.learnings.slice(0, 2), legacy.learnings)
  })

  it('does not update a report without matched excerpts or a completion event', async () => {
    for (const emit of [false, true]) {
      await assert.rejects(
        runResearchRefinement({
          ...base,
          services: services({
            async deepResearch(params: any) {
              if (emit) params.onProgress({ type: 'complete', learnings: result.learnings })
            },
            async writeFinalReport() {
              assert.fail('Must not revise without evidence')
            },
          }),
        } as any),
        /No matching source/,
      )
    }
  })

  it('rejects malformed patches and cancellation without mutating original data', async () => {
    await assert.rejects(
      runResearchRefinement({
        ...base,
        services: services({
          async writeFinalReport() {
            return {
              fullStream: (async function* () {
                yield { type: 'text-delta', textDelta: '{"patches":[' }
              })(),
            }
          },
        }),
      } as any),
    )
    const controller = new AbortController()
    await assert.rejects(
      runResearchRefinement({
        ...base,
        signal: controller.signal,
        services: services({
          async deepResearch(params: any) {
            params.onProgress({ type: 'complete', learnings: [finding] })
            controller.abort()
          },
          async writeFinalReport() {
            assert.fail('Must not revise after cancellation')
          },
        }),
      } as any),
      { name: 'AbortError' },
    )
    assert.equal(result.learnings.length, 1)
  })

  it('commits report, findings and history together, ignoring a stale completion', () => {
    const running = {
      ...createInitialResearchSession(),
      id: 's',
      operationId: 'o',
      status: 'running' as const,
      phase: 'research' as const,
      result,
      report,
    }
    const event = {
      type: 'REFINEMENT_SUCCEEDED' as const,
      sessionId: 's',
      operationId: 'o',
      report: 'New report',
      result: { learnings: [finding] },
      historyId: 'new-history',
      at: '2026-09-07',
    }
    const done = researchSessionReducer(running, event)
    assert.equal(done.status, 'completed')
    assert.equal(done.report, 'New report')
    assert.equal(done.historyId, 'new-history')
    assert.deepEqual(done.result.learnings[0].evidence, finding.evidence)
    assert.equal(researchSessionReducer({ ...running, status: 'cancelled' }, event).report, report)
    assert.equal(
      canRegenerateReportFromSession({
        ...running,
        status: 'cancelled',
        historyId: 'original',
        input: { query: 'Pricing', breadth: 2, depth: 2, numQuestions: 3 },
      }),
      true,
    )
    assert.equal(researchSessionReducer(running, { ...event, operationId: 'old' }), running)
  })
})
