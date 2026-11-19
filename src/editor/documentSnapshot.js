import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { getTextBetween, getTextSerializersFromSchema } from '@tiptap/core'
import { createDocumentJSONCodec } from '../core/documentJSON'
import { applyMediaHtmlMode } from '../core/media/htmlMode'
import { headingOutlineText } from '../core/documentTextEdits'
import { iterateHeadingNumbers, HEADING_NUMBER_CONTAINERS, isolatedHeadingContainers } from '../core/headingNumbering'

export { LARGE_DOCUMENT_SIZE } from './documentStats'

const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now()
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))

// This runtime is serialized into a Blob: all dependencies are explicit arguments.
function snapshotWorker(createCodec) {
  const codec = createCodec()
  const parentOf = codec.createGrouping()
  self.onmessage = ({ data }) => {
    if (data.type === 'append') {
      for (let offset = 0; offset < data.content.length; offset += 128) {
        const content = data.content.slice(offset, offset + 128).map(codec.restore)
        const parents = new Int32Array(content.map(parentOf))
        self.postMessage({ type: 'chunk', content, parents }, [parents.buffer])
      }
    } else if (data.type === 'finish') self.postMessage({ type: 'done' })
  }
}

export function documentSnapshotWorkerSource() {
  return `(${snapshotWorker.toString()})(${createDocumentJSONCodec.toString()});`
}

function createJSONWorker() {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const source = documentSnapshotWorkerSource()
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try { return new Worker(url) } finally { URL.revokeObjectURL(url) }
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
      const originalDoc = editor.state.doc
      const doc = editor.storage?.larkDoc?.pagedView?.logicalDocument(originalDoc) || originalDoc
      const current = () => !signal?.aborted && !editor.isDestroyed && editor.state.doc === originalDoc
      if (!current()) return null
      let worker = null
      try { worker = workerFactory() } catch (_) { /* CSP: use the shared codec below. */ }
      let result
      let resolveWorker
      let workerFailed = false
      let workerFinished = false
      let workerStopped = false
      let workerBlockCount = 0
      const stopWorker = () => { if (worker && !workerStopped) { workerStopped = true; worker.terminate() } }
      const codec = createDocumentJSONCodec()
      const assembler = codec.createAssembler()
      const waitForBackground = editor.storage?.larkDoc?.backgroundGate
        ? active => editor.storage.larkDoc.backgroundGate.wait(active) : null
      const workerResult = worker ? new Promise(resolve => {
        resolveWorker = resolve
        const fail = () => { workerFailed = true; workerFinished = true; stopWorker(); resolve(null) }
        worker.onmessage = ({ data }) => {
          if (workerFinished) return
          if (!current()) { workerFinished = true; stopWorker(); resolve(null); return }
          try {
            if (data?.type === 'chunk' && data.content.length <= 128 && data.parents.length === data.content.length) {
              assembler.append(data.content, data.parents)
              workerBlockCount += data.content.length
            } else if (data?.type === 'done' && workerBlockCount === doc.childCount) {
              workerFinished = true
              resolve({ type: 'doc', content: assembler.content })
            }
            else fail()
          } catch (_) { fail() }
        }
        worker.onerror = event => { event.preventDefault?.(); fail() }
      }) : null
      const cancel = () => { workerFinished = true; stopWorker(); resolveWorker?.(null) }
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
          if (waitForBackground && !await waitForBackground(current)) return null
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
            json.push(block.json)
            if (worker && !workerFailed) batch.push(block.json)
            pos += node.nodeSize
            index += 1
          } while (index < doc.childCount && clock() - start < 6 && index % 128 !== 0)
          if (batch.length) {
            try { worker.postMessage({ type: 'append', content: batch }) } catch (_) { workerFailed = true; resolveWorker?.(null) }
            batch = []
          }
          if (index < doc.childCount) await yieldTask()
        }
        if (!current()) return null
        if (worker && !workerFailed) {
          try { worker.postMessage({ type: 'finish' }) } catch (_) { workerFailed = true; resolveWorker?.(null) }
          result = await workerResult
        }
        if (!result && current()) {
          // CSP/worker failure keeps the original cached blocks; never serialize the DOM twice.
          const iterator = codec.normalize({ type: 'doc', content: json })
          let step
          do {
            if (!current() || (waitForBackground && !await waitForBackground(current))) return null
            const start = clock()
            do { step = iterator.next() } while (!step.done && clock() - start < 6)
            if (!step.done) await yieldTask()
          } while (!step.done)
          result = step.value
        }
        return current() ? { html: html.join(''), text: text.join(''), json: result } : null
      } finally {
        signal?.removeEventListener('abort', cancel)
        stopWorker()
      }
    },
  }
}

/** A cooperative, cached walk; a giant list/table is traversed leaf by leaf. */
export function createDocumentStatsReader() {
  const cache = new WeakMap()
  function* visit(node) {
    if (cache.has(node)) return cache.get(node)
    let characters = 0
    let first = ''
    let last = ''
    const headings = []
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
        for (let heading = 0; heading < stats.headings.length; heading += 1) {
          const item = stats.headings[heading]
          headings.push({ ...item, pos: pos + item.pos, hidden: item.hidden || isolatedHeadingContainers.has(node.type.name), scope: item.scope || (HEADING_NUMBER_CONTAINERS.has(node.type.name) ? node : null) })
          if (heading % 128 === 127) yield
        }
        pos += child.nodeSize
        if (index % 128 === 0) yield
      }
    }
    if (node.type.name === 'heading') headings.unshift({ pos: 0, level: node.attrs.level, text: headingOutlineText(node), attrs: node.attrs })
    const result = { characters, headings, first, last }
    cache.set(node, result)
    return result
  }
  function* summarize(doc) {
    const stats = yield* visit(doc)
    // 缓存中只存原始标题；前文删改后，未变节点也必须按新的前序重排编号。
    const numbers = new Map(), outline = []
    let maxHeadingLevel = 0
    for (const item of iterateHeadingNumbers(stats.headings)) {
      if (item) numbers.set(item.pos, item.info.label)
      yield
    }
    for (let index = 0; index < stats.headings.length; index += 1) {
      const item = stats.headings[index]
      maxHeadingLevel = Math.max(maxHeadingLevel, item.level)
      const label = numbers.get(item.pos)
      if (!item.hidden) outline.push({ pos: item.pos, level: item.level, text: label ? `${label} ${item.text || '无标题'}` : item.text })
      if (index % 128 === 0) yield
    }
    return { characters: stats.characters, outline, maxHeadingLevel, first: stats.first, last: stats.last }
  }
  return {
    async read(doc, current = () => true, waitForBackground) {
      const iterator = summarize(doc)
      let next
      do {
        if (!current()) return null
        if (waitForBackground && !await waitForBackground(current)) return null
        const start = clock()
        do { next = iterator.next() } while (!next.done && clock() - start < 6)
        if (!next.done) await yieldTask()
      } while (!next.done)
      return current() ? next.value : null
    },
  }
}
