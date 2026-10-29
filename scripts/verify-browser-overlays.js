'use strict'
/**
 * 浏览器级验证：分享 / 权限 / 导出浮层的原生 DOM 契约（阶段 5 批次 5）。
 *
 * 只通过页面 DOM 和公开编辑器方法断言，不依赖 Vue 子组件，因此能锁住原生渲染层的
 * 真实插入/移除、两层分享叠加、加密链接确认、密码弹窗和导出 toast 独立存活行为。
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://localhost:8080/lark-doc'
const results = []

function findChromium() {
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(cache)) return null
  const dirs = fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const dir of dirs) {
    for (const candidate of [
      path.join(cache, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]) if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function record(name, ok, detail = '') {
  results.push(!!ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function editorCall(page, source) {
  return page.evaluate((body) => {
    const anchor = document.querySelector('.lark-doc')
    const seen = new Set()
    const all = []
    const walk = (node) => {
      if (!node || seen.has(node)) return
      seen.add(node)
      all.push(node)
      ;(node.$children || []).forEach(walk)
    }
    walk(anchor && anchor.__vue__ ? anchor.__vue__.$root : null)
    const editor = all.find((node) => node.$options && node.$options.name === 'LarkDocEditor')
    // eslint-disable-next-line no-new-func
    return new Function('editor', `return (async () => { ${body} })()`)(editor)
  }, source)
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() || undefined })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__larkDoc && window.__larkDoc.getEditor && window.__larkDoc.getEditor(), { timeout: 60000 })

  // Demo 默认 session 是降级态；验证完整权限链路时只在页面内打开能力，不改业务逻辑。
  await editorCall(page, 'editor.session = { can: () => true }; editor.$forceUpdate(); editor.refreshOverlays()')
  await page.waitForTimeout(120)

  const initial = await page.evaluate(() => ({
    root: !!document.querySelector('.lark-doc-p6b-layer'),
    entry: !!document.querySelector('.lark-doc-share-entry'),
    popover: !!document.querySelector('.lark-doc-share-popover'),
    permission: !!document.querySelector('.lark-doc-permission-layer'),
    export: !!document.querySelector('.lark-doc-export-backdrop'),
  }))
  record('初始状态只挂载原生宿主与分享入口，条件浮层不在 DOM',
    initial.root && initial.entry && !initial.popover && !initial.permission && !initial.export, JSON.stringify(initial))

  await page.locator('.lark-doc-share-entry button').click()
  await page.waitForTimeout(80)
  const share = await page.evaluate(() => {
    const popover = document.querySelector('.lark-doc-share-popover')
    return {
      open: !!popover,
      role: popover && popover.getAttribute('role'),
      label: popover && popover.getAttribute('aria-label'),
      entry: !!document.querySelector('.lark-doc-share-entry'),
      options: document.querySelectorAll('.lark-doc-share-perm-select option').length,
      toast: !!document.querySelector('.lark-doc-share-toast'),
    }
  })
  record('分享入口打开一级 popover，保留 dialog ARIA 与权限选项',
    share.open && share.role === 'dialog' && share.label === '分享文档' && share.entry && share.options === 2 && !share.toast,
    JSON.stringify(share))

  await page.locator('.lark-doc-share-perm-btn').evaluate((node) => node.click())
  await page.waitForTimeout(80)
  const permission = await page.evaluate(() => ({
    popover: !!document.querySelector('.lark-doc-share-popover'),
    layer: !!document.querySelector('.lark-doc-permission-layer'),
    mask: !!document.querySelector('.lark-doc-permission-mask'),
    dialog: (() => {
      const node = document.querySelector('.lark-doc-permission-dialog')
      return node ? { role: node.getAttribute('role'), label: node.getAttribute('aria-label') } : null
    })(),
    outsideDesc: document.querySelector('.lark-doc-permission-desc')?.textContent.trim(),
    secure: !!document.querySelector('.lark-doc-secure-link'),
  }))
  record('权限 Dialog 打开时一级 popover 保持打开，遮罩与结构真实存在',
    permission.popover && permission.layer && permission.mask && permission.dialog &&
      permission.dialog.role === 'dialog' && permission.dialog.label === '权限设置' &&
      permission.outsideDesc === '仅"可管理权限"可以将内容分享到组织外' && permission.secure,
    JSON.stringify(permission))

  const switchNode = page.locator('.lark-doc-secure-link-desc')
  await switchNode.evaluate((node) => node.click())
  await page.waitForTimeout(80)
  const confirm = await page.evaluate(() => ({
    open: !!document.querySelector('.lark-doc-share-confirm'),
    checked: document.querySelector('.lark-doc-secure-link-checkbox')?.checked,
    passwordArea: !!document.querySelector('.lark-doc-secure-link-password-area'),
  }))
  record('开启加密链接先显示确认框，不提前勾选或插入密码区',
    confirm.open && confirm.checked === false && !confirm.passwordArea, JSON.stringify(confirm))

  await page.locator('.lark-doc-share-confirm .lark-doc-share-btn-outlined').evaluate((node) => node.click())
  await page.waitForTimeout(80)
  record('取消加密链接确认后确认框真实移除', !(await page.locator('.lark-doc-share-confirm').count()))

  await page.locator('.lark-doc-permission-layer .lark-doc-share-close').evaluate((node) => node.click())
  await page.waitForTimeout(80)
  record('关闭权限 Dialog 后权限层真实移除且 popover 仍由业务层单独控制',
    !(await page.locator('.lark-doc-permission-layer').count()) && !!(await page.locator('.lark-doc-share-popover').count()))

  await editorCall(page, 'editor.openExportDialog("word")')
  await page.waitForTimeout(80)
  const exportState = await page.evaluate(() => {
    const panel = document.querySelector('.lark-doc-export-panel')
    return {
      backdrop: !!document.querySelector('.lark-doc-export-backdrop'),
      panel: !!panel,
      role: panel && panel.getAttribute('role'),
      modal: panel && panel.getAttribute('aria-modal'),
      label: panel && panel.getAttribute('aria-label'),
      radios: document.querySelectorAll('.lark-doc-export-radio-input').length,
    }
  })
  record('导出 Dialog 保留 role/aria-modal/动态标题和 radio 组',
    exportState.backdrop && exportState.panel && exportState.role === 'dialog' && exportState.modal === 'true' &&
      exportState.label === '导出 Word 设置' && exportState.radios === 2, JSON.stringify(exportState))

  await page.locator('.lark-doc-export-submit').evaluate((node) => node.click())
  await page.waitForTimeout(80)
  const afterSubmit = await page.evaluate(() => ({
    backdrop: !!document.querySelector('.lark-doc-export-backdrop'),
    toast: document.querySelector('.lark-doc-export-toast')?.textContent.trim(),
    live: document.querySelector('.lark-doc-export-toast')?.getAttribute('aria-live'),
  }))
  record('提交导出先真实移除 Dialog，toast 独立保留并带 aria-live',
    !afterSubmit.backdrop && afterSubmit.toast === '正在导出文档' && afterSubmit.live === 'polite', JSON.stringify(afterSubmit))

  record('无浏览器脚本错误', errors.length === 0, errors.join(' | '))
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
