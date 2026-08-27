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
  it('enforces inherited domains during initial search, recovery and deeper research', async () => {
    mockModel([
      { queries: [plan] },
      {
        learnings: [],
        relevantUrls: [],
        rewriteQuery: 'Acme editor launch',
        followUpQuestions: [],
      },
      { learnings: [finding], relevantUrls: [url], followUpQuestions: ['Check details'] },
      {
        queries: [{ ...plan, query: 'Acme official details', includeDomains: ['outside.example'] }],
      },
      { learnings: [finding], relevantUrls: [url], followUpQuestions: [] },
    ])
    const queries: string[] = []
    const { result } = await run(
      async (query, options) => {
        queries.push(query)
        assert.deepEqual(options.includeDomains, ['example.com'])
        return [source]
      },
      { maxDepth: 2, searchConstraints: { includeDomains: ['example.com'] } },
    )
    assert.deepEqual(queries, [plan.query, 'Acme editor launch', 'Acme official details'])
    assert.equal(result.learnings.length, 1)
  })

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
    assert.ok(steps.some((s) => s.type === 'no_evidence' && s.assessment.reason === 'no_results'))
    assert.equal(
      steps.some((s) => s.type === 'error'),
      false,
    )
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
      {
        learnings: [{ ...finding, quote: 'Still not in the source.' }],
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

  it('repairs quotation extraction on the same sources without another web search', async () => {
    const prompts: string[] = []
    mockModel(
      [
        { queries: [plan] },
        {
          learnings: [{ ...finding, quote: '这是翻译后的摘录，无法与英文原文匹配。' }],
          relevantUrls: [url],
          followUpQuestions: [],
        },
        { learnings: [finding], relevantUrls: [url], followUpQuestions: [] },
      ],
      prompts,
    )
    let calls = 0
    const { result, steps } = await run(async () => {
      calls++
      return [source]
    })
    assert.equal(calls, 1)
    assert.equal(prompts.length, 3)
    assert.match(prompts[2]!, /SAME contents/)
    assert.equal(result?.learnings.length, 1)
    assert.equal(
      steps.some((s) => s.type === 'error' || s.type === 'no_evidence'),
      false,
    )
  })

  it('reports the reason after one failed extraction repair and does not fabricate evidence', async () => {
    const invalid = {
      learnings: [{ ...finding, quote: 'Unmatched fabricated quote.' }],
      relevantUrls: [url],
      followUpQuestions: [],
    }
    mockModel([{ queries: [plan] }, invalid, invalid])
    let calls = 0
    const { result, steps } = await run(async () => {
      calls++
      return [source]
    })
    assert.equal(calls, 1)
    assert.equal(result?.learnings.length, 0)
    const outcome = steps.find((s) => s.type === 'no_evidence')
    assert.deepEqual(outcome?.assessment, {
      reason: 'unmatched_quotes',
      resultsCount: 1,
      relevantCount: 1,
      findingsCount: 1,
      verifiedCount: 0,
      extractionRetried: true,
    })
    assert.equal(
      steps.some((s) => s.type === 'error'),
      false,
    )
  })

  it('passes provider syntax guidance to planning and extraction while retaining precise queries', async () => {
    const exactQuery = '"ECONNRESET" filetype:pdf'
    const prompts: string[] = []
    mockModel(
      [
        { queries: [{ ...plan, query: exactQuery, intent: 'general' }] },
        { learnings: [finding], relevantUrls: [url], followUpQuestions: [] },
      ],
      prompts,
    )
    const search: WebSearchFunction = async (query) => {
      assert.equal(query, exactQuery)
      return [source]
    }
    search.provider = 'firecrawl'
    await run(search)
    for (const prompt of prompts)
      assert.match(prompt, /Supported query syntax: quoted exact phrases/)
    assert.doesNotMatch(prompts[0]!, /function searchQueryGuidance/)
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

describe('on-demand page reading', () => {
  const page = {
    url,
    content: 'The official subscription costs 17 dollars per month.',
    sourceType: 'page' as const,
  }
  const request = { sourceId: 0, question: 'What does the subscription cost?' }
  const pageFinding = {
    url,
    learning: 'The subscription costs 17 dollars per month.',
    quote: page.content,
  }

  it('reads a promising snippet without date evidence and extracts from the page before rewriting', async () => {
    mockModel([
      { queries: [plan] },
      {
        learnings: [],
        relevantUrls: [],
        readRequests: [request],
        rewriteQuery: 'unneeded search',
        followUpQuestions: [],
      },
      { learnings: [pageFinding], relevantUrls: [url], followUpQuestions: [] },
    ])
    let searches = 0,
      reads = 0
    const search: WebSearchFunction = async () => {
      searches++
      return [source]
    }
    search.readSource = async (requested) => {
      reads++
      assert.equal(requested, url)
      return page
    }
    const { result, steps } = await run(search)
    assert.equal(searches, 1)
    assert.equal(reads, 1)
    assert.equal(result.learnings[0]?.evidence?.sourceType, 'page')
    assert.ok(steps.some((step) => step.type === 'reading_source'))
    assert.ok(
      steps
        .filter((step) => step.type === 'search_complete')
        .every((step) => step.results.every((source) => !source.content)),
    )
  })

  it('reads even after finding supported evidence and preserves both snippet and page findings', async () => {
    mockModel([
      { queries: [plan] },
      { learnings: [finding], relevantUrls: [url], readRequests: [request], followUpQuestions: [] },
      {
        learnings: [pageFinding],
        relevantUrls: [url],
        readRequests: [request],
        followUpQuestions: [],
      },
    ])
    let reads = 0
    const search: WebSearchFunction = async () => [source]
    search.readSource = async () => {
      reads++
      return page
    }
    const { result } = await run(search)
    assert.equal(reads, 1)
    assert.deepEqual(
      result.learnings.map((item) => item.evidence?.sourceType),
      ['search-result', 'page'],
    )
  })

  it('does not refetch existing pages or execute invented source IDs', async () => {
    for (const returned of [{ ...source, sourceType: 'page' as const }, source]) {
      mockModel([
        { queries: [plan] },
        {
          learnings: [finding],
          relevantUrls: [url],
          readRequests: [{ ...request, sourceId: returned.sourceType ? 0 : 99 }],
          followUpQuestions: [],
        },
      ])
      const search: WebSearchFunction = async () => [returned]
      search.readSource = async () => {
        assert.fail('Unexpected read')
      }
      assert.equal((await run(search)).result.learnings.length, 1)
    }
  })

  it('keeps verified findings if a page fails or the second extraction is malformed', async () => {
    for (const failRead of [true, false]) {
      mockModel([
        { queries: [plan] },
        {
          learnings: [finding],
          relevantUrls: [url],
          readRequests: [request],
          followUpQuestions: [],
        },
        ...(!failRead ? [{}] : []),
      ])
      const search: WebSearchFunction = async () => [source]
      search.readSource = async () => {
        if (failRead) throw new Error('Blocked page')
        return page
      }
      const { result, steps } = await run(search)
      assert.equal(result.learnings[0]?.learning, finding.learning)
      assert.ok(
        steps.some((step) => step.type === 'node_complete' && step.result?.learnings.length === 1),
      )
    }
  })

  it('reads a previously cited source before any search or planning call', async () => {
    mockModel([{ learnings: [pageFinding], relevantUrls: [url], followUpQuestions: [] }])
    const search: WebSearchFunction = async () => {
      assert.fail('Unneeded search')
    }
    search.readSource = async () => page
    const { result } = await run(search, { sourceUrls: [url] })
    assert.equal(result.learnings[0]?.evidence?.sourceType, 'page')
  })

  it('searches when reading the cited source fails or yields no relevant evidence', async () => {
    for (const emptyPage of [true, false]) {
      mockModel([
        ...(!emptyPage ? [{ learnings: [], relevantUrls: [], followUpQuestions: [] }] : []),
        { queries: [plan] },
        { learnings: [finding], relevantUrls: [url], followUpQuestions: [] },
      ])
      let searches = 0
      const search: WebSearchFunction = async (query) => {
        searches++
        assert.equal(query, plan.query)
        return [source]
      }
      search.readSource = async () => (emptyPage ? undefined : page)
      assert.equal((await run(search, { sourceUrls: [url] })).result.learnings.length, 1)
      assert.equal(searches, 1)
    }
  })

  it('does not extract or complete after cancellation during a read', async () => {
    mockModel([
      { queries: [plan] },
      { learnings: [finding], relevantUrls: [url], readRequests: [request], followUpQuestions: [] },
    ])
    const controller = new AbortController()
    const search: WebSearchFunction = async () => [source]
    search.readSource = async () => {
      controller.abort()
      return page
    }
    await assert.rejects(run(search, { signal: controller.signal }), { name: 'AbortError' })
  })
})

it('shares the page cache with recursive research branches', async () => {
  const page = {
    url,
    content: 'Official publication details for Acme.',
    sourceType: 'page' as const,
  }
  const read = {
    learnings: [],
    relevantUrls: [],
    readRequests: [{ sourceId: 0, question: 'Details?' }],
    followUpQuestions: [],
  }
  const extracted = {
    learnings: [{ url, learning: 'Official details', quote: page.content }],
    relevantUrls: [url],
    followUpQuestions: [] as string[],
  }
  mockModel([
    { queries: [plan] },
    read,
    { ...extracted, followUpQuestions: ['Check more details'] },
    { queries: [plan] },
    read,
    extracted,
  ])
  let calls = 0
  const search: WebSearchFunction = async () => [source]
  search.readSource = async () => {
    calls++
    return page
  }
  const { result } = await run(search, { maxDepth: 2 })
  assert.equal(calls, 1)
  assert.equal(result.learnings.length, 1)
})
