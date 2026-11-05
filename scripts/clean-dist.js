'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')

if (dist === root || !dist.endsWith(`${path.sep}dist`)) {
  throw new Error(`拒绝清理非项目 dist 路径：${dist}`)
}

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })
console.log(`✓ 已清理构建产物目录：${path.relative(root, dist)}`)
