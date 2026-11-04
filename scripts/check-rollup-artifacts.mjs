#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = resolve(ROOT, 'dist')
const checks = [
  { file: 'lark-doc.esm.js', required: ['export'], forbidden: ['__webpack_require__', '__webpack_public_path__'] },
  { file: 'lark-doc.common.js', required: ['module.exports'], forbidden: ['__webpack_public_path__', '__webpack_require__', 'featureLoader'] },
  { file: 'lark-doc-element.umd.min.js', required: ['LarkDoc'], forbidden: ['__webpack_require__', '__webpack_public_path__'] },
  { file: 'lark-doc-vue3.mjs', required: ['export'], forbidden: ['require(', 'module.exports'] },
  { file: 'lark-doc-react.mjs', required: ['export'], forbidden: ['require(', 'module.exports'] },
  { file: 'lark-doc-collab.esm.js', required: ['from \'yjs\'', 'from \'@tiptap/extension-collaboration\''], forbidden: ['class YDoc', 'module.exports'] },
  { file: 'lark-doc-manifest.json', required: ['"generatedBy": "rollup"'], forbidden: [] },
]

let failed = false
for (const check of checks) {
  const path = resolve(DIST, check.file)
  if (!existsSync(path) || statSync(path).size === 0) {
    console.error(`✗ 缺少 Rollup 产物：${check.file}`)
    failed = true
    continue
  }
  const source = readFileSync(path, 'utf8')
  for (const text of check.required || []) {
    if (!source.includes(text)) {
      console.error(`✗ ${check.file} 未满足检查：${text}`)
      failed = true
    }
  }
  for (const text of check.forbidden || []) {
    if (source.includes(text)) {
      console.error(`✗ ${check.file} 命中禁用内容：${text}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log('✓ Rollup 产物检查通过（入口存在、模块格式和协同 external 满足约束）')
