# 图片

图片组件支持本地上传、拖拽 / 粘贴插入、宽度拖拽、裁剪、替换、说明文字与点击预览。上传优先走宿主 `uploader.upload` 钩子；外链图片默认按原地址加载（`network.mode: 'open'`），切到 `offline` 后渲染为占位块。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { images: true },
  limits: { maxImageSize: 5 * 1024 * 1024 },   // 单张 5MB
  uploader: {
    upload: async (file) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      return { url: data.url, attchId: data.id }   // attchId 可选，随 JSON 保存
    },
  },
})
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.images` | `boolean` | `true` | 关闭后图片入口隐藏。 |
| `limits.maxImageSize` | `number` | `5MB` | 单张图片大小上限。 |
| `uploader.upload` | `(file) => Promise<{url, attchId?}>` | 内置本地读取 | 宿主接管上传；未提供时图片转 base64 本地预览。 |
| `network.mode` | `string` | `'open'` | 外链图片渲染策略，见[网络策略](/blocks/network)。 |
| `network.imageProxy` | `(url) => Promise<url>` | - | 宿主把外链图片转存为本地地址。 |

### 使用方式

| 入口 | 操作 |
| --- | --- |
| 插入菜单 / 工具栏 | 打开文件选择。 |
| 粘贴 / 拖拽 | 直接插入图片，自动走上传钩子。 |
| 选中图片 | 拖四角调宽度；工具条提供裁剪、替换、说明文字、预览、删除。 |
| 双击 | 打开大图预览。 |

### 数据契约

```html
<img src="…" alt="…" width="80" data-attch-id="…">
```

- JSON：`{ type: 'image', attrs: { src, alt, width, attchId? } }`。
- 被网络策略拦截的外链图片：`src` 置空、原地址保留在 `data-original-src`，并带 `data-network-blocked` 标记。

## 导出 HTML 时的两种媒体写法

`doc.getHTML()` / 导出 HTML 时，图片、视频、音频、附件既可以原样内联在文中，也可以只留一条可点击的地址。由 `media.htmlMode` 控制：

```ts
new LarkDoc({
  element: '#editor',
  media: {
    htmlMode: 'inline',   // 'inline' | 'link'（默认 inline）
    linkText: '',         // link 档的链接文字，留空用默认文案
    newTab: true,         // link 档是否 target="_blank"
  },
})
```

| 取值 | 输出 | 适用 |
| --- | --- | --- |
| `'inline'`（默认） | 保留 `<img>` / `<video>` / `<audio>` 等原生标签 | 正文直读、需要图片可见的页面 |
| `'link'` | 换成 `<a href="原地址">文字</a>`；块级媒体包一层 `<p class="lark-doc-media-link-block">` | 正文以文字为主、媒体只需留地址（省流量，也规避外链防盗链） |

`linkText` 支持 `{name}` / `{url}` / `{type}` 占位，留空时直接用地址本身作文案：

```ts
// 全局配置
const doc = new LarkDoc({ element: '#editor', media: { htmlMode: 'link', linkText: '[{type}] {name}' } })

// 单次导出临时覆盖，不影响实例配置
const html = doc.getHTML({ media: { mode: 'link' } })
```

`link` 档的输出示例（默认文案就是地址）：

```html
<p class="lark-doc-media-link-block" data-media-type="image">
  <a class="lark-doc-media-link" data-media-type="image"
     href="https://cdn.example.com/a.png"
     target="_blank" rel="noopener noreferrer">https://cdn.example.com/a.png</a>
</p>
```

没有地址的媒体（被网络策略拦下、上传未完成）保持原样不动，便于排查。

::: warning link 档是单向的
`link` 只影响 HTML 输出，不改文档 JSON —— 编辑器里仍是完整媒体节点，`getJSON()` / 保存的数据不受影响。但**把 `link` 档的 HTML 重新粘回编辑器时，媒体已经变成普通链接**，不会被识别回图片。需要往返编辑的场景请用 `inline`，或用 JSON / DOCX 作为交换格式。
:::

::: tip 上传失败
`upload` 抛错时图片节点回退为本地 base64 预览并提示，不会丢用户刚选的图。
:::
