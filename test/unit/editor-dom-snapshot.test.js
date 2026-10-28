/**
 * P0-03 拆编辑器模板 —— RF5 DOM 结构守卫。
 *
 * 拆 LarkDocEditor.vue 模板成 8 个子组件时，唯一的红线是"渲染结果逐节点不变"：
 * 类名、层级、顺序、属性有任何漂移都算视觉回归。本测试用与基线抓取
 * （scripts/capture-baseline.js dom，Task 1）完全相同的归一化口径，把 demo
 * 当前 DOM 与重构前基线 test/fixtures/editor-dom-before.html 逐字节比对。
 *
 * 运行前提：demo dev server 在线（apps/vue2-webpack-node14，8080 /lark-doc）
 * 与 playwright-core 可解析（NODE_PATH 指向其 node_modules，见基线抓取命令）。
 * 环境未备齐时跳过比对（保持 `npm run check` 在无浏览器环境自洽），但
 * fixture 缺失在任何环境下都算失败——基线不能丢。
 * 想强制跑：起 dev server 后 LARK_DOC_DOM_URL 可覆盖默认地址。
 */

import { spawnSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'
import { expect, it, describe } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixturePath = path.join(root, 'test/fixtures/editor-dom-before.html')
const snapshotScript = path.join(root, 'scripts/snapshot-dom.js')
const pageUrl = process.env.LARK_DOC_DOM_URL || 'http://localhost:8080/lark-doc'

function playwrightAvailable() {
  try {
    createRequire(import.meta.url).resolve('playwright-core')
    return true
  } catch (_) {
    return false
  }
}

function serverReachable(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 3000 }, (response) => {
      response.resume()
      resolve(response.statusCode !== undefined && response.statusCode < 500)
    })
    request.on('timeout', () => { request.destroy(); resolve(false) })
    request.on('error', () => resolve(false))
  })
}

function captureCurrentDom() {
  const result = spawnSync(process.execPath, [snapshotScript, pageUrl], {
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`snapshot-dom.js 失败（exit=${result.status}）：${(result.stderr || '').trim()}`)
  }
  return result.stdout
}

function firstDiffContext(baseline, current) {
  const length = Math.max(baseline.length, current.length)
  let index = 0
  while (index < length && baseline[index] === current[index]) index += 1
  const from = Math.max(0, index - 120)
  const clip = (text) => text.slice(from, index + 160).replace(/\n/g, '\\n')
  return `首个差异在偏移 ${index}（基线 ${baseline.length} 字符 / 当前 ${current.length} 字符）\n` +
    `  基线: …${clip(baseline)}…\n  当前: …${clip(current)}…`
}

describe('P0-03 RF5 编辑器 DOM 快照', () => {
  it('基线 fixture 存在且非空（任何环境都必须通过）', () => {
    expect(fs.existsSync(fixturePath)).toBe(true)
    expect(fs.statSync(fixturePath).size).toBeGreaterThan(1000)
  })

  it('demo 当前 DOM 与重构前基线逐字节一致', { timeout: 200000 }, async () => {
    const reachable = await serverReachable(pageUrl)
    if (!playwrightAvailable()) {
      console.warn(`[skip] playwright-core 不可解析（需 NODE_PATH 指向其 node_modules），跳过 DOM 快照比对`)
      return
    }
    if (!reachable) {
      console.warn(`[skip] demo dev server 不可达（${pageUrl}），跳过 DOM 快照比对`)
      return
    }
    const baseline = fs.readFileSync(fixturePath, 'utf8').replace(/\n$/, '')
    const current = captureCurrentDom().replace(/\n$/, '')
    expect(current, firstDiffContext(baseline, current)).toBe(baseline)
  })
})
