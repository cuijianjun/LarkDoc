#!/usr/bin/env node
/**
 * 独立回环验证宿主，始终只托管当前 worktree 的 dist，不启动外部 webpack。
 * npm run verify:host                         # 现有 dist，允许过期但明确标记
 * npm run verify:host -- --current            # 只接受与当前源码匹配的产物
 * npm run verify:host -- --build --smoke      # 强制重建后检查真实宿主启动链路
 * PORT=8877 npm run verify:host -- --current  # 指定端口（拒绝 8080 / 8765）
 * LARK_DOC_DEMO_HOST=/path/to/vue2-webpack-node14 npm run verify:host
 * BASE_URL=http://127.0.0.1:8877/lark-doc npm run verify:all
 * --smoke 不运行浏览器矩阵；产物匹配与烟测通过均不等于完整源码验收通过。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'))
const require = createRequire(import.meta.url)
const { parseComponent } = require('vue-template-compiler')
const port = Number(process.env.PORT || 0)
if (!Number.isInteger(port) || port < 0 || port > 65535 || [8080, 8765].includes(port)) {
  throw new Error('PORT 必须是 0–65535 的整数，且不能使用 8080 / 8765')
}
const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim()
const primaryRoot = dirname(resolve(ROOT, commonDir))
const demoRoot = realpathSync(resolve(process.env.LARK_DOC_DEMO_HOST || join(primaryRoot, '..', 'vue2-webpack-node14')))
const vueFile = require.resolve('vue/dist/vue.min.js')
const args = process.argv.slice(2)
if (args.some((arg) => !['--build', '--current', '--smoke'].includes(arg))) {
  throw new Error('只支持 --build / --current / --smoke')
}
const requireCurrent = args.includes('--current') || args.includes('--build')
const artifactScript = join(ROOT, 'scripts/ensure-artifacts.mjs')
if (args.includes('--build')) {
  const build = spawnSync(process.execPath, [artifactScript, '--force'], { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (build.error) throw build.error
  if (build.status !== 0) throw new Error('当前源码产物构建失败，未启动验证宿主')
}
const artifactCheck = spawnSync(process.execPath, [artifactScript, '--check'], {
  cwd: ROOT, encoding: 'utf8', env: process.env,
})
if (artifactCheck.error) throw artifactCheck.error
if (requireCurrent && artifactCheck.status !== 0) {
  throw new Error(`当前源码产物校验失败，未启动验证宿主：\n${artifactCheck.stdout.trim()}\n请通过同一 Node/npm 环境执行 npm run verify:host -- --build`)
}
const routes = new Map()
const hostFiles = ['src/styles/app.css', 'vue.config.js']

function replaceOnce(source, from, to, file) {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from)) {
    throw new Error(`${file} 接入结构已变动，不能静默使用替代夹具：${from}`)
  }
  return source.replace(from, to)
}

for (const [route, file, wc] of [
  ['/lark-doc', 'src/views/LarkDocView.vue', false],
  ['/lark-doc-wc', 'src/views/LarkDocWcView.vue', true],
]) {
  hostFiles.push(file)
  const component = parseComponent(readFileSync(join(demoRoot, file), 'utf8'))
  let script = component.script.content
  if (wc) {
    script = replaceOnce(script, "import Vue from 'vue'", 'const Vue = window.Vue', file)
    script = replaceOnce(script, "await import('lark-doc/element')", `await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = '/js/lark-doc-element.umd.min.js'
      script.onload = resolve
      script.onerror = () => reject(new Error('element 产物加载失败'))
      document.head.appendChild(script)
    })`, file)
  } else {
    script = replaceOnce(script, "import { LarkDoc } from 'lark-doc'", "const { LarkDoc } = window['lark-doc']", file)
    script = replaceOnce(script, "import 'lark-doc/style.css'", '', file)
  }
  script = replaceOnce(script, 'export default {', 'const HostView = {', file)
  // 只适配加载入口；原页面的正文、选项、适配器及生命周期逐字复用。
  script += `\nconst compiled = window.Vue.compile(${JSON.stringify(component.template.content)})
Object.assign(HostView, compiled)
window.Vue.config.productionTip = false
window.Vue.config.errorHandler = (error) => {
  window.__verifyHostError = String(error)
  console.error(error)
}
window.__verifyHostVm = new window.Vue({ render: (h) => h(HostView) }).$mount('#route')
window.addEventListener('pagehide', () => window.__verifyHostVm.$destroy(), { once: true })\n`
  const styles = component.styles.map((style) => style.content).join('\n')
  routes.set(route, { script, styles, wc })
}

const artifactFiles = ['dist/lark-doc.umd.min.js', 'dist/lark-doc-element.umd.min.js', 'dist/lark-doc.css']
const describeFile = (base, file) => {
  const abs = join(base, file)
  const stat = statSync(abs)
  return { file, bytes: stat.size, mtime: stat.mtime.toISOString(), sha256: createHash('sha256').update(readFileSync(abs)).digest('hex') }
}
const status = {
  root: ROOT,
  demoRoot,
  hostFiles: hostFiles.map((file) => describeFile(demoRoot, file)),
  artifacts: artifactFiles.map((file) => describeFile(ROOT, file)),
  artifactCheck: { code: artifactCheck.status, output: artifactCheck.stdout.trim(), error: artifactCheck.stderr.trim() },
  sourceArtifactsCurrent: artifactCheck.status === 0,
  currentSourceVerified: false,
  finalRebuildRequired: artifactCheck.status !== 0,
  note: artifactCheck.status === 0
    ? '产物与当前源码构建记录匹配；宿主启动或烟测不代表完整浏览器矩阵及性能门禁通过。'
    : '现有 dist 与当前源码不匹配；只可诊断旧产物启动链路，请用 --build 重建后再验证。',
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function serveFile(res, base, name) {
  const file = resolve(base, name)
  // 只开放明确挂载目录，连同符号链接也不能越界，不暴露源码、.git 或 node_modules。
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile() || !realpathSync(file).startsWith(realpathSync(base) + sep)) {
    return send(res, 404, 'text/plain; charset=utf-8', '未找到资源')
  }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'text/plain; charset=utf-8', '只支持读取')
  let pathname
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname) } catch {
    return send(res, 400, 'text/plain; charset=utf-8', '无效地址')
  }
  if (pathname.includes('\0')) return send(res, 400, 'text/plain; charset=utf-8', '无效地址')
  if (pathname === '/favicon.ico') return send(res, 204, 'image/x-icon', '')
  if (pathname === '/__verify__/status.json') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(status, null, 2))
  if (pathname === '/__verify__/vue.js') return send(res, 200, 'text/javascript', readFileSync(vueFile))
  if (pathname === '/__verify__/app.css') return send(res, 200, 'text/css', readFileSync(join(demoRoot, 'src/styles/app.css')))
  if (pathname === '/examples/element-demo.html') return send(res, 200, 'text/html; charset=utf-8', readFileSync(join(ROOT, 'examples/element-demo.html')))
  for (const prefix of ['/js/', '/dist/']) {
    if (pathname.startsWith(prefix)) return serveFile(res, join(ROOT, 'dist'), pathname.slice(prefix.length))
  }
  for (const [route, host] of routes) {
    if (pathname === `/__verify__${route}.js`) return send(res, 200, 'text/javascript; charset=utf-8', host.script)
    if (pathname === route || pathname === route + '/') {
      return send(res, 200, 'text/html; charset=utf-8', `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>独立验证宿主</title><link rel="stylesheet" href="/__verify__/app.css">
${host.wc ? '' : '<link rel="stylesheet" href="/js/lark-doc.css">'}<style>${host.styles}</style>
</head><body><div id="app"><main><div id="route"></div></main></div>
<script src="/__verify__/vue.js"></script>${host.wc ? '' : '<script src="/js/lark-doc.umd.min.js"></script>'}
<script type="module" src="/__verify__${route}.js"></script></body></html>`)
    }
  }
  return send(res, 404, 'text/plain; charset=utf-8', '未找到资源')
})

async function smoke(baseURL) {
  // 复用矩阵所用的本机驱动和 Chromium 缓存，不安装依赖或下载浏览器。
  const driverPath = process.env.NODE_PATH || '/Users/cjjxw/.workbuddy/binaries/node/workspace/node_modules'
  const { chromium } = require(require.resolve('playwright-core', { paths: [ROOT, ...driverPath.split(process.platform === 'win32' ? ';' : ':')] }))
  const fs = require('node:fs')
  const cache = join(process.env.HOME || '', 'Library/Caches/ms-playwright')
  const candidates = (existsSync(cache) ? fs.readdirSync(cache) : []).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap((name) => [join(cache, name, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), join(cache, name, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium')])
  const executablePath = process.env.LARK_DOC_CHROMIUM || candidates.find((file) => existsSync(file))
  if (!executablePath) throw new Error('未找到 Chromium；请设置 LARK_DOC_CHROMIUM')
  const browser = await chromium.launch({ headless: true, executablePath })
  const results = []
  try {
    for (const [route, key, draftKey] of [
      ['/lark-doc', '__larkDoc', 'lark-doc-demo-draft'],
      ['/lark-doc-wc', '__larkDocWc', 'lark-doc-wc-draft'],
      ['/examples/element-demo.html', null, null],
    ]) {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        const errors = []
        const failures = []
        page.on('pageerror', (error) => errors.push(String(error)))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
        page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`) })
        page.on('requestfailed', (request) => failures.push(`${request.failure()?.errorText} ${request.url()}`))
        await page.goto(new URL(route, baseURL).href, { waitUntil: 'networkidle' })
        await page.waitForSelector('.ProseMirror')
        await page.waitForSelector('.lark-doc-toolbar')
        if (key) {
          await page.waitForFunction((key) => window[key]?.getEditor(), key)
          await page.waitForSelector('.lark-doc-diagram svg')
          await page.waitForSelector('.katex')
          const initial = await page.evaluate((key) => window[key].getText(), key)
          if (!initial.includes('项目周报') || !initial.includes('本周聚焦')) throw new Error(`${route} 未加载真实宿主正文`)
          const persisted = await page.evaluate(async ({ key, draftKey }) => {
            await window[key].save()
            const draft = JSON.parse(localStorage.getItem(draftKey) || '[]').slice(-1)[0]
            return draft?.json?.type === 'doc' && Boolean(draft.updatedAt)
          }, { key, draftKey })
          if (!persisted) throw new Error(`${route} 未遵守真实宿主持久化契约`)
          await page.reload({ waitUntil: 'networkidle' })
          await page.waitForFunction((key) => window[key]?.getEditor(), key)
          const restored = await page.evaluate((key) => window[key].getText(), key)
          if (restored !== initial) throw new Error(`${route} 刷新后草稿不一致`)
        } else {
          await page.waitForFunction(() => ['editor-a', 'editor-b'].every((id) => document.getElementById(id)?.getAttribute('data-mounted') === 'true'))
        }
        if (errors.length || failures.length) throw new Error(`${route}: ${[...errors, ...failures].join(' | ')}`)
        results.push({ route, passed: true, persistenceReload: Boolean(key) })
        console.log(`启动烟测通过 ${route}${key ? '（真实正文 / 图表 / 公式 / 存盘刷新）' : '（双实例挂载）'}`)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
  return results
}

server.once('error', (error) => { console.error(error); process.exitCode = 1 })
server.listen(port, '127.0.0.1', async () => {
  status.baseURL = `http://127.0.0.1:${server.address().port}/lark-doc`
  console.log(`验证宿主：${status.baseURL}\n产物目录：${ROOT}/dist\n真实宿主：${demoRoot}`)
  console.warn(status.note)
  if (status.finalRebuildRequired) console.warn(status.artifactCheck.output)
  console.log(`完整矩阵（由你执行）：BASE_URL=${status.baseURL} npm run verify:all`)
  if (process.argv.includes('--smoke')) {
    try { status.smoke = { passed: true, results: await smoke(status.baseURL) } } catch (error) {
      status.smoke = { passed: false, error: String(error) }
      console.error(error)
      process.exitCode = 1
    } finally {
      status.at = new Date().toISOString()
      const logDir = join(ROOT, '_codex/verify-logs')
      try {
        mkdirSync(logDir, { recursive: true })
        const log = join(logDir, 'host-smoke.json')
        writeFileSync(log, JSON.stringify(status, null, 2))
        console.log(`启动烟测记录：${log}`)
      } finally { server.close() }
    }
  }
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
