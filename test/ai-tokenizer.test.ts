import assert from 'node:assert/strict'
import { it } from 'node:test'
import { getEncoding } from 'js-tiktoken'
import { countTokens } from '../lib/ai/providers.ts'
import { encodingForModel } from '../build/tavily-tokenizer.ts'

const samples = [
  '',
  'A research report with citations [1] and [2].',
  '研究证据和来源验证。',
  '한국어 연구 보고서',
  'Een onderzoeksrapport.',
  'Emoji 👨‍👩‍👧‍👦 test',
  'a\n\nb\t123.45',
  '```ts\nconst x = 42\n```',
]

it('preserves token counts when loading only the o200k_base vocabulary', () => {
  const original = getEncoding('o200k_base')
  for (const text of samples) {
    assert.equal(countTokens(text), original.encode(text).length, text)
  }
})

it('preserves the Tavily SDK vocabulary and token IDs', () => {
  const original = getEncoding('cl100k_base')
  const browser = encodingForModel('gpt-3.5-turbo')
  for (const text of samples) {
    assert.deepEqual(browser.encode(text), original.encode(text), text)
  }
  assert.throws(() => encodingForModel('unexpected-model'), /Unexpected Tavily tokenizer/)
})
