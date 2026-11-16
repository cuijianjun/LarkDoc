import katex from 'katex'
import { ImportedXmlComponent, TextRun } from 'docx'
import { scanHtml } from './markdown'

// 只使用 docx 的公开 XML API；KaTeX 负责解析 LaTeX，未知结构保留源码并计数。
function xml(tag, children = [], attrs) {
  const element = new ImportedXmlComponent(`m:${tag}`, attrs)
  children.filter(child => child != null).forEach(child => element.push(child))
  return element
}
const property = (tag, value) => xml(tag, [], { 'm:val': String(value) })
const textOf = node => node.tag === '#text' ? node.text : (node.children || []).map(textOf).join('')
const elements = node => (node.children || []).filter(child => child.tag !== '#text' || child.text.trim())
const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀'])
const PAIRS = new Map([['(', ')'], ['[', ']'], ['{', '}'], ['|', '|'], ['‖', '‖'], ['⟨', '⟩'], ['⌊', '⌋'], ['⌈', '⌉']])

function convert(node, depth = 0) {
  if (depth > 64) throw new Error('公式嵌套过深')
  const kids = elements(node)
  const map = child => convert(child, depth + 1)
  const slot = (name, child) => xml(name, child ? map(child) : [])
  if (['annotation', 'annotation-xml'].includes(node.tag)) return []
  if (['#text', 'mi', 'mn', 'mo', 'mtext', 'ms'].includes(node.tag)) {
    const variant = node.attrs?.mathvariant
    const properties = []
    if (['normal', 'bold', 'italic', 'bold-italic'].includes(variant) || ['mn', 'mo', 'mtext'].includes(node.tag)) {
      properties.push(property('sty', { bold: 'b', italic: 'i', 'bold-italic': 'bi' }[variant] || 'p'))
    }
    const script = { 'double-struck': 'double-struck', script: 'script', fraktur: 'fraktur', 'sans-serif': 'sans-serif', monospace: 'monospace' }[variant]
    if (script) properties.push(property('scr', script))
    return [xml('r', [properties.length ? xml('rPr', properties) : null, xml('t', [textOf(node)], { 'xml:space': 'preserve' })])]
  }
  if (['math', 'semantics', 'mrow', 'mstyle', 'mpadded'].includes(node.tag)) {
    if (kids.length > 1 && kids[0].tag === 'mo' && kids[kids.length - 1].tag === 'mo' && PAIRS.get(textOf(kids[0])) === textOf(kids[kids.length - 1])) {
      return [xml('d', [xml('dPr', [property('begChr', textOf(kids[0])), property('endChr', textOf(kids[kids.length - 1]))]), xml('e', kids.slice(1, -1).flatMap(map))])]
    }
    return kids.flatMap(map)
  }
  if (node.tag === 'mspace') return [xml('r', [xml('t', [' '], { 'xml:space': 'preserve' })])]
  if (node.tag === 'mfrac') return [xml('f', [node.attrs?.linethickness === '0px' ? xml('fPr', [property('type', 'noBar')]) : null, slot('num', kids[0]), slot('den', kids[1])])]
  if (['msqrt', 'mroot'].includes(node.tag)) return [xml('rad', [xml('radPr', [property('degHide', node.tag === 'msqrt' ? 1 : 0)]), slot('deg', node.tag === 'mroot' ? kids[1] : null), xml('e', node.tag === 'msqrt' ? kids.flatMap(map) : map(kids[0]))])]
  if (['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(node.tag)) {
    const base = kids[0]
    const symbol = textOf(base)
    const hasSub = ['msub', 'msubsup', 'munder', 'munderover'].includes(node.tag)
    const hasSup = ['msup', 'msubsup', 'mover', 'munderover'].includes(node.tag)
    const sub = hasSub ? kids[1] : null
    const sup = hasSup ? kids[hasSub ? 2 : 1] : null
    if (NARY.has(symbol)) return [xml('nary', [xml('naryPr', [property('chr', symbol), property('limLoc', node.tag.includes('under') || node.tag === 'mover' ? 'undOvr' : 'subSup'), property('subHide', hasSub ? 0 : 1), property('supHide', hasSup ? 0 : 1)]), slot('sub', sub), slot('sup', sup), xml('e')])]
    if (node.tag === 'mover' && (node.attrs?.accent === 'true' || kids[1]?.tag === 'mo')) return [xml('acc', [xml('accPr', [property('chr', textOf(kids[1]))]), slot('e', base)])]
    if (node.tag === 'munder') return [xml('limLow', [slot('e', base), slot('lim', sub)])]
    if (node.tag === 'mover') return [xml('limUpp', [slot('e', base), slot('lim', sup)])]
    if (node.tag === 'munderover') return [xml('limUpp', [xml('e', [xml('limLow', [slot('e', base), slot('lim', sub)])]), slot('lim', sup)])]
    return [xml(hasSub && hasSup ? 'sSubSup' : hasSub ? 'sSub' : 'sSup', [slot('e', base), hasSub ? slot('sub', sub) : null, hasSup ? slot('sup', sup) : null])]
  }
  if (node.tag === 'mtable') {
    if (kids.some(row => row.tag !== 'mtr' || elements(row).some(cell => cell.tag !== 'mtd'))) throw new Error('未知公式表格')
    return [xml('m', kids.map(row => xml('mr', elements(row).map(cell => xml('e', elements(cell).flatMap(map))))))]
  }
  if (node.tag === 'menclose' && node.attrs?.notation === 'updiagonalstrike') throw new Error('暂不支持公式划消')
  throw new Error('暂不支持此公式结构')
}

export function wordMath(latex, display, report) {
  const source = String(latex || '')
  try {
    if (!source.trim() || source.length > 16000) throw new Error('公式为空或过长')
    const markup = katex.renderToString(source, { output: 'mathml', displayMode: display, throwOnError: true, trust: false, maxExpand: 1000 })
    const roots = scanHtml(markup)
    const findMath = nodes => {
      for (const node of nodes) {
        if (node.tag === 'math') return node
        const found = findMath(node.children || [])
        if (found) return found
      }
      return null
    }
    const math = findMath(roots)
    if (!math) throw new Error('公式解析失败')
    return xml('oMath', convert(math))
  } catch (_) {
    if (report) report.mathFallbacks = (report.mathFallbacks || 0) + 1
    return new TextRun({ text: display ? source : `$${source}$` })
  }
}
