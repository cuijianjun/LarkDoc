/**
 * 压缩 lib 产物（dist/lark-doc.common.js）。
 *
 * 为什么要单独做这一步
 * --------------------
 * `@vue/cli-service` 的 lib 构建只在 postfix 里带 `.min` 时才压缩
 * （`resolveLibConfig.js`：`--formats commonjs` 会走 `optimization.minimize(false)`），
 * 所以 `--formats commonjs` 出来的产物是**未压缩明文**：webpack 模块注释、原始缩进、
 * 完整的 mermaid 源码全在里面，8.7 MB / 11 万行。
 *
 * 这个形态有两个实际代价：
 *   1. npm 包体积与安装/解包时间（内网离线包 `pack:intranet` 直接把 dist 打包）；
 *   2. 宿主的 `require` 解析成本 —— 11 万行明文要过一遍 V8 解析。
 *
 * 压缩**不是**为了过 size-limit 的数字游戏：budget 一个字没动，改的是产物本身。
 *
 * 顺序很重要
 * ----------
 * 必须排在 `fix-lib-require-scope.js` **之后**：
 *   - 改名前压缩，会让那个脚本的字符串查找命中压缩后的形态，改名规则（`__webpack_require__`）
 *     与产物形态耦合，容易改错；
 *   - 改名后压缩，内层 runtime 标识符会被 mangle 成短名，`__webpack_require__` 的**名字冲突**
 *     这个根因随之消失（外层注入的调用沿作用域链落到宿主 runtime，正是期望行为）。
 *
 * 两个约束
 * --------
 *   1. `format.quote_style = 3`（**保留原始引号**）。这一档不是随手选的，实测过三档：
 *        - `1`（优先单引号）：把 `require("vue/dist/vue.runtime.common.js")` 改写成单引号，
 *          而那一行是宿主的改写锚点（`docs/guide/getting-started.md` 的公开契约），
 *          双引号形态一变，宿主按文本改写就会落空 —— 本轮第一次跑这个脚本正是死在这里；
 *        - `2`（优先双引号）：反过来把 `id: 'diagram'` 改成双引号，
 *          `scripts/check-vditor-html.js` 的既有断言形态被动变化；
 *        - `3`（原始引号）：`require("…")` 保持双、`id: 'diagram'` 保持单，两边都不动。
 *      选 3 之后，「压缩」这件纯体积的事不再顺带改变任何字符串字面量的书写形态。
 *   2. 不做 `mangle.toplevel` / `mangle.properties`：公共面靠 `module.exports` 上的属性名
 *      承载（`pkg.LarkDoc` / `pkg.createEditor` …），属性名与顶层名一律不动。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIST = path.resolve(__dirname, '../dist')
const TARGET = path.join(DIST, 'lark-doc.common.js')
// 外部依赖调用必须原样保留：宿主 bundler 靠改写这一行把 vue 换成自己的 runtime。
const EXTERNAL_REQUIRE = 'require("vue/dist/vue.runtime.common.js")'
// 守卫用的宽松版：只认「调的是哪个模块」，不把引号风格写进判定条件。
// 这样即使将来 quote_style 被改，报错信息也能说清「是丢了调用」还是「只是换了引号」。
const EXTERNAL_REQUIRE_RE = /require\(\s*(['"])vue\/dist\/vue\.runtime\.common\.js\1\s*\)/g

const countExternalRequire = (text) => (text.match(EXTERNAL_REQUIRE_RE) || []).length

const gzipBytes = (text) => zlib.gzipSync(Buffer.from(text), { level: 9 }).length
const kb = (bytes) => (bytes / 1000).toFixed(2) + ' kB'

async function main() {
  if (!fs.existsSync(TARGET)) {
    console.error('[minify-lib-cjs] 缺少产物：' + TARGET)
    process.exit(1)
  }
  const { minify } = require('terser')
  const source = fs.readFileSync(TARGET, 'utf8')

  const beforeCount = countExternalRequire(source)
  if (beforeCount !== 1) {
    console.error(
      '[minify-lib-cjs] 压缩前 vue 外部依赖调用应恰好 1 处，实际 ' + beforeCount + ' 处，产物形态可能已变，请人工确认'
    )
    process.exit(1)
  }
  if (source.indexOf(EXTERNAL_REQUIRE) === -1) {
    console.error(
      '[minify-lib-cjs] 压缩前 vue 外部依赖调用不是 ' + EXTERNAL_REQUIRE + ' 的原样形态，' +
      '宿主改写锚点已变，请人工确认'
    )
    process.exit(1)
  }

  const before = { raw: Buffer.byteLength(source), gzip: gzipBytes(source) }
  const started = Date.now()
  const result = await minify(source, {
    compress: {
      passes: 2,
      // 语义保持的一批（与 vue.config.js 里 terser 块同口径），不碰 pure_getters / unsafe*。
      toplevel: false,
      reduce_vars: true,
      collapse_vars: true,
      reduce_funcs: true,
      inline: 2,
      hoist_funs: true,
      hoist_props: true,
      properties: true,
      comparisons: true,
      sequences: true,
      negate_iife: true,
      loops: true,
      switches: true,
      arrows: true,
      computed_props: true,
      typeofs: true,
      pure_funcs: ['console.log', 'console.debug', 'console.info'],
    },
    mangle: { toplevel: false },
    format: { comments: false, quote_style: 3 },
    ecma: 2015,
    sourceMap: false,
  })

  if (!result || typeof result.code !== 'string' || !result.code.length) {
    console.error('[minify-lib-cjs] terser 没有产出代码')
    process.exit(1)
  }
  const afterCount = countExternalRequire(result.code)
  if (afterCount !== 1) {
    console.error(
      '[minify-lib-cjs] 压缩后 vue 外部依赖调用应恰好 1 处，实际 ' + afterCount + ' 处，拒绝写入产物'
    )
    process.exit(1)
  }
  if (result.code.indexOf(EXTERNAL_REQUIRE) === -1) {
    const actual = result.code.match(EXTERNAL_REQUIRE_RE)[0]
    console.error(
      '[minify-lib-cjs] 压缩后 vue 外部依赖调用仍在，但形态被改写：' + actual + '\n' +
      '  宿主 bundler 按 ' + EXTERNAL_REQUIRE + ' 原样比对，引号变了就会落空。\n' +
      '  请把本脚本的 format.quote_style 保持为 3（保留原始引号）。'
    )
    process.exit(1)
  }
  // 压缩必须真的变小，否则说明选项失效（例如被上游改成已压缩），宁可报错也不写回。
  if (result.code.length >= source.length) {
    console.error('[minify-lib-cjs] 压缩后体积没有下降（' + source.length + ' → ' + result.code.length + '），拒绝写入')
    process.exit(1)
  }

  fs.writeFileSync(TARGET, result.code)
  const after = { raw: Buffer.byteLength(result.code), gzip: gzipBytes(result.code) }
  const pct = (a, b) => (((a - b) / a) * 100).toFixed(1) + '%'
  console.log(
    '[minify-lib-cjs] ' + (Date.now() - started) + ' ms，' +
    'raw ' + kb(before.raw) + ' → ' + kb(after.raw) + '（-' + pct(before.raw, after.raw) + '），' +
    'gzip ' + kb(before.gzip) + ' → ' + kb(after.gzip) + '（-' + pct(before.gzip, after.gzip) + '）'
  )
}

main().catch((error) => {
  console.error('[minify-lib-cjs] 压缩失败：' + (error && error.stack ? error.stack : error))
  process.exit(1)
})
