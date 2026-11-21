import { describe, it, expect } from 'vitest'
import { encodeQrMatrix } from '../../src/utils/shareQrCode'

describe('分享二维码编码器', () => {
  it('短链接生成 v2（25×25）矩阵，三个定位图形与固定黑点齐全', () => {
    const qr = encodeQrMatrix('https://example.com/d/1')
    expect(qr).not.toBeNull()
    expect(qr.size).toBe(25) // 22 字节 + 12 bit 头 > v1-L 的 19 字节
    expect(qr.modules).toHaveLength(25 * 25)
    const at = (x, y) => qr.modules[y * qr.size + x]
    // 三个定位图形中心 3×3 全黑（定位在 (3,3)、(size-4,3)、(3,size-4)）
    for (const [cx, cy] of [[3, 3], [21, 3], [3, 21]]) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) expect(at(cx + dx, cy + dy)).toBe(true)
      }
    }
    // 固定黑点 (8, size-8)
    expect(at(8, 17)).toBe(true)
  })

  it('同一链接两次编码结果完全一致（掩码选择稳定）', () => {
    const text = 'http://127.0.0.1:8793/_codex/vue3-collab-preview/dist/index.html?user=alice'
    const a = encodeQrMatrix(text), b = encodeQrMatrix(text)
    expect(a.size).toBe(b.size)
    expect(a.modules).toEqual(b.modules)
  })

  it('空串与超长链接按容量降级返回 null', () => {
    expect(encodeQrMatrix('')).toBeNull()
    expect(encodeQrMatrix('x'.repeat(400))).toBeNull()
  })

  it('版本随数据量增长：100 字节链接升到版本 5', () => {
    const qr = encodeQrMatrix('a'.repeat(100))
    expect(qr).not.toBeNull()
    expect(qr.size).toBe(37) // v5 = 5*4+17，v4-L 仅 80 字节不够
  })
})
