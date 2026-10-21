/**
 * Vditor `getHTML()` 兼容层。
 *
 * 背景：Vditor 的主存储格式是 Markdown，但对外导出的 HTML（三种模式都过 Lute
 * 引擎，见 `src/ts/markdown/getHTML.ts`）保留了它自己的扩展语法语义，形如：
 *
 *   <span class="language-math">E=mc^2</span>
 *   <div class="language-math">\int_a^b f(x)dx</div>
 *   <ul><li class="vditor-task"><input disabled type="checkbox" /> 待办</li></ul>
 *   <div class="language-mermaid">graph TD\n  A --&gt; B</div>
 *   <sup class="footnotes-ref"><a href="#footnotes-def-1">1</a></sup>
 *   <div class="footnotes-defs-div"><hr/><ol><li id="footnotes-def-1">…</li></ol></div>
 *
 * 本编辑器（Tiptap + 自有 schema）只认 `data-type="inline-math"` + `data-latex`、
 * `ul[data-type="taskList"]`、`pre > code.language-*` 等契约，直接 setContent 会
 * 丢公式、丢勾选状态、丢图表代码块。这一层在 sanitizeHTML 之前把 Vditor 结构
 * 改写成本 schema 认识的 HTML，其余标签原样交给 ProseMirror 解析。
 *
 * 约束：
 * - 只在浏览器执行（依赖 document）；SSR / Node 下原样返回，不抛错。
 * - 幂等：已经转换过的 HTML 再跑一遍不会改变结构（转换时就把指纹清理干净）。
 * - 不做网络请求，不加载远程资源（图片仍由 networkPolicy 决定是否放行）。
 * - 图表不做渲染：schema 没有图表节点，统一降级为带语言标记的代码块，源码不丢。
 */

// 旧数据指纹：命中任意一条即视为 Vditor getHTML() 产物。
const VEDITOR_PATTERNS = [
  /\bclass\s*=\s*["'][^"']*\bvditor-/i,
  /\bclass\s*=\s*["'][^"']*\bfootnotes-(?:ref|defs)\b/i,
  /<(?:span|div)\b[^>]*\bclass\s*=\s*["'][^"']*\blanguage-math\b/i,
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\blanguage-(?:mermaid|echarts|mindmap|plantuml|graphviz|abc|wavedrom|markmap|flowchart|smiles)\b/i,
]

// Vditor 支持的图表语言。schema 无图表节点，统一按代码块保留源码。
const DIAGRAM_LANGUAGES = [
  'mermaid', 'echarts', 'mindmap', 'plantuml', 'graphviz',
  'abc', 'wavedrom', 'markmap', 'flowchart', 'smiles',
]

const BLOCK_TAGS = [
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE',
  'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'BLOCKQUOTE', 'HR', 'FIGURE',
  'DETAILS', 'SUMMARY', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
]

const DEFAULT_CONTENT_WIDTH = 720
const MIN_COLUMN_WIDTH = 60

function createReport() {
  return {
    source: null, math: 0, inlineMath: 0, blockMath: 0,
    taskList: 0, taskItem: 0, diagram: 0, table: 0, footnote: 0, video: 0,
    dropped: [],
  }
}

function hasBlockChild(element) {
  return Array.from(element.children || []).some((child) => BLOCK_TAGS.indexOf(child.tagName) !== -1)
}

/** 去掉元素开头的空白文本节点，避免残留 `<input>` 被移除后留下缩进空格。 */
function trimLeadingSpace(element) {
  const first = element.firstChild
  if (!first || first.nodeType !== 3) return
  first.nodeValue = first.nodeValue.replace(/^\s+/, '')
  if (!first.nodeValue) element.removeChild(first)
}

/** 把行内文本包装成段落，满足 schema 的 block+ 内容约束。 */
function ensureBlockChild(element) {
  if (hasBlockChild(element)) return
  const paragraph = document.createElement('p')
  paragraph.innerHTML = element.innerHTML.trim() || '<br>'
  element.innerHTML = ''
  element.appendChild(paragraph)
}

/**
 * 任务项的内容约束是 `paragraph block*`：首个子节点必须是段落。
 * 嵌套清单会先出现 `<ul>`，所以要把开头的行内内容单独包成段落，块级子节点留在后面。
 */
function ensureTaskItemContent(item) {
  const first = item.firstElementChild
  if (first && first.tagName === 'P') return
  const paragraph = document.createElement('p')
  while (item.firstChild) {
    const child = item.firstChild
    if (child.nodeType === 1 && BLOCK_TAGS.indexOf(child.tagName) !== -1) break
    paragraph.appendChild(child)
  }
  if (!paragraph.textContent.trim()) paragraph.innerHTML = '<br>'
  item.insertBefore(paragraph, item.firstChild)
}

/**
 * 判断一段 HTML 是否来自 Vditor（旧数据）。
 * @param {string} html
 * @returns {boolean}
 */
export function isVditorHtml(html) {
  if (typeof html !== 'string' || !html) return false
  return VEDITOR_PATTERNS.some((pattern) => pattern.test(html))
}

/** 公式：`class="language-math"` → `data-type="inline-math|block-math"` + `data-latex`。 */
function convertMath(container, report) {
  const nodes = Array.from(container.querySelectorAll('span[class*="language-math"], div[class*="language-math"]'))
  nodes.forEach((node) => {
    if (!container.contains(node)) return
    const isBlock = node.tagName === 'DIV'
    // Vditor 的公式源码放在文本节点里；部分版本会带 data-math，优先取它。
    const latex = String(node.getAttribute('data-math') || node.textContent || '').trim()
    if (!latex) return
    const replacement = document.createElement(isBlock ? 'div' : 'span')
    replacement.setAttribute('data-type', isBlock ? 'block-math' : 'inline-math')
    replacement.setAttribute('data-latex', latex)
    replacement.textContent = latex
    node.replaceWith(replacement)
    report.math += 1
    if (isBlock) report.blockMath += 1
    else report.inlineMath += 1
  })
}

/** 勾选状态：Vditor 用 `vditor-task--done` 类，也可能只保留 input 的 checked。 */
function isTaskDone(node) {
  const input = node.querySelector('input[type="checkbox"]')
  if (input) return input.hasAttribute('checked') || input.checked === true
  return /\bvditor-task--done\b/.test(String(node.className || ''))
}

function isTaskNode(node) {
  return Boolean(node) && /\bvditor-task\b/.test(String(node.className || ''))
}

/** 单个任务项：`li.vditor-task` → `li[data-type="taskItem"][data-checked]`。 */
function finishTaskItem(item, checked, report) {
  item.setAttribute('data-type', 'taskItem')
  item.setAttribute('data-checked', checked ? 'true' : 'false')
  item.removeAttribute('class')
  Array.from(item.querySelectorAll('input')).forEach((input) => input.remove())
  trimLeadingSpace(item)
  ensureTaskItemContent(item)
  report.taskItem += 1
}

function convertTaskItem(item, report) {
  finishTaskItem(item, isTaskDone(item), report)
}

/**
 * 任务列表：按「连续段」拆分原 `<ul>`。
 *
 * Vditor 允许普通项与任务项混在同一个 `<ul>` 里，而本 schema 的 taskList 只能
 * 容纳 taskItem，所以必须把连续的任务项单独抽成 `ul[data-type="taskList"]`，
 * 普通项留在同 tag 的列表里，且拆分后的列表要作为**原列表的兄弟节点**，
 * 不能嵌进 `<ul>`（非法嵌套会被浏览器 HTML 解析器重排）。
 */
function convertTasks(container, report) {
  // 少数场景 Vditor 会把任务项输出成 div，先统一成列表项。
  Array.from(container.querySelectorAll('div.vditor-task')).forEach((node) => {
    if (!container.contains(node)) return
    const checked = isTaskDone(node)
    const list = document.createElement('ul')
    list.setAttribute('data-type', 'taskList')
    const item = document.createElement('li')
    item.innerHTML = node.innerHTML
    list.appendChild(item)
    node.replaceWith(list)
    finishTaskItem(item, checked, report)
  })

  const lists = Array.from(container.querySelectorAll('ul, ol'))
    .filter((list) => list.querySelector('li.vditor-task'))
  lists.forEach((list) => {
    if (!container.contains(list) || !list.parentNode) return
    const groups = []
    Array.from(list.children).forEach((child) => {
      if (child.tagName !== 'LI') return
      const task = isTaskNode(child)
      const last = groups[groups.length - 1]
      if (last && last.task === task) last.items.push(child)
      else groups.push({ task, items: [child] })
    })
    const fragment = document.createDocumentFragment()
    groups.forEach((group) => {
      const rebuilt = document.createElement(list.tagName === 'OL' ? 'ol' : 'ul')
      if (group.task) rebuilt.setAttribute('data-type', 'taskList')
      else if (list.hasAttribute('start')) rebuilt.setAttribute('start', list.getAttribute('start'))
      group.items.forEach((item) => {
        rebuilt.appendChild(item)
        if (group.task) convertTaskItem(item, report)
      })
      fragment.appendChild(rebuilt)
    })
    list.parentNode.insertBefore(fragment, list)
    list.remove()
  })
  report.taskList = container.querySelectorAll('ul[data-type="taskList"]').length
}

/** 图表：`div.language-mermaid` 等 → `pre > code.language-*`，源码原样保留（含换行）。 */
function convertDiagrams(container, report) {
  Array.from(container.querySelectorAll('div[class*="language-"]')).forEach((node) => {
    if (!container.contains(node)) return
    const language = String(node.getAttribute('class') || '').split(/\s+/)
      .map((name) => (name.indexOf('language-') === 0 ? name.slice(9) : ''))
      .find((name) => name && DIAGRAM_LANGUAGES.indexOf(name) !== -1)
    if (!language) return
    const source = String(node.textContent || '').replace(/^\n+/, '').replace(/\s+$/, '')
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.className = `language-${language}`
    code.textContent = source
    pre.appendChild(code)
    node.replaceWith(pre)
    report.diagram += 1
  })
}

/** 表格：Vditor 不输出列宽，按列数均分写入 colwidth；单元格补段落。 */
function convertTables(container, report) {
  Array.from(container.querySelectorAll('table')).forEach((table) => {
    report.table += 1
    const rows = Array.from(table.querySelectorAll('tr'))
    const columns = rows.reduce((max, row) => {
      const count = Array.from(row.children)
        .filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH')
        .reduce((total, cell) => total + Math.max(1, parseInt(cell.getAttribute('colspan'), 10) || 1), 0)
      return Math.max(max, count)
    }, 0)
    const columnWidth = columns ? Math.max(MIN_COLUMN_WIDTH, Math.round(DEFAULT_CONTENT_WIDTH / columns)) : 0

    rows.forEach((row) => {
      Array.from(row.children).forEach((cell) => {
        if (cell.tagName !== 'TD' && cell.tagName !== 'TH') return
        ensureBlockChild(cell)
        if (!columnWidth || cell.hasAttribute('colwidth')) return
        const colspan = Math.max(1, parseInt(cell.getAttribute('colspan'), 10) || 1)
        // sanitizeHTML 要求 colwidth 的数量与 colspan 一致，否则整条属性会被丢弃。
        cell.setAttribute('colwidth', new Array(colspan).fill(columnWidth).join(','))
      })
    })
  })
}

/** 脚注：去掉指向定义区的死链，保留上标数字与文末列表。 */
function convertFootnotes(container, report) {
  Array.from(container.querySelectorAll('sup.footnotes-ref')).forEach((sup) => {
    if (!container.contains(sup)) return
    Array.from(sup.querySelectorAll('a')).forEach((anchor) => {
      while (anchor.firstChild) anchor.parentNode.insertBefore(anchor.firstChild, anchor)
      anchor.remove()
    })
    sup.removeAttribute('class')
    sup.removeAttribute('id')
    report.footnote += 1
  })

  Array.from(container.querySelectorAll('.footnotes-defs-div')).forEach((block) => {
    if (!container.contains(block)) return
    Array.from(block.querySelectorAll('a')).forEach((anchor) => {
      const href = String(anchor.getAttribute('href') || '')
      if (/^#footnotes-ref/.test(href) || /↩/.test(anchor.textContent || '')) anchor.remove()
    })
    Array.from(block.querySelectorAll('hr.footnotes-defs-hr')).forEach((rule) => {
      rule.removeAttribute('class')
    })
    while (block.firstChild) block.parentNode.insertBefore(block.firstChild, block)
    block.remove()
  })
}

/** 视频 / 音频 / iframe 在 schema 中没有对应节点，降级为带链接的段落，信息不丢。 */
function convertMedia(container, report) {
  Array.from(container.querySelectorAll('video, audio, iframe')).forEach((node) => {
    if (!container.contains(node)) return
    let source = node.getAttribute('src') || ''
    if (!source && typeof node.querySelector === 'function') {
      const inner = node.querySelector('source')
      source = (inner && inner.getAttribute('src')) || ''
    }
    const paragraph = document.createElement('p')
    const label = document.createElement('span')
    label.textContent = '［Vditor 媒体］'
    paragraph.appendChild(label)
    if (source) {
      const link = document.createElement('a')
      link.setAttribute('href', source)
      link.textContent = source
      paragraph.appendChild(link)
    }
    node.replaceWith(paragraph)
    report.video += 1
  })
}

/** `[TOC]` 只是 Vditor 的目录占位，本包有自己的大纲面板，整段移除。 */
function removeTableOfContents(container, report) {
  Array.from(container.querySelectorAll('p, div')).forEach((node) => {
    if (!container.contains(node) || node.children.length) return
    if (!/^\[toc\]$/i.test(String(node.textContent || '').trim())) return
    node.remove()
    report.dropped.push('toc')
  })
}

/** 清掉 Vditor 私有类名与内部属性，保证幂等并避免污染导出 HTML。 */
function stripVditorArtifacts(container) {
  Array.from(container.querySelectorAll('*')).forEach((element) => {
    const className = element.getAttribute('class')
    if (className) {
      const rest = className.split(/\s+/).filter((name) => name
        && !/^vditor-/.test(name)
        && !/^footnotes-/.test(name)
        && name !== 'language-math'
        && name !== 'language-math-inline'
        && name !== 'math-block')
      if (rest.length) element.setAttribute('class', rest.join(' '))
      else element.removeAttribute('class')
    }
    Array.from(element.attributes).forEach((attribute) => {
      // data-type / data-latex 等契约属性必须保留，只清理 Vditor 内部标记。
      if (/^data-(?:block|marker|render|code-block-mode|math-preview)/.test(attribute.name)) element.removeAttribute(attribute.name)
    })
  })
}

/**
 * 把 Vditor `getHTML()` 产物归一化为本编辑器可解析的 HTML。
 *
 * @param {string} html Vditor 导出的 HTML
 * @param {{ force?: boolean, skip?: boolean }} [options]
 *   force: 跳过指纹检测强制转换；skip: 完全跳过归一化（宿主明确知道是新格式 HTML）
 * @returns {{ html: string, converted: boolean, report: object }}
 */
export function normalizeVditorHtml(html, options = {}) {
  const report = createReport()
  const input = typeof html === 'string' ? html : ''
  if (!input) return { html: input, converted: false, report }
  if (options.skip === true) return { html: input, converted: false, report }
  const force = options.force === true
  if (!force && !isVditorHtml(input)) return { html: input, converted: false, report }
  // SSR / Node 环境没有 DOM，原样返回，避免抛错。
  if (typeof document === 'undefined' || !document.createElement) return { html: input, converted: false, report }

  const container = document.createElement('div')
  container.innerHTML = input

  convertMath(container, report)
  convertTasks(container, report)
  convertDiagrams(container, report)
  convertFootnotes(container, report)
  convertTables(container, report)
  convertMedia(container, report)
  removeTableOfContents(container, report)
  stripVditorArtifacts(container)

  report.source = 'vditor'
  return { html: container.innerHTML, converted: true, report }
}

export default normalizeVditorHtml
