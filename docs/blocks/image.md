# 图片

支持本地上传、拖拽 / 粘贴插入、拖宽、裁剪、替换、说明文字、点开预览。上传优先走宿主 `uploader.upload`；外链图片默认按原地址加载（`network.mode: 'open'`），切到 `offline` 后显示占位块。

## 配置

```js
new LarkDoc({
  element: '#editor',
  features: { images: true },
  limits: { maxImageSize: 5 * 1024 * 1024 },     // 单张 5MB
  uploader: {
    upload: async (file, ctx) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form, signal: ctx.signal })
      const data = await res.json()
      return { url: data.url, attchId: data.id }   // attchId 可选，会随 JSON 一起保存
    },
  },
})
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `features.images` | `true` | 关闭后图片入口隐藏。 |
| `limits.maxImageSize` | `20MB` | 单张大小上限，可按宿主要求收紧。 |
| `uploader.upload` | 内置本地读取 | 宿主接管上传；不提供时转 base64 本地预览。 |
| `network.mode` | `'open'` | 外链图片策略，见[网络策略](/blocks/network)。 |
| `network.imageProxy` | - | 把外链图转存成本地地址。 |

## 上传生命周期

选图、粘贴文件、拖拽和替换共用 beforeUpload / upload / onStart / onProgress / onRetry / onSuccess / onError / onCancel / onReject / onSettled；已有图片链接不伪造文件上传事件。ctx 带 taskId、documentId、原始 file、source、mode、signal 与 cancel(reason?)。异步检查期间可取消；销毁、换文档和只读后不能晚写回。

合法 URL、相对图片路径与 JPEG/PNG/GIF/WebP/BMP data URI 均可作为上传结果，attchId 可省略。文件选择器支持多选；本地预览与上传进度不写入文档，粘贴后可在图片下方继续输入。选中上传预览后按 Delete/Backspace 取消，也支持撤销和重做。`doc.setUploader(nextUploader)` 或框架上传 property 更新不重建正文与撤销历史。完整签名、唯一终态和错误处理见[上传器](/blocks/uploader)。

## 怎么用

| 入口 | 操作 |
| --- | --- |
| 工具栏 / 插入菜单 | 打开文件选择。 |
| 粘贴 / 拖拽 | 直接插入，自动走同一 Provider；source 为 paste / drop。 |
| 选中图片 | 四角等比缩放；工具条提供裁剪、说明、左/中/右对齐、复制图片链接、分享和评论。 |
| 已选中后单击 / 阅读模式单击 | 大图查看：前后图片、缩放、原始尺寸、适应窗口、旋转、下载和评论。 |

数据契约：`<img src alt width data-attch-id>`；JSON 为 `{ type: 'image', attrs: { src, alt, width, attchId? } }`。被网络策略拦下的外链图 `src` 为空、原地址留在 `data-original-src`。

`src` 有两种来源，写法完全一样：

| 来源 | `src` 长什么样 | 说明 |
| --- | --- | --- |
| 上传 | `data:image/png;base64,…` | 图片跟着文档走，不依赖图床，适合离线 / 单文件分发。 |
| 远程地址 | `https://www.a.com/a.img` | 按原地址引用，**不转存、不转 base64**；随时能换图（换的是服务端文件）。 |

```js
// 直接写远程地址也是合法图片块
editor.commands.setImage({ src: 'https://www.a.com/a.img', alt: '远程图' })
```

远程地址受[网络策略](/blocks/network)影响：默认 `open` 照常加载；配成 `allowlist` / `offline` 时被拦下的图会降级成占位卡，原地址保留在 `data-original-src`，导出 HTML 时仍按原地址写出。

## 导出 HTML 时的两种媒体写法

图片、视频、音频、附件在 HTML 产物里有两种呈现，由 `media.htmlMode` 决定。JSON 永远不受影响。

```js
new LarkDoc({
  element: '#editor',
  media: {
    htmlMode: 'inline',   // 'inline' | 'link'，默认 inline
    linkText: '',         // link 档的链接文字，留空用地址本身
    newTab: true,
  },
})

// 单次覆盖，不改实例配置
const html = doc.getHTML({ media: { mode: 'link' } })
```

| 取值 | 输出 | 什么时候用 |
| --- | --- | --- |
| `'inline'`（默认） | 保留 `<img>` / `<video>` 等本体，正文能直接渲染出图 | 正文阅读页 |
| `'link'` | 换成 `<a href>` 一条地址，块级媒体再包一层 `<p class="lark-doc-media-link-block">` | 贴到邮件 / IM / 只接受文字和链接的系统 |

`linkText` 支持 `{name}` / `{url}` / `{type}` 占位。两种档位都**原样保留** `src` 里的远程 `https://` 地址（不转存、不转 base64），所以正文用外链图时，`inline` 出 `<img src="https://www.a.com/a.img">`，`link` 出指向同一地址的 `<a href>`。`link` 档输出长这样：

```html
<p class="lark-doc-media-link-block" data-media-type="image">
  <a class="lark-doc-media-link" data-media-type="image"
     href="https://cdn.example.com/a.png"
     target="_blank" rel="noopener noreferrer">https://cdn.example.com/a.png</a>
</p>
```

::: warning link 是单向的
`link` 只改 HTML 输出，编辑器里的节点还是完整图片，`getJSON()` 不受影响。但**把 `link` 档 HTML 重新粘回编辑器，图片会变成普通链接**，回不来。需要往返编辑就用 `inline`，或者用 JSON / DOCX 交换。
:::

::: tip 上传失败
自定义 upload 抛错或返回非法结果时通知 onError / onSettled，不回退为 base64 成功；替换、裁剪失败保留旧图。未配置 upload 的本地转换也提供相同回调。
:::

## 原位裁剪与分享

裁剪保留原始 `src` 与 `attchId`，只保存 `crop: [left, top, right, bottom]`（0–1 的边界，提交精度四位小数）以及 `naturalWidth`、`naturalHeight`。八个手柄调整边界，Enter 或点击外部提交，Escape 取消草稿；重新进入裁剪并扩展边界，或点击裁剪后出现的「重置图片」，均可还原全图，已有显示宽度不变。HTML/JSON 保留裁剪属性；Markdown 降级为原图链接。

图片分享的接收人目录复用 `mentionSource` 的人员和会话条目，发送由宿主的异步 `onImageShare({ image, url, recipients, message, signal })` 确认。返回 `false` 或 reject 会保留窗口和输入并显示错误；未配置回调时不允许发送。关闭窗口会使 `signal` 中止，宿主应据此取消尚未执行的请求。SDK 不自行发送消息。

编辑模式下首次点击图片只选中，再次点击打开查看器；阅读模式下单击直接打开。查看器支持方向键与上一张、下一张按钮，首尾停止切换，Escape 关闭；在评论输入框内按方向键仍用于编辑文字。分享预览包含图片与相邻内容的摘录，单选接收人后收起搜索列表，多选模式保留列表，取消会清空当前接收人和留言。

查看器下载裁剪图时按原图像素导出可见区域为 PNG，不重新上传或修改正文；普通图片仍下载原文件。

图片评论使用同一 `comments` Provider，以 `blockId` 锚定图片；不会把评论写进图片像素或更改附件。
