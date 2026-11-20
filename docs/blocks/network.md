---
pageClass: feature-guide
---

<script setup>
import FeatureDemo from '../examples/FeatureDemo.vue'
</script>

# 网络策略

<div class="feature-summary">

## 介绍

网络策略组件控制编辑器的运行时出网行为。默认 `open`：图片等媒体按原地址加载，**老系统的 http 图床开箱即可显示**。需要内网 / 公文 / 隐私场景时显式切到 `allowlist` 或 `offline`，`offline` 下外链图片降级为占位块并保留原地址。策略在粘贴、`setContent()`、图片渲染三个接线点统一生效。

</div>

<div class="feature-summary">

## 引入

在已有的 Vue 3 项目中安装示例版本，将基础用法里的完整组件代码复制到 `App.vue`。

```bash
npm install lark-doc@0.14.10
```

```js
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'
```

</div>

## 基础用法 {#demo}

<FeatureDemo name="network" />

## API

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| `network.mode` | 出网策略。非法值回退默认值 `open`。 | `'open' \| 'allowlist' \| 'offline'` | open / allowlist / offline | `'open'` |
| `network.allowlist` | 放行的 host；自动去除协议、路径并转小写，支持子域名。 | `string[]` | — | `[]` |
| `network.imageProxy` | 外链图片转存钩子；返回本地地址后编辑器自动替换原外链。 | `(url) => Promise<string>` | — | — |

示例通过 JSON 传入图片地址，交给编辑器应用离线策略。外链原址仍保留在文档数据中。

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
