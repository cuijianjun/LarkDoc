import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

function fixture(t) {
  mkdirSync(join(ROOT, '_codex'), { recursive: true })
  const root = mkdtempSync(join(ROOT, '_codex/verify-host-test-'))
  for (const dir of ['scripts', 'dist', 'examples', 'demo/src/views', 'demo/src/styles']) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of ['verify-host.mjs', 'verify.mjs']) copyFileSync(join(ROOT, 'scripts', file), join(root, 'scripts', file))
  for (const file of ['lark-doc.umd.min.js', 'lark-doc-element.umd.min.js', 'lark-doc.css']) writeFileSync(join(root, 'dist', file), '/* 产物夹具 */')
  writeFileSync(join(root, 'examples/element-demo.html'), '<title>双实例演示夹具</title>')
  writeFileSync(join(root, 'demo/src/styles/app.css'), 'body { margin: 0 }')
  writeFileSync(join(root, 'demo/vue.config.js'), 'module.exports = {}')
  writeFileSync(join(root, 'demo/src/views/LarkDocView.vue'), `<template><div /></template><script>
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
export default { name: 'RealHost', methods: { save() { return LarkDoc } } }
</script><style>.real-host { color: red }</style>`)
  writeFileSync(join(root, 'demo/src/views/LarkDocWcView.vue'), `<template><lark-doc /></template><script>
import Vue from 'vue'
export default { async mounted() { await import('lark-doc/element') } }
</script>`)
  writeFileSync(join(root, 'scripts/ensure-artifacts.mjs'), `import { existsSync, writeFileSync } from 'node:fs'
if (process.env.TEST_BUILD_FAIL === '1') process.exit(1)
if (process.argv.includes('--force')) writeFileSync('built.json', JSON.stringify({ cwd: process.cwd() }))
process.exit(existsSync('built.json') || process.env.TEST_CURRENT === '1' ? 0 : 1)
`)
  return root
}

function run(t, root, script, args = [], extraEnv = {}) {
  const child = spawn(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd: root,
    env: { ...process.env, PORT: '0', LARK_DOC_DEMO_HOST: join(root, 'demo'), ...extraEnv },
  })
  let output = ''
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', (data) => { output += data })
  const done = new Promise((resolve) => child.once('close', (code) => resolve({ code, output })))
  t.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await done
  })
  return {
    done,
    async ready() {
      return await new Promise((resolve, reject) => {
        const inspect = () => {
          const found = output.match(/验证宿主：(http:\/\/127\.0\.0\.1:\d+)\/lark-doc/)
          if (found) { child.stdout.off('data', inspect); resolve(found[1]) }
        }
        child.stdout.on('data', inspect)
        child.once('close', () => reject(new Error(output)))
        inspect()
      })
    },
  }
}

test('当前产物模式拒绝过期记录，不静默启动旧 dist', { timeout: 30000 }, async (t) => {
  const root = fixture(t)
  const result = await run(t, root, 'verify-host.mjs', ['--current']).done
  assert.equal(result.code, 1)
  assert.match(result.output, /当前源码产物校验失败/)
  assert.doesNotMatch(result.output, /验证宿主：http/)
})

test('构建失败时不启动宿主，保留非零退出码', { timeout: 30000 }, async (t) => {
  const root = fixture(t)
  const result = await run(t, root, 'verify-host.mjs', ['--build'], { TEST_BUILD_FAIL: '1' }).done
  assert.equal(result.code, 1)
  assert.match(result.output, /构建失败，未启动验证宿主/)
  assert.doesNotMatch(result.output, /验证宿主：http/)
})

test('保留端口不能被独立宿主占用', { timeout: 30000 }, async (t) => {
  const root = fixture(t)
  for (const port of ['8080', '8765']) {
    const result = await run(t, root, 'verify-host.mjs', [], { PORT: port }).done
    assert.equal(result.code, 1)
    assert.match(result.output, /不能使用 8080 \/ 8765/)
  }
})

test('重建模式使用当前工作树，启动后区分产物匹配与完整验收', { timeout: 30000 }, async (t) => {
  const root = fixture(t)
  const base = await run(t, root, 'verify-host.mjs', ['--build']).ready()
  assert.equal(JSON.parse(readFileSync(join(root, 'built.json'))).cwd, root)
  const status = await fetch(base + '/__verify__/status.json').then((res) => res.json())
  assert.equal(status.root, root)
  assert.equal(status.sourceArtifactsCurrent, true)
  assert.equal(status.finalRebuildRequired, false)
  assert.equal(status.currentSourceVerified, false)
  const html = await fetch(base + '/lark-doc').then((res) => res.text())
  assert.match(html, /\/js\/lark-doc\.umd\.min\.js/)
  const wc = await fetch(base + '/__verify__/lark-doc-wc.js').then((res) => res.text())
  assert.match(wc, /\/js\/lark-doc-element\.umd\.min\.js/)
  assert.doesNotMatch(wc, /import\('lark-doc\/element'\)/)
  for (const path of ['/js/lark-doc.umd.min.js', '/dist/lark-doc-element.umd.min.js', '/examples/element-demo.html']) {
    assert.equal((await fetch(base + path)).status, 200)
  }
  for (const path of ['/src/index.js', '/.git/config', '/node_modules/vue/package.json', '/js/..%2fpackage.json']) {
    assert.equal((await fetch(base + path)).status, 404)
  }
  assert.equal((await fetch(base + '/js/%00')).status, 400)
  assert.equal((await fetch(base + '/lark-doc', { method: 'POST' })).status, 405)
})

test('现有 dist 诊断模式明确报告过期且不自动构建', { timeout: 30000 }, async (t) => {
  const root = fixture(t)
  const base = await run(t, root, 'verify-host.mjs').ready()
  const status = await fetch(base + '/__verify__/status.json').then((res) => res.json())
  assert.equal(status.sourceArtifactsCurrent, false)
  assert.equal(status.finalRebuildRequired, true)
  assert.equal(status.currentSourceVerified, false)
  assert.match(status.note, /--build/)
})

test('运行器转发同一宿主的 Vue、WC、element 地址并探活实际端口', { timeout: 30000 }, async (t) => {
  const root = fixture(t)
  const base = await run(t, root, 'verify-host.mjs', ['--current'], { TEST_CURRENT: '1' }).ready()
  writeFileSync(join(root, 'scripts/verify-browser-routing.js'), `const vue = process.argv[2] || 'http://localhost:8080/lark-doc'
const wc = process.argv[3] || 'http://localhost:8080/lark-doc-wc'
const element = process.argv[4] || 'http://localhost:8765/examples/element-demo.html'
console.log(JSON.stringify([vue, wc, element]))
`)
  const result = await run(t, root, 'verify.mjs', ['routing'], { BASE_URL: base }).done
  assert.equal(result.code, 0, result.output)
  assert.doesNotMatch(result.output, /没响应|requiredPorts|FAIL/)
  const urls = JSON.parse(readFileSync(join(root, '_codex/verify-logs/routing.log'), 'utf8'))
  assert.deepEqual(urls, [base + '/lark-doc', base + '/lark-doc-wc', base + '/examples/element-demo.html'])
})
