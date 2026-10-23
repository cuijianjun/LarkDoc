# 上传器

## 概述

上传器组件统一处理图片上传：编辑器内的图片插入、粘贴、拖拽最终都走 `uploader.upload` 钩子。未提供时使用内置行为（读取本地文件转 base64 预览）；提供后由宿主决定存储位置。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  uploader: {
    upload: async (file) => {
      // file: File 对象，已通过大小校验（limits.maxImageSize）
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      // 必须返回 url；attchId 可选，会随图片 JSON 一起保存
      return { url: data.url, attchId: data.id }
    },
  },
})
```

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `uploader.upload` | `(file: File) => Promise<{url: string, attchId?: string}>` | 本地 base64 | 宿主接管上传。 |
| `limits.maxImageSize` | `number` | `5MB` | 超限文件在选择阶段即被拒绝并提示。 |
| `network.imageProxy` | `(url) => Promise<string>` | - | 外链图片转存钩子，与上传器独立，见[网络策略](/blocks/network)。 |

### 行为约定

| 场景 | 行为 |
| --- | --- |
| `upload` 成功 | 图片 `src` 为返回的 `url`，`attchId` 写入 `data-attch-id`。 |
| `upload` 抛错 / reject | 回退本地 base64 预览并提示，不丢用户选择的图。 |
| 未配置上传器 | base64 直接写入 `src`（随 JSON 保存，注意草稿体积）。 |
| 外链 URL 插图 | 不走上传器，走网络策略判断。 |

::: tip 与网络策略的关系
上传器处理**文件 → 存储地址**；网络策略处理**外链地址是否允许渲染**。两者正交：内网图床建议 `network: { mode: 'allowlist', allowlist: ['oss.internal.example'] }` + 自定义上传器。
:::
