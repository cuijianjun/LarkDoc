'use strict'

/**
 * 浏览器级 AI provider 闭环：宿主接口、两字段直连、request、响应格式及异常。
 * 宿主回调与 Playwright 路由提供确定性响应。
 */
const assert = require('assert')
const { chromium } = require('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:58742/lark-doc?verify=1'
const results = []

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PERF_BROWSER_EXECUTABLE })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const check = (name, passed, detail) => {
    results.push(passed)
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
    assert(passed, name)
  }
  const panel = () => page.locator('.lark-doc-ai-panel')
  const result = () => panel().locator('.lark-doc-ai-result').first().innerText()
  const observed = []
  let gatewayRejects = false
  await page.route('**/api/browser-test/**', async route => {
    const req = route.request()
    observed.push({ url: new URL(req.url()).pathname, method: req.method(), auth: req.headers().authorization, body: req.postDataJSON() })
    if (req.url().endsWith('/endpoint')) {
      await route.fulfill({ json: { content: 'Host endpoint response' } })
    } else if (gatewayRejects) {
      await route.fulfill({ status: 401, contentType: 'text/plain', body: 'upstream denied native-fake-key\nresponse-must-not-preview' })
    } else {
      const content = observed.length === 4 ? 'New response after retry' : 'Native streaming response'
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` })
    }
  })

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
            return { ok: true, status: 200, body: 'data: {"choices":[{"delta":{"content":"SSE direct response"}}]}\n\ndata: [DONE]\n\n' }
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
    check('SSE 帧仅正文写入 AI 预览，服务显示已接入', (await result()).trim() === 'SSE direct response' && await panel().innerText().then(text => text.includes('已接入')))

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

    const useAI = async provider => {
      if (provider) await page.evaluate(aiProvider => window.__larkDoc.patchProps({ aiProvider }), provider)
      await page.evaluate(() => {
        const doc = window.__larkDoc
        const editor = doc.getEditor()
        editor.commands.setTextSelection({ from: 1, to: editor.state.doc.firstChild.nodeSize - 1 })
        doc.getWorkspace().startAI('rewrite')
      })
    }
    const previewContains = text => panel().locator('.lark-doc-ai-result').filter({ hasText: text }).waitFor()
    await useAI('/api/browser-test/endpoint')
    await previewContains('Host endpoint response')
    check('仅接口地址通过原生 XHR 发起请求并显示 JSON 结果',
      observed[0]?.url === '/api/browser-test/endpoint' && observed[0].method === 'POST' && observed[0].body.action === 'rewrite')

    await useAI({ baseurl: '/api/browser-test/v1/', api_key: 'native-fake-key' })
    await previewContains('Native streaming response')
    check('仅 baseurl 和 api_key 发起 OpenAI 兼容请求，SSE 返回进入预览',
      observed[1]?.url === '/api/browser-test/v1/chat/completions' && observed[1].auth === 'Bearer native-fake-key'
      && observed[1].body.model === 'gpt-4o-mini' && observed[1].body.stream === true
      && observed[1].body.messages?.[1]?.content === 'AI direct request browser fixture'
      && (await result()).trim() === 'Native streaming response')

    gatewayRejects = true
    const originalText = await page.evaluate(() => window.__larkDoc.getText())
    await useAI()
    const unauthorized = panel().locator('[role="alert"]').filter({ hasText: 'HTTP 401' })
    await unauthorized.waitFor()
    check('401 显示错误，拒绝正文不进入生成结果、密钥遮蔽、文档不变',
      (await unauthorized.innerText()).includes('[redacted]') && !(await panel().innerText()).includes('native-fake-key')
      && await panel().locator('.lark-doc-ai-result').filter({ hasText: 'response-must-not-preview' }).count() === 0
      && await page.evaluate(() => window.__larkDoc.getText()) === originalText)

    gatewayRejects = false
    await useAI()
    await previewContains('New response after retry')
    check('401 后沿原配置重试恢复且错误清除',
      observed.length === 4 && observed[3].url === observed[1].url && observed[3].auth === observed[1].auth
      && await panel().locator('[role="alert"]').count() === 0)
    check('AI 浏览器闭环无页面脚本错误', errors.length === 0, errors)
  } finally {
    await browser.close()
  }
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
