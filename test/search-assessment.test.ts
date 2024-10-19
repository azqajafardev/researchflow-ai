import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assessSearchLearnings } from '../shared/utils/search-assessment.ts'
import { searchQueryGuidance } from '../shared/utils/search-plan.ts'
import { createWebSearch } from '../lib/core/web-search.ts'

const source = { url: 'https://example.com', content: 'A sufficiently long source excerpt.' }
const finding = { url: source.url, learning: 'A finding', quote: source.content }

describe('search evidence diagnostics', () => {
  it('distinguishes empty results, irrelevant sources, empty findings and mismatched URLs', () => {
    assert.equal(assessSearchLearnings([], [], []).assessment.reason, 'no_results')
    assert.equal(assessSearchLearnings([finding], [source], []).assessment.reason, 'irrelevant')
    assert.equal(assessSearchLearnings([], [source], [source.url]).assessment.reason, 'no_findings')
    assert.equal(
      assessSearchLearnings([{ ...finding, url: 'https://other.com' }], [source], [source.url])
        .assessment.reason,
      'unmatched_sources',
    )
  })
  it('keeps deterministic excerpt matching and records verified counts', () => {
    const success = assessSearchLearnings([finding], [source], [source.url])
    assert.equal(success.learnings.length, 1)
    assert.equal(success.assessment.reason, 'verified')
    assert.equal(success.assessment.verifiedCount, 1)
    const failed = assessSearchLearnings(
      [{ ...finding, quote: 'Translated or fabricated excerpt' }],
      [source],
      [source.url],
      true,
    )
    assert.equal(failed.assessment.reason, 'unmatched_quotes')
    assert.equal(failed.assessment.extractionRetried, true)
    assert.equal(failed.learnings.length, 0)
  })
  it('does not count model-invented relevant URLs as actual relevant results', () => {
    assert.equal(
      assessSearchLearnings([finding], [source], ['https://other.com']).assessment.relevantCount,
      0,
    )
  })
})

describe('provider-aware search syntax', () => {
  it('advertises only confirmed operator support and keeps provider identity on bound searches', () => {
    for (const provider of ['firecrawl', 'google-pse', 'tavily', 'crw'] as const) {
      assert.equal(createWebSearch({ provider }).provider, provider)
    }
    assert.match(searchQueryGuidance('firecrawl'), /filetype:/)
    assert.match(searchQueryGuidance('google-pse'), /OR between closely related alternatives/)
    assert.match(searchQueryGuidance('tavily'), /Advanced operators are not confirmed/)
    assert.match(searchQueryGuidance('crw'), /Advanced operators are not confirmed/)
    assert.match(searchQueryGuidance(), /exact identifier text/)
  })
})
