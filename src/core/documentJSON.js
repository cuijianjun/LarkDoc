/** Self-contained codec factory: the same implementation runs in the host and Blob Worker. */
export function createDocumentJSONCodec() {
  function* restore(node) {
    if (!node || typeof node !== 'object') return node
    yield
    if (Array.isArray(node)) {
      const result = []
      for (const item of node) result.push(yield* restore(item))
      return result
    }
    const next = { ...node }
    for (const key of ['content', 'children']) {
      if (Array.isArray(node[key])) next[key] = yield* restore(node[key])
    }
    if (next.type === 'unknownBlock') {
      const payload = next.attrs && next.attrs.payload
      if (typeof payload === 'string' && payload) {
        try {
          const value = JSON.parse(payload)
          if (value && typeof value === 'object' && typeof value.type === 'string' && value.type !== 'unknownBlock') return value
        } catch (_) { /* Preserve damaged placeholders exactly as the synchronous API does. */ }
      }
    }
    return next
  }
  function consume(iterator) {
    let step
    do { step = iterator.next() } while (!step.done)
    return step.value
  }
  function createGrouping() {
    const stack = []
    let index = 0
    return function parentOf(block) {
      const heading = block && block.type === 'heading'
      const level = heading ? Number(block.attrs && block.attrs.level) || 1 : Infinity
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      const parent = stack.length ? stack[stack.length - 1].index : -1
      if (heading) stack.push({ index, level })
      index += 1
      return parent
    }
  }
  function createAssembler() {
    const content = []
    const nodes = []
    const parentOf = createGrouping()
    return {
      content,
      append(blocks, parents) {
        blocks.forEach((block, index) => {
          const parent = parents ? parents[index] : parentOf(block)
          if (!Number.isInteger(parent) || parent < -1 || parent >= nodes.length) throw new Error('Invalid snapshot parent')
          let next = block
          if (block && block.type === 'heading') {
            next = { ...block }
            if (Array.isArray(block.children) && block.children.length) next.children = block.children.slice()
            else delete next.children
          }
          if (parent < 0) content.push(next)
          else {
            const owner = nodes[parent]
            if (!owner || owner.type !== 'heading') throw new Error('Invalid snapshot heading')
            if (!Array.isArray(owner.children)) owner.children = []
            owner.children.push(next)
          }
          nodes.push(next)
        })
      },
    }
  }
  function aggregate(json) {
    if (!json || typeof json !== 'object' || json.type !== 'doc' || !Array.isArray(json.content)) return json
    const assembler = createAssembler()
    assembler.append(json.content)
    return { ...json, content: assembler.content }
  }
  function* normalize(json) {
    const assembler = createAssembler()
    for (const block of json.content) {
      assembler.append([yield* restore(block)])
      yield
    }
    return { ...json, content: assembler.content }
  }
  return { restore: value => consume(restore(value)), restoreIterator: restore, aggregate, normalize, createGrouping, createAssembler }
}

const codec = /* #__PURE__ */ createDocumentJSONCodec()
export const aggregateHeadingContainers = codec.aggregate
export const restoreUnknownBlocks = codec.restore
