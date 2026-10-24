'use strict'

/**
 * 只读 DOM 快照：抓当前 demo 的归一化 DOM 并打到 stdout，不写任何文件。
 * 供 test/unit/editor-dom-snapshot.test.js（RF5）与 fixture 比对。
 *
 *   NODE_PATH=<playwright-core 所在 node_modules> \
 *     node scripts/snapshot-dom.js [url]
 *
 * 与写基线的 scripts/capture-baseline.js dom 共享同一套归一化实现
 * （scripts/lib/dom-capture.js），保证比对口径一致。
 */

const { captureNormalizedDom } = require('./lib/dom-capture')

const url = process.argv[2] || 'http://localhost:8080/lark-doc'
captureNormalizedDom(url)
  .then((html) => process.stdout.write(html))
  .catch((error) => {
    console.error(error && error.message ? error.message : error)
    process.exit(1)
  })
