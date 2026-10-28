/*
 * Vditor（getHTML）兼容性检查。
 *
 * 用法：npm run build && node scripts/check-vditor-html.js
 * 依赖：jsdom（devDependency，Node 14 兼容）
 *
 * 覆盖范围：
 * 1. 指纹识别：只有 Vditor 特征命中时才转换，普通 HTML 原样通过；
 * 2. DOM 归一化：language-math → data-type/data-latex、li.vditor-task → taskList、
 *    div.language-mermaid → pre > code、脚注死链清理、[TOC] 移除、表格列宽均分；
 * 3. 端到端：真实挂载编辑器后检查 Tiptap JSON 与导出 HTML；
 * 4. 幂等：转换结果再跑一次不再改写。
 */
const { JSDOM } = require('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
const { window } = dom
Object.getOwnPropertyNames(window).forEach((key) => {
  if (global[key] === undefined) {
    try { global[key] = window[key] } catch (error) { /* 只读属性忽略 */ }
  }
})
global.window = window
global.document = window.document
if (!window.Element.prototype.scrollIntoView) window.Element.prototype.scrollIntoView = () => {}
if (!window.Range.prototype.getClientRects) window.Range.prototype.getClientRects = () => []
if (!window.Range.prototype.getBoundingClientRect) {
  window.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const pkg = require('../dist/lark-doc.common.js')

// 真实 Vditor getHTML() 样本（Lute 3.11 输出形态），覆盖全部需要改写的结构。
const FIXTURE = [
  '<h1>一级标题</h1>',
  '<h2>二级标题</h2>',
  '<p>这是<strong>加粗</strong>、<em>斜体</em>、<del>删除</del>、<span class="language-math">E=mc^2</span>。</p>',
  '<div class="language-math">\\int_a^b f(x)dx</div>',
  '<ul>',
  '<li class="vditor-task"><input disabled="" type="checkbox" /> 未完成事项</li>',
  '<li class="vditor-task vditor-task--done"><input checked="" disabled="" type="checkbox" /> 已完成事项</li>',
  '<li>普通列表项</li>',
  '</ul>',
  '<ol><li>第一步</li></ol>',
  '<blockquote>引用内容</blockquote>',
  '<hr />',
  '<table><thead><tr><th>项目</th><th>说明</th></tr></thead>'
    + '<tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>',
  '<div class="language-mermaid">graph TD\n  A --&gt; B\n</div>',
  '<div class="language-echarts">option = { xAxis: { type: \'category\' } };</div>',
  '<pre><code class="language-js">console.log(1)</code></pre>',
  '<p><img src="http://20.200.174.87:8090/attchs/a.png" alt="截图" title="图标题" /></p>',
  '<p>这里引用脚注<sup class="footnotes-ref" id="footnotes-ref-1"><a href="#footnotes-def-1">1</a></sup>。</p>',
  '<div class="footnotes-defs-div"><hr class="footnotes-defs-hr" />',
  '<ol class="footnotes-defs-ol"><li id="footnotes-def-1"><p>脚注内容 <a href="#footnotes-ref-1">↩</a></p></li></ol></div>',
  '<p>[TOC]</p>',
  '<video src="http://20.200.174.87:8090/attchs/v.mp4"></video>',
].join('\n')

const PLAIN = '<h2>普通文档</h2><p>没有 Vditor 标记</p>'

const failures = []
const checks = []
function check(name, condition, detail) {
  checks.push(name)
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  // P1-02/P1-04 起标题容器化：getJSON 为聚合形态，块可挂在 heading 的 children 下。
  if (Array.isArray(node.content)) node.content.forEach((child) => walk(child, visit))
  if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
}
function collect(json, type) {
  const found = []
  walk(json, (node) => { if (node.type === type) found.push(node) })
  return found
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function main() {
  /* ---------- 1. 指纹识别 ---------- */
  check('识别 Vditor HTML', pkg.isVditorHtml(FIXTURE) === true)
  check('普通 HTML 不误判', pkg.isVditorHtml(PLAIN) === false)
  const detection = pkg.detectLegacyHtml(FIXTURE)
  check('detectLegacyHtml 返回来源', detection.legacy === true && detection.source === 'vditor')

  const untouched = pkg.normalizeVditorHtml(PLAIN)
  check('普通 HTML 不做转换', untouched.converted === false && untouched.html === PLAIN)
  const skipped = pkg.normalizeVditorHtml(FIXTURE, { skip: true })
  check('skip 跳过归一化', skipped.converted === false && skipped.html === FIXTURE)

  /* ---------- 1.1 网络策略默认值 ---------- */
  const defaultPolicy = pkg.createNetworkPolicy()
  check('默认策略为 open', pkg.DEFAULT_NETWORK.mode === 'open' && defaultPolicy.mode === 'open')
  check('默认放行 http 图片', defaultPolicy.allows('http://20.200.174.87:8090/attchs/a.png') === true)
  const offlinePolicy = pkg.createNetworkPolicy({ mode: 'offline' })
  check('显式 offline 仍可拦截', offlinePolicy.allows('http://20.200.174.87:8090/attchs/a.png') === false)

  /* ---------- 2. DOM 归一化 ---------- */
  const normalized = pkg.normalizeVditorHtml(FIXTURE)
  const box = document.createElement('div')
  box.innerHTML = normalized.html
  check('转换标记', normalized.converted === true)
  check('报告来源', normalized.report.source === 'vditor')

  const inlineMath = box.querySelectorAll('span[data-type="inline-math"]')
  const blockMath = box.querySelectorAll('div[data-type="block-math"]')
  check('行内公式 1 个', inlineMath.length === 1)
  check('行内公式 latex 正确', inlineMath[0] && inlineMath[0].getAttribute('data-latex') === 'E=mc^2')
  check('块公式 1 个', blockMath.length === 1)
  check('块公式 latex 正确', blockMath[0] && blockMath[0].getAttribute('data-latex') === '\\int_a^b f(x)dx')
  check('公式计数', normalized.report.inlineMath === 1 && normalized.report.blockMath === 1 && normalized.report.math === 2)

  check('生成 taskList', box.querySelectorAll('ul[data-type="taskList"]').length === 1)
  check('生成 taskItem', box.querySelectorAll('li[data-type="taskItem"]').length === 2)
  check('勾选状态保留', box.querySelectorAll('li[data-checked="true"]').length === 1
    && box.querySelectorAll('li[data-checked="false"]').length === 1)
  check('隐藏复选框已移除', box.querySelectorAll('input[type="checkbox"]').length === 0)
  check('普通列表项留在原列表', /普通列表项/.test(box.innerHTML) && box.querySelectorAll('ul:not([data-type]) li').length === 1)
  check('任务项补段落', box.querySelectorAll('li[data-type="taskItem"] > p').length === 2)

  check('图表降级为代码块', box.querySelectorAll('pre > code.language-mermaid').length === 1)
  const mermaid = box.querySelector('pre > code.language-mermaid')
  check('图表源码保留换行', Boolean(mermaid) && mermaid.textContent.indexOf('\n') !== -1, mermaid && JSON.stringify(mermaid.textContent))
  check('图表实体已解码', Boolean(mermaid) && mermaid.textContent.indexOf('A --> B') !== -1)
  check('echarts 降级为代码块', box.querySelectorAll('pre > code.language-echarts').length === 1)
  check('图表计数', normalized.report.diagram === 2)
  check('原生代码块保留', Boolean(box.querySelector('pre > code.language-js')))

  const header = box.querySelector('th')
  const cell = box.querySelector('td')
  check('表头列宽均分', Boolean(header) && header.getAttribute('colwidth') === '360')
  check('单元格列宽均分', Boolean(cell) && cell.getAttribute('colwidth') === '360')
  check('单元格补段落', Boolean(box.querySelector('td > p')))
  check('表格计数', normalized.report.table === 1)

  check('脚注上标去掉死链', box.querySelectorAll('sup.footnotes-ref').length === 0
    && box.querySelectorAll('a[href^="#footnotes"]').length === 0)
  check('脚注上标数字保留', Array.from(box.querySelectorAll('sup')).some((node) => node.textContent.trim() === '1'))
  check('脚注定义区已拆壳', box.querySelectorAll('.footnotes-defs-div').length === 0 && /脚注内容/.test(box.innerHTML))
  check('脚注回跳箭头已移除', box.innerHTML.indexOf('↩') === -1)
  check('脚注计数', normalized.report.footnote === 1)

  check('[TOC] 已移除', box.innerHTML.indexOf('[TOC]') === -1)
  check('[TOC] 计入 dropped', normalized.report.dropped.indexOf('toc') !== -1)

  check('媒体降级为链接段落', /Vditor 媒体/.test(box.innerHTML) && Boolean(box.querySelector('a[href*="v.mp4"]')))
  check('vditor 类名已清理', !/vditor-/.test(box.innerHTML))
  check('内部 data 属性已清理', !/data-block|data-marker/.test(box.innerHTML))

  /* ---------- 2.1 幂等 ---------- */
  const again = pkg.normalizeVditorHtml(normalized.html)
  check('二次归一化不再转换', again.converted === false && again.html === normalized.html)

  /* ---------- 2.2 嵌套清单 ---------- */
  const nested = pkg.normalizeVditorHtml('<ul><li class="vditor-task"><input type="checkbox" /> 父项'
    + '<ul><li class="vditor-task"><input type="checkbox" /> 子项</li></ul></li></ul>')
  const nestedBox = document.createElement('div')
  nestedBox.innerHTML = nested.html
  check('嵌套任务项首子节点为段落', Boolean(nestedBox.querySelector('li[data-type="taskItem"] > p')))
  check('嵌套子清单保留', nestedBox.querySelectorAll('li[data-type="taskItem"] ul[data-type="taskList"]').length === 1)

  /* ---------- 3. 端到端：真实编辑器 ---------- */
  const host = document.getElementById('editor')
  const reports = []
  const doc = new pkg.LarkDoc({
    element: host,
    content: FIXTURE,
    storage: 'none',
    onImportReport: (report) => reports.push(report),
  })

  await delay(1500)

  const json = doc.getJSON()
  check('编辑器挂载成功', Boolean(json && json.type === 'doc'))
  check('导入报告回调触发', reports.length === 1, JSON.stringify(reports.length))
  check('导入报告来源正确', reports[0] && reports[0].source === 'vditor')

  if (json) {
    const taskLists = collect(json, 'taskList')
    const taskItems = collect(json, 'taskItem')
    const inline = collect(json, 'inlineMath')
    const block = collect(json, 'blockMath')
    const tables = collect(json, 'table')
    const codeBlocks = collect(json, 'codeBlock')
    const images = collect(json, 'image')
    const rules = collect(json, 'horizontalRule')
    const headings = collect(json, 'heading')
    const texts = []
    walk(json, (node) => { if (node.type === 'text') texts.push(node.text) })
    const plain = texts.join('')

    check('JSON 含 taskList', taskLists.length === 1)
    check('JSON 含 2 个 taskItem', taskItems.length === 2)
    check('taskItem.checked 正确', taskItems.some((node) => node.attrs.checked === true)
      && taskItems.some((node) => node.attrs.checked === false))
    check('JSON 含行内公式', inline.length === 1 && inline[0].attrs.latex === 'E=mc^2')
    check('JSON 含块公式', block.length === 1 && block[0].attrs.latex === '\\int_a^b f(x)dx')
    check('JSON 含 table', tables.length === 1)
    check('列宽进入 JSON', JSON.stringify(tables[0] || {}).indexOf('360') !== -1)
    check('JSON 含 mermaid 代码块', codeBlocks.some((node) => node.attrs.language === 'mermaid'))
    check('mermaid 源码完整', codeBlocks.some((node) => JSON.stringify(node).indexOf('graph TD') !== -1))
    check('JSON 含 image', images.length === 1)
    check('image 默认 http 直连', images[0] && String(images[0].attrs.src).indexOf('http://20.200.174.87:8090/attchs/a.png') === 0)
    check('image 未被降级为占位', images[0] && !/^data:image\/gif/i.test(String(images[0].attrs.src)))
    check('JSON 含 horizontalRule', rules.length === 2)
    check('JSON 含标题', headings.length >= 2)
    check('正文文本完整', ['一级标题', '普通列表项', '脚注内容', '甲', '引用内容'].every((text) => plain.indexOf(text) !== -1))
  }

  const html = doc.getHTML()
  check('导出 HTML 无 vditor 残留', !/vditor-/.test(html))
  check('导出 HTML 保留任务列表', /data-type="taskList"/.test(html))
  check('导出 HTML 保留公式契约', /data-type="inline-math"/.test(html))
  check('导出 HTML 保留公式源码', /data-latex="E=mc\^2"/.test(html))
  check('导入报告可从实例读取', Boolean(doc.getImportReport() && doc.getImportReport().taskItem === 2))

  /* ---------- 4. 图表直接渲染（默认预览，无需切换） ---------- */
  await delay(1200)
  const firstBlock = host.querySelector('.lark-doc-code')
  const previewBoxDefault = firstBlock.querySelector('.lark-doc-diagram')
  check('图表块默认渲染预览（无需切换）', Boolean(previewBoxDefault))
  check('预览层不可编辑', Boolean(previewBoxDefault) && previewBoxDefault.getAttribute('contenteditable') === 'false')
  const codeBody = firstBlock.querySelector('.lark-doc-code-body')
  // jsdom 无真实布局，common.js 内联构建下 mermaid 会真正执行并渲染失败 → 错误态。
  // 错误态按设计显示源码区 + 错误提示（便于修错）；渲染成功路径由 verify-browser-mermaid.js 在真浏览器验证。
  check('渲染失败显错提示（jsdom 无布局，成功路径见浏览器断言）', Boolean(firstBlock.querySelector('.lark-doc-diagram-error')))
  check('错误态源码区可见（便于修错）', Boolean(codeBody) && codeBody.style.display !== 'none')
  const blockButtons = () => Array.from(firstBlock.querySelectorAll('.lark-doc-code-toolbar button')).map((button) => button.textContent.trim())
  check('图表块出现「编辑源码」按钮', blockButtons().indexOf('编辑源码') !== -1)
  check('图表块隐藏语言下拉（独立外观，不与代码框共用）', firstBlock.querySelectorAll('.lark-doc-code-toolbar select').length === 0 && firstBlock.querySelectorAll('.lark-doc-code-toolbar .lark-doc-select').length === 0)
  check('图表块携带独立外观类', firstBlock.className.indexOf('lark-doc-code-diagram') !== -1)
  // 代码块语言下拉：阶段 2 起由 core 的纯 DOM NodeView 自绘，形态是**原生 <select>**
  // （R1 禁止 core 引 `.vue`，原来的 `LarkDocSelect.vue` 换成原生 select，样式由
  // `code-block.css` 里早已存在的 select 规则承接），所以这里直接读 options 清单。
  const langSelect = host.querySelector('.lark-doc-code-toolbar select[aria-label="代码语言"]')
  check('代码块使用原生语言下拉', Boolean(langSelect))
  const langMenuItems = langSelect
    ? Array.from(langSelect.options).map((option) => option.textContent.trim())
    : []
  check('语言下拉含 Mermaid 图表项', langMenuItems.some((text) => text.indexOf('Mermaid 图表') !== -1))
  let blockButton = Array.from(firstBlock.querySelectorAll('.lark-doc-code-toolbar button')).find((button) => button.textContent.trim() === '编辑源码')
  if (blockButton) blockButton.click()
  await delay(100)
  check('切换后显示源码区', Boolean(codeBody) && codeBody.style.display !== 'none' && firstBlock.querySelectorAll('.lark-doc-diagram').length === 0)
  blockButton = Array.from(firstBlock.querySelectorAll('.lark-doc-code-toolbar button')).find((button) => button.textContent.trim() === '预览图表')
  check('切换后按钮变「预览图表」', Boolean(blockButton))
  if (blockButton) blockButton.click()
  await delay(300)
  check('切回预览后预览层重建', Boolean(codeBody) && Boolean(firstBlock.querySelector('.lark-doc-diagram')))
  check('切回预览后错误态保持（源码仍可见，jsdom 无布局）',
    Boolean(firstBlock.querySelector('.lark-doc-diagram-error')) && codeBody.style.display !== 'none')
  // 新契约：mermaid 走动态 import()（构建工具接管寻址），不再手动注入 <script> 标签。
  check('渲染走动态 import（无 script 注入）', !document.querySelector('script[data-lark-doc-diagram="mermaid"]'))

  /* ---------- 4.5 「图表」插入命令 ---------- */
  const bundle = require('fs').readFileSync(require('path').join(__dirname, '../dist/lark-doc.common.js'), 'utf8')
  check('mermaid 内联进 common 包（内网零外链）', bundle.indexOf('flowchart-v2') !== -1)
  check('命令清单含「图表」插入项', /id:\s*'diagram'/.test(bundle))
  check('插入命令携带 mermaid 示例源码', bundle.indexOf('A[开始]') !== -1)

  /* ---------- 5. importVditor 强制归一化 + 普通内容回归 ---------- */
  const forced = doc.importVditor('<ul><li class="vditor-task"><input type="checkbox" disabled />强制导入</li></ul>')
  check('importVditor 返回 true', forced === true)
  await delay(200)
  const itemsAfter = collect(doc.getJSON(), 'taskItem')
  check('importVditor 生效', itemsAfter.length === 1 && itemsAfter[0].attrs.checked === false)

  doc.setContent('<h2>新的普通内容</h2>')
  await delay(200)
  check('普通 setContent 未被改写', /新的普通内容/.test(doc.getText()) && !/vditor/.test(doc.getHTML()))

  doc.destroy()
  check('销毁后移除 DOM', host.children.length === 0)

  /* ---------- 6. features.diagram: false 关闭图表 ---------- */
  // 渲染走动态 import（common.js 下内联同步执行），新实例关闭 features.diagram 后不应触发任何渲染副作用。
  const host2 = document.createElement('div')
  document.body.appendChild(host2)
  const doc2 = new pkg.LarkDoc({
    element: host2,
    content: '<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>',
    storage: 'none',
    features: { diagram: false },
  })
  await delay(1200)
  const buttons2 = Array.from(host2.querySelectorAll('.lark-doc-code-toolbar button')).map((button) => button.textContent.trim())
  check('关闭 features.diagram 无预览按钮', buttons2.indexOf('预览图表') === -1)
  check('关闭后无预览层', host2.querySelectorAll('.lark-doc-diagram').length === 0)
  const langSelect2 = Array.from(host2.querySelectorAll('.lark-doc-code-toolbar .lark-doc-select'))
    .find((node) => node.querySelector('[aria-label="代码语言"]'))
  const langTrigger2 = langSelect2 && langSelect2.querySelector('.lark-doc-select-trigger')
  if (langTrigger2) langTrigger2.click()
  await delay(60)
  const langMenuItems2 = Array.from(host2.querySelectorAll('.lark-doc-select-menu button')).map((button) => button.textContent.trim())
  check('关闭后下拉无 Mermaid 图表功能项', langMenuItems2.every((text) => text.indexOf('Mermaid 图表') === -1))
  check('关闭后无 mermaid 渲染痕迹（无 SVG / 错误态）', host2.querySelectorAll('.lark-doc-diagram-svg, .lark-doc-diagram-error, .lark-doc-diagram-status').length === 0)
  doc2.destroy()
  check('第二个实例销毁', host2.children.length === 0)

  /* ---------- 汇总 ---------- */
  if (failures.length) {
    console.error(`\n✗ Vditor 兼容检查失败 ${failures.length}/${checks.length}`)
    failures.forEach((item) => console.error(`  - ${item}`))
    process.exit(1)
  }
  console.log(`✓ Vditor 兼容检查通过（${checks.length} 项）`)
  process.exit(0)
}

main().catch((error) => {
  console.error('检查脚本异常：', error && error.stack ? error.stack : error)
  process.exit(1)
})
