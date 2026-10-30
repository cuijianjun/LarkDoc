import { describe, expect, it } from 'vitest'
import {
  BLOCK_CLIPBOARD_MIME,
  createClipboardPayload,
  decodeClipboardPayload,
  encodeClipboardPayload,
  remapClipboardIds,
} from '../../src/core/blocks/block-clipboard'

describe('块级剪贴板契约', () => {
  const blocks = [
    { type: 'callout', attrs: { blockId: 'k' }, content: [{ type: 'paragraph', attrs: { blockId: 'p' }, content: [{ type: 'text', text: 'x' }] }] },
  ]

  it('私有 MIME 载荷可编码并回读，且不暴露原始引用', () => {
    const payload = createClipboardPayload(blocks, { source: 'editor' })
    const encoded = encodeClipboardPayload(payload)
    expect(BLOCK_CLIPBOARD_MIME).toBe('application/vnd.lark-doc.blocks+json')
    expect(decodeClipboardPayload(encoded)).toEqual(payload)
    payload.blocks[0].attrs.blockId = 'changed'
    expect(decodeClipboardPayload(encoded).blocks[0].attrs.blockId).toBe('k')
  })

  it('损坏、版本错误和空选择安全返回 null', () => {
    expect(createClipboardPayload([], {})).toBeNull()
    expect(decodeClipboardPayload('not-json')).toBeNull()
    expect(decodeClipboardPayload(JSON.stringify({ version: 99, blocks }))).toBeNull()
    expect(decodeClipboardPayload(JSON.stringify({ version: 1, blocks: 'bad' }))).toBeNull()
  })

  it('粘贴时整棵子树重新生成 blockId，并返回旧新映射', () => {
    const result = remapClipboardIds(blocks, new Set(['existing']))
    expect(result.blocks[0].attrs.blockId).not.toBe('k')
    expect(result.blocks[0].content[0].attrs.blockId).not.toBe('p')
    expect(result.idMap).toMatchObject({ k: result.blocks[0].attrs.blockId, p: result.blocks[0].content[0].attrs.blockId })
  })
})
