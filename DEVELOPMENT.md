# lark-doc 开发备忘（入口）

> **本文只讲开发者最常用的入口。** 需要细节时再按域打开 [`dev/00-INDEX.md`](./dev/00-INDEX.md)。

## 先做这三件事

1. **看稳定事实**：[`_codex/CONTEXT-CARD.md`](./_codex/CONTEXT-CARD.md)。
2. **改代码前选对应册**：按 [`dev/00-INDEX.md`](./dev/00-INDEX.md) 找规则；不要直接通读 `requirements/`。
3. **改完先跑快速门禁**：`npm run check:quick`；发布前再跑 `npm run check`。

使用方接入说明在 [`docs/guide/environments.md`](./docs/guide/environments.md)，在线 demo 在 [`docs/public/demo/`](./docs/public/demo/)。长期路线以 [`MASTER_PLAN.md`](./MASTER_PLAN.md) 为准。

当前版本以 `package.json` 为准。

## 铁律（拆册后仍然成立）

1. 每一条回归备忘都是真实修过的 bug：**改某个域之前，确认没把已修的问题写回来**。
2. **按改动域选门禁，不是每次都全量**：改完随手 `npm run check:quick`（秒级）；块逻辑 `check:code`、主题 CSS `check:ui`、部署面 `check:deploy`；**发布前才跑全量 `npm run check`**，必须 EXIT=0 且 0 warning。对照表见 [`dev/01`](./dev/01-环境与校验链.md)。
3. 依赖方向固定为 `components/ → registry/ → core/`，`core/` 不许反向 import。块定义只从 `src/registry/blocks.js` 取。
