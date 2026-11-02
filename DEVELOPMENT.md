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

## 新手必读：菜单、图表与本地预览

### 本次集中改动

- **三个入口共用菜单**：工具栏「插入」、空段落「＋」和输入 `/` 使用同一套菜单 renderer；不要在某个入口另写一份图表插入逻辑。
- **图表有六种类型**：流程图、时序图、甘特图、饼图、状态图、类图。类型定义在 `src/components/lark-doc/editor/constants.js`，统一由 `insertDiagramType(typeId)` 插入 Mermaid 模板。
- **图表菜单支持悬浮和点击**：进入「图表」打开右侧子菜单，进入子菜单不会立即关闭；离开后短暂延迟关闭，Escape 或点击外部关闭。工具栏按钮的下拉箭头在菜单打开时旋转。
- **六种图表使用不同彩色图标**：图标含义分别对应节点分支、生命线消息、时间轴任务条、饼图扇区、状态迁移和 UML 类框。图标统一从 `src/ui/icon.js` 生成，工具栏与「＋」菜单必须复用它，不能复制 SVG。
- **Mermaid 懒加载使用相对 chunk 路径**：`src/core/diagram.js` 的动态模块必须能在浏览器和静态部署中找到同目录 chunk；改动后要重新构建 ESM 产物。

### 改动时只记这几条

1. 改菜单交互：优先看 `src/ui/commandMenu.js`、`src/ui/toolbar.js` 和对应 `*Menu*Mixin.js`，复用已有的 hover 延迟、定位、Escape 和外部点击机制。
2. 改图表类型：先改 `diagramTypes` 和模板，再让所有入口调用 `insertDiagramType(typeId)`；不要把 Mermaid 字符串散落在 renderer 或 toolbar 中。
3. 改图标：只在 `src/ui/icon.js` 增加类型图标，并保留语义差异；彩色由菜单图标样式统一控制，不能在工具栏单独写暗色 SVG。
4. 改 ESM 或 Mermaid 加载：执行 `npm run build:esm`，否则 Vue3 demo 可能仍引用旧的 `dist/`。
5. 改 Vue3 demo：从 `apps/vue3-vite` 启动 Vite，访问 `/lark-doc`；不要从 `apps/` 根目录启动，否则路径可能被当成源码文件。

### 最短验证与发布顺序

```bash
npm run lint
npm run build:esm
npm run check:quick
# 发布前：npm run check
npm run ship
```

`npm run ship` 会按仓库脚本完成版本号、校验、npm 发布、GitHub commit/tag/push；不要手动拆成多套发布命令。详细交互实现见 [`docs/弹窗交互统一改造说明.md`](./docs/弹窗交互统一改造说明.md)，Mermaid 规则见 [`dev/04h-图表mermaid.md`](./dev/04h-图表mermaid.md)。
