import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findCitedReportBlocks,
  applyReportRevision,
  appendReportSources,
} from '../shared/utils/report-revision.ts'

describe('targeted report revisions', () => {
  const report =
    '# Report\n\nThe price is 10 [1].\n\nUnrelated fact [2].\n\n| Plan | Price |\n| --- | --- |\n| Basic | 10 [1] |\n\n```txt\nexample [1]\n```\n\n## Sources\n\n1. [Source](https://example.com)\n'

  it('selects cited paragraphs and whole tables, excluding code and sources', () => {
    const blocks = findCitedReportBlocks(report, 1)
    assert.equal(blocks.length, 2)
    assert.match(blocks[0].markdown, /^The price/)
    assert.match(blocks[1].markdown, /^\| Plan/)
    assert.deepEqual(findCitedReportBlocks(report, 11), [])
  })

  it('preserves all unrelated text and citation numbering', () => {
    const blocks = findCitedReportBlocks(report, 1)
    const updated = applyReportRevision(
      report,
      blocks,
      {
        patches: blocks.map((block) => ({
          id: block.id,
          markdown: block.markdown.replaceAll('10 [1]', '12 [3]'),
        })),
      },
      3,
    )
    assert.equal(updated, report.replaceAll('10 [1]', '12 [3]'))
  })

  it('preserves Windows line endings in imported reports', () => {
    const imported = report.replaceAll('\n', '\r\n')
    const blocks = findCitedReportBlocks(imported, 1)
    const revised = applyReportRevision(
      imported,
      blocks,
      {
        patches: blocks.map((block) => ({
          id: block.id,
          markdown: block.markdown.replaceAll('10 [1]', '12 [3]'),
        })),
      },
      3,
    )
    assert.equal(revised, imported.replaceAll('10 [1]', '12 [3]'))
  })

  it('rejects missing blocks, unknown IDs, duplicated IDs and invalid citations atomically', () => {
    const blocks = findCitedReportBlocks(report, 1)
    const patches = blocks.map((block) => ({ id: block.id, markdown: 'Price 12 [3].' }))
    for (const invalid of [
      patches.slice(0, 1),
      [...patches, patches[0]],
      [{ id: 999, markdown: 'Bad [3]' }, patches[1]],
      patches.map((patch) => ({ ...patch, markdown: 'Invented [99]' })),
      patches.map((patch) => ({ ...patch, markdown: 'No source' })),
    ]) {
      assert.throws(() => applyReportRevision(report, blocks, { patches: invalid }, 3))
    }
    assert.match(report, /The price is 10/)
  })

  it('appends safe source links with stable numbering', () => {
    const output = appendReportSources(
      report,
      [
        { url: 'https://example.com/new', title: 'A [new] source' },
        { url: 'javascript:alert(1)', title: 'Unsafe' },
      ],
      3,
    )
    assert.match(output, /3\. \[A \\\[new\\\] source\]/)
    assert.match(output, /4\. Unsafe$/)
    assert.equal(output.includes('javascript:'), false)
  })
})
