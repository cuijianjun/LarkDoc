/**
 * 轻量 markdown → HTML。零依赖，只产出 Tiptap schema 认识的标签，
 * 避免为了渲染 AI 结果把 marked 之类的整包拉进产物（ESM 预算 110KB）。
 *
 * 覆盖范围：标题、段落、有序/无序列表、引用、代码块、分隔线、行内
 * 粗体/斜体/删除线/行内代码/链接/图片。刻意不做表格、脚注、任务列表
 * 之外的扩展语法——这些在 AI 输出里出现频率低，误判代价却很高。
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }

function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, char => HTML_ESCAPES[char])
}

function safeUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(value)) return value
  return ''
}

/** 行内标记。先按反引号切段，保证代码里的 * 和 _ 不被当成强调语法。 */
function renderInline(raw) {
  const segments = String(raw == null ? '' : raw).split('`')
  return segments.map((segment, index) => {
    if (index % 2 === 1) return `<code>${escapeHtml(segment)}</code>`
    let text = escapeHtml(segment)
    // 地址允许一层嵌套括号：维基类链接和 `javascript:alert(1)` 都能被整体吃掉，
    // 否则 `[x](a(b))` 会留下一个多余的 `)`。
    text = text.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (match, alt, src) => {
      const url = safeUrl(src)
      return url ? `<img src="${url}" alt="${alt}">` : alt
    })
    text = text.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (match, label, href) => {
      const url = safeUrl(href)
      return url ? `<a href="${url}">${label}</a>` : label
    })
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
    text = text.replace(/(^|[^\w~])~~([^~]+)~~/g, '$1<s>$2</s>')
    text = text.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    text = text.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>')
    return text
  }).join('')
}

const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const QUOTE_RE = /^\s{0,3}>\s?/
const UL_RE = /^\s{0,3}[-*+]\s+(.*)$/
const OL_RE = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/
const BLOCK_START_RE = /^\s{0,3}(#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|`{3,}|~{3,})/

export function markdownToHtml(markdown) {
  const source = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n')
  if (!source.trim()) return ''
  const lines = source.split('\n')
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }

    const fence = FENCE_RE.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const language = fence[2] || ''
      const body = []
      index += 1
      const closer = new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`)
      while (index < lines.length && !closer.test(lines[index])) { body.push(lines[index]); index += 1 }
      index += 1
      const className = language ? ` class="language-${escapeHtml(language)}"` : ''
      blocks.push(`<pre><code${className}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (HR_RE.test(line)) { blocks.push('<hr>'); index += 1; continue }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (QUOTE_RE.test(line)) {
      const body = []
      while (index < lines.length && QUOTE_RE.test(lines[index])) {
        body.push(lines[index].replace(QUOTE_RE, ''))
        index += 1
      }
      blocks.push(`<blockquote><p>${renderInline(body.join(' '))}</p></blockquote>`)
      continue
    }

    const ulItem = UL_RE.exec(line)
    const olItem = OL_RE.exec(line)
    if (ulItem || olItem) {
      const ordered = Boolean(olItem)
      const start = ordered ? Number(olItem[1]) : 1
      const items = []
      while (index < lines.length) {
        const current = lines[index]
        const item = ordered ? OL_RE.exec(current) : UL_RE.exec(current)
        if (!item) {
          // 悬挂缩进的续行并入上一项，避免 AI 输出的软换行被切成新列表。
          if (items.length && current.trim() && /^\s{2,}/.test(current) && !BLOCK_START_RE.test(current)) {
            items[items.length - 1] += ` ${current.trim()}`
            index += 1
            continue
          }
          break
        }
        items.push(ordered ? item[2] : item[1])
        index += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
      const body = items.map(item => `<li><p>${renderInline(item)}</p></li>`).join('')
      blocks.push(`<${tag}${startAttr}>${body}</${tag}>`)
      continue
    }

    const paragraph = []
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index]
      if (paragraph.length && (BLOCK_START_RE.test(current) || HR_RE.test(current))) break
      paragraph.push(current)
      index += 1
    }
    blocks.push(`<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }
  return blocks.join('')
}

const MARKDOWN_HINT_RE = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|`{3,})|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/

/** 粗略判断一段流式文本是不是 markdown；纯文本走更轻的段落包装。 */
export function looksLikeMarkdown(text) {
  return MARKDOWN_HINT_RE.test(String(text == null ? '' : text))
}

/**
 * 把一段纯文本转成段落 HTML。保留单换行为 <br>，空行分段。
 */
export function plainTextToHtml(text) {
  const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim()
  if (!source) return ''
  return source
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * 预览内容 → 可直接进 Tiptap 的 HTML。
 * - format = 'html'：原样返回（宿主已渲染好）
 * - format = 'text'：纯文本段落化
 * - format = 'markdown' / 未指定：自动判断是否含 markdown 语法
 */
export function previewToHtml(text, format) {
  const source = String(text == null ? '' : text)
  if (!source.trim()) return ''
  if (format === 'html') return source
  if (format === 'text') return plainTextToHtml(source)
  if (format === 'markdown') return markdownToHtml(source) || plainTextToHtml(source)
  return looksLikeMarkdown(source) ? markdownToHtml(source) : plainTextToHtml(source)
}

/**
 * 单段落内容（如「把这句话改得更正式」）只需要替换段内文字，
 * 不能让 insertContentAt 把光标所在段落切开。返回段内 HTML，
 * 由调用方当作 inline 内容插入；多块内容返回 null。
 */
export function singleParagraphInner(html) {
  const match = /^<p>([\s\S]*)<\/p>$/.exec(String(html || '').trim())
  if (!match) return null
  return /<\/?(p|div|ul|ol|li|h[1-6]|blockquote|pre|hr|table|figure)\b/i.test(match[1]) ? null : match[1]
}
