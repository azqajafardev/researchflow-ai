import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { MockLanguageModelV1, convertArrayToReadableStream } from 'ai/test'
import { deepResearch, type ResearchStep } from '../lib/core/deep-research.ts'
import type { WebSearchFunction } from '../lib/core/web-search.ts'

const url = 'https://example.com/launch'
const source = {
  url,
  content: 'Acme launched its new AI editor on September 6, 2026.',
  publishedAt: '2026-09-06',
}
const finding = {
  url,
  learning: 'Acme launched an AI editor on September 6.',
  quote: source.content,
}
const plan = {
  query: 'AI product launches',
  researchGoal: 'Discover recent AI products',
  intent: 'news',
  timeRange: 'week',
}
const globals = globalThis as any
const originalModel = globals.getLanguageModel

afterEach(() => {
  globals.getLanguageModel = originalModel
})

function mockModel(outputs: unknown[], prompts: string[] = []) {
  globals.getLanguageModel = () =>
    new MockLanguageModelV1({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt))
        assert.ok(outputs.length, 'Unexpected extra model call')
        const output = JSON.stringify(outputs.shift())
        return {
          rawCall: { rawPrompt: '', rawSettings: {} },
          stream: convertArrayToReadableStream([
            { type: 'text-delta', textDelta: output },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 1, completionTokens: 1 },
            },
          ]),
        }
      },
    })
}
async function run(
  webSearchFunction: WebSearchFunction,
  extra: Partial<Parameters<typeof deepResearch>[0]> = {},
) {
  const steps: ResearchStep[] = []
  const result = await deepResearch({
    query: '最近的 AI 新闻',
    breadth: 1,
    maxDepth: 1,
    currentDepth: 1,
    languageCode: 'zh',
    searchLanguageCode: 'en',
    aiConfig: { provider: 'openai-compatible', model: 'mock' },
    onProgress: (step) => steps.push(step),
    webSearchFunction,
    ...extra,
  })
  return { result, steps }
}

describe('structured search execution', () => {
  it('keeps search language separate, passes filters and source dates, and needs no extra model call on success', async () => {
    const prompts: string[] = []
    mockModel(
      [{ queries: [plan] }, { learnings: [finding], relevantUrls: [url], followUpQuestions: [] }],
      prompts,
    )
    let calls = 0
    const { result } = await run(async (query, options) => {
      calls++
      assert.equal(query, plan.query)
      assert.equal(options.lang, 'en')
      assert.equal(options.intent, 'news')
      assert.equal(options.timeRange, 'week')
      return [source]
    })
    assert.equal(calls, 1)
    assert.equal(result?.learnings.length, 1)
    assert.equal(prompts.length, 2)
    assert.match(prompts[0]!, /ONE angle/)
    assert.match(prompts[0]!, /models, products, and industry/)
    assert.match(prompts[1]!, /2026-09-06/)
  })

  it('rejects off-topic evidence, rewrites once, and freezes filters', async () => {
    mockModel([
      { queries: [plan] },
      {
        learnings: [finding],
        relevantUrls: [],
        rewriteQuery: 'Acme AI editor launch',
        followUpQuestions: [],
      },
      { learnings: [finding], relevantUrls: [url], followUpQuestions: [] },
    ])
    const queries: string[] = []
    const { result, steps } = await run(async (query, options) => {
      queries.push(query)
      assert.equal(options.timeRange, 'week')
      assert.equal(options.intent, 'news')
      options.onNotice?.(['language'])
      return [source]
    })
    assert.deepEqual(queries, [plan.query, 'Acme AI editor launch'])
    assert.equal(result?.learnings.length, 1)
    assert.deepEqual(
      steps.filter((s) => s.type === 'searching').map((s) => s.attempt),
      [1, 2],
    )
    assert.ok(
      steps.some((s) => s.type === 'search_complete' && s.limitations?.includes('language')),
    )
  })

  it('recovers from zero results and stops after the second empty search', async () => {
    mockModel([
      { queries: [plan] },
      { learnings: [], relevantUrls: [], rewriteQuery: 'AI launches', followUpQuestions: [] },
      {
        learnings: [],
        relevantUrls: [],
        rewriteQuery: 'third query forbidden',
        followUpQuestions: [],
      },
    ])
    let calls = 0
    const { result, steps } = await run(async () => {
      calls++
      return []
    })
    assert.equal(calls, 2)
    assert.equal(result?.learnings.length, 0)
    assert.ok(steps.some((s) => s.type === 'error' && /No relevant/.test(s.message)))
  })

  it('does not accept fabricated quotes or repeatedly send the same query', async () => {
    mockModel([
      { queries: [plan] },
      {
        learnings: [{ ...finding, quote: 'This text is not in the source.' }],
        relevantUrls: [url],
        rewriteQuery: plan.query,
        followUpQuestions: [],
      },
    ])
    let calls = 0
    const { result } = await run(async () => {
      calls++
      return [source]
    })
    assert.equal(calls, 1)
    assert.equal(result?.learnings.length, 0)
  })

  it('does not retry network errors or execute invalid planner filters', async () => {
    mockModel([{ queries: [plan] }])
    let calls = 0
    await run(async () => {
      calls++
      throw new Error('HTTP 401')
    })
    assert.equal(calls, 1)
    mockModel([{ queries: [{ ...plan, timeRange: 'decade' }] }])
    await run(async () => {
      calls++
      return []
    })
    assert.equal(calls, 1)
  })

  it('preserves the parent time window during deeper research while allowing primary-source discovery', async () => {
    mockModel([
      { queries: [plan] },
      {
        learnings: [finding],
        relevantUrls: [url],
        followUpQuestions: ['Find the official announcement'],
      },
      {
        queries: [
          {
            ...plan,
            query: 'Acme AI editor announcement',
            timeRange: 'year',
            intent: 'general',
            sourcePreference: 'primary',
          },
        ],
      },
      { learnings: [finding], relevantUrls: [url], followUpQuestions: [] },
    ])
    const searches: Array<{ query: string; intent?: string }> = []
    await run(
      async (query, options) => {
        assert.equal(options.timeRange, 'week')
        searches.push({ query, intent: options.intent })
        return [source]
      },
      { maxDepth: 2 },
    )
    assert.deepEqual(
      searches.map((s) => s.intent),
      ['news', 'general'],
    )
  })

  it('keeps already verified parent evidence when deeper searches find nothing relevant', async () => {
    mockModel([
      { queries: [plan] },
      { learnings: [finding], relevantUrls: [url], followUpQuestions: ['Check details'] },
      { queries: [{ ...plan, query: 'Acme editor details' }] },
      { learnings: [], relevantUrls: [], followUpQuestions: [] },
    ])
    let count = 0
    const { result } = await run(async () => (++count === 1 ? [source] : []), { maxDepth: 2 })
    assert.equal(count, 2)
    assert.equal(result?.learnings.length, 1)
    assert.equal(result?.learnings[0]?.learning, finding.learning)
  })

  it('uses a saved plan when retrying a history node', async () => {
    mockModel([{ learnings: [finding], relevantUrls: [url], followUpQuestions: [] }])
    await run(
      async (query, options) => {
        assert.equal(query, plan.query)
        assert.equal(options.timeRange, 'week')
        return [source]
      },
      {
        retryNode: {
          id: '0-0',
          label: plan.query,
          researchGoal: plan.researchGoal,
          searchPlan: plan,
        },
      },
    )
  })

  it('retries a legacy node without a stored plan or research goal', async () => {
    mockModel([{ learnings: [finding], relevantUrls: [url], followUpQuestions: [] }])
    const { steps } = await run(
      async (query, options) => {
        assert.equal(query, 'legacy query')
        assert.equal(options.timeRange, undefined)
        return [source]
      },
      { retryNode: { id: '0-0', label: 'legacy query' } },
    )
    assert.equal(
      steps.some((s) => s.type === 'error'),
      false,
    )
  })

  it('does not accept an extraction that omitted the relevance assessment', async () => {
    mockModel([{ queries: [plan] }, { learnings: [finding], followUpQuestions: [] }])
    const { result } = await run(async () => [source])
    assert.equal(result?.learnings.length, 0)
  })

  it('cancellation after the first search prevents extraction and recovery', async () => {
    mockModel([{ queries: [plan] }])
    const controller = new AbortController()
    let calls = 0
    await assert.rejects(
      run(
        async () => {
          calls++
          controller.abort()
          return []
        },
        { signal: controller.signal },
      ),
      { name: 'AbortError' },
    )
    assert.equal(calls, 1)
  })
})
