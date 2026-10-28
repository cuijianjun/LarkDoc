/**
 * 三份 babel 口径，靠环境变量切换：
 *
 * - 默认（esm / cjs / 开发）：只走 @vue/cli-plugin-babel 的 preset，按 browserslist
 *   （>0.5% / last 2 versions / not dead）推导目标。「not dead」已经把不支持
 *   `?.` / `??` 的浏览器排除干净，所以现代产物里这两个语法会原样保留 —— 这是想要的：
 *   现代宿主拿到的代码最短。
 *
 * - LARK_DOC_LEGACY=1（umd / element / adapters）：额外把 ES2020+ 语法降级到 ES2018。
 *   原因是 UMD 产物的消费者不一定是现代浏览器 —— 大量内网宿主还在 webpack 4，
 *   而 webpack 4 内置的 acorn 解析不了 `?.` / `??`，`import { LarkDoc } from 'lark-doc'`
 *   会直接报 "Module parse failed: Unexpected token"。
 *
 *   这里刻意**只加语法转换插件、不改 targets**：
 *   改 targets 会让 @babel/preset-env 的 useBuiltIns: 'usage' 按老浏览器补一堆
 *   core-js polyfill，产物体积会涨 30% 以上；而 webpack 4 卡住的只是「解析」，不是
 *   「运行时缺少 API」。只降语法，体积只涨 helper 的那一点（实测压缩后 ~1%）。
 *
 * - LARK_DOC_NO_POLYFILL=1（adapters 薄壳）：关掉 preset 的 polyfill 注入。
 *   原因很具体：@vue/babel-preset-app 在 app 模式下会无条件塞 4 个「默认可依赖」
 *   polyfill（es.promise / es.array.iterator / es.object.assign / es.promise.finally），
 *   因为是给「第三方依赖可能用到」兜底的。薄壳只有几 KB 源码、一个第三方依赖都没有，
 *   注入后产物从 ~5 KiB 涨到 34 KiB —— 全是 core-js 的 Symbol / Iterator / Promise 链。
 *   薄壳的目标环境是现代宿主（Vue 3 / React 18 的构建器），这些 API 全都不用兜底。
 */
const LEGACY = process.env.LARK_DOC_LEGACY === '1'
const NO_POLYFILL = process.env.LARK_DOC_NO_POLYFILL === '1'

module.exports = {
  presets: NO_POLYFILL
    ? [['@vue/cli-plugin-babel/preset', { useBuiltIns: false }]]
    : ['@vue/cli-plugin-babel/preset'],
  plugins: LEGACY ? require('./legacy-syntax') : [],
}
