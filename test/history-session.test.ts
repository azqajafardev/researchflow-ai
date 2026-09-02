import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createResearchHistoryItem,
  normalizeStoredHistory,
  parseImportedHistoryItem,
  updateResearchHistoryItem,
} from '../app/utils/history.ts'

const research = {
  title: 'Repeated query',
  query: 'Repeated query',
  breadth: 2,
  depth: 2,
  numQuestions: 3,
  feedback: [],
  learnings: [{ url: 'https://example.com', learning: 'A result' }],
  report: '',
}

describe('history-backed research sessions', () => {
  it('creates independent history identities for repeated queries', () => {
    const first = createResearchHistoryItem(research, {
      id: 'history-1',
      timestamp: '2026-07-15T00:00:00.000Z',
    })
    const second = createResearchHistoryItem(research, {
      id: 'history-2',
      timestamp: '2026-07-15T00:01:00.000Z',
    })

    assert.equal(first.query, second.query)
    assert.notEqual(first.id, second.id)
    assert.equal(first.id, 'history-1')
    assert.equal(second.id, 'history-2')
  })

  it('updates the exact history ID when queries are identical', () => {
    const first = createResearchHistoryItem(research, {
      id: 'history-1',
      timestamp: '2026-07-15T00:00:00.000Z',
    })
    const second = createResearchHistoryItem(research, {
      id: 'history-2',
      timestamp: '2026-07-15T00:01:00.000Z',
    })
    const updated = updateResearchHistoryItem(
      [first, second],
      'history-2',
      { report: 'Second report' },
      '2026-07-15T00:02:00.000Z',
    )

    assert.equal(first.report, '')
    assert.equal(updated?.id, 'history-2')
    assert.equal(updated?.report, 'Second report')
  })

  it('filters malformed persisted items and rejects incomplete imports', () => {
    const valid = createResearchHistoryItem(research, {
      id: 'history-1',
      timestamp: '2026-07-15T00:00:00.000Z',
    })
    const normalized = normalizeStoredHistory({
      items: [valid, { id: 'broken', query: 'missing arrays' }],
    })

    assert.deepEqual(normalized.items, [valid])
    assert.throws(
      () => parseImportedHistoryItem({ id: 'broken', query: 'missing arrays' }),
      /Invalid history item format/,
    )
  })

  it('round trips evidence in new history and accepts older history without it', () => {
    const learning = {
      ...research.learnings[0],
      evidence: {
        excerpt: 'The source supports this result.',
        sourceType: 'page' as const,
        retrievedAt: '2026-09-07T00:00:00Z',
      },
    }
    const item = createResearchHistoryItem({ ...research, learnings: [learning] })
    assert.deepEqual(parseImportedHistoryItem(JSON.parse(JSON.stringify(item))).learnings, [
      learning,
    ])
    assert.deepEqual(normalizeStoredHistory({ items: [item] }).items[0].learnings, [learning])
    const legacy = createResearchHistoryItem(research)
    assert.deepEqual(parseImportedHistoryItem(legacy).learnings, research.learnings)
  })
})
