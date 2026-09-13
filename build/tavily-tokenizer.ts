import { Tiktoken } from 'js-tiktoken/lite'
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

// Tavily 0.3 uses only this model in its private searchContext token counter.
// Keep its original vocabulary without bundling every js-tiktoken vocabulary.
export function encodingForModel(model: string) {
  if (model !== 'gpt-3.5-turbo') {
    throw new Error(`Unexpected Tavily tokenizer model: ${model}`)
  }
  return new Tiktoken(cl100kBase)
}
