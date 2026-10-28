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

::: tip 上传失败
`upload` 抛错时图片节点回退为本地 base64 预览并提示，不会丢用户刚选的图。
:::
