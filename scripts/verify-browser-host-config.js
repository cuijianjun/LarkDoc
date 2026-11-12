'use strict'

/**
 * 浏览器级宿主闭环：动态配置、只读切换、功能开关与销毁。
 *
 * 只通过公开 LarkDoc 门面和 DOM 断言，不读取 Vue 实例或内部 renderer 状态。
 */
const assert = require('assert')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => {
    results.push(passed)
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
    assert(passed, name)
  }
  const waitRender = () => page.waitForTimeout(420)

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(() => window.__larkDoc.setContent('<h1>宿主配置核验</h1><p>动态切换与卸载边界</p>'))
    await waitRender()

    const initial = await page.evaluate(() => ({
      root: !!document.querySelector('.lark-doc'),
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
      outline: !!document.querySelector('.lark-doc-toolbar button[aria-label="目录"]'),
      insert: !!document.querySelector('.lark-doc-toolbar button[aria-label="插入"]'),
      config: window.__larkDoc.getConfig()?.features || null,
    }))
    check('初始宿主实例可编辑且配置/入口可见', initial.root && initial.editable === 'true' && initial.outline && initial.insert, initial)

    await page.evaluate(() => window.__larkDoc.patchProps({ config: { features: { outline: false, insert: false } } }))
    await waitRender()
    const disabled = await page.evaluate(() => ({
      outline: !!document.querySelector('.lark-doc-toolbar button[aria-label="目录"]'),
      outlineAside: !!document.querySelector('.lark-doc-outline'),
      insert: !!document.querySelector('.lark-doc-toolbar button[aria-label="插入"]'),
      config: window.__larkDoc.getConfig()?.features || null,
    }))
    check('运行时关闭目录/插入功能会立即移除入口和目录侧栏', !disabled.outline && !disabled.outlineAside && !disabled.insert, disabled)

    await page.evaluate(() => window.__larkDoc.patchProps({ config: { features: { outline: true, insert: true } } }))
    await waitRender()
    const restored = await page.evaluate(() => ({
      outline: !!document.querySelector('.lark-doc-toolbar button[aria-label="目录"]'),
      insert: !!document.querySelector('.lark-doc-toolbar button[aria-label="插入"]'),
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
    }))
    check('运行时恢复功能后入口和编辑态恢复', restored.outline && restored.insert && restored.editable === 'true', restored)

    await page.evaluate(() => window.__larkDoc.setReadonly(true))
    await waitRender()
    const readonly = await page.evaluate(() => ({
      api: window.__larkDoc.isReadonly(),
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
      writeDisabled: [...document.querySelectorAll('.lark-doc-toolbar .lark-doc-tools button')]
        .filter(button => button.disabled).length,
      enabled: [...document.querySelectorAll('.lark-doc-toolbar .lark-doc-tools button')]
        .filter(button => !button.disabled)
        .map(button => button.getAttribute('aria-label') || button.textContent.trim()),
    }))
    const readonlyViewers = ['查找', '目录', '页面宽度', '阅读模式', '全屏', '演示模式', '快捷键帮助', '文档操作']
    check('只读切换立即锁正文并保留查看类入口', readonly.api && readonly.editable === 'false' && readonly.writeDisabled >= 1 && JSON.stringify(readonly.enabled) === JSON.stringify(readonlyViewers), readonly)

    await page.evaluate(() => window.__larkDoc.setReadonly(false))
    await waitRender()
    const writable = await page.evaluate(() => ({
      api: window.__larkDoc.isReadonly(),
      editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
    }))
    check('解除只读恢复正文编辑能力', !writable.api && writable.editable === 'true', writable)

    const isolated = await page.evaluate(async () => {
      const Klass = window.__larkDoc.constructor
      const host = document.createElement('div')
      host.id = 'host-config-lifecycle-fixture'
      document.body.appendChild(host)
      let destroyEvents = 0
      const instance = new Klass({
        element: host,
        title: '生命周期核验',
        content: '<p>可销毁实例</p>',
        storage: 'none',
        themeStorage: 'none',
        onDestroy: () => { destroyEvents += 1 },
      })
      await new Promise(resolve => setTimeout(resolve, 850))
      const before = { root: !!host.querySelector('.lark-doc'), editor: !!instance.getEditor(), children: host.children.length }
      instance.destroy()
      const afterFirst = { root: !!host.querySelector('.lark-doc'), editor: !!instance.getEditor(), children: host.children.length, config: instance.getConfig() }
      instance.destroy()
      const afterSecond = { root: !!host.querySelector('.lark-doc'), editor: !!instance.getEditor(), children: host.children.length, destroyEvents }
      host.remove()
      return { before, afterFirst, afterSecond }
    })
    check('独立宿主实例 destroy 清理 DOM/编辑器且重复销毁幂等',
      isolated.before.root && isolated.before.editor && isolated.afterFirst.root === false && isolated.afterFirst.editor === false && isolated.afterFirst.children === 0 && isolated.afterFirst.config === null && isolated.afterSecond.destroyEvents === 1,
      isolated)

    await page.evaluate(() => window.__larkDoc.destroy())
    await waitRender()
    const destroyed = await page.evaluate(() => ({
      root: !!document.querySelector('.lark-doc'),
      editor: !!window.__larkDoc.getEditor(),
      config: window.__larkDoc.getConfig(),
      patch: window.__larkDoc.patchProps({ readonly: false }),
    }))
    check('当前演示实例卸载后移除 DOM、编辑器和配置且 patchProps 拒绝写入', !destroyed.root && !destroyed.editor && destroyed.config === null && destroyed.patch === false, destroyed)
    check('宿主生命周期无脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
