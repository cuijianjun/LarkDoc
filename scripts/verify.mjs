#!/usr/bin/env node
/**
 * 浏览器验证统一入口。
 *
 * 之前是逐个手工 `node scripts/verify-browser-xxx.js`，一次只验证一个域，
 * 每次都要重新起浏览器 + 打开页面 + 全量初始化，而且脚本的原始输出（DOM 转储、
 * 逐条断言日志）会把会话上下文冲掉。
 *
 * 这里收敛成一条命令：
 *   node scripts/verify.mjs highlight-fold list-marker   # 顺序跑多个
 *   node scripts/verify.mjs --all                        # 全跑
 *   node scripts/verify.mjs --list                       # 只列可用目标
 *
 * 输出规则（给 agent 看的部分必须短）：
 *   - 成功：一行 `PASS <target> <耗时> <摘要>`；
 *   - 失败：一行 `FAIL` + 最多 12 行命中 fail/error 的行 + 末尾 8 行；
 *   - 完整原始输出永远写到 `_codex/verify-logs/<target>.log`（已被 gitignore）——
 *     要细节读文件，不要把 stdout 直接灌进上下文。
 *
 * 环境要求：Node >= 18（浏览器脚本实际用 Node 22 + playwright-core）；
 * dev server 需先在 8080 起来（本脚本只探活提示，不负责拉起）。
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'scripts')
const LOG_DIR = join(ROOT, '_codex', 'verify-logs')
const PREFIX = 'verify-browser-'
const DEV_PORT = 8080
const DEFAULT_TIMEOUT = 240 // 秒

/** 本机 playwright-core 的默认位置（可用 NODE_PATH 覆盖） */
const FALLBACK_NODE_PATH = '/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const targets = argv.filter((a) => !a.startsWith('--'))
const timeoutArg = argv.find((a) => a.startsWith('--timeout='))
const TIMEOUT = (timeoutArg ? Number(timeoutArg.split('=')[1]) : DEFAULT_TIMEOUT) * 1000

const available = readdirSync(SCRIPTS)
  .filter((f) => f.startsWith(PREFIX) && f.endsWith('.js'))
  .map((f) => f.slice(PREFIX.length, -3))
  .sort()

function printList() {
  console.log(`可用目标（${available.length}）：\n`)
  for (const t of available) console.log('  ' + t)
  console.log('\n用法：node scripts/verify.mjs <target...> | --all')
}

if (flags.has('--list') || (targets.length === 0 && !flags.has('--all'))) {
  printList()
  process.exit(0)
}

const selected = flags.has('--all') ? available : targets
const unknown = selected.filter((t) => !available.includes(t))
if (unknown.length) {
  console.error(`✗ 未知目标：${unknown.join(', ')}`)
  console.error(`可用：${available.join(', ')}`)
  process.exit(2)
}

const major = Number(process.versions.node.split('.')[0])
if (major < 18) {
  console.error(`✗ 需要 Node >= 18（浏览器脚本用 playwright-core），当前 ${process.versions.node}`)
  process.exit(2)
}

const env = { ...process.env }
if (!env.NODE_PATH) {
  if (existsSync(FALLBACK_NODE_PATH)) env.NODE_PATH = FALLBACK_NODE_PATH
  else console.warn('⚠ NODE_PATH 未设置，playwright-core 可能找不到')
}

/** 探活 dev server：不通只警告，不阻塞（有的目标不需要页面） */
function probeDevServer() {
  return new Promise((resolve) => {
    const sock = net.connect({ port: DEV_PORT, host: '127.0.0.1' })
    const done = (ok) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(1500)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

function runOne(target) {
  const script = join(SCRIPTS, PREFIX + target + '.js')
  const logPath = join(LOG_DIR, target + '.log')
  const out = createWriteStream(logPath)
  const chunks = []
  const started = Date.now()

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, env })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT)

    const onData = (buf) => {
      chunks.push(buf)
      out.write(buf)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      out.end()
      resolve({
        target,
        code: timedOut ? 124 : code,
        signal,
        ms: Date.now() - started,
        text: Buffer.concat(chunks).toString('utf8'),
        logPath
      })
    })
  })
}

/** 从原始输出里挑「有价值的一行」当摘要，不要整段。 */
function summarize(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter(Boolean)
  // 优先找带统计数字的收尾行
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\d+\s*(项|条|个|断言|checks?|passed|PASS)/i.test(lines[i])) {
      return lines[i].slice(0, 100)
    }
  }
  return (lines[lines.length - 1] || '').slice(0, 100)
}

/** 失败时只保留命中关键字的行，再补末尾几行。 */
function failureDigest(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trimEnd())
    .filter((l) => l.trim())

  // 脚本自己抛的异常：一行就够，后面全是 playwright 的错误对象结构（name/Call log/log/at ...）
  const own = lines.find((l) => /^(验证脚本异常|Verification failed|断言失败)[:：]/.test(l.trim()))
  if (own) return ['    ' + own.trim().slice(0, 160)]

  const NOISE = /^\s*(name:|message:|stack:|Call log:|log:|\]|\}|'|\s*- |at\s)/
  const hits = lines.filter(
    (l) => /\b(fail|failed|✗|✘|error|Error|Assertion|期望|不对|mismatch)\b/.test(l) && !NOISE.test(l)
  )
  const tail = lines.slice(-4).filter((l) => !NOISE.test(l))
  return [...new Set([...hits.slice(0, 8), ...tail])].map((l) => '    ' + l.trim().slice(0, 160))
}

const fmt = (ms) => (ms / 1000).toFixed(1) + 's'

async function main() {
  mkdirSync(LOG_DIR, { recursive: true })

  const alive = await probeDevServer()
  if (!alive) {
    console.warn(`⚠ 127.0.0.1:${DEV_PORT} 没响应 —— 需要页面的目标会失败`)
    console.warn('  Node14 起服务：PATH=$HOME/.nvm/versions/node/v14.21.3/bin:$PATH npm run dev')
  }

  console.log(`跑 ${selected.length} 个目标：${selected.join(', ')}\n`)
  const results = []
  for (const t of selected) {
    process.stdout.write(`· ${t} … `)
    const r = await runOne(t)
    results.push(r)
    const ok = r.code === 0
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${fmt(r.ms)}\n`)

    if (ok && flags.has('--verbose')) console.log(r.text.trim())
    if (!ok) {
      if (r.code === 124) console.log(`    ✗ 超过 ${TIMEOUT / 1000}s 被终止`)
      console.log(failureDigest(r.text).join('\n'))
      console.log(`    完整输出：${r.logPath}`)
    }
  }

  const pass = results.filter((r) => r.code === 0).length
  const fail = results.length - pass
  console.log('\n──────── 结果 ────────')
  for (const r of results) {
    const tag = r.code === 0 ? 'PASS' : r.code === 124 ? 'TIME' : 'FAIL'
    const note = r.code === 0 ? summarize(r.text) : `→ ${r.logPath}`
    console.log(`${tag}  ${r.target.padEnd(18)}${fmt(r.ms).padStart(7)}   ${note}`)
  }
  console.log('─────────────────────')
  console.log(`${results.length} 个目标：${pass} PASS${fail ? ` / ${fail} FAIL` : ''}`)

  // 稳定汇总文件：给下个会话/CI 一行的机器可读结果
  try {
    writeFileSync(
      join(LOG_DIR, 'latest.json'),
      JSON.stringify(
        { at: new Date().toISOString(), node: process.versions.node, results: results.map(({ target, code, ms, logPath }) => ({ target, code, ms, logPath })) },
        null,
        2
      )
    )
  } catch {
    /* 日志写不进去不影响判定 */
  }

  process.exit(fail ? 1 : 0)
}

main()
