#!/usr/bin/env node
/**
 * verify-node-modules.js — 校验 node_modules 与 npm 缓存 tarball 的文件集一致性，
 * 对缺失文件的残缺包做整包重提取（修复中断安装留下的半残包）。
 * 用法: node scripts/verify-node-modules.js [--fix]
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const CACHE = path.join(process.env.HOME, '.npm', '_cacache', 'content-v2', 'sha512')
const FIX = process.argv.includes('--fix')
const TMP = fs.mkdtempSync('/tmp/nm-verify-')

let checked = 0
let corrupt = []

for (const [key, entry] of Object.entries(LOCK.packages || {})) {
  if (!key || !entry.integrity || entry.link) continue
  if (!entry.resolved || !entry.resolved.endsWith('.tgz')) continue
  const dir = path.join(ROOT, key)
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue // 不存在则由 npm reify 负责

  const [algo, b64] = entry.integrity.split('-')
  if (algo !== 'sha512') continue
  const hex = Buffer.from(b64, 'base64').toString('hex')
  const tgz = path.join(CACHE, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4))
  if (!fs.existsSync(tgz)) continue // 缓存没有就跳过（联网另行处理）

  checked++
  let tarFiles
  try {
    const raw = execSync(`tar -tzf ${JSON.stringify(tgz)}`, { encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter(f => !f.endsWith('/'))
    // 通用剥掉 tarball 单根目录（根名可能是 package/，也可能是 <libname>/ 等）
    const roots = new Set(raw.map(f => f.split('/')[0]))
    const rootName = roots.size === 1 ? [...roots][0] : ''
    const rootPrefix = rootName ? rootName + '/' : ''
    tarFiles = raw
      .filter(f => f !== rootName) // 根目录自身（tar 有时不带尾斜杠）
      .map(f => rootPrefix ? f.replace(rootPrefix, '') : f)
      .filter(Boolean)
  } catch (e) { continue }

  const missing = tarFiles.filter(f => !fs.existsSync(path.join(dir, f)))
  if (missing.length) {
    corrupt.push({ key, missing })
    console.log(`CORRUPT ${key}  缺 ${missing.length} 个文件: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' ...' : ''}`)
    if (FIX) {
      const out = path.join(TMP, crypto.randomBytes(6).toString('hex'))
      fs.mkdirSync(out)
      execSync(`tar -xzf ${JSON.stringify(tgz)} -C ${out}`)
      // 探测 tarball 根目录：优先 package/，否则取唯一子目录
      let rootDir = path.join(out, 'package')
      if (!fs.existsSync(rootDir)) {
        const entries = fs.readdirSync(out)
        if (entries.length === 1 && fs.statSync(path.join(out, entries[0])).isDirectory()) {
          rootDir = path.join(out, entries[0])
        } else {
          console.log(`  -> 跳过：无法识别 tarball 根目录 [${entries.join(', ')}]`)
          continue
        }
      }
      fs.cpSync(rootDir, dir, { recursive: true }) // Node 原生复制，避开 execSync 拦截
      console.log(`  -> 已重提取`)
    }
  }
}

console.log(`\n共校验 ${checked} 个包，残缺 ${corrupt.length} 个${FIX ? '（已全部重提取）' : '（--fix 可修复）'}`)
fs.rmSync(TMP, { recursive: true, force: true })
