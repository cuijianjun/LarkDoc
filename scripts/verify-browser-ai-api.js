'use strict'

/**
 * 浏览器级 AI provider 闭环：别名配置、宿主 request、流式/JSON/纯文本响应和取消。
 * 不访问外网，request 回调在页面内返回确定性 Response-like 对象。
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
  const panel = () => page.locator('[aria-label="AI 模拟预览"]')
  const result = () => panel().locator('.lark-doc-ai-result').first().innerText()

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__larkDoc?.getEditor?.())
    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      window.__aiMode = 'sse'
      window.__aiRequests = []
      window.__aiCancelled = false
      window.__aiResolve = null
      window.__larkDoc.patchProps({
        config: { features: { ai: true }, network: { mode: 'open' } },
        aiProvider: {
          protocol: 'openai',
          baseurl: '/api/browser-ai',
          api_key: 'browser-key',
          model: 'browser-model',
          request: request => {
            window.__aiRequests.push({ url: request.url, method: request.method, headers: request.headers, body: request.body })
            if (window.__aiMode === 'pending') {
              return new Promise((resolve, reject) => {
                window.__aiResolve = resolve
                request.signal?.addEventListener('abort', () => {
                  window.__aiCancelled = true
                  reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
                }, { once: true })
              })
            }
            if (window.__aiMode === 'json') return { ok: true, status: 200, body: '{"content":"JSON direct response"}' }
            if (window.__aiMode === 'plain') return { ok: true, status: 200, body: 'plain direct response' }
            if (window.__aiMode === 'error') throw new Error('upstream browser-key rejected')
            return { ok: true, status: 200, body: 'data: {"choices":[{"delta":{"content":"SSE direct response"}]}\n\ndata: [DONE]\n\n' }
          },
        },
      })
      window.__larkDoc.setContent('<p>AI direct request browser fixture</p>')
    })
    await page.waitForFunction(() => window.__larkDoc.getText().includes('AI direct request'))
    await page.evaluate(() => window.__larkDoc.getWorkspace().startAI('rewrite'))
    await panel().waitFor()
    await page.waitForFunction(() => window.__aiRequests.length === 1)
    await page.waitForFunction(() => document.querySelector('.lark-doc-ai-result')?.textContent.includes('SSE direct response'))
    const captured = await page.evaluate(() => window.__aiRequests[0])
    check('direct request 收到规范化 URL、Bearer key 和 OpenAI body', captured.url === '/api/browser-ai/chat/completions' && captured.method === 'POST' && captured.headers.Authorization === 'Bearer browser-key' && captured.body.model === 'browser-model' && captured.body.messages?.length >= 1, { url: captured.url, method: captured.method, auth: captured.headers.Authorization, model: captured.body.model, messages: captured.body.messages?.length })
    check('SSE 增量响应写入 AI 预览且 provider 状态显示已接入', (await result()).includes('SSE direct response') && await panel().innerText().then(text => text.includes('已接入')), await panel().innerText())

    await page.evaluate(() => { window.__aiMode = 'pending'; window.__larkDoc.getWorkspace().startAI('rewrite') })
    await page.waitForFunction(() => window.__aiRequests.length === 2)
    await page.getByRole('button', { name: '停止', exact: true }).click()
    await page.waitForFunction(() => window.__aiCancelled === true)
    check('停止按钮通过 AbortSignal 取消 direct request', await page.evaluate(() => window.__aiCancelled) && (await panel().innerText()).includes('已停止'))

    for (const mode of ['json', 'plain']) {
      await page.evaluate(mode => { window.__aiMode = mode; window.__larkDoc.getWorkspace().startAI('rewrite') }, mode)
      await page.waitForFunction(expected => window.__aiRequests.length >= 3 && document.querySelector('.lark-doc-ai-result')?.textContent.includes(expected), mode === 'json' ? 'JSON direct response' : 'plain direct response')
      check(`${mode === 'json' ? '整包 JSON' : '纯文本'}响应写入预览`, (await result()).includes(mode === 'json' ? 'JSON direct response' : 'plain direct response'))
    }

    await page.evaluate(() => { window.__aiMode = 'error'; window.__larkDoc.getWorkspace().startAI('rewrite') })
    await page.waitForFunction(() => window.__aiRequests.length >= 5 && document.querySelector('.lark-doc-ai-panel [role="alert"]')?.textContent)
    const errorText = await panel().locator('[role="alert"]').innerText()
    check('请求错误进入面板且不泄露 api_key', errorText.includes('browser-key') === false && errorText.length > 0, errorText)
    check('AI direct request 浏览器闭环无页面脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
