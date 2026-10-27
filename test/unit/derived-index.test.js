import { describe, expect, it, vi } from 'vitest'
import { createDerivedIndex } from '../../src/core/derive/index'

const mappingFrom = (...segments) => ({
  maps: segments.map((ranges) => ({
    forEach(callback) {
      ranges.forEach(([oldStart, oldEnd]) => callback(oldStart, oldEnd))
    },
  })),
})

const transaction = ({ doc, mapping, meta = false }) => ({
  doc,
  docChanged: !meta,
  mapping,
  getMeta: () => (meta ? { source: 'test' } : undefined),
})

const documentWithScanCounter = (id, scans) => ({
  id,
  descendants(callback) {
    scans.count += 1
    if (callback) callback()
  },
})

describe('P7-01 DerivedIndex seams', () => {
  it('reuses the cached decoration set until a transaction invalidates it', () => {
    const doc = { id: 'doc-1' }
    const rebuild = vi.fn(() => ({ id: 'decorations-1' }))
    const index = createDerivedIndex({ doc, schema: {}, rebuild })

    const first = index.decorations({ doc })
    const second = index.decorations({ doc })

    expect(second).toBe(first)
    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it('returns every mapped range, merging overlapping and adjacent segments across maps', () => {
    const initialDoc = { id: 'before' }
    const nextDoc = { id: 'after' }
    const index = createDerivedIndex({ doc: initialDoc, schema: {}, rebuild: vi.fn() })

    const result = index.update(transaction({
      doc: nextDoc,
      mapping: mappingFrom(
        [[4, 8], [20, 24]],
        [[7, 10], [24, 26]],
      ),
    }))

    expect(result.changed).toEqual([
      { from: 4, to: 10 },
      { from: 20, to: 26 },
    ])
  })

  it('keeps meta-only transactions on the invalidation path', () => {
    const doc = { id: 'doc-1' }
    const rebuild = vi.fn(() => ({ id: 'decorations-1' }))
    const index = createDerivedIndex({ doc, schema: {}, rebuild })

    index.decorations({ doc })
    const result = index.update(transaction({
      doc,
      mapping: mappingFrom(),
      meta: true,
    }))
    index.decorations({ doc })

    expect(result.changed).toEqual([])
    expect(rebuild).toHaveBeenCalledTimes(2)
  })

  it('invalidate() forces a rebuild even when the document identity is unchanged', () => {
    const doc = { id: 'doc-1' }
    const rebuild = vi.fn(() => ({ id: 'decorations-1' }))
    const index = createDerivedIndex({ doc, schema: {}, rebuild })

    index.decorations({ doc })
    index.invalidate()
    index.decorations({ doc })

    expect(rebuild).toHaveBeenCalledTimes(2)
  })

  it('does not invoke the full rebuild/descendants path for a single local edit', () => {
    const scans = { count: 0 }
    const initialDoc = documentWithScanCounter('before', scans)
    const nextDoc = documentWithScanCounter('after', scans)
    const rebuild = vi.fn((state) => {
      state.doc.descendants(() => {})
      return { id: `decorations-${rebuild.mock.calls.length}` }
    })
    const index = createDerivedIndex({ doc: initialDoc, schema: {}, rebuild })

    index.decorations({ doc: initialDoc })
    const initialRebuilds = rebuild.mock.calls.length
    const initialScans = scans.count

    index.update(transaction({
      doc: nextDoc,
      mapping: mappingFrom([[8, 8]]),
    }))
    index.decorations({ doc: nextDoc })

    expect(rebuild).toHaveBeenCalledTimes(initialRebuilds)
    expect(scans.count).toBe(initialScans)
  })
})
