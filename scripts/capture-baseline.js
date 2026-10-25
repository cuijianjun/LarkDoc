'use strict'

/**
 * 抓取 P0「重构前」基线 —— 三个后续任务各自要比对的原点。
 *
 *   node scripts/capture-baseline.js schema   # test/fixtures/schema-v1.json
 *   node scripts/capture-baseline.js legacy   # test/fixtures/legacy/document-v1.json
 *   NODE_PATH=<playwright-core 所在 node_modules> \
 *     node scripts/capture-baseline.js dom    # test/fixtures/editor-dom-before.html
 *
 * 三条都走真实运行：schema 由 getSchema() 序列化，legacy 正文由 schema 往返
 * 校验后落盘，DOM 由真实浏览器渲染后抓 outerHTML。禁止手填任何数字。
 */

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const sourceRoot = path.join(root, 'src')
const fixtures = path.join(root, 'test', 'fixtures')

/**
 * src 是 ESM，Node 直接 require 不了。这里复用既存 check 脚本的装法：
 * 只对 src 下的文件挂 babel CJS 变换，其余一律走原生 loader。
 */
function loadSource() {
  const { transformSync } = require(path.join(root, 'node_modules/@babel/core'))
  const originalLoader = require.extensions['.js']
  require.extensions['.js'] = (module, filename) => {
    if (!filename.startsWith(sourceRoot + path.sep)) return originalLoader(module, filename)
    const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
      babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
    })
    module._compile(code, filename)
  }
  return require(path.join(sourceRoot, 'components/lark-doc/extensions.js'))
}

function openSchema() {
  const { createLarkDocExtensions } = loadSource()
  const { getSchema } = require(path.join(root, 'node_modules/@tiptap/core'))
  return getSchema(createLarkDocExtensions())
}

// schema 序列化口径在 scripts/lib/schema-contract.js（与单测快照守卫共用）。
const { serializeMap } = require('./lib/schema-contract')

function captureSchema() {
  const schema = openSchema()
  const payload = {
    $comment: [
      'P0 重构前 schema 快照。生成：node scripts/capture-baseline.js schema（getSchema(createLarkDocExtensions())）。用于 Task 4「schema 逐字节不变」比对。',
      '盲区声明（比对的是结构契约，不是行为契约）：① parseHTML / renderHTML / addNodeView /',
      'parse LaTeX 等函数行为不进快照——两份 schema 即使 JSON 相同，函数仍可能不同；',
      '② attrs default 为函数或不可 JSON 化的值时，这里只落 `<type>` 占位符；',
      '③ marks 谓词只存名字数组，谓词语义不校验。若 Task 4 需要比对这些，另行加行为级用例。',
    ].join('\n   '),
    topNode: schema.spec.topNode,
    nodes: serializeMap(schema.spec.nodes),
    marks: serializeMap(schema.spec.marks),
  }
  const target = path.join(fixtures, 'schema-v1.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`写入 ${path.relative(root, target)}：${Object.keys(payload.nodes).length} 节点 / ${Object.keys(payload.marks).length} mark`)
}

/**
 * 手工构造的 v1 正文候选：覆盖老文档最常见的五类块。
 * 写盘前先过一遍真实 schema（nodeFromJSON → toJSON），因此产物天然 round-trip 无损，
 * 且是"浏览器里 getJSON() 出来的样子"（全部 attrs 显式）。
 */
function legacyCandidate() {
  const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
  const p = (text, attrs) => ({ type: 'paragraph', attrs: { indent: 0, ...(attrs || {}) }, content: text ? [t(text)] : [] })
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, indent: 0, numbering: true, numberingStart: 1 }, content: [t('P0 架构缝回归样例')] },
      {
        type: 'paragraph', attrs: { indent: 0 }, content: [
          t('普通正文，后面依次叠加行内样式：'),
          t('加粗', [{ type: 'bold' }]),
          t('斜体', [{ type: 'italic' }]),
          t('下划线', [{ type: 'underline' }]),
          t('删除线', [{ type: 'strike' }]),
          t('行内代码', [{ type: 'code' }]),
          t('上标', [{ type: 'superscript' }]),
          t('下标', [{ type: 'subscript' }]),
          t('黄色高亮', [{ type: 'highlight', attrs: { color: '#ffdd00' } }]),
          t('红色前景', [{ type: 'textStyle', attrs: { color: '#d83931' } }]),
          t('链接', [{ type: 'link', attrs: { href: 'https://example.com/lark-doc', title: '示例标题' } }]),
        ],
      },
      { type: 'paragraph', attrs: { indent: 2 }, content: [t('缩进两级的一段。')] },
      { type: 'heading', attrs: { level: 2 }, content: [t('列表')] },
      {
        type: 'bulletList', attrs: {}, content: [
          { type: 'listItem', attrs: {}, content: [p('无序列表第一项')] },
          { type: 'listItem', attrs: {}, content: [p('无序列表第二项'), { type: 'bulletList', attrs: {}, content: [{ type: 'listItem', attrs: {}, content: [p('嵌套无序项')] }] }] },
        ],
      },
      {
        type: 'orderedList', attrs: { start: 1, continueFrom: false }, content: [
          { type: 'listItem', attrs: {}, content: [p('有序列表第一项')] },
          { type: 'listItem', attrs: {}, content: [p('有序列表第二项')] },
          { type: 'listItem', attrs: { numberStart: 1 }, content: [p('有序列表：从这里重新开局'), { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', attrs: {}, content: [p('嵌套有序项')] }] }] },
        ],
      },
      {
        type: 'taskList', attrs: {}, content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p('已完成的任务')] },
          { type: 'taskItem', attrs: { checked: false }, content: [p('未完成的任务')] },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [t('表格')] },
      {
        type: 'table', attrs: {}, content: [
          {
            type: 'tableRow', attrs: {}, content: [
              { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [160, 160, 160] }, content: [p('列一')] },
              { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p('列二')] },
              { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p('列三')] },
            ],
          },
          {
            type: 'tableRow', attrs: {}, content: [
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p('A1')] },
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, textAlign: 'center' }, content: [p('B1')] },
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, backgroundColor: '#f0f2f5' }, content: [p('C1'), { type: 'paragraph', attrs: { indent: 0 }, content: [t('带'), t('加粗', [{ type: 'bold' }])] }] },
            ],
          },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [t('折叠')] },
      {
        type: 'details', attrs: { open: true }, content: [
          { type: 'detailsSummary', attrs: {}, content: [t('折叠块标题（点标题收起/展开）')] },
          { type: 'detailsContent', attrs: {}, content: [p('折叠内容第一段。'), p('折叠内容第二段。')] },
        ],
      },
      {
        type: 'details', attrs: { open: false }, content: [
          { type: 'detailsSummary', attrs: {}, content: [t('默认收起的折叠块')] },
          { type: 'detailsContent', attrs: {}, content: [p('收起时正文仍在 JSON 里，不能丢。')] },
        ],
      },
    ],
  }
}

function captureLegacy() {
  const schema = openSchema()
  const json = schema.nodeFromJSON(legacyCandidate()).toJSON()
  // 自检：round-trip 必须逐字节稳定，否则后面 Task 4 的比对没有意义。
  const roundTrip = schema.nodeFromJSON(JSON.parse(JSON.stringify(json))).toJSON()
  if (JSON.stringify(roundTrip) !== JSON.stringify(json)) throw new Error('legacy 正文 round-trip 不稳定')
  const kinds = new Set()
  const walk = (node) => { kinds.add(node.type); (node.content || []).forEach(walk) }
  walk(json)
  const target = path.join(fixtures, 'legacy', 'document-v1.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`写入 ${path.relative(root, target)}：${Array.from(kinds).sort().join(' ')}`)
}

/**
 * DOM 快照的抓取与归一化实现在 scripts/lib/dom-capture.js
 * （与只读快照 scripts/snapshot-dom.js 共用同一套，保证比对口径一致）。
 */
function captureDom() {
  const { captureNormalizedDom } = require('./lib/dom-capture')
  return captureNormalizedDom(process.argv[3] || 'http://localhost:8080/lark-doc').then((html) => {
    const target = path.join(fixtures, 'editor-dom-before.html')
    fs.writeFileSync(target, `${html}\n`)
    console.log(`写入 ${path.relative(root, target)}：${html.length} 字符`)
  })
}

const command = process.argv[2]
const commands = { schema: captureSchema, legacy: captureLegacy, dom: captureDom }
if (!commands[command]) {
  console.error('用法：node scripts/capture-baseline.js schema|legacy|dom')
  process.exit(1)
}
const result = commands[command]()
Promise.resolve(result).catch((error) => { console.error(error); process.exit(1) })
