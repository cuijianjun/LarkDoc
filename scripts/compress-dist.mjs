#!/usr/bin/env node
/**
 * 浏览器交付产物的预压缩（brotli + gzip）。
 *
 * 为什么需要这一步：`size-limit` 一律按 gzip 计量，但真实传输格式由宿主的静态
 * 服务器决定。内核 raw 已 1.87 MB，brotli q11 比 gzip 再省 21%，这是不改进一行
 * 产品代码就能拿到的最大一笔。可现实里有两类宿主：
 *
 *   · nginx —— `gzip_static on` 是内置模块，`brotli_static` 需要编译进 libbrotli；
 *   · 对象存储 / CDN —— 多数只认「同目录预先放好 `<file>.br`」这种静态压缩。
 *
 * 所以这里把 `<file>.br` 与 `<file>.gz` 直接生成在源文件旁边：服务器开
 * `gzip_static` / `brotli_static` 即可零配置吃到，不需要任何运行时模块。
 *
 * 只压「浏览器真正会请求」的那一小批：引导器、内核、补丁包、各特性包、两份样式。
 * `dist/` 里其余文件（ESM 分块、manifest、graph）是给 bundler 与门禁读的，
 * 压它们只是让发布目录膨胀。
 *
 * 用法：
 *   node scripts/compress-dist.mjs            # 补齐缺失/过期的 .br/.gz（幂等）
 *   node scripts/compress-dist.mjs --check     # 只校验，缺一个就 EXIT=1
 *   node scripts/compress-dist.mjs --force     # 全部重压
 *   node scripts/compress-dist.mjs --prune     # 顺手清掉源文件已消失的 sibling
 *
 * 幂等靠 mtime：sibling 比源文件新就跳过，因此增量构建只压改动过的那几个。
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { elementPackNames, elementPackStyles } from '../rollup.config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

/** 浏览器会请求的产物。新增特性组时只改这里 —— 它是发布面，不是构建内部实现。 */
export const DELIVERY_FILES = [
  'lark-doc-element.umd.min.js',
  'lark-doc-element.runtime.umd.min.js',
  'lark-doc-element.polyfills.umd.min.js',
  ...elementPackNames.map(name => `lark-doc-element.umd.min.${name}.js`),
  'lark-doc-element.css',
  ...Object.values(elementPackStyles),
]

/** 太小的文件压缩后会更大（帧头开销），静态压缩对它们没意义。 */
const MIN_BYTES = 1024

/**
 * brotli 参数取真实最优：质量 11 是压缩率上限，MODE_TEXT 告诉编码器输入是
 * JS/CSS 文本而不是通用二进制，短字符串字典更贴。
 */
function brotli(buffer) {
  return brotliCompressSync(buffer, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
    },
  })
}

/** mtime 置 0：同一份输入必须产出同一份字节，否则每次构建都算「变脏」。 */
function gzip(buffer) {
  return gzipSync(buffer, { level: 9, mtime: 0 })
}

function fresh(source, target) {
  if (!existsSync(target)) return false
  const sibling = statSync(target)
  return sibling.size > 0 && sibling.mtimeMs >= statSync(source).mtimeMs
}

/**
 * @param {{ dist?: string, check?: boolean, force?: boolean, quiet?: boolean, prune?: boolean, allowMissing?: boolean }} options
 *   allowMissing：构建只跑了部分 target 时，未产出的交付文件不该让整条链路失败。
 */
export function compressDelivery(options = {}) {
  const dist = options.dist || DIST
  const check = !!options.check
  const rows = []
  const problems = []
  let wrote = 0

  for (const name of DELIVERY_FILES) {
    const source = resolve(dist, name)
    if (!existsSync(source)) {
      if (!options.allowMissing) problems.push(`缺少交付产物：dist/${name}`)
      continue
    }
    const raw = statSync(source).size
    if (raw < MIN_BYTES) continue
    const buffer = readFileSync(source)
    const row = { name, raw }

    for (const [ext, encode] of [['.br', brotli], ['.gz', gzip]]) {
      const target = source + ext
      const key = ext === '.br' ? 'br' : 'gz'
      if (options.force || !fresh(source, target)) {
        if (check) {
          problems.push(`dist/${name}${ext} 缺失或已过期`)
          row[key] = existsSync(target) ? statSync(target).size : 0
          continue
        }
        writeFileSync(target, encode(buffer))
        wrote += 1
      }
      row[key] = statSync(target).size
    }

    // 压完不该更大：小文件或已压缩内容会「膨胀」，那是配置错了。
    if (row.br >= row.raw) problems.push(`dist/${name} 的 brotli 产物没有变小（${row.br} ≥ ${row.raw}）`)
    rows.push(row)
  }

  if (!check && !options.quiet && rows.length) {
    const width = Math.max(...rows.map(row => row.name.length))
    console.log(`${'产物'.padEnd(width)}  ${'raw'.padStart(9)} ${'gzip'.padStart(9)} ${'brotli'.padStart(9)}  br 比 gzip`)
    for (const row of rows) {
      console.log(`${row.name.padEnd(width)}  ${String(row.raw).padStart(9)} ${String(row.gz).padStart(9)} ${String(row.br).padStart(9)}  ${((1 - row.br / row.gz) * 100).toFixed(1)}%`)
    }
    const raw = rows.reduce((sum, row) => sum + row.raw, 0)
    const gz = rows.reduce((sum, row) => sum + row.gz, 0)
    const br = rows.reduce((sum, row) => sum + row.br, 0)
    console.log(`\n合计 raw ${raw} → brotli ${br}（${((1 - br / raw) * 100).toFixed(1)}%）；比 gzip ${gz} 再少 ${gz - br} B（${((1 - br / gz) * 100).toFixed(1)}%）`)
  }

  // --prune：源文件已消失的 sibling 留着只会被部署到 CDN 上占位。
  if (options.prune && existsSync(dist)) {
    const known = new Set(DELIVERY_FILES.flatMap(name => [`${name}.br`, `${name}.gz`]))
    const orphans = readdirSync(dist).filter(file => /\.(?:br|gz)$/.test(file) && !known.has(file))
    for (const file of orphans) unlinkSync(resolve(dist, file))
    if (orphans.length && !options.quiet) console.log(`✓ 清理陈旧预压缩文件 ${orphans.length} 个`)
  }

  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`)
    return { ok: false, rows, wrote }
  }
  if (!options.quiet) {
    console.log(check
      ? `✓ ${rows.length} 个交付产物的 .br / .gz 均已就位且新于源文件`
      : `✓ 预压缩就绪（本次写入 ${wrote} 个文件；'.br' / '.gz' 供 brotli_static / gzip_static 直取）`)
  }
  return { ok: true, rows, wrote }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const result = compressDelivery({
    check: argv.includes('--check'),
    force: argv.includes('--force'),
    prune: argv.includes('--prune'),
  })
  if (!result.ok) process.exit(1)
}
