'use strict'
/**
 * 浏览器级验证：分享 / 权限 / 导出浮层的原生 DOM 契约（阶段 5 批次 5）。
 *
 * 只通过页面 DOM 和公开编辑器方法断言，不依赖 Vue 子组件，因此能锁住原生渲染层的
 * 真实插入/移除、两层分享叠加、加密链接确认、密码弹窗和导出 toast 独立存活行为。
 */
const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
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
    const editor = window.__larkDoc?._handle?.nativeHost?.host || all.find((node) => node.$options && node.$options.name === 'LarkDocEditor')
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
  await editorCall(page, 'window.__overlayOriginalSession = editor.session; editor.session = { can: () => true }; editor.$forceUpdate(); editor.refreshOverlays()')
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

  // Hold the actual export until its pending UI is observed. Fast local DOCX
  // generation may complete before an arbitrary 80ms sleep has elapsed.
  await editorCall(page, `
    const dispatch = editor.dispatchExport.bind(editor)
    editor._verifyOriginalDispatchExport = dispatch
    editor.dispatchExport = (...args) => new Promise((resolve, reject) => {
      editor._releaseVerifyExport = () => Promise.resolve(dispatch(...args)).then(resolve, reject)
    })
  `)
  await page.locator('.lark-doc-export-submit').click()
  await page.locator('.lark-doc-export-toast').waitFor({ state: 'visible' })
  const afterSubmit = await page.evaluate(() => ({
    backdrop: !!document.querySelector('.lark-doc-export-backdrop'),
    toast: document.querySelector('.lark-doc-export-toast')?.textContent.trim(),
    live: document.querySelector('.lark-doc-export-toast')?.getAttribute('aria-live'),
  }))
  record('提交导出先真实移除 Dialog，toast 独立保留并带 aria-live',
    !afterSubmit.backdrop && afterSubmit.toast === '正在导出文档' && afterSubmit.live === 'polite', JSON.stringify(afterSubmit))

  const download = page.waitForEvent('download')
  await editorCall(page, 'return editor._releaseVerifyExport()')
  const exported = await download
  await page.locator('.lark-doc-export-toast').waitFor({ state: 'detached' })
  record('真实 DOCX 下载完成后处理中提示自行消失', /\.docx$/i.test(exported.suggestedFilename()))

  await editorCall(page, 'editor.session = window.__overlayOriginalSession; editor.dispatchExport = editor._verifyOriginalDispatchExport')
  await page.evaluate(() => {
    const provider = window.__larkDocComments.createMemoryCommentsProvider({ threads: [{
      id: 'export-real-comment', blockId: 'export-source', quote: '正文引用导出核验', resolved: false,
      author: { id: 'author', name: '导出核验作者' }, createdAt: 1700000000000,
      replies: [{ id: 'export-real-reply', author: { id: 'author', name: '导出核验作者' }, content: '真实评论导出闭环', createdAt: 1700000000000 }],
    }] })
    window.__larkDoc.getSession().setProvider('comments', provider)
  })
  await editorCall(page, 'editor.openExportDialog("word")')
  await page.locator('.lark-doc-export-radio-input[value="withComments"]').check()
  const commentedDownload = page.waitForEvent('download')
  await page.locator('.lark-doc-export-submit').click()
  const commentWord = await commentedDownload
  const stream = await commentWord.createReadStream(), chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const zip = await JSZip.loadAsync(Buffer.concat(chunks))
  const commentsXML = await zip.file('word/comments.xml').async('string')
  const bodyXML = await zip.file('word/document.xml').async('string')
  record('正文及评论档真实下载含Word原生评论、作者和引用记录', commentsXML.includes('真实评论导出闭环') && commentsXML.includes('导出核验作者') && commentsXML.includes('正文引用导出核验') && bodyXML.includes('commentReference'))
  await page.evaluate(() => { window.__exportPrintCalls = 0; window.print = () => { window.__exportPrintCalls++ } })
  const beforePrintJSON = await editorCall(page, 'return JSON.stringify(editor.editor.getJSON())')
  await editorCall(page, 'editor.openExportDialog("pdf")')
  await page.locator('.lark-doc-export-radio-input[value="withComments"]').check()
  await page.locator('.lark-doc-export-submit').click()
  const printComments = page.locator('[data-lark-doc-export-comments]')
  await printComments.waitFor()
  record('PDF打印附录实际包含评论，且置于受管理编辑器之外', (await printComments.innerText()).includes('真实评论导出闭环') && await printComments.evaluate(node => !node.closest('.ProseMirror')) && await page.evaluate(() => window.__exportPrintCalls === 1))
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await printComments.waitFor({ state: 'detached' })
  record('打印结束清除临时评论且正文JSON保持不变', await editorCall(page, 'return JSON.stringify(editor.editor.getJSON())') === beforePrintJSON)

  await page.evaluate(() => {
    const Facade = window.__larkDoc.document?.constructor || window.__larkDoc.constructor
    window.__larkDoc.destroy()
    const element = document.createElement('div')
    document.body.appendChild(element)
    window.__larkDoc = new Facade({ element, storage: 'none', content: '<p></p>',
      user: { id: 'reminder-self', name: '本地核验用户' },
      comments: window.__larkDocComments.createMemoryCommentsProvider(),
    })
  })
  await page.waitForFunction(() => window.__larkDoc.getEditor())
  await page.locator('.tiptap p').first().click()
  await page.keyboard.type('/reminder')
  await page.locator('[data-command-id="reminder"]').click()
  const reminder = page.locator('.lark-doc-reminder-popover')
  await reminder.waitFor()
  const reminderAttrs = () => editorCall(page, 'return editor.editor.getJSON().content.flatMap(node => node.content || []).flatMap(node => node.marks || []).find(mark => mark.type === "reminder")?.attrs')
  const reminderHeight = async () => Math.round((await reminder.boundingBox()).height)
  record('日期提醒从斜杠菜单插入，包含两开关、当前用户与 280×519 浮层',
    (await reminder.boundingBox()).width === 280 && await reminderHeight() === 519 && await reminder.getByRole('checkbox').count() === 2 && (await reminder.innerText()).includes('提醒：本地核验用户'))
  record('日期提醒的选择框为源端 174×32 尺寸', await reminder.locator('[data-reminder="time"]').evaluate(node => { const r = node.getBoundingClientRect(); return r.width === 174 && r.height === 32 }))
  await reminder.getByRole('checkbox', { name: '设置时间开关' }).uncheck()
  record('关闭时间隐藏时分与输入，浮层减少 40px', await reminderHeight() === 479 && !await reminder.locator('[data-reminder="time"]').count() && (await reminderAttrs()).hasTime === false && !/\d{2}:\d{2}/.test(await page.locator('.lark-doc-reminder-chip').innerText()))
  await reminder.getByRole('checkbox', { name: '提醒开关' }).uncheck()
  record('两开关均关闭时高度 447px，通知状态独立保存', await reminderHeight() === 447 && (await reminderAttrs()).notify === false && !await reminder.locator('[data-reminder="offset"]').count())
  await page.locator('.lark-doc-status').click()
  await reminder.waitFor({ state: 'detached' })
  await editorCall(page, 'const saved = editor.editor.getJSON(); editor.editor.commands.setContent(saved)')
  await page.locator('.lark-doc-reminder-chip').click()
  await reminder.waitFor()
  record('重新进入与 JSON 往返保留两项关闭状态及 447px 面板', await reminderHeight() === 447 && !await reminder.getByRole('checkbox', { name: '设置时间开关' }).isChecked() && !await reminder.getByRole('checkbox', { name: '提醒开关' }).isChecked())
  await reminder.getByRole('checkbox', { name: '设置时间开关' }).check()
  await reminder.getByRole('checkbox', { name: '提醒开关' }).check()
  await reminder.locator('[data-reminder="offset"]').click()
  const offsetList = page.getByRole('listbox', { name: '提前提醒' })
  await offsetList.waitFor()
  const offsetBounds = await offsetList.boundingBox()
  record('提前提醒有九个选项，菜单 166×246', await offsetList.getByRole('option').count() === 9 && offsetBounds.width === 166 && offsetBounds.height === 246)
  await offsetList.getByRole('option', { name: '提前 15 分钟', exact: true }).click()
  record('选择提前量即写入 mark，旧 repeat 属性仍保留', (await reminderAttrs()).notifyOffset === 15 && (await reminderAttrs()).repeat === 'none')
  const timeInput = reminder.getByRole('combobox', { name: '设置时间' })
  await timeInput.click()
  const timeList = page.getByRole('listbox', { name: '提醒时间' })
  await timeList.waitFor()
  const timeBounds = await timeList.boundingBox()
  record('时间下拉有 48 个半小时时段，菜单 166×246', await timeList.getByRole('option').count() === 48 && timeBounds.width === 166 && timeBounds.height === 246)
  await timeInput.fill('13:17')
  record('时间输入保持完整时段列表，草稿不提前写正文', await timeList.getByRole('option').count() === 48 && !/13:17/.test(await page.locator('.lark-doc-reminder-chip').innerText()))
  await timeInput.press('Enter')
  record('Enter 提交任意有效分钟并移出输入焦点', (await page.locator('.lark-doc-reminder-chip').innerText()).includes('13:17') && await timeInput.evaluate(node => node.ownerDocument.activeElement !== node))
  await timeInput.fill('25:99')
  await timeInput.press('Enter')
  record('非法时间回到旧值，正文不变', await timeInput.inputValue() === '13:17' && (await page.locator('.lark-doc-reminder-chip').innerText()).includes('13:17'))
  await timeInput.fill('9:5')
  await timeInput.press('Enter')
  record('单数字时分规范成 09:05', await timeInput.inputValue() === '09:05' && (await page.locator('.lark-doc-reminder-chip').innerText()).includes('09:05'))
  await timeInput.fill('13:18')
  await reminder.click({ position: { x: 6, y: 6 } })
  record('未按 Enter 的时间草稿在失焦时不提交', (await page.locator('.lark-doc-reminder-chip').innerText()).includes('09:05'))
  await reminder.getByRole('checkbox', { name: '设置时间开关' }).uncheck()
  const beforeBrowse = await editorCall(page, 'return editor.editor.getJSON()')
  await reminder.getByRole('button', { name: '选择年份', exact: true }).click()
  const periodGrid = reminder.locator('.lark-doc-reminder-periods')
  record('年份面板包含 20 年、48×32 圆角选项和 248px 网格', await periodGrid.getByRole('gridcell').count() === 20 && (await periodGrid.boundingBox()).height === 248 && await periodGrid.getByRole('gridcell').first().evaluate(node => { const r = node.getBoundingClientRect(); return r.width === 48 && r.height === 32 && getComputedStyle(node).borderRadius === '16px' }))
  const sourceYear = new Date().getFullYear() + 1
  await periodGrid.getByRole('gridcell', { name: String(sourceYear), exact: true }).click()
  await reminder.getByRole('button', { name: '选择月份', exact: true }).click()
  record('月份面板有 12 个圆角选项，浏览年份未改正文', await periodGrid.getByRole('gridcell').count() === 12 && await periodGrid.getByRole('gridcell').first().evaluate(node => getComputedStyle(node).borderRadius === '16px') && JSON.stringify(await editorCall(page, 'return editor.editor.getJSON()')) === JSON.stringify(beforeBrowse))
  await periodGrid.getByRole('gridcell', { name: '2月', exact: true }).click()
  await reminder.getByRole('gridcell', { name: `${sourceYear}年2月3日`, exact: true }).click()
  record('选择年月返回日期网格，选择日期才提交且保留浮层', (await page.locator('.lark-doc-reminder-chip').innerText()) === `${sourceYear}年2月3日` && await reminder.isVisible() && (await reminderAttrs()).hasTime === false)
  record('远期日期使用项目原有主题色', await page.locator('.lark-doc-reminder-chip').evaluate(node => {
    const sample = document.createElement('span')
    sample.style.color = 'var(--ld-brand-chrome)'
    node.parentElement.appendChild(sample)
    const brand = getComputedStyle(node).getPropertyValue('--ld-brand-chrome').trim()
    const matches = !!brand && node.dataset.reminderTone === 'future' && getComputedStyle(node).color === getComputedStyle(sample).color
    sample.remove()
    return matches
  }))
  record('选中日期有实体品牌色圆形背景，避免未知变量让文字消失', await reminder.locator('.lark-doc-reminder-day.is-selected').evaluate(node => {
    const s = getComputedStyle(node)
    const sample = document.createElement('span')
    sample.style.color = 'var(--ld-brand-chrome)'
    node.appendChild(sample)
    const matches = !!s.getPropertyValue('--ld-brand-chrome').trim() && s.backgroundColor === getComputedStyle(sample).color && s.borderRadius === '16px' && s.color !== s.backgroundColor
    sample.remove()
    return matches
  }))
  if (process.env.LARK_DOC_EVIDENCE_DIR) await reminder.screenshot({ path: path.join(process.env.LARK_DOC_EVIDENCE_DIR, 'master-parity-local-reminder-popover.png') })
  await editorCall(page, 'editor.editor.commands.insertContentAt(1, "prefix "); editor.chooseReminderOffset(30)')
  record('打开期间正文编辑映射提醒锚点，后续改动不覆盖前文', (await editorCall(page, 'return editor.editor.state.doc.textContent')).startsWith('prefix ') && (await reminderAttrs()).notifyOffset === 30)
  await editorCall(page, 'editor.editor.commands.deleteRange({ from: editor.reminderFrom, to: editor.reminderTo })')
  await reminder.waitFor({ state: 'detached' })
  const afterDelete = await editorCall(page, 'return editor.editor.getJSON()')
  await editorCall(page, 'editor.chooseReminderTime("10:00"); editor.chooseReminderDay({ year: 2027, month: 1, day: 4 })')
  record('删除当前提醒后关闭浮层，旧控件事件无法改其他文字', JSON.stringify(await editorCall(page, 'return editor.editor.getJSON()')) === JSON.stringify(afterDelete))

  record('无浏览器脚本错误', errors.length === 0, errors.join(' | '))
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 项通过`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch((error) => { console.error(error); process.exit(1) })
