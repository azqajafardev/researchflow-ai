import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectResearchResult } from '../app/utils/research-result.ts'

describe('research result collection', () => {
  it('keeps different findings from the same URL across branches', () => {
    const result = collectResearchResult([
      {
        learnings: [
          { url: 'https://example.com/a', learning: 'Unaffected branch' },
          { url: 'https://example.com/shared', learning: 'Older duplicate' },
        ],
      },
      {
        learnings: [
          { url: 'https://example.com/b', learning: 'Retried branch' },
          { url: 'https://example.com/shared', learning: 'Newer duplicate' },
        ],
      },
    ])

    assert.deepEqual(result.learnings, [
      { url: 'https://example.com/a', learning: 'Unaffected branch' },
      { url: 'https://example.com/shared', learning: 'Older duplicate' },
      { url: 'https://example.com/b', learning: 'Retried branch' },
      { url: 'https://example.com/shared', learning: 'Newer duplicate' },
    ])
  })
})
