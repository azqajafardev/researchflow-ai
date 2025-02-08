import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { MockLanguageModelV1, convertArrayToReadableStream } from 'ai/test'
import { deepResearch, type ResearchStep } from '../lib/core/deep-research.ts'
import {
  createResearchHistoryGraph,
  restoreResearchHistoryGraph,
} from '../app/utils/research-history-graph.ts'
import { collectResearchResult } from '../app/utils/research-result.ts'
import { isRootNode } from '../app/utils/tree-node.ts'

// Run the component's actual progress handler without requiring a browser or mounting Vue Flow.
function progressHarness() {
  const { descriptor } = parse(
    readFileSync(
      new URL('../app/components/DeepResearch/DeepResearch.vue', import.meta.url),
      'utf8',
    ),
  )
  const script = ts.createSourceFile(
    'DeepResearch.ts',
    descriptor.scriptSetup!.content,
    ts.ScriptTarget.Latest,
    true,
  )
  const handler = script.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'handleResearchProgress',
  )
  assert.ok(handler)
  const compiled = ts.transpileModule(handler.getText(script), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const nodes = { value: [{ id: '0', label: 'Start' }] as any[] }
  const searchResults = { value: {} as Record<string, any> }
  const handle = new Function(
    'nodes',
    'flowRef',
    'searchResults',
    'toast',
    't',
    'isRootNode',
    'isLoading',
    'console',
    `${compiled}\nreturn handleResearchProgress;`,
  )(
    nodes,
    { value: undefined },
    searchResults,
    { add() {} },
    () => '',
    isRootNode,
    { value: false },
    { log() {}, error() {} },
  ) as (step: ResearchStep) => void
  return { nodes, searchResults, handle }
}

const globals = globalThis as any
const originalModel = globals.getLanguageModel
afterEach(() => {
  globals.getLanguageModel = originalModel
})

describe('research progress evidence persistence', () => {
  it('retains committed evidence after deeper planning fails and history is restored', async () => {
    const source = {
      url: 'https://example.com',
      title: 'Acme launch',
      content: 'Acme released its editor in September.',
    }
    const outputs = [
      { queries: [{ query: 'Acme editor', researchGoal: 'Check launch details' }] },
      {
        learnings: [
          { url: source.url, learning: 'Acme released an editor.', quote: source.content },
        ],
        relevantUrls: [source.url],
        followUpQuestions: ['Find pricing'],
      },
      {}, // Invalid follow-up plan: the error is emitted on the already completed parent.
    ]
    globals.getLanguageModel = () =>
      new MockLanguageModelV1({
        doStream: async () => {
          assert.ok(outputs.length)
          return {
            rawCall: { rawPrompt: '', rawSettings: {} },
            stream: convertArrayToReadableStream([
              { type: 'text-delta', textDelta: JSON.stringify(outputs.shift()) },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { promptTokens: 1, completionTokens: 1 },
              },
            ]),
          }
        },
      })
    const { nodes, handle } = progressHarness()
    const result = await deepResearch({
      query: 'Acme editor',
      breadth: 1,
      maxDepth: 2,
      currentDepth: 1,
      languageCode: 'en',
      aiConfig: { provider: 'openai-compatible', model: 'mock' },
      onProgress: handle,
      webSearchFunction: async () => [source],
    })
    assert.equal(result.learnings.length, 1)
    assert.equal(nodes.value.find((node) => node.id === '0-0')?.status, 'error')
    const restored = restoreResearchHistoryGraph(
      JSON.parse(JSON.stringify(createResearchHistoryGraph(nodes.value))),
    )
    assert.deepEqual(collectResearchResult(Object.values(restored.searchResults)), result)
    const siblingFinding = { url: 'https://example.com/pricing', learning: 'Price is 12.' }
    restored.searchResults['0-1'] = { learnings: [siblingFinding] }
    assert.deepEqual(collectResearchResult(Object.values(restored.searchResults)).learnings, [
      ...result.learnings,
      siblingFinding,
    ])
  })

  it('discards an uncommitted extraction draft when extraction fails', () => {
    const { nodes, handle } = progressHarness()
    handle({
      type: 'generating_query',
      nodeId: '0-0',
      parentNodeId: '0',
      result: { query: 'Acme' },
    })
    handle({
      type: 'processing_search_result',
      nodeId: '0-0',
      query: 'Acme',
      result: { learnings: [{ url: 'https://example.com', learning: 'Unverified draft' }] },
    })
    handle({ type: 'error', nodeId: '0-0', message: 'Extraction failed' })
    const restored = restoreResearchHistoryGraph(createResearchHistoryGraph(nodes.value))
    assert.deepEqual(collectResearchResult(Object.values(restored.searchResults)).learnings, [])
  })
})
