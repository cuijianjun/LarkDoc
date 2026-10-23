/**
 * 给 lib 产物（dist/lark-doc.common.js）内层 webpack runtime 的标识符加包前缀。
 *
 * 要修的问题
 * ----------
 * lib 产物是「自带一份 webpack runtime 的单文件 CJS」。它把 Vue 留给宿主，产物里因此有一条
 * 真实的外部依赖调用：
 *
 *     module.exports = require("vue/dist/vue.runtime.common.js");
 *
 * 使用方（webpack4 / webpack5 / rollup commonjs 等）会把这条 require 改写成
 * 自己 runtime 的调用形式，webpack4 dev 下即：
 *
 *     __webpack_require__("./node_modules/vue/dist/vue.runtime.common.js")
 *
 * 改写是就地替换文本，而这段代码位于 lib 内部 IIFE 里。IIFE 内已经存在同名函数
 * `function __webpack_require__(moduleId)`，于是这个调用被内层 runtime 捕获，它去自己的
 * 模块表里查一个外层的字符串 id，查不到 → undefined → 调 .call 时抛：
 *
 *     TypeError: Cannot read properties of undefined (reading 'call')
 *
 * 表现就是整包在 webpack4 使用方里一 require 就崩（页面白屏 / 路由被踢回首页）。
 * 而它在 Node 里 require 是正常的——Node 没有改写这一步，掩盖了问题。
 *
 * 修法
 * ----
 * 把内层 runtime 的标识符统一改名（加 `__larkDoc` 前缀）。改名后使用方注入的
 * `__webpack_require__(id)` 不再被内层捕获，而是沿作用域链落到使用方自己的 runtime 上，
 * 也就是本来期望的行为。内层 runtime 内部引用同步改名，产物仍然自洽。
 *
 * 只处理 lib 产物：UMD 的外部依赖在工厂函数参数里（顶层，不在内层 IIFE 作用域内），
 * 本来就正常。
 */
const fs = require('fs')
const path = require('path')

const DIST = path.resolve(__dirname, '../dist')
const TARGET = path.join(DIST, 'lark-doc.common.js')

// 只需要改 __webpack_require__：它就是使用方改写 require 时注入的那个名字。
// __webpack_modules__ / __webpack_module_cache__ 只在 IIFE 内部被引用，不会被外部注入，
// 保持原样以免多改多错。
const RENAMES = [
  ['__webpack_require__', '__larkDocRequire__'],
]

if (!fs.existsSync(TARGET)) {
  console.error('[fix-lib-require-scope] 缺少产物：' + TARGET)
  process.exit(1)
}

let code = fs.readFileSync(TARGET, 'utf8')
const before = code.length

let renamed = 0
for (const [from, to] of RENAMES) {
  const hits = code.split(from).length - 1
  if (hits === 0) continue
  code = code.split(from).join(to)
  renamed += hits
}

// 外部依赖调用必须原样保留：它就是留给使用方去改写的入口。
const externalKept = /module\.exports = require\("vue\/dist\/vue\.runtime\.common\.js"\)/.test(code)

if (!externalKept) {
  console.error('[fix-lib-require-scope] 没找到 vue 外部依赖调用，产物形态可能已变，请人工确认')
  process.exit(1)
}

fs.writeFileSync(TARGET, code)

// 改完必须保证内层不再残留旧标识符，否则等于没修。
const leftover = RENAMES.filter(([from]) => code.includes(from)).map(([from]) => from)
if (leftover.length) {
  console.error('[fix-lib-require-scope] 残留未改名标识符：' + leftover.join(', '))
  process.exit(1)
}

console.log(
  '[fix-lib-require-scope] 内层 runtime 标识符改名 ' + renamed + ' 处，' +
  (before / 1024 / 1024).toFixed(2) + ' MB 产物已就绪'
)
