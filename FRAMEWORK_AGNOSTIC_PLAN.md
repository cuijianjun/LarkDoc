# lark-doc 框架无关演进 · 终极方案

> 目标：**内核零框架、UI 原生 DOM、对外只剩一个自定义元素** —— 让 Vue 2 EOL 不再是我们包里的债务，也让 0.13 之后的每次发版都不用再为「宿主是什么框架」做取舍。
>
> ⚠️ **本文档已合并进 [MASTER_PLAN.md](./MASTER_PLAN.md)**（多环境统一 × 框架无关 合并版）。本文保留为「包内部怎么写」一侧的细节备查（分层实测 / mixin 可留清单 / S3 批次表），**遇冲突以 MASTER_PLAN.md 为准**。
>
> 姊妹篇：`MULTI_ENV_PLAN.md` 解决**宿主怎么引入**（打包器 / 产物 / 配置），本文解决**包内部怎么写**（分层 / UI 技术选型 / 演进节奏）。
>
> 动 `src/` 之前先读本文；动任何一行代码之前先读 `DEVELOPMENT.md`。

- 基线：`next/0.12` HEAD `837e329`，`package.json` version `0.12.1`
- 撰写日期：2026-10-29
- 文中所有「实测」均指在本地工作区对上述 HEAD 跑出来的数字

---

## 0. 一句话结论

我们**不需要重写产品**。四个标杆项目指向同一件事：把 UI 的书写方式与内核解耦。而我们的内核（`src/core`）**已经是零框架的了**，差的只有 UI 层。

本方案不是「推倒重来 1.6 万行」，而是按同一个接缝推进三步：

```
现在    core(零框架) → components(38 个 Vue2 SFC) → mount/vueRenderer → 5 套发布面
终局    core(零框架) → ui(原生 DOM)              → mount/domRenderer → 1 个元素 + 2 个薄壳
                ↑ 已达标                      ↑ 唯一要干的活            ↑ 接缝早已存在
```

---

## 1. 四个标杆教了我们什么

### 1.1 事实对比

外部四家为公开资料与 registry 实测，最后一行是本地 `next/0.12` HEAD 实测。

| 项目 | 核心依赖 | UI 谁写 | 对外发布面 | 多框架怎么给 |
| --- | --- | --- | --- | --- |
| **TipTap 3.32** | `@tiptap/core` 的 `dependencies` = **`{}`**（本地 node_modules 实测） | **不写**（headless） | `core` + 3 个框架适配包 | `@tiptap/vue-2 / vue-3 / react`，框架是 peer |
| **Lexical**（Meta） | `@lexical/core` 不依赖任何 UI 框架；自带 DOM reconciler 与 EditorState 双缓冲 | 宿主写（官方只给 `@lexical/react` binding，另有 headless 包供服务端使用） | `lexical` + bindings | binding 薄、可替换 |
| **AIEditor 2.0** | `@tiptap/core` + `@tiptap/pm` + 45 个 `@tiptap/extension-*`，以及 `katex` / `lucide` / `marked` / `openai` / `lowlight` / `dompurify` / `highlight.js` / `@floating-ui/dom`（registry 实测，**一个 UI 框架都没有**） | **原生 DOM 手写** + `@floating-ui/dom`（浮层定位）+ `lucide`（图标） | `exports` 只有 `"."` 与 `"./style.css"` **两条** | 不区分框架，一个 Web Component 通吃 |
| **Milkdown** | monorepo 拆分：core / plugins / prose / transformer / utils，UI 与框架分属不同 package | headless UI 组件 + 宿主集成 | 按 package 粒度按需安装 | `integrations` 层，可替换 |
| **lark-doc 0.12.1**（我们） | `core` 114 个 js / **0 个 `.vue`**（实测） | **Vue 2 SFC 手写**（38 个 / 7370 行） | dist 7 套 + `exports` 9 条 | UMD + element + vue3/react 薄壳 |

### 1.2 六条可迁移的规律

| # | 规律 | 出处 | 我们达标了吗 |
| --- | --- | --- | --- |
| 1 | **核心零 UI 框架依赖**，且自己握住 DOM 协调权 | TipTap / Lexical | 已达标 —— `src/core` 0 个 vue，且 `core/nodeviews` 已有 11 个文件自己管 NodeView |
| 2 | **分层是单向依赖**，且能被机器校验 | Milkdown | 部分 —— 有 `scripts/check-architecture.js`，但没校验「UI 不许反向渗透内核」 |
| 3 | **自有 UI 也不用 UI 框架写** | AIEditor | **未达标，唯一一条** |
| 4 | **特性是一等注册单元**（节点 + 命令 + 快捷键 + 装饰绑在一起） | TipTap Extension / Milkdown plugin | 已达标 —— `core/blocks` 42 个 + `core/commands` 15 个 |
| 5 | **框架绑定要薄到没有价值含量** | TipTap 三适配包 | 已达标 —— 薄壳 3.0 / 4.2 KiB |
| 6 | **发布面越窄越好** | AIEditor 只留 2 条 exports | 0.13 刚收口，仍可再压 |

---

## 2. 自测：我们现在到底差在哪

### 2.1 分层实测（`src/` 一级目录）

| 目录 | js | js 行数 | `.vue` | vue 行数 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `core` | 114 | 20369 | **0** | 0 | 零框架内核（含 blocks 42 / commands 15 / nodeviews 11 / derive 2 / versioning 7） |
| `providers` | 17 | 1059 | **0** | 0 | 干净 |
| `collab` | 4 | 565 | **0** | 0 | 干净 |
| `utils` | 7 | 1982 | **0** | 0 | 干净 |
| `session` / `registry` / `assets` / `styles` / `legacy` | 12 | 3758 | **0** | 0 | 干净 |
| `web-component` | 7 | 730 | **0** | 0 | 已是纯 DOM 外壳 |
| `mount` | 2 | 120 | **0** | 0 | **渲染接缝，且已带替换钩子** |
| `components` | 41 | 8628 | **37** | **7008** | UI 层，Vue 2 全在这里 |
| `adapters` | 4 | 231 | **1** | 362 | 仅 `vue2/CodeNode.vue` 一个 NodeView SFC |
| **合计** | **209** | **37577** | **38** | **7370** |  |

关键事实：**显式 `from 'vue'` 的文件只有 1 个** —— `src/mount/vueRenderer.js`。
Vue 的入口在法律意义上已经收得极窄；真正的耦合面是「37 个 SFC 的模板语法 + mixin 的响应式假设」，而不是散落的 `import Vue`。

### 2.2 三个 `@tiptap/vue-2` 耦合点（全仓库就这三处）

| 位置 | 用了什么 | 摘除代价 |
| --- | --- | --- |
| `src/components/lark-doc/LarkDocEditor.vue:161` | `Editor` / `EditorContent` | 低 —— `EditorContent` 干的事就是新建 `<div>` 后 `element.append(...editor.view.dom.parentNode.childNodes)`，再 `setOptions({ element })` + `createNodeViews()`，十几行原生代码 |
| `src/adapters/vue2/nodeviews.js:12` | `VueNodeViewRenderer` | 中 —— 换成 core 原生 NodeView（`constructor` 建 DOM、`update` 增量、`stopEvent` 自行拦截） |
| `src/adapters/vue2/CodeNode.vue:98` | `NodeViewWrapper` / `NodeViewContent` / `nodeViewProps` | 中 —— 随上一项一起改 |

### 2.3 Vue 依赖三层，按可去掉性排

| 层 | 现状（实测） | 能不能去 | 收益 |
| --- | --- | --- | --- |
| ① Vue 运行时 | `dependencies` 里**没有** vue；`vue` 与 `@tiptap/vue-2` **均已是 optional peer**。UMD 里是 `require('vue/dist/vue.runtime.common.js')`（吃宿主那份），element 用 `--inline-vue` 自带 | **已经去了** | 代价仅 16.0 KiB gzip（element 462.7 − UMD 446.7） |
| ② `@tiptap/vue-2` 适配层 | 3 个文件，见 2.2 | **能去** | Vue 从「运行时必需」降级为「仅 UI 渲染器」 |
| ③ UI 代码本身 | 37 个 SFC 7008 行 + 31 个 mixin | **是重写，不是去依赖** | 干掉 Vue 2 EOL 债务；node view 少一层 Vue 包装 |

> 顺带纠正一个常见误判：**去 Vue 的收益不在体积**。Vue 运行时只占 UMD 首屏 446.7 KiB 的约 4%。真正的长期理由是 Vue 2 已于 2023-12-31 EOL，而我们是内网私有化部署，长期锁 Vue 2 是实打实的债。

### 2.4 工作量修正：mixin 里的逻辑大部分能留

`src/components/lark-doc/editor/` 下是 **31 个 mixin + 24 个 SFC（2968 行）**。会被推翻的只有 SFC 那部分，mixin 侧按可保留程度分三档：

- **零改动可直接搬的纯数据/常量**：`icons.js` 104 行、`palette.js` 134 行、`constants.js` 70 行、`docModes.js` 107 行、`shortcutGroups.js` 125 行 —— 共 **546 行**；
- **逻辑可搬、语法要改**：命令执行、列宽计算、折叠范围判定、标题编号计算 —— 改写成普通函数即可，算法本身不用重写；
- **真正要重写的是 Vue 响应式假设**：`$refs`（15 个 mixin 用到）、`$emit`（4 处）、**`$nextTick` 53 处**。`$nextTick` 是最大单点 —— 它实质是「等 DOM 刷新后再做定位」，原生写法很简单，但每一处时序都要重新验收。

> 这就是 §4 里 S3 必须「按模块渐进 + 每模块先补断言」的原因：重写量看着只有约 7000 行模板，但验收面是 53 个 nextTick 时序点。

---

## 3. 目标形态

### 3.1 七层单向依赖

```
L0  基础        utils / exception / networkPolicy / theme tokens
L1  文档内核    core（schema · blocks · commands · derive · nodeviews · decorations）   零 UI、零框架，Node 里能跑
L2  数据与接入  session / providers / collab / storage / registry
L3  特性单元    Feature Unit = 节点 + 命令 + 快捷键 + 装饰 + i18n + tier（UI 配件可选）
L4  UI 层       原生 DOM：toolbar / bubble / block-menu / dialogs / comments / panel
L5  渲染接缝    renderer adapter：mount / update / destroy / getInstance / getRoot
L6  发布面      <lark-doc> Web Component + vue3 / react 薄壳 + UMD / CDN
```

依赖只允许自下而上：`L0..L3` 不得 import `L4/L5/L6`。这条今天已基本成立，**缺的是校验它的断言**。

### 3.2 三条要写进 `check:architecture.js` 的硬规则

该脚本是纯 `assert` 风格的 Node 脚本（216 行，已在 `npm run check` 链里，现有规则如门面 `<700` 行、blocks `<400` 行、命令 id 逐项断言），追加规则零成本。

| # | 规则 | 落地方式 |
| --- | --- | --- |
| **R1** | `src/core`、`session`、`providers`、`collab`、`registry`、`utils` 下任何文件不得出现 `from 'vue'`、`from '@tiptap/vue-*'`、`from 'react'` 等 UI 框架 import | 直接硬失败（当前应全绿，作用是防回潮） |
| **R2** | `src/components` **新增**文件一律禁止引入 UI 框架；存量走**白名单清单**，断言清单只减不增 | 白名单固化当前 38 条，谁加新 SFC 就必须改清单，评审可见 |
| **R3** | `L0..L3` 不得 import `L4/L5`（反向依赖） | 静态扫描 import 路径 |

### 3.3 明确「不做」的事（写下来防止日后被重提）

| 提议 | 为什么不采纳 |
| --- | --- |
| 在包里内置 Vue 3 渲染器 | 等于同时维护两套 UI 实现，成本与回归面都翻倍；Vue 3 宿主用 `<lark-doc>` 元素已经拿到完全一样的能力（0.13 起） |
| 把内部 UI 组件也做成 Web Component | 编辑器内部组件需要高频同步的父子树与大量 props 传递，Shadow DOM + attribute 序列化在这个密度下更慢且更难调。Web Component 适合当**边界**，不适合当内部实现机制 |
| 一把梭全量重写 UI | 37 个 UI 模块里踩过的坑（垂直居中 1px、标题下拉三入口、折叠取缩进子树、浮层避让吸顶栏、列表序号顶格）会全部重新验收一遍，风险远大于收益 |
| 与 TypeScript / SWC 迁移合并推进 | 那是另一条工程改造线，与本方案正交。混在一起会让「是编译坏了还是重构坏了」无法归因 |

---

## 4. 落地节奏 S0 ~ S4

每阶段**独立提交、独立发版、可单独回退**，不设大爆炸节点。

| 阶段 | 内容 | 风险 | 产物影响 | 状态 |
| --- | --- | --- | --- | --- |
| **S0** | 0.13 打包收口：`browser` 字段、UMD 降 ES2018、vue3/react 薄壳、`__LARK_DOC_PUBLIC_PATH__` | 低 | 发布面收口，宿主零配置 | 已完成，待提交与发版 |
| **S1** | R1/R2/R3 三条闸门 + 渲染接缝契约文档化；**不动任何 UI** | 极低 | 无 | 待开 |
| **S2** | 摘 `@tiptap/vue-2`：原生 Editor 挂载 + 原生 NodeView（3 个文件） | 中 | Vue 降级为「仅 UI 渲染器」 | 待开 |
| **S3** | UI 按模块原生化，混合期允许「Vue 主壳挂原生模块」 | 高（视觉回归） | 逐模块替换，随时可停 | 待开 |
| **S4** | 删除 vue2 renderer；element 去掉 `--inline-vue` | 低（S3 完成后） | element 预计降到 UMD 同档约 447 KiB gzip | 待开 |

### S1 · 钉死闸门（今天就能做）

- 给 `scripts/check-architecture.js` 追加 R1 / R2 / R3；
- R2 白名单固化为当前 `.vue` 清单（38 条），断言长度不得增长；
- 把 `src/mount/index.js` 已有的 renderer 契约（`mount / update / destroy / getInstance / getRoot`）写进注释与类型标注 —— 抽象本身已经正确，只是没被锁死；
- 顺手修：`src/mount/vueRenderer.js` 头部注释写「四个动作」，实际导出五个（`getRoot` 是第五个）。

**验收**：`npm run check` EXIT=0 且 0 warning。

### S2 · 摘 `@tiptap/vue-2`

- `LarkDocEditor.vue`：用 `@tiptap/core` 的 `Editor` + 十几行原生挂载替换 `EditorContent`；
- `adapters/vue2/nodeviews.js` 与 `CodeNode.vue`：改为 core 原生 NodeView；
- 改完后 `CodeNode.vue` 不必再是 SFC，R2 白名单顺势减 1。

**验收**：`npm run verify` 全绿；浏览器断言全绿；代码块的语言切换与增删仍能用；`code_block` 相关装饰行为不变。

### S3 · UI 原生化（按此顺序，每批一个 commit）

| 批次 | 模块 | 主要涉及文件 | 为什么排这个位置 |
| --- | --- | --- | --- |
| 1 | Tooltip / 气泡条 | `BubbleBar.vue`、`bubbleMenuMixin.js` | 独立浮层、无文档语义，失败面最小；`DEVELOPMENT.md` 里「浮层避让吸顶栏」正好当验收用例 |
| 2 | 工具栏 | `ToolbarBar.vue`、`TopBar.vue` + toolbar 相关 mixin | 纯按钮与下拉，无选区副作用 |
| 3 | 各级菜单 | `BlockHandleMenu.vue`、`LarkDocHeadingMenu.vue`、`CommandMenu.vue` + menu mixin | 开始碰到「菜单三入口展开」「假 mouseleave」等交互坑 |
| 4 | 弹窗 / 面板 | `dialogs/` 6 个 + CommentPanel / VersionPanel / OutlinePanel / TemplateLibrary 等 | 体积大但交互套路统一 |
| 5 | 主壳 | `PaperStage.vue`、`LarkDocOverlays.vue`、`LarkDocWorkspace.vue` | 必须最后动 |

**混合期怎么过渡**：`src/mount/index.js` 的 `setRenderer()` 是换整渲染器的钩子，粒度不够；实际做法是在 Vue 主壳里**逐个把子组件替换成原生 DOM 片段**。一个批次做完即可发一个 MINOR，随时可停。

**每批开工前必做**：先给该模块补一组浏览器断言。现有基线（可作参照量级）：highlight-fold 74 / heading-number 38 / heading-menu 16 / icon-align 7 / list-marker 23 / list-number-menu 30 / element 14 / mermaid 12 / vditor 91。

### S4 · 收尾

- 删除 `src/mount/vueRenderer.js`，`createRenderer()` 默认切到 `domRenderer`；
- `build:element` 去掉 `--inline-vue`，element gzip 预计从 462.7 KiB 降到约 447 KiB；
- `peerDependencies` 删除 `vue` 与 `@tiptap/vue-2` 两项；
- `size-limit` 门禁相应下调。

---

## 5. 回归防线（复用现有资产，不必新造）

| 层 | 手段 | 命令 |
| --- | --- | --- |
| 静态校验 | 架构闸门（含新增 R1/R2/R3）+ 契约 + lint | `npm run check` |
| 产物校验 | 重建 dist + vditor HTML + size-limit 门禁 | `npm run check:artifacts` |
| 端到端验收 | `verify.mjs` | `npm run verify` |
| 视觉 / 交互断言 | 浏览器断言 9 组（基线见 S3） | 按 `DEVELOPMENT.md` 的 playwright 口径 |
| 性能 | `perf/measure.mjs` | `npm run check:perf` |

**回滚粒度**：每个 commit 独立。S3 任一批次出问题，回滚该批次 commit 即可，不影响 S1 / S2 的成果。

### 当前 size-limit 与实测对照

| 产物 | 实测 gzip | 门禁 | 余量 |
| --- | --- | --- | --- |
| `lark-doc.esm.js` 主包 | 272.5 KiB | 285 KB | 12.5 KB |
| `lark-doc.umd.min.js` | 446.7 KiB | 465 KB | 18.3 KB |
| `lark-doc-element.umd.min.js` | 462.7 KiB | 480 KB | 17.3 KB |
| `lark-doc.common.js` | 2399.4 KiB | 2500 KB | 100.6 KB |

---

## 6. 下一步（按推荐顺序）

1. **S1**：把 R1 / R2 / R3 加进 `scripts/check-architecture.js` —— 零风险、当天可做，立刻开始产生复利（防止新人往 `core/` 里塞 Vue）；
2. **S2**：摘 `@tiptap/vue-2` —— 独立性最强、收益最明确的下一个正式技术任务；
3. **S3 试点**：选批次一（气泡条）做原生化试点，**用它的真实工时反推 S3 排期**，而不是现在拍脑袋估。

顺序建议 **1 → 2 → 3**：1 是 2 与 3 的安全网；2 做完会让 3 的第一个批次更容易（node view 那时已经是原生的了）。

---

## 7. 风险登记

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| S3 期间 UI 分叉（一半 Vue 一半原生，风格漂） | 视觉不一致 | 每批次结束立即跑回归断言；不允许同一控件长期存在两个版本 |
| 原生化后性能反噬 | 体验倒退 | 有 `check:perf` 基线（mount / keystrokeP95 / scrollFps），每批次后采样一次 |
| 框架换成原生后，原先被响应式掩盖的时序 bug 暴露 | bug 群 | 本质上是收益（隐式依赖显性化），但要留缓冲 —— 建议 S3 批次之间隔一个 MINOR 稳定期 |
| Vue 2 在完工前爆出必须修的安全问题 | 中 | S2 完成后 Vue 只存在于 UI 层，届时可直接跳做 S3 的批次 4 / 5，不必等全量排期 |
