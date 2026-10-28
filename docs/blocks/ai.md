# AI 组件

## 概述

AI 组件提供选区 / 整块的 AI 交互面板，内置 11 种动作（续写、改写、扩写、精简、摘要、翻译、校对、正式语气、友好语气、生成标题、生成大纲）。默认由内置 Mock 流式输出驱动，可完整走通交互；接入真实模型只改 `ai` 一项配置，**不需要写传输层、不需要写渲染逻辑**。

接入分三档，按宿主的能力和诉求选一档即可：

| 档次 | 写法 | 谁负责发请求 | 谁负责显示 | 适合 |
| --- | --- | --- | --- | --- |
| **L1 只给地址** | `ai: '/api/ai'` | 组件内置（XHR + SSE 解析） | 组件内置 | 后端自己封装了 AI 网关 |
| **L2 直连模型** | `ai: { protocol: 'openai', baseURL, apiKey, model }` | 组件内置 | 组件内置 | 有 OpenAI 兼容服务，想省掉后端 |
| **L3 自管传输** | `ai: { stream(args) { … } }` | 宿主 | 组件内置 | 已有 SDK / 签名 / 加密 / 特殊协议 |

> `ai` 的三档写法会在内部归一化成同一个 `{ kind, protocol, contentFormat, stream(args) }` 契约，下游只认这一种形态，因此三档可以随时升降级，不用改调用代码。

## 配置内容

### 方式一：只给接口地址（推荐，最省事）

```ts
import { LarkDoc } from 'lark-doc'

new LarkDoc({
  element: '#editor',
  features: { ai: true },
  // 字符串等价于 { endpoint: '…', protocol: 'auto' }
  ai: '/api/ai',
})
```

需要显式指定协议时写成对象：

```ts
new LarkDoc({
  element: '#editor',
  ai: {
    endpoint: '/api/ai',
    protocol: 'auto',        // 'auto' | 'openai' | 'chatStream' | 'json'
    headers: () => ({ Authorization: `Bearer ${getToken()}` }),
    contentFormat: 'markdown', // 结果按 markdown 渲染并落正文
  },
})
```

#### 后端契约

组件发出的请求体是扁平参数，`action` 就是宿主区分「续写 / 润色 / 翻译」的依据：

```http
POST /api/ai
Content-Type: application/json;charset=UTF-8
Accept: text/event-stream, application/json, text/plain, */*
```

```json
{
  "action": "rewrite",
  "text": "待处理的正文",
  "prompt": "用户在面板里补的要求，可空",
  "language": "zh",
  "range": { "from": 12, "to": 48, "source": "selection" }
}
```

响应支持三种形态，组件会**自动识别**，后端改成哪种都不用改前端：

| 形态 | 响应体 | 识别方式 |
| --- | --- | --- |
| SSE 流式 | `data: {"content":"你"}` 逐帧，空行分隔，末尾 `data: [DONE]` | 首块出现 `data:` / `event:` / `id:` 行 |
| 整包 JSON | `{"content":"完整结果"}` | 首块是 `{` 或 `[` 且能整体 `JSON.parse` |
| 纯文本 | 直接吐字 | 首块含换行，或长度超过 4KB |

SSE 帧里的文本字段名不固定，以下都能取到（按顺序探测，最多 4 层）：

```
choices[0].delta.content / choices[0].message.content / choices[0].text
content / text / delta / answer / output / reply / chunk / token
message.{…} / data.{…} / result.{…}
```

结束信号认 `[DONE]`、`{"done":true}`、`{"event":"finish"}`、`choices[0].finish_reason` 以及事件名 `done|end|finish|complete|message_end`。错误给 `{"error":"…"}` 或 `{"success":false,"message":"…"}` 即可，组件会把文案抛到面板错误态。

### 方式二：直连模型服务

```ts
new LarkDoc({
  element: '#editor',
  ai: {
    protocol: 'openai',
    baseURL: process.env.VUE_APP_AI_BASE_URL, // 如 https://api.openai.com/v1
    apiKey: process.env.VUE_APP_AI_KEY,       // 自动补 Authorization: Bearer …
    model: process.env.VUE_APP_AI_MODEL,
    contentFormat: 'markdown',
  },
})
```

- 实际地址 = `baseURL` 去掉末尾斜杠 + `/chat/completions`，可用 `urlPath` 覆盖。
- 请求体 = `{ model, stream, messages }`，`messages` 是 `[{role:'system'},{role:'user'}]` 两条，指令由组件按动作生成（11 个动作的指令内置在 `prompt.js`，翻译会把目标语言拼进去）。
- 需要自己控制 `messages` 时传 `messages: (args) => [...]`。

::: tip 密钥不要进仓库
`apiKey` 支持传函数，渲染时再取值；也可以整体走宿主后端代理，用方式一。前端直连模型服务意味着密钥会进浏览器，仅建议内网或自用场景。
:::

### 方式三：自管传输（兼容旧写法）

```ts
new LarkDoc({
  element: '#editor',
  ai: {
    contentFormat: 'markdown',
    stream(args) {
      const { action, text, prompt, language, onStart, onChunk, onDone, onCancelled, onError } = args
      const controller = mySdk.chat({
        prompt: buildPrompt(action, text, prompt),
        onOpen: onStart,
        onDelta: onChunk,      // 逐字回调，只传增量文本
        onFinish: onDone,
        onError,
      })
      return { cancel: () => controller.abort() }
    },
  },
})
```

这一档的入参与返回值与历史版本**完全一致**，老接入不需要任何改动。`stream` 也可以写成 `generate`（别名），或者直接把函数当 `ai` 传：

```ts
ai: (args) => ({ cancel() {} })
```

### `stream(args)` 契约

入参是一个对象（**不是位置参数**）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `action` | `string` | 动作值与 `AI_ACTIONS` 一致，如 `rewrite`、`translate`；面板输入框提交时为 `custom`，问答为 `chat`。 |
| `text` | `string` | 上下文正文（按 `AI_CONTEXTS` 取选区 / 当前块 / 全文）。 |
| `prompt` | `string` | 用户在面板里补的要求，未填为空串。 |
| `language` | `string` | 目标语言，`translate` 用；未设置为空串。 |
| `range` | `{ from, to, source }` | 生成时的文档位置快照，用于结果回落。 |
| `context` | `object` | 上下文快照（含上下文来源、块信息等），排查问题用。 |

回调（**全部可选**，但建议至少实现 `onChunk` 与 `onError`）：

| 回调 | 说明 |
| --- | --- |
| `onStart()` | 首块开始输出时触发一次，用于切换「生成中」。 |
| `onChunk(text)` | 增量文本，**只传新增部分**，组件自己累加。 |
| `onDone()` | 正常结束，触发一次。 |
| `onCancelled()` | 用户点了停止。 |
| `onError(error)` | 出错，传 `Error` 对象，`message` 会显示在面板上。 |

返回值需要提供 `cancel()`；返回一个函数时组件会自动包成 `{ cancel }`。

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.ai` | `boolean` | `true` | 关闭后 AI 面板与工具栏入口隐藏。 |
| `ai` | `string \| object \| function` | 内置 Mock | 三档接入任选其一；传 `null` / `false` 回落 Mock。 |
| `ai.enabled` | `boolean` | `true` | 显式置 `false` 关闭接入（同时回落 Mock），便于按环境开关。 |
| `ai.endpoint` | `string` | — | 自家 AI 网关地址；别名 `url`、`api`。 |
| `ai.baseURL` | `string` | — | OpenAI 兼容服务基址；别名 `baseUrl`。配了它且没配 `endpoint` 时协议默认 `openai`。 |
| `ai.urlPath` | `string` | `/chat/completions` | `openai` 协议拼接的路径。 |
| `ai.apiKey` | `string \| () => string` | — | 自动补 `Authorization: Bearer …`；已有同名头则跳过。 |
| `ai.model` | `string` | — | 仅 `openai` 协议，写进请求体。 |
| `ai.protocol` | `'auto' \| 'openai' \| 'chatStream' \| 'json'` | `auto` | 决定请求体形状与帧解析方式。 |
| `ai.contentFormat` | `'auto' \| 'markdown' \| 'html' \| 'text'` | `auto` | 结果按什么格式渲染预览并落正文。 |
| `ai.headers` | `object \| () => object` | `{}` | 额外请求头，函数形式每次请求实时求值。 |
| `ai.params` | `object` | — | 合并进请求体的额外字段，如 `{ temperature: 0.2 }`。 |
| `ai.messages` | `(args) => Message[]` | 组件生成 | 仅 `openai` 协议，覆盖默认 `system + user`。 |
| `ai.transformRequest` | `(request, args) => request` | — | 发请求前整体改写 `{ url, headers, body }`。 |
| `ai.stream`（布尔） | `boolean` | `true` | 置 `false` 时不做流式，一次性接收整包结果。 |
| `ai.timeout` | `number` | `0` | 毫秒；流式建议保持 `0`。 |
| `ai.withCredentials` | `boolean` | `false` | 跨域带 cookie。 |
| `ai.stream`（函数） | `(args) => { cancel }` | — | 方式三的自管传输钩子。与上面的流式开关同名，按类型区分。 |

### 显示控制：`contentFormat`

AI 返回的多半是 markdown，直接塞进文档会露出 `**` 和 `#`。`contentFormat` 决定这些标记怎么处理：

| 值 | 预览 | 落正文 |
| --- | --- | --- |
| `auto`（默认） | 内容含 markdown 语法时按富文本渲染，否则显示原文 | 富文本时解析成标题 / 列表 / 粗体；纯文本保持原样 |
| `markdown` | 一律按 markdown 渲染 | 解析成真实格式 |
| `html` | 按宿主给的 HTML 渲染 | 直接插入（仍需符合编辑器 schema） |
| `text` | 纯文本 `<pre>` | `insertText`，不解析任何标记 |

额外做了两件防坑的事：

- **单段落结果按行内插入**：「把这句话改正式」这类只产出一段的动作，替换时只换段内文字，不会把光标所在段落切成两段。
- **解析失败回落纯文本**：结果结构超出编辑器 schema 时退回 `insertText`，保证内容不丢。

行内渲染对 `<`、`&` 一律逃生，链接只放行 `http(s):`、`mailto:`、`tel:` 与站内相对路径，`javascript:` 之类的协议会被剥掉 `href` 只留文字。

### 内置动作（AI_ACTIONS）

| value | label | value | label | value | label |
| --- | --- | --- | --- | --- | --- |
| `continue` | 续写 | `rewrite` | 改写 | `expand` | 扩写 |
| `shorten` | 精简 | `summarize` | 摘要 | `translate` | 翻译 |
| `proofread` | 校对 | `formal` | 正式语气 | `friendly` | 友好语气 |
| `title` | 生成标题 | `outline` | 生成大纲 | | |

除这 11 个外，面板输入框提交会带 `action: 'custom'`（`prompt` 是要求、`text` 是内容），问答会带 `action: 'chat'`。

### 上下文来源（AI_CONTEXTS）

| value | label |
| --- | --- |
| `none` | 无上下文 |
| `selection` | 当前选区 |
| `block` | 当前块 |
| `document` | 全文 |

### 交互流程

| 入口 | 行为 |
| --- | --- |
| 工具栏 AI 按钮 / 气泡菜单 | 打开 AI 面板，选择动作与上下文。 |
| 流式输出 | 预览区逐字显示，可随时停止。 |
| 确认 / 放弃 | 确认后写入文档（并入撤销历史）；放弃不改动正文。 |
| 校对 | 额外输出问题清单（Mock 内置规则审查）。 |
| 生成标题 | 只写实例的 `title`，不改正文。 |

## 错误与取消

- HTTP 状态非 2xx 时，错误文案会拼上响应体里的 `message` / `error.message` / `error` / `msg`，直接显示在面板上；非 JSON 响应体截取前 200 字。
- 出错后的后续帧会被丢弃，不会再触发 `onDone`，避免「报错了却又写入半截文本」。
- 同一轮生成里 `onDone` / `onCancelled` / `onError` 只会有一个生效，重复调用被忽略。
- 取消会 `abort` 底层请求并停止轮询，不会留下后台流量。

::: warning 生命周期
`destroy()` 与组件卸载都会先调用 `stopAI()`，进行中的流会被取消，之后到达的 `onChunk` / `onDone` 一律丢弃，不会出现「销毁后还往正文写」的回调。宿主自己发起的请求仍需在 `cancel()` 里真正中断底层连接。
:::

## 调试与自检

```ts
import { ai as aiAdapter } from 'lark-doc'

// 看一眼配置会被归一化成什么
aiAdapter.normalizeAIProvider({ endpoint: '/api/ai', contentFormat: 'markdown' })

// 验证 markdown 渲染结果，确认落正文的 HTML 符合预期
aiAdapter.previewToHtml('## 标题\n\n- 要点', 'markdown')

// 单独试一个动作的指令
aiAdapter.buildMessages('translate', 'hello', '', 'en')
```

`ai` 命名空间还导出 `markdownToHtml` / `looksLikeMarkdown` / `plainTextToHtml` / `singleParagraphInner` / `createSseDecoder` / `createFrameParser` / `pickText` / `extractWholeBody` / `ACTION_PROMPTS`，可以在宿主侧复用同一套解析与渲染，避免出现「组件里显示对了、自己拼的请求却对不上」。
