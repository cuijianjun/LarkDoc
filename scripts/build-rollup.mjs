#!/usr/bin/env node
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { rollup } from 'rollup'
import { getRollupConfig } from '../rollup.config.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = resolve(ROOT, 'dist')
const target = process.env.ROLLUP_TARGET || 'adapters'

function assertNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major < 14) throw new Error(`Rollup 构建要求 Node >=14，当前为 ${process.versions.node}`)
}

function expectedFiles() {
  if (target === 'adapters') return ['lark-doc-vue3.mjs', 'lark-doc-react.mjs']
  if (target === 'collab') return ['lark-doc-collab.esm.js']
  return []
}

async function main() {
  assertNodeVersion()
  mkdirSync(DIST, { recursive: true })
  const config = getRollupConfig(target)
  const bundle = await rollup({
    input: config.input,
    external: config.external,
    plugins: config.plugins,
    treeshake: config.treeshake,
    onwarn: config.onwarn,
  })
  await bundle.write(config.output)
  await bundle.close()

  for (const file of expectedFiles()) {
    const path = resolve(DIST, file)
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`Rollup 构建结束但产物缺失或为空：${path}`)
    }
  }
  console.log(`✓ Rollup ${target} 产物已生成：${expectedFiles().join(', ')}`)
}

main().catch((error) => {
  console.error(`✗ Rollup ${target} 构建失败`)
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
