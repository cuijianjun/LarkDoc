const { defineConfig } = require('@vue/cli-service')
const path = require('path')
const webpack = require('webpack')

module.exports = defineConfig({
  transpileDependencies: true,
  productionSourceMap: false,
  // CSS is published as a separate npm asset. Relative URLs keep bundled
  // KaTeX fonts resolvable from the package's own dist/fonts directory when a
  // Vue 2 host imports the stylesheet through its normal css-loader pipeline.
  publicPath: './',
  chainWebpack(config) {
    // vendored 第三方 UMD（mermaid）绝不能进 babel：transpileDependencies 的
    // core-js 注入会往文件头加 require()，file-loader 落盘后在浏览器里
    // 直接 ReferenceError: require is not defined。源码资产按原样落盘。
    config.module.rule('js').exclude.add(path.resolve(__dirname, 'src/assets'))
  },
  // The library is consumed as an npm package. Vue must resolve to the
  // CommonJS constructor so Tiptap's Vue 2 node-view runtime receives the
  // same constructor shape as a normal Vue 2 application.
  configureWebpack: {
    externals: {
      vue: {
        commonjs: 'vue/dist/vue.runtime.common.js',
        commonjs2: 'vue/dist/vue.runtime.common.js',
        amd: 'vue',
        root: 'Vue',
      },
    },
    // Dynamic imports otherwise produce chunks that an npm consumer does not
    // automatically copy into its own public asset directory.
    plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
  },
})
