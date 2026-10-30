# 图片

支持本地上传、拖拽 / 粘贴插入、拖宽、裁剪、替换、说明文字、点开预览。上传优先走宿主 `uploader.upload`；外链图片默认按原地址加载（`network.mode: 'open'`），切到 `offline` 后显示占位块。

## 配置

```js
new LarkDoc({
  element: '#editor',
  features: { images: true },
  limits: { maxImageSize: 5 * 1024 * 1024 },     // 单张 5MB
  uploader: {
    upload: async (file) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      return { url: data.url, attchId: data.id }   // attchId 可选，会随 JSON 一起保存
    },
  },
})
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `features.images` | `true` | 关闭后图片入口隐藏。 |
| `limits.maxImageSize` | `5MB` | 单张大小上限。 |
| `uploader.upload` | 内置本地读取 | 宿主接管上传；不提供时转 base64 本地预览。 |
| `network.mode` | `'open'` | 外链图片策略，见[网络策略](/blocks/network)。 |
| `network.imageProxy` | - | 把外链图转存成本地地址。 |

## 怎么用

| 入口 | 操作 |
| --- | --- |
| 工具栏 / 插入菜单 | 打开文件选择。 |
| 粘贴 / 拖拽 | 直接插入，自动走上传钩子。 |
| 选中图片 | 拖四角调宽度；工具条给裁剪、替换、说明文字、预览、删除。 |
| 双击 | 大图预览。 |

数据契约：`<img src alt width data-attch-id>`；JSON 为 `{ type: 'image', attrs: { src, alt, width, attchId? } }`。被网络策略拦下的外链图 `src` 为空、原地址留在 `data-original-src`。

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

`linkText` 支持 `{name}` / `{url}` / `{type}` 占位。`link` 档输出长这样：

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
`upload` 抛错时图片回退成 base64 本地预览并提示，不会丢用户刚选的图。
:::
