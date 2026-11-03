# 网络策略

网络策略组件控制编辑器的运行时出网行为。默认 `open`：图片等媒体按原地址加载，**老系统的 http 图床开箱即可显示**。需要内网 / 公文 / 隐私场景时显式切到 `allowlist` 或 `offline`，`offline` 下外链图片降级为占位块并保留原地址。策略在粘贴、`setContent()`、图片渲染三个接线点统一生效。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  // 默认可省略；显式写成下面这样等价于默认行为
  network: { mode: 'open' },

  // 只放行内网图床
  // network: { mode: 'allowlist', allowlist: ['20.200.174.87', 'oss.internal.example'] },

  // 完全离线
  // network: { mode: 'offline' },
})
```

## 配置与用法

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `network.mode` | `'open' \| 'allowlist' \| 'offline'` | `'open'` | 出网策略。非法值回退默认值 `open`。 |
| `network.allowlist` | `string[]` | `[]` | 放行的 host；自动去除协议、路径并转小写，支持子域名。 |
| `network.imageProxy` | `(url) => Promise<string>` | - | 外链图片转存钩子；返回本地地址后编辑器自动替换原外链。 |

### 三种模式

| 模式 | 外链图片（http / https） | 使用场景 |
| --- | --- | --- |
| `open`（默认） | 全部按原地址加载 | 老系统迁移、外部图床、完全可信内容 |
| `allowlist` | 仅名单内 host 放行，其余降级占位 | 内网多图床、需要收敛到白名单 |
| `offline` | 全部降级占位（保留 `data-original-src`） | 内网隔离、公文、隐私 |

### 拦截后处理

| 接线点 | 处理 |
| --- | --- |
| 粘贴 HTML | `transformPastedHTML` 移除外链 `src`，标记 `data-network-blocked`。 |
| `setContent()` | JSON 遍历：`src` 置空、原地址存 `originalSrc`。 |
| 图片渲染 | 占位块样式，不发起 GET；宿主 `network.imageProxy` 成功后自动替换为本地地址。 |

### 宿主转存外链

```ts
new LarkDoc({
  element: '#editor',
  network: {
    mode: 'offline',                          // 或 allowlist
    imageProxy: async (url) => (await uploadToInternalOss(url)).url,
  },
})
```

### 构建期守卫

```bash
node scripts/check-offline-assets.js   # 扫 src/ 与 dist/，硬编码远程地址即失败
```

::: tip 静态资源与运行时出网是两件事
KaTeX 字体、代码高亮、Emoji 字形始终随包发布，任何模式下都不请求外部 CDN；这条由构建期守卫保证。`network` 只管**正文内容里的媒体地址**。
:::

详见[离线与资源本地化](/guide/offline)。
