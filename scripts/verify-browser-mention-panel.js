'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')
const baseUrl = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const evidenceDir = process.env.LARK_DOC_EVIDENCE_DIR || '/tmp/lark-doc-v12e'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
  page.setDefaultTimeout(8000)
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  const fixture = fs.readFileSync(path.join(evidenceDir, 'master-parity-upload-fixture.png'))
  await page.route(/^https?:\/\/mention-avatar\.test\//, async route => {
    requests.push(route.request().url())
    if (route.request().url().endsWith('bad.png')) await route.fulfill({ status: 404, body: '' })
    else await route.fulfill({ status: 200, contentType: 'image/png', body: fixture })
  })
  const check = (name, passed, detail) => { results.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); assert(passed, name) }
  const panel = page.getByRole('dialog', { name: '提及', exact: true })
  const getMention = () => page.evaluate(() => window.__mentionDoc.getJSON().content.flatMap(node => node.content || []).find(node => node.type === 'mention'))
  const open = async () => {
    await page.evaluate(() => window.__mentionDoc.setContent('<p></p>'))
    await page.locator('.tiptap > p').click()
    await page.keyboard.type('@')
    await panel.waitFor()
  }
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.evaluate(avatar => {
      const Facade = (window.__larkDoc.document || window.__larkDoc).constructor
      window.__larkDoc.destroy()
      const element = document.createElement('div')
      document.body.appendChild(element)
      window.__mentionDoc = new Facade({ element, storage: 'none', content: '<p></p>', config: { network: { mode: 'offline' } },
        mentionSource: [
          { kind: 'user', id: 'user-local', name: '核验用户', department: '产品研发', avatar },
          { kind: 'user', id: 'user-remote', name: '远端用户', department: '核验部门', avatar: 'https://mention-avatar.test/avatar.png' },
          { kind: 'user', id: 'user-escaped', name: '伪本地地址', avatar: '/' + String.fromCharCode(92) + 'mention-avatar.test/private.png' },
          { kind: 'user', id: 'user-broken', name: '加载失败', avatar: 'https://mention-avatar.test/bad.png' },
          { kind: 'page', id: 'page-local', name: '核验文档', department: '最近修改：今天' },
          { kind: 'chat', id: 'chat-local', name: '核验群组', department: '核验组织' },
        ],
      })
    }, `data:image/png;base64,${fixture.toString('base64')}`)
    await open()
    check('Typing @ opens the source four tabs with notification unchecked', JSON.stringify(await panel.getByRole('tab').allTextContents()) === JSON.stringify(['全部', '人', '云文档', '群名片']) && !await panel.getByRole('checkbox', { name: '同时发送通知', exact: true }).isChecked())
    const row = panel.getByRole('option').filter({ hasText: '核验用户' })
    await row.locator('img').waitFor()
    const geometry = await row.evaluate(node => {
      const box = e => e.getBoundingClientRect().toJSON()
      const avatar = node.querySelector('.lark-doc-mention-avatar'), main = node.querySelector('.lark-doc-mention-main')
      const name = node.querySelector('.lark-doc-mention-row-name'), dept = node.querySelector('.lark-doc-mention-row-dept')
      return { row: box(node), avatar: box(avatar), main: box(main), name: box(name), dept: box(dept), nameFont: getComputedStyle(name).fontSize, nameLine: getComputedStyle(name).lineHeight, deptFont: getComputedStyle(dept).fontSize, deptLine: getComputedStyle(dept).lineHeight, radius: getComputedStyle(avatar).borderRadius }
    })
    check('Source candidate row is 360×48 with a 32px avatar at the 16px inset', geometry.row.width === 360 && geometry.row.height === 48 && geometry.avatar.width === 32 && geometry.avatar.height === 32 && geometry.avatar.x - geometry.row.x === 16 && geometry.avatar.y - geometry.row.y === 8 && geometry.main.x - geometry.avatar.right === 8, geometry)
    check('Name and department match the source stacked 14/22px and 12/20px typography', geometry.nameFont === '14px' && geometry.nameLine === '22px' && geometry.deptFont === '12px' && geometry.deptLine === '20px' && geometry.dept.y === geometry.name.bottom && geometry.main.height === 42, geometry)
    const footerSize = await panel.locator('.lark-doc-mention-footer').evaluate(node => { const button = node.querySelector('button'); return { height: node.getBoundingClientRect().height, button: button.getBoundingClientRect().toJSON(), font: getComputedStyle(button).fontSize, radius: getComputedStyle(button).borderRadius } })
    check('Source footer is 48px with a 52×32 confirmation and 6px corners', footerSize.height === 48 && footerSize.button.width === 52 && footerSize.button.height === 32 && footerSize.font === '14px' && footerSize.radius === '6px', footerSize)
    const notificationSize = await panel.locator('.lark-doc-mention-notify').evaluate(node => { const input = node.querySelector('input'), text = node.querySelector('span'); return { rect: node.getBoundingClientRect().toJSON(), input: input.getBoundingClientRect().toJSON(), gap: text.getBoundingClientRect().left - input.getBoundingClientRect().right, radius: getComputedStyle(input).borderRadius } })
    check('Notification control matches the source 16px square, 4px corners and 8px gap', notificationSize.rect.width === 108 && notificationSize.rect.height === 22 && notificationSize.input.width === 16 && notificationSize.input.height === 16 && notificationSize.radius === '4px' && notificationSize.gap === 8, notificationSize)
    check('Offline candidates load only the supplied local avatar', requests.length === 0 && await panel.locator('img').count() === 1)
    await page.evaluate(() => window.__mentionDoc.patchProps({ config: { network: { mode: 'open' } } }))
    await page.waitForFunction(() => [...document.querySelectorAll('.lark-doc-mention-row')].find(row => row.textContent.includes('远端用户'))?.querySelector('img')?.naturalWidth === 323)
    await page.waitForFunction(() => ![...document.querySelectorAll('.lark-doc-mention-row')].find(row => row.textContent.includes('加载失败'))?.querySelector('img'))
    check('Live network change loads the allowed photo and broken photos retain their initial', requests.length === 2 && (await panel.getByRole('option').filter({ hasText: '加载失败' }).locator('.lark-doc-mention-avatar').innerText()) === '加')
    await page.evaluate(() => window.__mentionDoc.patchProps({ config: { network: { mode: 'offline' } } }))
    check('Revoking remote access removes old avatar sources while keeping local data', await panel.locator('img').count() === 1 && await row.locator('img').count() === 1 && requests.length === 2)
    await panel.getByRole('tab', { name: '人', exact: true }).click()
    check('Real mouse tab changes filter candidates and preserve the editor focus', await panel.getByRole('option').count() === 4 && await page.locator('.tiptap').evaluate(node => node.contains(document.activeElement)))
    await row.click()
    await panel.waitFor({ state: 'detached' })
    const chosen = await getMention()
    check('Clicking a person persists the real identity with notification false', chosen?.attrs.id === 'user-local' && chosen.attrs.kind === 'user' && chosen.attrs.notify === false && !!chosen.attrs.mentionId)
    await page.keyboard.press('ControlOrMeta+z')
    check('One undo removes the mention and restores the typed query', !await getMention() && await page.evaluate(() => window.__mentionDoc.getText()) === '@')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    check('Redo restores the same mention identity and notification flag', (await getMention())?.attrs.mentionId === chosen.attrs.mentionId && (await getMention()).attrs.notify === false)
    await open()
    await panel.getByRole('checkbox', { name: '同时发送通知', exact: true }).check()
    await panel.getByRole('option').filter({ hasText: '核验用户' }).click()
    check('Explicit local notification selection persists true on a person only', (await getMention())?.attrs.notify === true)
    for (const [tab, kind, id] of [['云文档', 'page', 'page-local'], ['群名片', 'chat', 'chat-local']]) {
      await open()
      await panel.getByRole('tab', { name: tab, exact: true }).click()
      check(`${tab} tab filters the configured directory without inventing records`, await panel.getByRole('option').count() === 1)
      check(`${tab} has no unavailable notification control and keeps confirmation at the right`, await panel.getByRole('checkbox').count() === 0 && await panel.getByRole('button', { name: '提及', exact: true }).evaluate(button => button.getBoundingClientRect().right > button.parentElement.getBoundingClientRect().right - 20))
      await panel.getByRole('option').click()
      const entry = await getMention()
      check(`Selecting ${tab} inserts and reloads the actual node`, entry?.attrs.kind === kind && entry.attrs.id === id && entry.attrs.notify === false)
      const json = await page.evaluate(() => window.__mentionDoc.getJSON())
      await page.evaluate(json => window.__mentionDoc.setContent(json), json)
      check(`${tab} survives JSON reload`, (await getMention())?.attrs.mentionId === entry.attrs.mentionId)
    }
    await open()
    await page.keyboard.type('不存在的候选')
    await panel.getByText('没有匹配结果', { exact: false }).waitFor()
    check('No-match search disables confirmation', await panel.getByRole('button', { name: '提及', exact: true }).isDisabled() && await panel.getByRole('checkbox').count() === 0)
    await page.keyboard.press('Escape')
    check('Escape dismisses without deleting the typed search', await panel.count() === 0 && (await page.evaluate(() => window.__mentionDoc.getText())).includes('@不存在的候选'))
    await open()
    await page.evaluate(() => window.__mentionDoc.setReadonly(true))
    check('Readonly update closes the active mention panel', await panel.count() === 0)
    check('No uncaught page errors', errors.length === 0, errors)
  } catch (error) {
    await page.screenshot({ path: path.join(evidenceDir, 'master-parity-local-mention-failure.png') })
    throw error
  } finally {
    fs.writeFileSync(path.join(evidenceDir, 'master-parity-local-mention.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
