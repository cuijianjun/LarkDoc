'use strict'

/**
 * 构建无 Vue import 的 options 兼容入口，实际 UI 使用同一份 DOM renderer。
 *
 * 入口单独位于 src/legacy-vue，不引入 Vue 运行时或 SFC。
 * ESM 档复用 build-esm.js；CommonJS 档使用 Vue CLI library 构建。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const env = { ...process.env, LARK_DOC_LEGACY: '1', LARK_DOC_LEGACY_ENTRY: '1', LARK_DOC_TARGET: 'lib' }

function run(args, extraEnv = {}) {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extraEnv } })
  if (result.status !== 0) process.exit(result.status || 1)
}

run(['run', 'build:legacy:cjs'])

// ESM 构建器接受显式入口，不修改源码脚本，避免中断时留下临时状态。
run(['run', 'build:esm', '--', '--entry', 'src/legacy-vue/index.js', '--name', 'lark-doc-legacy'])

const generated = path.join(root, 'dist/lark-doc-legacy.esm.js')
if (!fs.existsSync(generated)) throw new Error(`legacy ESM 产物缺失：${generated}`)
