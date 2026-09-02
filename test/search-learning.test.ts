import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  escapePromptAttribute,
  finalizeLearningsFromSearchResults,
} from '../shared/utils/search-learning.ts'
import { deduplicateLearnings } from '../shared/utils/research-learning.ts'

describe('finalizeLearningsFromSearchResults', () => {
  const results = [
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/b', title: 'B' },
  ]

  it('keeps only learnings whose URL is in the search results', () => {
    assert.deepEqual(
      finalizeLearningsFromSearchResults(
        [
          { url: 'https://example.com/a', learning: ' Fact A ' },
          { url: 'https://hallucinated.example/x', learning: 'Fake' },
          { url: 'https://example.com/b', learning: 'Fact B' },
          { url: 'https://example.com/a', learning: '   ' },
        ],
        results,
      ),
      [
        { url: 'https://example.com/a', learning: 'Fact A', title: 'A' },
        { url: 'https://example.com/b', learning: 'Fact B', title: 'B' },
      ],
    )
  })

  it('returns an empty list when learnings are missing', () => {
    assert.deepEqual(finalizeLearningsFromSearchResults(undefined, results), [])
  })

  it('saves only excerpts matched against retrieved source content', () => {
    const source = {
      url: 'https://example.com/a',
      title: 'A',
      content: 'The current price\nis 12 per month.',
      sourceType: 'page' as const,
    }
    const findings = finalizeLearningsFromSearchResults(
      [
        { url: source.url, learning: 'Price is 12', quote: 'The current price is 12 per month.' },
        { url: source.url, learning: 'Unsupported', quote: 'The current price is 99 per month.' },
      ],
      [source],
      '2026-09-07T00:00:00Z',
    )
    assert.deepEqual(findings[0].evidence, {
      excerpt: 'The current price is 12 per month.',
      sourceType: 'page',
      retrievedAt: '2026-09-07T00:00:00Z',
    })
    assert.equal(findings[1].evidence, undefined)
  })

  it('deduplicates repeated facts without losing other facts or evidence', () => {
    const evidence = {
      excerpt: 'The current price is 12.',
      sourceType: 'page' as const,
      retrievedAt: '2026-09-07',
    }
    const findings = deduplicateLearnings([
      { url: 'a', learning: 'Price is 12', evidence },
      { url: 'a', learning: 'Supports local deployment' },
      { url: 'a', learning: 'Price is 12' },
    ])
    assert.equal(findings.length, 2)
    assert.deepEqual(findings[0].evidence, evidence)
  })
})

describe('escapePromptAttribute', () => {
  it('escapes quotes and ampersands for prompt attributes', () => {
    assert.equal(
      escapePromptAttribute('https://example.com/q?a=1&b="x"'),
      'https://example.com/q?a=1&amp;b=&quot;x&quot;',
    )
  })
})
