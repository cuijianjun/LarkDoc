import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { ASYNC_BLOCK_TYPES } from '../../src/core/documentOperations'
import { normalizeAsyncBlockState } from '../../src/core/blocks/shared'

describe('async block schema state contract', () => {
  it('registers all async block types in the shared block set', () => {
    expect([...ASYNC_BLOCK_TYPES]).toEqual(['fileBlock', 'image', 'sheet', 'webEmbed', 'bookmark', 'unknownBlock'])
  })

  it('normalizes state payload before serializing it on a block node', () => {
    const schema = getSchema(createLarkDocExtensions())
    const node = schema.nodes.unknownBlock.create({
      payload: '', unknownType: 'future',
      asyncState: JSON.stringify(normalizeAsyncBlockState({ state: 'unauthorized', attempt: 2 })),
    })
    expect(JSON.parse(node.attrs.asyncState)).toMatchObject({ state: 'unauthorized', attempt: 2 })
  })
})
