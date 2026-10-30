'use strict'

const path = require('path')

// ESM 单测直接读取源码时也要复用 Vue CLI 的构建期别名。
const mermaidVendor = path.resolve(__dirname, 'src/assets/vendor/mermaid/mermaid.min.js')
const katexCss = path.resolve(__dirname, 'node_modules/katex/dist/katex.min.css')

/**
 * 单元测试门禁配置。
 *
 * environment 刻意用 node：P0 要守卫的是 core 的依赖闭包，浏览器行为由
 * scripts/verify-browser-*.js 十套断言负责，这里不需要 jsdom，也不该让
 * 单测因为 DOM 而变慢。未来若某个用例真要 DOM，在文件头打
 * `// @vitest-environment jsdom` 覆盖即可。
 *
 * 用 CJS 导出而不用 `defineConfig`：package.json 没有 "type": "module"，
 * `.js` 里的 ESM 语法会让 Vite 打印 configLoader 弃用告警，而 `npm run check`
 * 要求 0 warning。
 *
 * @type {import('vitest/config').UserConfig}
 */
/**
 * 显式拒载 src/ 下的 .vue：core 的依赖闭包不允许出现 Vue 组件，Node 单测
 * 永远不该 import 到 .vue。若未来某个测试真的踩进来，宁可在这里给出一句
 * 可读的门禁报错，也不要让 vite 抛「Unexpected token <」这种无法定位的错。
 */
function forbidVueImports() {
  return {
    name: 'forbid-vue-imports',
    load(id) {
      if (id.endsWith('.vue') && id.includes(`${path.sep}src${path.sep}`)) {
        throw new Error(`[P0 门禁] 单测闭包引用了 ${id}\n` +
          'core 不得依赖 .vue 组件；请让测试只 import core 模块（extensions/registry/documentOperations 等）。')
      }
      return null
    },
  }
}

module.exports = {
  resolve: { alias: { 'lark-doc/mermaid-vendor': mermaidVendor, 'lark-doc/katex.css': katexCss } },
  plugins: [forbidVueImports()],
  test: {
    environment: 'node',
    setupFiles: ['./test/bootstrap.js'],
    include: ['test/**/*.test.js'],
    // 这条链要进 npm run check，必须输出稳定：失败时立刻退出，避免 watch 卡住 CI。
    watch: false,
    reporters: ['dot'],
    /**
     * 并发上界：默认按 CPU 数起 fork，每个 fork 都要重新 init 环境并 import
     * 全部依赖（jsdom 用例单个 ~7s 启动）。文件数一多就会把机器打满，
     * 出现「Timeout waiting for worker to respond」——不是用例失败，是
     * worker 起不来，表现成整个门禁假红。限制到 4 个后总时长仍在 1 分钟内，
     * 但不会再因为并发数随测试文件增长而抖。
     */
    /**
     * 复用 worker：默认 isolate 会给每个测试文件重启一个独立环境，73 个文件里
     * 有 70 个耗时全花在「spawn + init environment」上（实测 409s → 157s）。
     * 本仓库单测是纯 Node 环境、不碰 DOM 全局，用例之间也没有共享可变单例，
     * 因此关掉隔离是安全的（已全量双跑校验：73 files / 1709 tests 结果一致）。
     * 一旦将来某个用例需要在全局上打桩，务必改回 isolate: true，
     * 否则桩会泄漏给同 worker 的后续文件，表现为「单独跑绿、全量跑红」。
     */
    isolate: false,
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
  },
}
