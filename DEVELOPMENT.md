# lark-doc 开发备忘（入口）

> **正文已按域拆到 [`dev/`](./dev/00-INDEX.md)，本文只剩入口。**
> 拆开的原因：这篇原来 41 KB（约 9k token），被标成「改代码前必读」，等于每开一个会话先交一笔固定税。
> 现在每册 1–10 KB，按域取用。

## 从这里开始

- **总导航（先看这张）**：[`dev/00-INDEX.md`](./dev/00-INDEX.md) —— 「我要做什么 → 读哪一册」的对照表。
- **改块类型**：`_codex/contract/INDEX.md`（约 950 token，一屏列出所有块的 attrs / 关键常量 / 02 证据锚点 / 源码位置）。它是从 `src/core/blocks/*.js` 生成的，**代码是真源**，不会漂移；改完代码跑 `node scripts/gen-contract.mjs` 重新生成，`node scripts/gen-contract.mjs --check` 可判定是否过期。
- **稳定事实 / 进度**：`_codex/CONTEXT-CARD.md`。
- **查需求细节**：`_codex/req/<编号>/INDEX.md` 定位 → 只读命中的那一片。**不要裸读 `requirements/*.md`**（`02` 一篇约 10 万 token）。切片由 `node _codex/split-req.mjs` 生成，`requirements/` 是唯一真源。
- **使用方**接入说明（编译工具配置 / 工具栏配置 / 可运行 demo）：`docs/guide/environments.md`。

当前版本以 `package.json` 为准（别再在这里写死，历史上已漂移过一次）。

## 铁律（拆册后仍然成立）

1. 每一条回归备忘都是真实修过的 bug：**改某个域之前，确认没把已修的问题写回来**。
2. **按改动域选门禁，不是每次都全量**：改完随手 `npm run check:quick`（秒级）；块逻辑 `check:code`、主题 CSS `check:ui`、部署面 `check:deploy`；**发布前才跑全量 `npm run check`**，必须 EXIT=0 且 0 warning。对照表见 [`dev/01`](./dev/01-环境与校验链.md)。
3. 依赖方向固定为 `components/ → registry/ → core/`，`core/` 不许反向 import。块定义只从 `src/registry/blocks.js` 取。
