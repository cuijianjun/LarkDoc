'use strict'

const path = require('path')

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
     * 全部依赖。文件数一多就会把机器打满，出现「Timeout waiting for worker to respond」
     * ——不是用例失败，是 **worker 起不来，那批测试文件根本没被执行**。
     *
     * 这不是理论风险，实测过：16 核 / load≈11 的机器上 `maxWorkers: 4` 跑一次，
     * 结果是「57 个文件通过 + 25 个 worker 启动超时」，而这 25 个文件**一条用例都没跑**，
     * vitest 仍打印「Test Files 57 passed」，只在末尾记 25 条 unhandled error 并以 1 退出。
     * 换成 2 之后同一份代码 82 个文件 / 1983 条用例全过、0 error、退出码 0。
     *
     * 也就是说 2 不是「为了变绿而降并发」，是唯一能让整套用例真的跑完的并发数；
     * 4 看上去更快（717s vs 838s），但那 717s 里少了 30% 的文件。
     * 调大之前请先确认整套 82 个文件都在输出里 —— 少跑比跑得慢危险得多。
     */
    maxWorkers: 2,
    minWorkers: 1,
  },
}
