import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { getTextBetween, getTextSerializersFromSchema } from '@tiptap/core'
import { aggregateHeadingContainers, restoreUnknownBlocks } from '../core/documentOperations'
import { applyMediaHtmlMode } from '../core/media/htmlMode'

export const LARGE_DOCUMENT_SIZE = 500000
const isolated = new Set(['callout', 'blockquote', 'detailsContent', 'column', 'tableCell', 'tableHeader'])
const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now()
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))

// JSON transformations have no DOM/schema dependency. Keep the implementation
// shared with the synchronous public API, including unknown-block roundtrips.
function createJSONWorker() {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const source = `let content=[];
self.onmessage=({data})=>{
  if(data.type==='append') content.push(...data.content);
  if(data.type==='finish') {
    self.postMessage({type:'doc',content});
    content=[];
  }
};`
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try { return new Worker(url) } finally { URL.revokeObjectURL(url) }
}

/** A cooperative, cached walk; a giant list/table is traversed leaf by leaf. */
export function createDocumentStatsReader() {
  const cache = new WeakMap()
  function* visit(node) {
    if (cache.has(node)) return cache.get(node)
    let characters = 0
    let first = ''
    let last = ''
    const outline = []
    if (node.isText) {
      first = node.text.charAt(0)
      last = node.text.slice(-1)
      // Same Unicode-code-point contract as CharacterCount's textCounter,
      // without allocating Array.from(30MB) on the main thread.
      for (let index = 0; index < node.text.length; index += 1) {
        const code = node.text.charCodeAt(index)
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < node.text.length) {
          const next = node.text.charCodeAt(index + 1)
          if (next >= 0xdc00 && next <= 0xdfff) index += 1
        }
        characters += 1
        if (index % 16384 === 0) yield
      }
    } else if (node.isLeaf) { characters = 1; first = ' '; last = ' ' } // textBetween(..., undefined, ' ')
    else {
      let pos = node.type.name === 'doc' ? 0 : 1
      for (let index = 0; index < node.childCount; index += 1) {
        const child = node.child(index)
        const stats = yield* visit(child)
        if (last && stats.first && /[\uD800-\uDBFF]/.test(last) && /[\uDC00-\uDFFF]/.test(stats.first)) characters -= 1
        characters += stats.characters
        if (!first) first = stats.first
        if (stats.last) last = stats.last
        if (!isolated.has(node.type.name)) {
          stats.outline.forEach(item => outline.push({ ...item, pos: pos + item.pos }))
        }
        pos += child.nodeSize
        if (index % 128 === 0) yield
      }
    }
    if (node.type.name === 'heading') outline.unshift({ pos: 0, level: node.attrs.level, text: node.textContent })
    const result = { characters, outline, first, last }
    cache.set(node, result)
    return result
  }
  return {
    async read(doc, current = () => true) {
      const iterator = visit(doc)
      let next
      do {
        if (!current()) return null
        const start = clock()
        do { next = iterator.next() } while (!next.done && clock() - start < 6)
        if (!next.done) await yieldTask()
      } while (!next.done)
      return current() ? next.value : null
    },
  }
}

/**
 * Serialize unchanged immutable blocks once, in bounded tasks. JSON heading
 * aggregation/unknown restoration runs in a real Worker where available.
 * CSP/SSR environments use the same codec in the cooperative fallback.
 */
export function createDocumentSnapshotReader({ workerFactory = createJSONWorker } = {}) {
  const cache = new WeakMap()
  return {
    async read(editor, { signal, media } = {}) {
      const doc = editor.state.doc
      const current = () => !signal?.aborted && !editor.isDestroyed && editor.state.doc === doc
      if (!current()) return null
      let worker = null
      try { worker = workerFactory() } catch (_) { /* CSP: use the shared codec below. */ }
      let result
      let resolveWorker
      const workerResult = worker ? new Promise(resolve => {
        resolveWorker = resolve
        worker.onmessage = event => resolve(event.data)
        worker.onerror = event => { event.preventDefault?.(); resolve(null) }
      }) : null
      const cancel = () => { worker?.terminate(); resolveWorker?.(null) }
      signal?.addEventListener('abort', cancel, { once: true })
      const serializer = DOMSerializer.fromSchema(editor.schema)
      let singleDoc
      let blockPosition = 0
      let blockIndex = 0
      const textSerializers = Object.fromEntries(Object.entries(getTextSerializersFromSchema(editor.schema)).map(([name, serialize]) => [name, args => serialize({
        ...args, pos: args.pos + blockPosition, parent: args.parent === singleDoc ? doc : args.parent,
        index: args.parent === singleDoc ? blockIndex : args.index, range: { from: 0, to: doc.content.size },
      })]))
      const container = document.implementation.createHTMLDocument().createElement('div')
      const html = []
      const text = []
      const json = []
      let batch = []
      let index = 0
      let pos = 0
      try {
        while (index < doc.childCount) {
          if (!current()) return null
          const start = clock()
          do {
            const node = doc.child(index)
            let block = cache.get(node)
            if (!block) {
              container.replaceChildren(serializer.serializeFragment(Fragment.from(node)))
              block = { html: container.innerHTML, json: node.toJSON() }
              cache.set(node, block)
            }
            html.push(applyMediaHtmlMode(block.html, media))
            // Pass the original document and absolute range to preserve custom
            // toText serializers' parent/index/position contracts.
            singleDoc = doc.copy(Fragment.from(node))
            blockPosition = pos
            blockIndex = index
            text.push((index && node.isBlock ? '\n\n' : '') + getTextBetween(singleDoc, { from: 0, to: singleDoc.content.size }, { textSerializers }))
            if (worker) batch.push(block.json)
            else json.push(restoreUnknownBlocks(block.json))
            pos += node.nodeSize
            index += 1
          } while (index < doc.childCount && clock() - start < 6 && batch.length < 128)
          if (batch.length) { worker.postMessage({ type: 'append', content: batch }); batch = [] }
          if (index < doc.childCount) await yieldTask()
        }
        if (!current()) return null
        if (worker) {
          worker.postMessage({ type: 'finish' })
          result = await workerResult
          if (result?.type === 'doc') result = aggregateHeadingContainers(restoreUnknownBlocks(result))
          if (!result && current()) {
            // A worker may be blocked asynchronously by worker-src CSP.
            // Retry the codec with yielding, without changing the API result.
            worker.terminate()
            return createDocumentSnapshotReader({ workerFactory: () => null }).read(editor, { signal, media })
          }
        } else result = aggregateHeadingContainers({ type: 'doc', content: json })
        return current() ? { html: html.join(''), text: text.join(''), json: result } : null
      } finally {
        signal?.removeEventListener('abort', cancel)
        worker?.terminate()
      }
    },
  }
}
