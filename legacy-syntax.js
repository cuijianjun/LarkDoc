/**
 * webpack 4 的 acorn 读不了的 ES2020+ 语法，对应的 babel 转换插件。
 *
 * 两处消费：
 * - babel.config.js —— 包内源码与 node_modules（transpileDependencies: true）
 * - vue.config.js   —— src/assets/vendor 下的预构建 UMD（mermaid），它为了躲开
 *   core-js 注入刻意不走 js rule，所以语法降级得单独挂一条 loader
 *
 * 只做语法转换，不带 targets / core-js：体积只涨 helper 那一点。
 * 需要同步升级时改这里一处即可。
 */
module.exports = [
  // a?.b / a?.[b] / a?.()
  require.resolve('@babel/plugin-transform-optional-chaining'),
  // a ?? b
  require.resolve('@babel/plugin-transform-nullish-coalescing-operator'),
  // a ??= b / a ||= b / a &&= b
  require.resolve('@babel/plugin-transform-logical-assignment-operators'),
  // 1_000_000
  require.resolve('@babel/plugin-transform-numeric-separator'),
  // try { … } catch { … }（省略绑定名，ES2019）
  require.resolve('@babel/plugin-transform-optional-catch-binding'),
  // class A { x = 1; static y = 2; #p = 3 }
  require.resolve('@babel/plugin-transform-class-properties'),
  require.resolve('@babel/plugin-transform-private-methods'),
]
