# 图片上传：接口配置与完整回调

你可以让库直接把图片上传到服务器，也可以先用本地 base64。Vue2、Vue3、React、Web Component 和原生页面共用同一条图片管线。

## 先选择保存方式

| 方式 | 初始化配置 | 结果 |
| --- | --- | --- |
| 本地 base64 | 不传 `action` 和 `upload`，可以只传回调 | 浏览器读取文件，生成图片 data URI |
| 服务器表单上传 | `uploader: { action, response, ...callbacks }` | 库发送文件，等待地址后写入编辑器 |
| 自定义上传流程 | `uploader: { upload(file, ctx), ...callbacks }` | 应用执行自有协议并返回 `{ url, attchId? }` |

优先级是 **自定义 upload → action HTTP → 本地 base64**。配置服务器上传后，失败会进入错误回调，不会悄悄改成本地 base64。

可以先打开<a href="../demo/?example=base64" target="_blank" rel="noopener">base64 demo</a>查看回调，再打开<a href="../demo/?example=server" target="_blank" rel="noopener">服务器配置 demo</a>。GitHub Pages 只托管静态页面；服务器 demo 需要填入你自己的接口。

## 初始化配置 HTTP 上传

下面是一份可以放进应用的配置。不需要再写 `uploader.upload`，也不需要在成功回调里手动插图。

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

const uploader = {
  action: '/api/upload', // 修改成你的上传接口
  method: 'POST',
  fieldName: 'file',     // 服务端接收文件的表单字段名
  data: { businessType: 'document' },
  timeout: 30000,
  withCredentials: false,
  response: {
    success: { path: 'code', equals: 0 },
    url: 'data.url',
    attchId: 'data.id',
    message: 'message',
  },
  onProgress: event => console.log('上传进度', event.taskId, event.percent),
  onSuccess: event => console.log('取得图片结果', event.taskId),
  onError: event => console.error('上传失败', event.error.message),
  onSettled: event => console.log('任务结束', event.status),
}

const doc = new LarkDoc({
  element: '#editor', // 页面先放 <div id="editor"></div>
  storage: 'none',
  uploader,
  onUpdate: ({ json }) => console.log('正文已更新', json),
})
// 页面卸载时：doc.destroy()
```

这份配置对应下面的服务端 JSON：

```json
{
  "code": 0,
  "message": "上传成功",
  "data": { "url": "/images/a.png", "id": "123" }
}
```

执行顺序为：选择图片 → 发送 multipart 文件 → 等待 HTTP 与业务成功 → 从 `data.url` 读取地址 → 校验地址 → 编辑器插入、替换或更新裁剪结果。`attchId` 是可选附件 ID。

如果后端直接返回 `{ "url": "/images/a.png", "attchId": "123" }`，整个 `response` 都可以省略。图片 URL 可以是 HTTP(S)、相对路径，或 PNG/JPEG/GIF/WebP 的 base64 data URI。相对图片路径按当前页面地址解析；跨域上传服务器通常应返回可直接访问的完整图片 URL。

### 请求与响应字段

| 配置 | 默认值和用途 |
| --- | --- |
| `action` | 上传接口 URL，支持 HTTP(S) 或相对路径；空值/非法地址会失败 |
| `method` | 默认 `POST`，也支持 `PUT` / `PATCH` |
| `fieldName` | 默认 `file`，multipart 文件字段名 |
| `headers` | 请求头对象，或每次请求执行的 `(file, ctx) => object / Promise<object>` |
| `data` | 额外表单字段；仅字符串/数字/布尔值，null/undefined 忽略；不能覆盖文件字段 |
| `timeout` | 默认 30000 毫秒；0 关闭；不包含等待异步 headers 的时间 |
| `withCredentials` | 默认 false；接口确实需要跨域 Cookie 时再启用 |
| `response.url` | 默认 `url`，提取图片地址的点分路径，例如 `data.url` |
| `response.attchId` | 默认 `attchId`，可选附件 ID 的点分路径 |
| `response.success` | 可选 `{ path, equals }`，严格比较业务成功值，例如 code 必须等于数字 0 |
| `response.message` | 可选业务错误消息路径，例如 `message` |

`headers` 可按请求重新读取应用的登录状态；不要把长期凭证写死在示例或日志中。**不要手动设置 Content-Type**，multipart 的 boundary 由浏览器生成。跨域需要服务端允许页面来源、方法及实际请求头；带 Cookie 时还需正确配置凭据 CORS。

字段映射只读取对象自身的点分路径，不执行表达式、不读取原型链。HTTP 错误、业务失败、无效 JSON、无效地址都会触发 error/settled。

### 进度、重试和取消

内置 HTTP 使用 XMLHttpRequest。进度按实际 multipart 传输比例折算为文件级 loaded/total/percent；未知传输总量时不伪造中间百分比。100% 的文件发送进度不代表服务器已经响应成功。

默认只发一次请求。后端允许安全重试时才显式增加 `retry: { attempts: 3, delay: 300 }`；仅已有可重试规则允许的网络错误、429/5xx 或显式 retryable 错误会重试，业务失败不重试。重试不会重复触发 onStart。

`ctx.cancel(reason)` 会中止请求，晚到结果不能写回。内置 HTTP 不推断分片、签名或多步上传协议；需要这些协议时提供自定义 upload。

## 完整回调怎么写

下面可作为前面 `uploader` 的回调部分，也可单独用于本地 base64（不加 action/upload）：

```js
const report = (name, event) => {
  // 示例只记录任务信息，不记录原始文件、base64 或凭证。
  console.log(name, event.taskId, event.source, event.mode, event.status || '')
}

const callbacks = {
  beforeUpload: async (file, ctx) => {
    console.log('上传前检查', ctx.taskId, file.name)
    return true // 返回 false，或 ctx.cancel('原因')，会取消本次任务。
  },
  onStart: event => report('开始', event),
  onProgress: event => console.log('进度', event.taskId, event.percent),
  onRetry: event => console.log('重试', event.taskId, event.nextAttempt),
  onSuccess: event => report('取得图片结果', event),
  onError: event => console.error('失败', event.taskId, event.code, event.error.message),
  onCancel: event => report('取消', event),
  onReject: event => report('文件被拒绝', event),
  onSettled: event => report('结束', event),
  onCallbackError: error => console.error('应用回调自身出错', error.message),
}

// 本地 base64：
const localDoc = new LarkDoc({ element: '#editor', storage: 'none', uploader: callbacks })
// 服务端模式则使用：uploader: { ...callbacks, action: '/api/upload', response: ... }
```

| 方法 / 回调 | 时机与参数 |
| --- | --- |
| `beforeUpload(file, ctx)` | 文件校验后、开始前；等待其 Promise；false 表示取消 |
| `onStart(event)` | 前置检查通过后开始一次 |
| `onProgress(event)` | 文件级 loaded/total/percent；重试和分片时保持单调，不超过 100% |
| `onRetry(event)` | 带 error、attempt、nextAttempt；分片时增加 chunk |
| `onSuccess(event)` | `event.result` 是已经通过校验的 `{ url, attchId?, ... }` |
| `onError(event)` | 请求、读取、前置检查异常或结果格式失败，带稳定 code/error |
| `onCancel(event)` | 前置否决、应用取消或生命周期结束，带 reason |
| `onReject(event)` | 类型/大小校验拒绝，不执行上传 |
| `onSettled(event)` | 唯一终态后执行一次，status 是 success/error/cancelled/rejected |
| `onCallbackError(error)` | 通知回调自身抛错或 Promise 拒绝；用于应用记录回调异常 |

正常顺序：**校验 → beforeUpload → onStart → 进度/重试 → onSuccess → onSettled**。校验拒绝走 onReject/settled；取消走 onCancel/settled；失败走 onError/settled。成功时不会额外触发失败或取消回调。

除 beforeUpload 外，通知回调不阻塞任务；它们自身出错不会让图片重新上传，也不会递归调用 onError。onCallbackError 接收的是 Error，不是上传 event。

### source、mode 和写入状态

ctx 和上传事件包含 `taskId`、`documentId`、原始 `file`、`source`、`mode`、`signal`、`cancel(reason?)`，并按时机增加 result/error/attempt/chunk/reason。

- `source`：select（选图）、paste（粘贴文件）、drop（拖拽）、replace（替换）、crop（裁剪）。
- `mode`：upload（服务器/自定义上传）或 local（本地 base64）。
- `onSuccess`：已经获得合法图片结果，**不表示文档已写入或后端已保存**。
- 文档 update/change：确认正文事务变化；业务持久化成功应由应用的保存接口或已配置的持久化流程确认。

不要在 onSuccess 中再次插入图片。直接插入已有图片 URL 不存在文件上传过程，不会伪造这套文件回调；外链显示仍受[网络策略](/blocks/network)约束。

## 需要自定义 upload 时

例如后端有特殊签名流程，应用可以自己执行请求并返回结果。以下是最小 fetch 示例（fetch 本身不提供上传进度）：

```js
const uploader = {
  ...callbacks,
  upload: async (file, ctx) => {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/upload', {
      method: 'POST', body: form, signal: ctx.signal,
    })
    if (!response.ok) {
      throw Object.assign(new Error('上传失败'), { status: response.status })
    }
    const data = await response.json()
    return { url: data.url, attchId: data.id }
  },
}
```

自定义实现可用 `ctx.onProgress({ loaded })` 报告已传字节。分片模式的第一个参数是当前片 Blob，ctx.file 始终是原始 File；Provider 聚合成文件级进度。分片协议及最终地址由应用负责，自定义 upload 保留原有重试策略。

旧 `uploader: fn`、`uploadImage: fn` 继续兼容。需要应用主动查询/取消时，可从 `lark-doc/providers` 引入 `createUploadProvider(options)`，其实例提供 `cancel(taskId, reason?)`、`cancelAll(reason?)`、`pending()`、`clearResume()`；传入编辑器时保持该 Provider 身份。

## Vue2、Vue3、React 如何传配置

三框架推荐命令式 `new LarkDoc({ element, uploader })`，完整可复制示例见[各环境接入](/guide/environments)。标签或兼容组件的对象传递方式如下：

```vue
<!-- Vue2 options 兼容组件 -->
<lark-doc-editor v-model="html" :uploader="uploader" />

<!-- Vue3 Web Component；options 是包含 uploader 的稳定对象 -->
<lark-doc :options.prop="options" />
```

```jsx
// React 薄壳：先 import 'lark-doc/element'，模块级创建组件工厂。
const LarkDocView = createReactLarkDoc(React)
// uploader/config 在组件外或 useMemo 中保持稳定。
function Editor() {
  return <LarkDocView uploader={uploader} />
}
```

对象和函数必须走 property/prop，不能变成 JSON 字符串或 HTML attribute。Vue2 uploader prop、Vue3 options property、React 薄壳 effect 和原生元素都保留回调函数身份。

仅更新上传配置时：

```js
doc.setUploader(nextUploader)
// Web Component：
el.options = { ...el.options, uploader: nextUploader }
```

这条路径原地更新，保留当前 Editor、正文、标题与撤销历史。其他 options 变化可能重建，不能据此承诺任意配置更新都保留撤销历史。

## 拒绝、失败和生命周期边界

- 默认图片大小上限 5 MB；`limits.maxImageSize` 和 Provider 自身 limits 可以收紧。SVG、不支持 MIME、可识别为图片但缺 MIME 的文件会被拒绝。
- 上传失败不产生半截节点；替换/裁剪失败保留旧图。PDF 等非图片附件走原有附件处理，不属于图片回调。
- 编辑器销毁、切文档或变只读时，取消自身任务并阻止晚写回。同一 Provider 被多个编辑器使用时，销毁一个不取消另一个。
- 取消是幂等的，终态后不再改变状态；异步 beforeUpload 等待期间也能取消，晚到返回不能复活任务。

## 验证范围

同一包已在 Vue2/CLI5/Webpack5、Vue3/Vite7、React18/Vite7，以及三个真实适配器、原生 default/full/lite+features、Element ESM、CDN UMD、Webpack4.47 中验证。覆盖初始化配置、真实 multipart、图片加载、五来源、URL/base64、适用回调、重试、取消、超时和失败；图表、公式及本地字体同时回归。

该验证使用本机 Chromium 和本地 HTTP 模拟上传服务，尚未与具体业务后端联调。Node14 验证库构建与普通 CJS 编辑，不代表服务器原生支持 XMLHttpRequest；SSR 仍只在客户端挂载。
