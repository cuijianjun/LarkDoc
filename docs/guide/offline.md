# 离线与资源本地化

## 概述

包默认**静态资源完全本地化**：KaTeX 样式与全部字体随包发布（`src/assets/fonts/katex/`），构建产物 `dist/fonts/` 自带字体文件；代码高亮为本地动态 chunk；emoji 是内置字符表——任何模式下都不会请求外部 CDN。CI 侧有 `scripts/check-offline-assets.js` 守卫，产物里出现硬编码远程地址或字体缺失即构建失败。

**正文媒体**由 `network.mode` 控制，默认 `open`：图片按原地址加载，老系统的 http 图床可直接显示；需要完全断网时显式设 `offline`。

## 配置内容

```ts
new LarkDoc({
  element: '#editor',
  // 默认可省略（open）；需要离线时：
  network: {
    mode: 'offline',      // 外链图片降级为占位块
    allowlist: [],        // mode 为 allowlist 时生效
    // 可选：宿主接管外链图片，转存后返回本地地址
    imageProxy: async (url) => uploadByUrl(url),
  },
})
```

## 配置说明

### network.mode

| 模式 | 行为 | 使用场景 |
| --- | --- | --- |
| `open`（默认） | 不拦截，http / https 媒体按原地址加载 | 老系统迁移、外部图床 |
| `allowlist` | 仅放行 `allowlist` 中的 host（自动去掉协议与路径） | 有内网图床的环境 |
| `offline` | 拦截全部外部请求；外链图片显示占位块并保留 `data-original-src` | 内网隔离、公文、隐私场景 |

### 拦截接线点

| 时机 | 处理 |
| --- | --- |
| 粘贴 HTML | `transformPastedHTML` 阶段清洗外链 `src` |
| `setContent()` | JSON 层遍历，外链图片 `src` 置空、原地址存入 `originalSrc` |
| 图片渲染 | ImageNode 对被拦截图片渲染占位样式，不再发起 GET |

### 宿主自行上传

```ts
// imageProxy 返回本地 URL 后，编辑器自动用新地址替换原外链
new LarkDoc({
  element: '#editor',
  network: {
    mode: 'offline',
    imageProxy: async (url) => {
      const blob = await fetchViaInternalService(url)
      return (await uploadToInternalOss(blob)).url
    },
  },
})
```

### 自检方法

```bash
cd apps/lark-doc && node scripts/check-offline-assets.js
```

- 扫描 `src/**` 与 `dist/*.{js,css}`，命中运行时外部域名即失败（XML 命名空间等注释性字符串在白名单内）。
- 校验 `dist/fonts/` 完整、CSS 中所有 `url()` 均为相对路径。
- 该脚本挂在 `npm run check`（`check:offline`）中，构建必过。

::: tip 验收方式
页面打开后 Network 面板应只有本机域名请求；粘贴一张外链图片，应看到占位块且无对应网络请求。
:::
