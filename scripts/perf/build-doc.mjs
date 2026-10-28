/**
 * build-doc.mjs — P0-10 性能基线的 2,000 块 fixture 生成器（requirements/09 §2.4.3）。
 *
 * 文本 + 标题（含缩进子块，供折叠路径覆盖）+ 列表（含嵌套）+ 表格混合；
 * seed 固定（默认 42）→ 同 seed 输出逐字节一致，跨期对比的是同一份工作负载。
 *
 * 用法：
 *   node scripts/perf/build-doc.mjs [--seed 42] [--blocks 2000] [--out perf/.run/fixture.html]
 *   或 import { buildDocHtml } from './build-doc.mjs'
 */

/** 线性同余伪随机（Math.random 不可复现，性能基线要求逐字节可复现）。 */
function createRng(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const WORDS = [
  '项目', '文档', '段落', '标题', '列表', '表格', '协作', '编辑', '性能', '基线',
  '渲染', '装饰', '折叠', '编号', '大纲', '快照', '存储', '同步', '评论', '锚点',
  'version', 'block', 'doc', 'fold', 'index', 'table', 'list', 'render', 'perf',
]

function sentence(rng, minLength) {
  const parts = []
  let length = 0
  while (length < minLength) {
    const word = WORDS[Math.floor(rng() * WORDS.length)]
    parts.push(word)
    length += word.length + 1
  }
  return `${parts.join(' ')}。`
}

function table(rng, rowIndex) {
  const rows = []
  for (let r = 0; r < 3; r += 1) {
    const cells = []
    for (let c = 0; c < 3; c += 1) {
      cells.push(`<td><p>表${rowIndex}·${r}${c} ${sentence(rng, 6)}</p></td>`)
    }
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table><tbody><tr>${'<th><p>列头</p></th>'.repeat(3)}</tr>${rows.join('')}</tbody></table>`
}

/**
 * 按「块」生成 HTML 片段数组，一块对应一个（或一组同属一个逻辑块的）顶层元素。
 *
 * 为什么要把数组暴露出来：P8-01 需要按**顶层块边界**把文档切成若干段做分段灌入验证，
 * 而 `buildDocHtml` 返回的是 `parts.join('')` 的整串，没有分隔符 —— 想从字符串上切
 * 只能靠正则猜顶层标签，而表格里的 `<td><p>` 会被误判成顶层段落，切出来的 HTML 直接坏掉。
 * 所以切分点必须在**生成时**就保留下来。
 *
 * 输出与改动前逐字节一致（`buildDocHtml` 仍是 `join('')`），不影响已采集数字的可比性。
 *
 * @param {{ seed?: number, blocks?: number }} options
 * @returns {string[]} 每个元素是一个逻辑块对应的 HTML 片段
 */
export function buildDocBlocks({ seed = 42, blocks = 2000 } = {}) {
  const rng = createRng(seed)
  const parts = []
  for (let index = 0; index < blocks; index += 1) {
    const roll = rng()
    if (roll < 0.42) {
      parts.push(`<p>${index} 号段落：${sentence(rng, 24)}</p>`)
    } else if (roll < 0.54) {
      // 标题 + 缩进子块：覆盖折叠/编号装饰的真实工作负载。两块同属一个逻辑块，
      // 但分段灌入时可以落在同一段里，也不会改变语义 —— 这里按元素切，不按逻辑块切。
      parts.push(`<h2>${index} 号标题：${sentence(rng, 10)}</h2>`)
      parts.push(`<p data-indent="1">${sentence(rng, 20)}</p>`)
    } else if (roll < 0.66) {
      const listTag = rng() < 0.5 ? 'ul' : 'ol'
      const items = []
      const count = 2 + Math.floor(rng() * 3)
      for (let i = 0; i < count; i += 1) items.push(`<li><p>${index}.${i + 1} ${sentence(rng, 12)}</p></li>`)
      if (rng() < 0.35) items.push(`<li><p>${index}.嵌套 ${sentence(rng, 8)}<${listTag}><li><p>内层项 ${sentence(rng, 6)}</p></li></${listTag}></p></li>`)
      parts.push(`<${listTag}>${items.join('')}</${listTag}>`)
    } else if (roll < 0.78) {
      parts.push(table(rng, index))
    } else if (roll < 0.9) {
      parts.push(`<h3>${index} 号小节：${sentence(rng, 8)}</h3>`)
      parts.push(`<p>${sentence(rng, 16)}</p>`)
    } else {
      parts.push(`<blockquote><p>${index} 号引用：${sentence(rng, 14)}</p></blockquote>`)
    }
  }
  return parts
}

/**
 * 生成混合文档 HTML。块计数口径：每个顶层元素计 1 块（缩进子块/列表项不计入，
 * 与「2,000 块文档」的直觉口径一致，总量由循环次数保证）。
 * @param {{ seed?: number, blocks?: number }} options
 * @returns {string} HTML 字符串（直接可喂 editor.commands.setContent）
 */
export function buildDocHtml(options = {}) {
  return buildDocBlocks(options).join('')
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const argOf = (flag, fallback) => {
    const at = process.argv.indexOf(flag)
    return at >= 0 ? Number(process.argv[at + 1]) : fallback
  }
  const seed = argOf('--seed', 42)
  const blocks = argOf('--blocks', 2000)
  const html = buildDocHtml({ seed, blocks })
  const outAt = process.argv.indexOf('--out')
  if (outAt >= 0) {
    const { writeFileSync, mkdirSync } = await import('fs')
    const { dirname } = await import('path')
    mkdirSync(dirname(process.argv[outAt + 1]), { recursive: true })
    writeFileSync(process.argv[outAt + 1], html)
    console.log(`fixture 已写入 ${process.argv[outAt + 1]}（seed=${seed}, blocks=${blocks}, ${html.length} 字符）`)
  } else {
    process.stdout.write(html)
  }
}
