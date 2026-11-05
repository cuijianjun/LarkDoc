'use strict'

// T032 acceptance: Chromium device emulation, explicitly not a Safari/device claim.
const assert = require('assert').strict
const fs = require('fs')
const path = require('path')
const { chromium, devices } = require('playwright-core')
const BASE = process.argv[2] || 'http://127.0.0.1:54189/lark-doc'
const ROOT = path.resolve(__dirname, '..')
function executable() {
  const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright')
  for (const dir of fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
    for (const suffix of ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = path.join(cache, dir, suffix)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error('No Chromium executable')
}
async function main() {
  const browser = await chromium.launch({ executablePath: executable(), headless: true })
  let passed = 0
  const results = []
  const artifactFailures = []
  const interactionFailures = []
  try {
    for (const [name, options] of [
      ['phone', { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } }],
      ['tablet', { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } }],
    ]) {
      const context = await browser.newContext(options)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(String(e)))
      await page.goto(BASE, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
      const status = await (await context.request.get(new URL('/__verify__/status.json', BASE).href)).json()
      assert.equal(status.root, ROOT)
      try { assert.equal(status.sourceArtifactsCurrent, true) } catch (error) {
        artifactFailures.push({ name, error: error.message, artifactCheck: status.artifactCheck })
        console.error(`FAIL ${name}: 当前源码产物匹配断言失败；继续验证现有 dist 的交互`)
      }
      await page.evaluate(() => {
        const nativeHost = window.__larkDoc?._handle?.nativeHost?.host
        if (nativeHost?.editor && typeof nativeHost.loadComments === 'function') {
          window.__mobileEditor = nativeHost
          return
        }
        const queue = [document.querySelector('.lark-doc-editor')?.__vue__, window.__larkDoc.getWorkspace(), window.__verifyHostVm]
        const seen = new Set()
        while (queue.length) {
          const vm = queue.shift()
          if (!vm || seen.has(vm)) continue
          seen.add(vm)
          if (typeof vm.loadComments === 'function' && vm.editor) { window.__mobileEditor = vm; return }
          queue.push(...(vm.$children || []))
        }
        throw new Error('Editor component unavailable')
      })
      const dimensions = await page.evaluate(() => ({ width: innerWidth, touch: navigator.maxTouchPoints, dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth - innerWidth }))
      assert.equal(dimensions.width, options.viewport.width)
      assert.ok(dimensions.touch > 0)
      assert.equal(dimensions.dpr, options.deviceScaleFactor)
      assert.ok(dimensions.overflow <= 1, JSON.stringify(dimensions))
      console.log(`PASS ${name}: 宿主路径、touch/DPR/viewport、无横向溢出；sourceArtifactsCurrent=${status.sourceArtifactsCurrent}`)
      passed++
      await page.evaluate(() => {
        const vm = window.__mobileEditor
        vm.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'mobile-anchor' }, content: [{ type: 'text', text: 'Mobile anchor text' }] }] })
        vm.editor.commands.focus('end')
      })
      await page.keyboard.type(' persisted')
      const before = await page.evaluate(() => window.__mobileEditor.editor.getJSON())
      await page.setViewportSize({ width: options.viewport.height, height: options.viewport.width })
      await page.waitForFunction(() => window.__mobileEditor.viewportOrientation === 'landscape')
      assert.deepEqual(await page.evaluate(() => window.__mobileEditor.editor.getJSON()), before)
      await page.setViewportSize(options.viewport)
      await page.waitForFunction(() => window.__mobileEditor.viewportOrientation === 'portrait')
      assert.deepEqual(await page.evaluate(() => window.__mobileEditor.editor.getJSON()), before)
      console.log(`PASS ${name}: keyboard input and portrait/landscape preserve full document identity`)
      passed++
      await page.evaluate(async () => { window.__mobileEditor.setMode('read'); await window.__mobileEditor.$nextTick() })
      await page.waitForFunction(() => !window.__mobileEditor.editor.isEditable)
      const readBefore = await page.evaluate(() => window.__mobileEditor.editor.getJSON())
      await page.locator('.ProseMirror').first().tap()
      await page.keyboard.type('MUST_NOT_WRITE')
      assert.deepEqual(await page.evaluate(() => window.__mobileEditor.editor.getJSON()), readBefore)
      await page.evaluate(() => window.__mobileEditor.setMode('edit'))
      await page.waitForFunction(() => window.__mobileEditor.editor.isEditable)
      console.log(`PASS ${name}: touch reading mode refuses keyboard writes and edit mode recovers`)
      passed++
      // Injectable host boundary: deterministic second-account/comments evidence, not a live tenant.
      await page.evaluate(async () => {
        const vm = window.__mobileEditor
        if (!vm.session) throw new Error('Host session missing')
        window.__mobileThreads = [{ id: 'mobile-thread', blockId: 'mobile-anchor', anchor: { blockId: 'mobile-anchor', offset: 0, length: 6 }, quote: 'Mobile', resolved: false, createdAt: Date.now(), replies: [{ id: 'mobile-reply', author: { id: 'account-b', name: 'Second account' }, content: 'Emulated account reply', createdAt: Date.now() }] }]
        vm.session.setProvider('comments', {
          list: async () => window.__mobileThreads,
          createThread: async () => { throw new Error('Not used') },
          reply: async ({ content, author }) => { const reply = { id: 'reply-added', author, content, createdAt: Date.now() }; window.__mobileThreads[0].replies.push(reply); return reply },
          resolve: async () => { window.__mobileThreads[0].resolved = true; return window.__mobileThreads[0] },
          reopen: async () => { window.__mobileThreads[0].resolved = false; return window.__mobileThreads[0] },
          remove: async () => {},
        })
        await vm.loadComments()
        vm.activateComment('mobile-thread')
      })
      await page.getByRole('dialog', { name: '评论', exact: true }).waitFor()
      assert.ok(await page.getByText('Emulated account reply', { exact: true }).isVisible())
      await page.getByRole('textbox', { name: '回复', exact: true }).fill('Mobile reply roundtrip')
      await page.getByRole('button', { name: '发送', exact: true }).tap()
      await page.getByText('Mobile reply roundtrip', { exact: true }).waitFor()
      const comments = await page.evaluate(async () => { const vm = window.__mobileEditor; await vm.loadComments(); return { bound: vm.commentThreads[0].bound, replies: vm.commentThreads[0].replies.length } })
      assert.equal(comments.bound, true)
      assert.equal(comments.replies, 2)
      console.log(`PASS ${name}: second-account comment visible, touch reply and provider reread retain anchor`)
      passed++
      await page.evaluate(async () => {
        const vm = window.__mobileEditor
        vm.session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canEdit: true, canComment: false, canResolveComment: false }) })
        await vm.session.refreshCapabilities()
        await vm.$nextTick()
      })
      assert.equal(await page.getByRole('textbox', { name: '回复', exact: true }).evaluate(el => el.readOnly), true)
      const denied = await page.evaluate(async () => {
        const vm = window.__mobileEditor
        vm.setCommentDraft('mobile-thread', 'DENIED')
        await vm.submitCommentDraft('mobile-thread')
        await vm.resolveComment('mobile-thread')
        return { replies: window.__mobileThreads[0].replies.length, resolved: window.__mobileThreads[0].resolved }
      })
      assert.deepEqual(denied, { replies: 2, resolved: false })
      await page.evaluate(async () => {
        const vm = window.__mobileEditor
        vm.session.setProvider('authorization', { getCapabilities: async () => ({ canView: false }) })
        await vm.session.refreshCapabilities()
        await vm.loadComments()
      })
      assert.equal(await page.locator('.lark-doc-comment-panel').count(), 0)
      console.log(`PASS ${name}: comment permission downgrade refuses writes, no-view clears comments`)
      passed++
      await page.evaluate(async () => {
        const vm = window.__mobileEditor
        vm.session.setProvider('authorization', { getCapabilities: async () => ({ canView: true, canRestoreVersion: false, canCreateVersion: false }) })
        await vm.session.refreshCapabilities()
        const record = { id: 'mobile-version', label: 'Mobile saved version', createdAt: Date.now(), author: { id: 'account-b', name: 'Second account' }, kind: 'manual', blockCount: 1, payload: new Uint8Array([1, 2, 3]) }
        window.__mobileRestoreCalls = 0
        vm.session.setProvider('versioning', { list: async () => [record], get: async () => record, createSnapshot: async () => { throw new Error('Write must not be called') }, restore: async () => { window.__mobileRestoreCalls++; throw new Error('Restore must not be called') } })
        await vm.openVersionPanel()
        await vm.selectVersion(record.id)
      })
      await page.locator('.lark-doc-version-layer').waitFor()
      const version = await page.evaluate(async () => {
        const vm = window.__mobileEditor
        const before = JSON.stringify(vm.editor.getJSON())
        const denied = await vm.restoreSelectedVersion()
        return { preview: vm.versionPreview.id, disabled: vm.versionRestoreDisabled, unchanged: JSON.stringify(vm.editor.getJSON()) === before, denied: denied == null }
      })
      assert.deepEqual(version, { preview: 'mobile-version', disabled: true, unchanged: true, denied: true })
      assert.equal(await page.evaluate(() => window.__mobileRestoreCalls), 0)
      const restoreBounds = await page.locator('.lark-doc-version-restore').boundingBox()
      try {
        assert.ok(restoreBounds && restoreBounds.x >= 0 && restoreBounds.x + restoreBounds.width <= options.viewport.width, 'Version restore control must fit inside the emulated viewport')
      } catch (error) {
        const failure = { name, error: error.message, restoreBounds, viewport: options.viewport }
        interactionFailures.push(failure)
        const dir = path.join(ROOT, '_codex/verify-logs')
        fs.mkdirSync(dir, { recursive: true })
        await page.screenshot({ path: path.join(dir, `mobile-${name}-version-overflow.png`) })
        console.error(`FAIL ${name}: 版本恢复控件越界 ${JSON.stringify(failure)}`)
      }
      assert.ok(await page.getByText('Mobile saved version', { exact: true }).first().isVisible())
      await page.getByRole('button', { name: '返回文档', exact: true }).tap()
      await page.waitForFunction(() => !document.querySelector('.lark-doc-version-layer'))
      console.log(`${interactionFailures.some(f => f.name === name) ? 'FAIL' : 'PASS'} ${name}: 版本面板、快照元数据及禁止恢复不改文档；恢复控件边界单独记录`)
      if (!interactionFailures.some(f => f.name === name)) passed++
      assert.deepEqual(errors, [])
      results.push({ name, dimensions, restoreBounds, checks: 6, pageErrors: errors })
      await context.close()
    }
    const dir = path.join(ROOT, '_codex/verify-logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'mobile-evidence.json'), JSON.stringify({ browser: browser.version(), engine: 'Chromium', acceptance: 'Chromium 设备模拟；不代表真机、Safari 或真实跨账号验证', passed, results, artifactFailures, interactionFailures }, null, 2))
    console.log(`${artifactFailures.length || interactionFailures.length ? 'FAIL' : 'PASS'} 交互 ${passed}/12；产物匹配失败 ${artifactFailures.length}；Chromium 设备模拟，非真机/Safari`)
    if (artifactFailures.length || interactionFailures.length) process.exitCode = 1
  } finally { await browser.close() }
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1 })
