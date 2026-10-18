'use strict'

const AI_ACTIONS = Object.freeze([
  { value: 'continue', label: '续写' }, { value: 'rewrite', label: '改写' },
  { value: 'expand', label: '扩写' }, { value: 'shorten', label: '精简' },
  { value: 'summarize', label: '摘要' }, { value: 'translate', label: '翻译' },
  { value: 'proofread', label: '校对' }, { value: 'formal', label: '正式语气' },
  { value: 'friendly', label: '友好语气' }, { value: 'title', label: '生成标题' },
  { value: 'outline', label: '生成大纲' },
])

const AI_CONTEXTS = Object.freeze([
  { value: 'none', label: '无上下文' },
  { value: 'selection', label: '当前选区' },
  { value: 'block', label: '当前块' },
  { value: 'document', label: '全文' },
])

function contextText(doc, from, to) {
  return doc.textBetween(Math.max(0, from), Math.min(doc.content.size, to), '\n')
}

function contextBlocks(doc, from, to) {
  const blocks = []
  doc.forEach((node, offset) => {
    const blockFrom = Math.max(from, offset)
    const blockTo = Math.min(to, offset + node.nodeSize)
    if (blockTo <= blockFrom) return
    blocks.push({ from: blockFrom, to: blockTo, text: contextText(doc, blockFrom, blockTo) })
  })
  return blocks
}

function truncateContext(doc, from, to, source, limit) {
  if (!limit || source.length <= limit) return { text: source, truncated: false, oversized: false }
  const blocks = contextBlocks(doc, from, to)
  let text = ''
  for (const block of blocks) {
    const candidate = text ? `${text}\n${block.text}` : block.text
    if (candidate.length > limit) {
      // Do not split a single block silently; the caller can show an explicit budget state.
      return { text, truncated: true, oversized: !text }
    }
    text = candidate
  }
  return { text, truncated: true, oversized: false }
}

function blockRange(editor, position) {
  const doc = editor.state.doc
  const $pos = doc.resolve(Math.max(0, Math.min(doc.content.size, position)))
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.isBlock && depth === 1) return { from: $pos.start(depth), to: $pos.end(depth), node }
  }
  const first = doc.firstChild
  return first ? { from: 0, to: first.nodeSize, node: first } : { from: 0, to: doc.content.size, node: null }
}

function createContextSnapshot(editor, scope = 'selection', maxChars = 4000) {
  const normalizedScope = AI_CONTEXTS.some(item => item.value === scope) ? scope : 'selection'
  const { doc, selection } = editor.state
  let from = selection.from
  let to = selection.to
  if (normalizedScope === 'none') { from = selection.from; to = selection.from }
  else if (normalizedScope === 'document') { from = 0; to = doc.content.size }
  else if (normalizedScope === 'block') {
    const range = blockRange(editor, selection.from)
    from = range.from
    to = range.to
  } else if (selection.empty) { from = selection.from; to = selection.from }
  const source = contextText(doc, from, to)
  const limit = Math.max(0, Number(maxChars) || 0)
  const bounded = truncateContext(doc, from, to, source, limit)
  const text = bounded.text
  const truncated = bounded.truncated
  const budgetExceeded = Boolean(bounded.oversized)
  const blockCount = normalizedScope === 'none' ? 0 : contextBlocks(doc, from, to).length
  const labels = { none: '无上下文', selection: '当前选区', block: '当前块', document: '全文' }
  const summary = normalizedScope === 'none'
    ? '无上下文'
    : `${labels[normalizedScope]} · ${text.length} 字${budgetExceeded ? ' · 单块超出预算' : (truncated ? ' · 已截断' : '')}`
  return { scope: normalizedScope, from, to, source, text, summary, truncated, budgetExceeded, blockCount, docSize: doc.content.size }
}

function createReviewResult(text) {
  const raw = String(text || '')
  const source = raw.trim()
  const baseOffset = raw.indexOf(source)
  const issues = []
  if (!source) {
    issues.push({ id: 'review-empty', kind: '结构', severity: 'info', from: 0, to: 0, expected: '', message: '当前范围没有可审阅文字。', suggestion: '先输入内容再开始审阅。' })
  } else {
    const repeated = source.match(/([，。！？])\1+/)
    if (repeated) issues.push({ id: 'review-punctuation', kind: '表达', severity: 'low', from: baseOffset + repeated.index, to: baseOffset + repeated.index + repeated[0].length, expected: repeated[0], message: '发现重复标点。', suggestion: repeated[1] })
    if (source.length > 80) issues.push({ id: 'review-long', kind: '结构', severity: 'medium', from: baseOffset, to: baseOffset + Math.min(source.length, 80), expected: raw.slice(baseOffset, baseOffset + Math.min(source.length, 80)), message: '段落较长，建议拆分为更短的表达。', suggestion: `${source.slice(0, 72)}…` })
    if (!issues.length) issues.push({ id: 'review-clarity', kind: '表达', severity: 'info', from: baseOffset, to: baseOffset + Math.min(source.length, 24), expected: source.slice(0, 24), message: '未发现明显格式问题，可继续检查事实和语气。', suggestion: source.slice(0, 24) })
  }
  return { source, issues }
}

function createToolProposal(context, anchor) {
  const summary = context?.summary || '当前范围'
  const target = anchor || context
  return {
    id: `proposal-${Date.now()}`,
    title: '整理当前内容结构',
    summary: `基于${summary}生成一个可确认的结构提案。`,
    requiresConfirmation: true,
    target: target ? { scope: context?.scope || 'selection', from: target.from, to: target.to, source: target.source || '' } : null,
    operations: [{ type: 'propose_insert', target: summary, description: '在生成时的 AI 锚点位置插入结构化大纲', content: '一、目标与背景\n二、关键内容\n三、下一步行动' }],
  }
}

function mockResult(action, text, options = {}) {
  const source = String(text || '').trim()
  const topic = source.slice(0, 60) || '这份文档'
  switch (action) {
    case 'continue': return `接下来，我们将明确执行步骤、负责人和时间节点，并在每个关键阶段检查进展。${topic ? '\n请同步风险与待确认事项，确保计划按期推进。' : ''}`
    case 'rewrite': return `关于${topic}，建议先明确目标，再梳理关键任务，以清晰、可执行的方式推进工作。`
    case 'expand': return `${source || '请明确文档目标。'}\n具体执行时，可分为准备、实施和复盘三个阶段。准备阶段确认范围与资源，实施阶段记录进展和风险，复盘阶段总结经验并制定下一步行动。`
    case 'shorten': return source.length > 45 ? `${source.slice(0, 45)}…` : source || '明确目标，落实行动。'
    case 'summarize': return `摘要：${topic}\n重点：明确目标、确认计划、跟踪行动。`
    case 'translate': {
      const language = options.language || 'en'
      if (language === 'zh') return `译文：${source || '请先选择需要翻译的内容。'}\n[本地模拟翻译]`
      if (language === 'ja') return `翻訳：${topic}について、範囲、担当者、次のステップを確認してください。\n[本地模拟翻译]`
      return `Local mock translation: This document describes the project plan. Confirm the scope, owners and next steps.\n[模拟翻译，不代表真实翻译服务]`
    }
    case 'proofread': return source.replace(/([，。！？])\1+/g, '$1').replace(/[ \t]{2,}/g, ' ') || '当前段落没有需要校对的文字。'
    case 'formal': return `请各相关方就“${topic}”开展确认，并依据既定安排落实工作，及时反馈进展及风险。`
    case 'friendly': return `大家好，一起看看${topic}吧。我们可以先确认重点，再一步步推进，有问题随时沟通。`
    case 'title': return `${topic.slice(0, 18).replace(/[。！？，\n]/g, '')} · 行动计划`
    case 'outline': return '一、背景与目标\n二、当前进展\n三、关键任务与负责人\n四、风险与待确认事项\n五、下一步安排'
    case 'chat': return `关于${topic}，${options.prompt || '请继续说明你的目标。'}\n建议先确认范围、负责人和下一步行动。`
    default: throw new Error('不支持的 AI 操作')
  }
}

function streamMock(action, text, { onStart, onChunk, onDone, onCancelled, onError, delay = 45, ...options } = {}) {
  let result
  try { result = mockResult(action, text, options) } catch (error) {
    if (onError) onError(error)
    return { cancel() {} }
  }
  let offset = 0
  let active = true
  let timer
  if (onStart) onStart()
  function tick() {
    if (!active) return
    const chunk = result.slice(offset, offset + 12)
    offset += chunk.length
    if (onChunk) onChunk(chunk)
    if (!active) return
    if (offset < result.length) timer = setTimeout(tick, delay)
    else { active = false; if (onDone) onDone() }
  }
  timer = setTimeout(tick, delay)
  return { cancel() { if (!active) return; active = false; clearTimeout(timer); if (onCancelled) onCancelled() } }
}

function createAnchor(editor) {
  const { selection, doc } = editor.state
  let { from, to } = selection
  if (selection.empty && selection.$from.parent.isTextblock) {
    from = selection.$from.start()
    to = selection.$from.end()
  }
  return { from, to, source: doc.textBetween(from, to, '\n'), valid: true }
}

// 每个本地事务映射选区，接受时仍比对原文字；不使用 Yjs 相对位置。
function mapAnchor(anchor, transaction) {
  if (!anchor || !anchor.valid || !transaction.docChanged) return
  const from = transaction.mapping.mapResult(anchor.from, 1)
  const to = transaction.mapping.mapResult(anchor.to, -1)
  anchor.from = from.pos
  anchor.to = Math.max(from.pos, to.pos)
  if (from.deleted || to.deleted || !anchorValid(anchor, transaction.doc)) anchor.valid = false
}

function anchorValid(anchor, doc) {
  return Boolean(anchor && anchor.valid && anchor.from >= 0 && anchor.to <= doc.content.size &&
    doc.textBetween(anchor.from, anchor.to, '\n') === anchor.source)
}

module.exports = { AI_ACTIONS, AI_CONTEXTS, mockResult, streamMock, createContextSnapshot, createReviewResult, createToolProposal, createAnchor, mapAnchor, anchorValid }
