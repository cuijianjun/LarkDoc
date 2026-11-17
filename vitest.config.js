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

/**
 * 跑真 rollup 构建的用例。单独成一套，理由有两层，都是实测出来的：
 *
 * 1. 它们是**唯一需要长超时**的文件。构建一支 UMD 要 5~40 秒，默认的 5s
 *    testTimeout 在机器忙时必然误报；把全局 testTimeout 抬到 100s 又会削弱其余
 *    4,900 条用例「卡住算失败」的信号。分开之后只给这 3 个文件放宽。
 * 2. 它们**不能和普通用例同池并发**。实测同跑三支（2 worker）：93s 里 4 条
 *    5s/30s 超时误报；逐支单跑 69.0 + 27.3 + 21.6 = 118s 全绿。构建是纯 CPU
 *    密集，和同池用例抢核心只会两边都慢还出假红。
 *
 * 于是 `check:unit` 拆成两趟串行：先 `--project unit`（快、并发），再
 * `--project build`（慢、独占）。日常增量 `test:affected` 只走 unit 那套。
 */
const BUILD_TEST_FILES = [
  'test/unit/build-contract.test.js',
  'test/unit/export-lazy.test.js',
  'test/unit/shared-host.test.js',
]

module.exports = {
  resolve: { alias: { 'lark-doc/mermaid-vendor': mermaidVendor, 'lark-doc/katex.css': katexCss } },
  plugins: [forbidVueImports()],
  test: {
    environment: 'node',
    // Vitest5默认搜索整个workspace；本项目缓存不能清理其他会话的目录。
    fsModuleCachePath: path.join(__dirname, 'node_modules/.vitest-cache'),
    setupFiles: ['./test/bootstrap.js'],
    // include 放在各 project 里，不放这里：根上的 include 会和 project 的 include
    // 合并（不是覆盖），结果 build 那套又把全部用例收进来。
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
    /**
     * 用例覆盖真实 DOM、跨产物 feature registry、dev 调度回归和浏览器全局桩。
     * 每个文件隔离模块及全局状态，避免复用 worker 时注册器、样式和 DOM realm
     * 污染后续文件，产生「单独跑绿、全量跑红」。
     */
    isolate: true,
    pool: 'forks',
    // 缺省仍是最稳的 2；本机想跑快一点用 `VITEST_MAX_WORKERS=6 npx vitest run`。
    // 上界不要超过「能全部跑完」的那个数：调大前先确认输出里的文件数与总数没少。
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 2,
    minWorkers: 1,
    /**
     * 两套用例，共用上面全部选项（`extends: true` 继承根配置）。
     *
     *   npm run test:unit    只跑快的（缺省，日常/增量）
     *   npm run test:build   只跑真构建（单独放宽超时）
     *   npm run check:unit   两趟串行，等价于原来的全量 `vitest run`
     */
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/**/*.test.js'], exclude: BUILD_TEST_FILES } },
      {
        extends: true,
        test: {
          name: 'build',
          include: BUILD_TEST_FILES,
          // 单支 UMD 构建 5~40s；`startTranspile` 那批还要真起子进程。
          testTimeout: 120000,
          hookTimeout: 60000,
        },
      },
    ],
  },
}
