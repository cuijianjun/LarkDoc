'use strict'

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
module.exports = {
  test: {
    environment: 'node',
    setupFiles: ['./test/bootstrap.js'],
    include: ['test/**/*.test.js'],
    // 这条链要进 npm run check，必须输出稳定：失败时立刻退出，避免 watch 卡住 CI。
    watch: false,
    reporters: ['dot'],
  },
}
