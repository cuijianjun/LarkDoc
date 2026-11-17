# 主产物体积拆分方案（懒加载，不动引入/安装逻辑）

前置阅读：[性能与预算](./performance.md) 的「2026-11-17：体积预算口径修订与超预算归因」一节。

**硬约束**：对外 API、构造签名、宿主的 `import` / `<script>` / `install` 方式一律不变。懒加载必须在产物内部自消化，不允许要求宿主多引一个文件、多调一次初始化。

本方案的所有收益数字来自 `dist/lark-doc-graph.json` 的真实依赖图 + Rollup 模块级 `renderedLength` 探针，用实测比率（`esm` 初始图 `gzip / raw = 0.156`）换算，落地实测预计有 ±3~5% 偏差。

---

## 一、结论

三档切口，按风险从低到高递进，每档可独立成 PR、独立回滚：

| 档 | 内容 | 省下 gzip | 落地后 ESM | 对 310 KB 预算 |
| --- | --- | ---: | ---: | --- |
| 现状 | — | — | 383,986 | 超 74 KB |
| **A** | 面板 / 对话框（打开才用）+ 封面 | ≈ 32,700 | ≈ 351,300 | 超 41 KB |
| **B** | A + 菜单 / 浮层 / 手柄 / 斜杠命令 | ≈ 96,500 | ≈ 287,500 | **达标，余 22 KB** |
| **C** | B + 评论 | ≈ 112,200 | ≈ 271,800 | 达标，余 38 KB |

- **ESM / lite 在 B 档即可达标**，不需要走到 C 档。C 档留给后续「预算再收紧」的余量。
- **Element 单独走第七节的一条线**，与 A/B/C 无关：**L0 把整个 runtime 移出应用加载路径（613 KB → 0），L1–L3 把单文件从 613 KB 降到 ≈ 418 KB**。上一版「三档都救不了」的结论已作废。
- 理论上限：把「除首屏必需之外的全部 mixin」一起惰性化，两种切分口径分别实测 105,902 B / 79 模块和 108,005 B / 87 模块（互有出入，差 2 KB）。C 档补上 `notify` / `confirm` 后已越过这两个口径——说明**再往下拆没有空间了**，工作重心应转向「不让 `src` 继续涨」而不是继续拆。
- 注意：A/B/C 是**按体积门槛**凑出来的档位，第七节的 18 组是**按业务使用时机**切的。后者口径更细（含 `src/ui` 顶层工具栏、`src/core/nodeviews` 等 A/B/C 算作首屏的部分），因此 Element 侧 153,747 的收益**不能与 A/B/C 的 112,200 直接相加**。

### 单模块独占体积（降序，只列 ≥ 2 KB；全量 64 项由附录探针脚本产出）

| mixin | 独占 gzip | 模块数 | 分档 | 跨界调用方 |
| --- | ---: | ---: | --- | --- |
| `p6bMixin`（聚合点） | 39,487 | 24 | 拆解后按件分档 | — |
| `commentsMixin` | 15,330 | 5 | C | bubbleMenu / stageUi / blockInteraction |
| `toolbarUiMixin` | 9,737 | 4 | 首屏 | — |
| `commandMenuMixin` | 8,291 | 13 | B | — |
| `shareMixin` | 7,905 | 3 | A（判据留首屏） | blockHandleUi / blockMenu / toolbarUi / bubbleMenu / linkToolsUi |
| `tableInteractionMixin` | 6,112 | 1 | B | — |
| `panelsUiMixin` | 5,465 | 4 | A | — |
| `blockHandleMixin` | 5,121 | 1 | B | — |
| `blockMenuMixin` | 4,399 | 3 | B | — |
| `tableToolsMixin` | 4,230 | 1 | B | — |
| `versioningMixin` | 4,048 | 2 | A | viewModes |
| `blockHandleUiMixin` | 4,018 | 3 | B | — |
| `topbarMoreMixin` | 4,016 | 1 | B | — |
| `bubbleMenuMixin` | 3,987 | 2 | 首屏 | — |
| `notifyMixin` | 3,531 | 1 | B（被 overlaysUi 依赖） | overlaysUi |
| `toolbarMenusMixin` | 3,498 | 2 | B | — |
| `mentionMixin` | 3,493 | 1 | B | — |
| `reminderMixin` | 3,401 | 1 | A | commandMenu / overlayDismiss |
| `viewModesMixin` | 3,281 | 1 | 首屏 | — |
| `tableToolsUiMixin` | 2,971 | 4 | B | — |
| `linkToolsUiMixin` | 2,755 | 2 | B | — |
| `overlaysUiMixin` | 2,441 | 4 | B | — |
| `mentionUiMixin` | 2,432 | 2 | B | — |
| `revisionMixin` | 2,353 | 1 | A | viewModes |
| `coverMixin` | 2,178 | 1 | A（被 panelsUi 依赖） | panelsUi |
| `documentMenuView` | 2,125 | 1 | B | — |

> 「独占」= 只切断进入该种子模块的静态边后，从入口不可达的模块集合。种子之外的共享依赖仍由其它路径到达，因此不等于「入口的完整静态闭包」。

---

## 二、为什么不能直接把 `import` 改成 `import()`

四个卡点，每一个都会让「粗暴改 import」当场炸：

### 卡点 1：`mixins` 是按值传入的数组

`src/editor/nativeOptionsHost.js` 第 4–10 行：

```js
const visit = option => { (option.mixins || []).forEach(visit); layers.push(option) }
const methods = Object.assign({}, ...layers.map(layer => layer.methods))
const computed = Object.assign({}, ...layers.map(layer => layer.computed))
```

`nativeEditorHost.js` 第 68–74 行把 42 个 mixin 直接写进数组。往数组里塞 `Promise` 只会得到 `undefined` 的 `methods`。**必须先改宿主**，这是本方案唯一一处框架级改动（第四节）。

### 卡点 2：`writable()` 是全局判据，162 处调用 / 30 个文件

`readingModeMixin.writable()` 提供「修订 / 阅读 / 协同只读」三态的唯一口径，被 `blockHandle`、`bubbleMenu`、`viewModes`、`toolbarMenus`、`tableInteraction`、`WorkspaceController` 等 30 个文件调用。它同时也是 `applyInteractionMode()` 的宿主——`nativeEditorHost.js` 的 `session` watcher 直接调。

**结论：`readingModeMixin` 永远留在首屏。** 但它当前藏在 `p6bMixin` 的 `mixins` 数组里（第 51 行 import、第 82 行挂载），而 `p6bMixin` 是要整体惰性化的。所以第一步不是拆 `p6bMixin`，而是**把它从聚合点里取出来、改由 `nativeEditorHost.js` 首屏引入**。这一步做完，`p6bMixin` 剩余 38,552 B 才能整体惰性化。

### 卡点 3：`p6bMixin` 是 13 个 mixin 的聚合点，内含 26 条首屏跨界调用

首屏 mixin 直接调用「非首屏 mixin」的方法共 **41 条**。其中 16 条只是 `writable()`（Phase 1 把 `readingModeMixin` 提到首屏后自动消失），剩 **25 条真实跨界**：

```
blockHandleUi  → share   : shareCan
blockMenu      → share   : shareCan
toolbarUi      → share   : shareCan, toggleSharePopover
toolbarUi      → createMenu : measureCreateMenu
toolbarUi      → searchPanelUi : focusSearchPanel
overlaysUi     → notify  : notificationContext, notifyCurrent, measureNotify, closeNotify, markAllNotifyRead, toggleNotifyMute
overlaysUi     → share   : 6 项
overlaysUi     → export  : 4 项
linkToolsUi    → linkHover / share : 5 项
toolbarMenus   → createMenu / linkHover : 3 项
commandMenu    → calendar / isv / reminder : 5 项
overlayDismiss → calendar / isv / reminder : 3 项
viewModes      → revision / searchPanelUi : 2 项
bubbleMenu     → comments / share : 2 项
extendedOverlaysUi → confirm : closeConfirm
stageUi        → comments : openImageComments
```

这 26 条不能一律用「异步补挂」解决——`shareCan` 在 `refreshToolbar` / `refreshBlockHandle` 里是**同步**读的。第五节给出三种隔离手段。

### 卡点 4：Element 档是单文件 inline，`import()` 无效

`rollup.config.mjs` 的 `element` / `elementRuntime` 目标都设 `inlineDynamicImports: true`（第 666、680 行）。写 `import()` 只会被内联回同一个文件，体积一分不省。

但 **`import()` 不是 Element 唯一的懒加载通道**。`src/features/element.js` 用的是运行时 `document.createElement('script')` 侧载，这条路**不经过 Rollup**，能把任意业务块搬出单文件——现有的 `mermaid` / `office` / `math` / `highlight` / `document` / `markdown` / `ui` 七个组共 1.5 MB 就是这么搬出去的。Element 的问题不是「没法拆」，是「只拆了重依赖、没拆业务代码，而且 runtime 无条件在 `<script>` 落地时拉取」。见第七节。

---

## 三、范围与顺序

```
Phase 0  宿主分层        nativeOptionsHost.js 支持后挂层         (框架级，唯一)
Phase 1  抽出判据        readingModeMixin 上首屏 + shareCapability 拆判据
Phase 2  A 档            ~32.7 KB，面板 / 对话框 / 封面
Phase 3  B 档            ~96.5 KB，菜单 / 浮层 / 手柄 → ESM 达标
Phase 4  C 档（可选）     ~107.6 KB，评论

Element 独立线（与 A/B/C 并行，互不阻塞）：
L0  runtime 延迟引导      loader.js 加观察器，613 KB 移出加载路径   ← 改动最小、收益最大
L1  18 组业务侧载         20 组静态桩 + 12 组走 Phase 0 后挂       -153.7 KB
L2  CSS 随组下沉          13 条 @import 改挂到组入口               -21.0 KB
L3  core-js 裁剪          6 个 feature → 按 browserslist 保留      -8~21 KB
```

Phase 2/3 可以并行，但都必须等 Phase 0 + 1 落地。**L0 不依赖任何前置，可以立刻做。**

---

## 四、Phase 0：宿主支持分层后挂

### 4.1 改动点

`src/editor/nativeOptionsHost.js`。核心是把「一次性收集全部层」改成「先注册首屏层，之后可增量注册」，并让 `registerLayers` 具备与启动时等价的接线能力。

```js
export function createNativeOptionsHost({ options, ... }) {
  const layers = []
  const visit = option => { (option.mixins || []).forEach(visit); layers.push(option) }
  visit(options)

  const methods = {}
  const computed = {}
  const pending = new Set()
  const dependencies = new Map()
  const computedEffects = new Map()
  const watchers = []
  let ready = false
  // …
```

新增 `registerLayers`，语义与启动时的接线完全一致：

```js
  // 后挂一层。幂等：同一对象重复注册直接返回。
  const registered = new Set(layers)
  const registerLayers = next => {
    if (destroyed || destroying) return
    const collected = []
    next.filter(Boolean).forEach(option => {
      const before = layers.length
      visit(option)                        // 复刻「先子后父」的层序
      layers.slice(before).forEach(layer => {
        if (registered.has(layer)) return
        registered.add(layer)
        collected.push(layer)
      })
    })
    if (!collected.length) return
    // 顺序语义：后注册的层覆盖先注册层的方法/计算属性（Object.assign 语义）
    collected.forEach(layer => applyLayer(layer))
    collected.forEach(layer => layer.created?.call(host))   // 补 replay
    flush()
    onChange?.()
  }
```

`applyLayer` 就是把现有第 179–205 行的三段（`methods` 包装、`computed` 注册、`data` 播种、`watch` 初始求值）抽成一个可复用函数：

```js
  const applyLayer = layer => {
    Object.entries(layer.methods || {}).forEach(([key, method]) => {
      methods[key] = method
      target[key] = (...args) => destroyed ? undefined : method.apply(host, args)
    })
    Object.entries(layer.computed || {}).forEach(([key, definition]) => {
      computedEffects.set(key, { key, computed: true, dirty: true, dependencies: new Set(),
        get: typeof definition === 'function' ? definition : definition.get, set: definition.set })
    })
    const data = layer.data?.call(host) || {}
    Object.entries(data).forEach(([key, value]) => { if (!seeded.has(key)) { seeded.add(key); raw[key] = value } })
    Object.entries(layer.watch || {}).forEach(([key, definitions]) => { /* 与现逻辑一致 */ })
  }
```

返回值追加一项，`beforeDestroy` 也要覆盖后挂的层：

```js
  return { host, state, flush, registerLayers, mount, updateProps, invalidateEditor, destroy }
```

### 4.2 必须守住的四条语义

| 语义 | 为什么 | 怎么守 |
| --- | --- | --- |
| 覆盖顺序 = 「先子后父、后注册压先注册」 | `p6bMixin` 把 `readingModeMixin` 放最后就是为了压住同名旧口径 | `visit` 递归顺序不动；`applyLayer` 按 `collected` 顺序执行 |
| `data` 只播种不覆盖 | 宿主 `state` 传入的同名键必须优先 | 沿用 `seeded` 集合（现有第 185–189 行的逻辑） |
| `watch` 后挂时要补一次初始值 | 否则首个变更拿到 `undefined` 作为 `previous` | `applyLayer` 里 `watcher.value = evaluate(watcher, watcher.read)`，`immediate` 仍立即触发 |
| `created` 要 replay | mixin 的 `created` 常做事件绑定、DOM 测量 | `registerLayers` 合并后对新增层逐个 `created` |

### 4.3 对外零变更的证明方式

`createNativeOptionsHost` 只在 `src/editor/` 内部被 `nativeEditorHost.js` 调用。`registerLayers` 是**新增导出字段**，不传即退化为现有行为（`ready` 之前完成全部注册 → 与今天完全一致）。因此 Phase 0 单独合入时产品行为不变，可以先上这一层再谈拆分。

---

## 五、三种隔离手段

26 条跨界调用按「调用时机」分三类，各配一种手段。这是本方案能否落地的关键——只用其中一种都会留下崩溃点。

### 手段 1：判据留首屏（同步路径必须）

适用于**渲染期同步读**的纯判定函数。

- `writable()` / `showEditingChrome()` / `applyInteractionMode()` → `readingModeMixin` 整体留首屏（935 B，Phase 1）。
- `shareCan()` / `shareReadCurrent()` / `selectionShareTargetValid()` → 从 `shareMixin` 抽到新文件 `src/components/lark-doc/editor/shareCapability.js`，`shareMixin` 与首屏消费方（`blockHandleUi` / `blockMenu` / `toolbarUi`）都从它 import。判据只有几百字节，`shareMixin` 剩 7.9 KB 里的 DOM/网络部分随 B 档走。
- `createMenu` 的 `measureCreateMenu` 被 `toolbarUi` 在刷新时调 → `createMenuMixin`（732 B）留首屏，菜单内容随 `toolbarMenus` 走。

**判据与行为分离**是这条线的统一做法，`src/core/policy/capability.js` 已经是同类基建，可复用。

### 手段 2：异步闸（点击才走）

适用于用户交互触发、可以等一次网络/IO 的入口。

在门面上加一个 `requireLayer`，并把首屏侧的调用点包一层：

```js
// nativeEditorHost.js
async requireLayer(name, thunk) {
  await this._layerLoader?.(name)   // 内部就是 Promise.all 一组 () => import(...) + registerLayers
  return thunk()
}
```

调用点收敛到 `editHoveredLink` / `focusSearchPanel` / `openSelectionComment` / `openSelectionShareDialog` / `startCalendarEvent` / `startReminder` / `openExportDialog` 这批入口。它们**全部在 `@click` / `keydown` 回调里**，不在刷新路径上。

配套要求（必须一起做，否则首次点击会有明显空白）：

- 交互入口先进入 pending 态（按钮加 `aria-busy`，浮层挂空壳）；
- `createLazyUi` 已有的「`attempted` 只试一次、失败后可重试」语义直接复用；
- 加载失败走现有 `lark-doc-error` 事件链，不新增对外契约。

### 手段 3：判空可选调用（清理 / 关闭类）

适用于「没加载就等于没打开」的清理语义。

```js
// 原：this.closeIsvPanel()
// 改：this.closeIsvPanel?.()
```

适用清单：`overlayDismiss` 的 `closeCalendarSearch` / `closeIsvPanel` / `closeReminderPopover`，`extendedOverlaysUi` 的 `closeConfirm`，`overlaysUi` 的 `closeNotify` / `closeExportDialog`，`viewModes` 的 `syncRevisionTracking`，`stageUi` 的 `openImageComments`（无图片评论时）。这里的 `?.` 不是掩盖问题，而是**语义上本就等于「未打开」**。

---

## 六、分档清单

### 6.0 首屏保留清单（三档共用）

以下 13 项任何一档都不动，合计约 24.6 KB。判据是「渲染期同步需要」：

| mixin | gzip | 留下的理由 |
| --- | ---: | --- |
| `toolbarUiMixin` | 9,737 | 顶栏是首屏 DOM，`refreshToolbar` 挂在 `mobileEditorActive` / `menuOpen` / `colorPaletteOpen` 等 watcher 上 |
| `bubbleMenuMixin` | 3,987 | 选区气泡条的显示依赖选区同步，不能等一次 import |
| `viewModesMixin` | 3,281 | 视图模式决定首屏布局 |
| `toolbarCollapseMixin` | 1,936 | 窄视口顶栏折叠，首屏即生效 |
| `overlayDismissMixin` | 1,382 | 全局 Esc / 点击外部，必须在任何浮层出现前就位 |
| `readingModeMixin` | 935 | `writable()` 162 处调用 / 30 个文件（Phase 1 从 `p6bMixin` 提出） |
| `selectionPacingMixin` | 778 | 选区节流，首屏输入路径 |
| `createMenuMixin` | 732 | `measureCreateMenu` 在 `refreshToolbar` 同步读（Phase 1 从 `p6bMixin` 提出） |
| `foldPersistMixin` | 504 | 折叠态持久化，首屏恢复 |
| `collabMixin` | 397 | 协同会话挂载 |
| `blockIndentMixin` | 328 | 缩进输入规则 |
| `stageUiMixin` | 320 | 编辑区容器尺寸 |
| `popoverPosition` | 302 | 浮层定位工具（被 `createMenu` 等首屏件共享） |

> B 档数字在首屏清单定型后预计浮动 ±2 KB：例如把 `headingNumberMixin`（1,274 B）也留首屏，B 档降到 ≈ 95.2 KB。不影响达标判定（余量 22 KB 足够吸收）。

**归位校验**：`options.mixins` 现有 42 项 = 41 个直接 mixin + 1 个聚合点 `p6bMixin`。41 项归位为 **首屏 10 / A 档 11 / B 档 20**；`p6bMixin` 展开的 13 个成员归位为 **首屏 2**（`readingMode` / `createMenu`）、**A 档 4**（`share` / `export` / `versioning` / `cover`）、**B 档 6**（`topbarMore` / `linkHover` / `codeLang` / `confirm` / `notify` / `relationBitable`）、**C 档 1**（`comments`）；`commentPanelView` 随 B 档的 `nativeCommentPanelMixin` 走。展开后共 54 个 layer，与现有 42 项一一对应，无遗漏、无新增挂载点。

### A 档：面板 / 对话框（打开才用）≈ 32.7 KB

15 个挂载项（`documentSearch` 是 `searchPanelUi` 的依赖子模块，随它一起走）：

```
面板类    panelsUi  dialogsUi  searchPanelUi  isvPanelUi  calendarSearchUi  revisionUi
业务类    reminder  reminderUi  calendar  isv  revision  versioning  export
          share  cover
```

- 探针值 30,541 B / 24 模块，加 `coverMixin`(2,178) ≈ **32,719 B**。`cover` 必须同档，因为 `panelsUi` 直接调 `addCover` / `openCoverPanel`。
- 15 项里 `panelsUi` / `dialogsUi` / `reminderUi` / `searchPanelUi` / `isvPanelUi` / `calendarSearchUi` / `revisionUi` 均为 `data=0 computed=0 watch=1` 形态，后挂风险最低。
- 已有懒加载范式可抄：`revisionUiMixin.js` 用 `createLazyView(() => import('../../../ui/revision'), 'createRevisionPanels', …)`，`panelsUi` 照此改造即可。
- **A 档单独不达标**（ESM 仍超 41 KB），必须和 B 档一起上才有效果。若只想先验证基建，A 档的价值是「证明 Phase 0 可行 + 拿到 32 KB」。

### B 档：A + 菜单 / 浮层 / 手柄 / 斜杠命令 ≈ 96.5 KB

在 A 档基础上追加：

```
commandMenu  commandMenuUi  blockMenu  blockHandle  blockHandleUi  tableTools  tableToolsUi
tableInteraction  toolbarMenus  calloutColor  calloutToolsUi  colorPaletteUi  headingNumber
headingNumberMenuUi  linkToolsUi  linkHover  mention  mentionUi  helpFabUi  overlaysUi
extendedOverlaysUi  topbarMore  codeLang  relationBitable
+ notify（被 overlaysUi 依赖）+ confirm（被 extendedOverlaysUi 依赖）
```

- 探针值 92,290 B / 81 模块，补 `notifyMixin`(3,531) + `confirmMixin`(636) ≈ **96,457 B**。
- **这一档让 ESM / lite 达标**（287.5 KB / 310 KB）。
- 风险点：`bubbleMenu` 也被列进 B 档的话会破坏选区交互的即时性——它当前标「首屏」，不建议动。`toolbarUiMixin`（9,737 B）是顶栏装配主体，同样留首屏。

### C 档：B + 评论 ≈ 112.2 KB

只追加 `commentsMixin`（15,330 B，含 `core/comments/{thread,binding,state}`）。探针 C 档值 108,005 B / 87 模块，补上 `notify` / `confirm`（4,167 B）后 ≈ **112,172 B**。

- 依赖它的面很宽：`bubbleMenu` / `stageUi` / `blockInteraction` / `topbarMore` / `notify` / `panelsUi` 都有调用。其中 `bubbleMenu → openSelectionComment` 与 `panelsUi → imageCommentCurrent` 走手段 2，`notify → activateComment` 走手段 2。
- **建议单独 PR、单独回滚**，不要和 B 档混在一起。

---

## 七、Element 档：三层拆分 + 一层引导延迟

Element 档 614,339 B gzip（`lark-doc-element.runtime.umd.min.js`）。原 475,000 B 的单文件预算已拆成「引导 2 KB + runtime 620 KB」两条（见 7.8），因为 L0 之后总字节不变、但进不了应用加载路径，单文件口径量不出这件事。

**上一版结论（「单文件 inline，三档都救不了，只能抬预算到 520 KB」）是错的。** 错在把「`import()` 无效」等同于「无法拆分」——`import()` 确实无效，但 Element 走的是**运行时 `<script>` 侧载**，那条路不经过 Rollup，能把任意业务块搬出单文件。`src/features/element.js` 的 `groups` 表已经用这个机制搬走了 1.5 MB（mermaid 1002 KB / office 220 KB / math 80 KB / highlight 68 KB / document 30 KB / markdown 18 KB），证明机制成立，只是**没用够**。

四层各治一个病，可以分开上线：

> **⚠ 7.5（L1.5）已作废，2026-11-17 实测推翻前提。** 关掉 `inlineDynamicImports` 重新出图后，`elementRuntime` 只有一个静态 chunk：`3,963,848 B / 523 模块`，`prosemirror-*` 与 `@tiptap/*` **全部在里面**；42 条动态边只指向 `remoteConversion`、`stage`、`dialogs`、`tooltip`、`snapshot` 这类小功能，合计约 120 KB。原文「295 模块 / 217,596 只经 `import()` 到达」是拿 `bundle.cache.modules[].dependencies` 做 BFS 得出的——折叠模式下 cache 不含动态边，于是动态入口的整棵子树被误判成「静态不可达」。**L1.5 方案与本章所有 −196,457 / −217,596 / 418 KB / 264 KB 的数字一并不成立。**

| 层 | 治什么 | 一句话做法 | 收益 |
| --- | --- | --- | ---: |
| **L0** | 应用加载时太大 | `loader.js` 不再在模块顶层无条件插 runtime，改视口观察 | 加载路径 613 KB → 0 |
| ~~**L1.5**~~ | ~~单文件被 `import()` 内联虚胖~~ | ~~295 个只经 `import()` 到达的模块外置成 `engine` 组~~ | ~~−196,457~~ **作废** |
| **L1** | 业务代码全在首屏 | 按使用时机切 18 组，走现有 `groups` 表 | −153,744 |
| **L2/L3** | CSS 与垫片跟着首屏走 | CSS 独立成文件 + 卸掉 core-js | 已落地 59,350（见 7.9） |

### 7.1 实测构成（`elementRuntime`，K = gz / ΣrenderedLength = 0.1501）

| 区 | gzip | 模块 | 说明 |
| --- | ---: | ---: | --- |
| `npm tiptap + prosemirror` | 178,273 | 49 | 内核静态部分不可切；**其中只经 `import()` 到达的部分由 7.5 外置**（prosemirror 几乎全在那一侧） |
| `src/core`（blocks / nodeviews / embed / documentOperations / media） | 139,427 | 143 | 块渲染与文档操作，**其中 63,667 已经是按需的**（未达 53 模块） |
| `src/components`（editor mixin 120,279 + ai 10,490 + 配置 4,742） | 132,479 | 74 | **几乎全可切** |
| `src/ui`（topBar / toolbar / icons / stage / blockHandle） | 40,359 | 30 | `ui` 组已侧载，首屏仍留 33,357 |
| CSS 内联（`style.css` 单一模块 265,008 renderedLength） | 39,797 | 1 | **旧记 28 KB 是错的** |
| `npm core-js` 垫片 | 21,139 | 173 | 现代浏览器目标下可裁 |
| `src/editor` / `workspace` / `session` / `utils` / `mount` / 其余 | 62,865 | 126 | 部分可切 |
| **合计** | **614,339** | **556** | `lark-doc-element.runtime.umd.min.js` |

> 口径：`ΣrenderedLength = 4,094,035`，产物 `raw = 2,138,051`，比值 1.915 —— `renderedLength` 是 **terser 压缩前**长度，所以模块级 gzip 必须用 `614,339 / 4,094,035 = 0.1501` 折算，**不能**用整文件 `gz/raw = 0.2873`（会系统性高估压缩率低的模块，上一版的 76 KB CSS 就是这么来的）。

### 7.2 同类产品怎么做（调研结论）

四家做法不同，但**没有一家改动对外 API**，全部在包内部造边界：

| 产品 | 拆分机制 | 如何保住加载性能 | 对本项目的意思 |
| --- | --- | --- | --- |
| **ECharts** | `echarts/core` + `echarts.use([BarChart, GridComponent, CanvasRenderer])` 运行时注册表；subpath export（`echarts/charts` / `components` / `renderers`）让 tree-shaking 生效；renderer **故意不默认包含**，逼使用者二选一以省掉另一个 | `use()` 必须在 `init()` 前调用 —— 注册表是**同步**的，懒加载只发生在**模块解析层**（subpath），不在运行时 | 与本仓库 `registerFeature` / `loadFeature` 同构。ECharts 全量约 1 MB minified，按需后降到零头，说明「注册表 + subpath」这套在本类库上是验证过的 |
| **Tiptap** | 官方**没有**拆分边界，performance guide 只讲 `immediatelyRender` / `shouldRerenderOnTransaction` 等渲染控制 | 社区靠 `await Promise.all([import('@tiptap/extension-x')])` 懒加载 extension 数组，再 `editor.registerPlugin` | 我们的 178 KB tiptap+PM 就是这块，**它自己也不拆**。所以不该指望从内核榨体积，只能控制「什么时候加载它」 |
| **Vditor** | `cdn` 参数 = 运行时资源根路径；lute 引擎、mermaid、flowchart、graphviz、math、echarts、mindmap 全部在 `dist/` 下按需 `<script>` 拉取；`cdn: ''` 则全内联 | ① 按渲染类型懒加载（文档里出现 mermaid 才拉 mermaid）；② **渲染优先级调度**（先文本、后图表/公式）；③ 构建出 **4 个入口**：`index.min.js` / `method.min.js` / 非 min 两份 —— `method.min.js` 是**纯 API 面**，宿主只调方法时可完全不加载编辑器内核 | **最贴近本项目**：`loader 678 B → runtime 613 KB` 就是 Vditor 的 `cdn` 两种形态。差的只是「runtime 何时拉」这件事没做 |
| **reactjs-tiptap-editor** | extension 走 feature subpath，只挂需要的控件；Word 转换器 / 上传弹窗 / Drawer canvas / Emoji picker / KaTeX 全在**使用时**才加载 | **明确声明不需要额外 `React.lazy`** —— 因为包内已有加载边界；并强调「initial JavaScript / total emitted / installed package size 是三个不同指标」 | 我们的 7 个 `feature:*` 组就是这个模式，同样不需要宿主加 `lazy`。它提醒的「三个指标」正是上一版把 475 KB 单文件当成唯一指标的错误 |

**四条共性**：① 拆分边界画在「**用户什么时候真的会用到**」而不是目录结构；② 注册表/工厂是**同步**的，异步只发生在「取模块」这一步；③ 重依赖（渲染器、语言包、转换器）一律外置，内核只留调度；④ **加载时机本身就是一种拆分手段**——Vditor 的 `cdn` 与 `method.min.js` 都不减字节，但把字节移出了关键路径。

我们的差距不在机制，在于**只用了机制的一半**：7 个重依赖组已外置，但 `src/components` 132 KB、`src/ui` 33 KB、CSS 40 KB、core-js 21 KB 全在关键路径上，而且 **runtime 在 `<script>` 一落地就无条件拉取**。

### 7.3 L0 引导延迟：把 613 KB 移出应用加载路径（单刀最大，改动最小）

**这是本次最重要的一刀，也是唯一真正命中「应用加载时太大」的解法。**

现状（`src/web-component/loader.js:30`）：

```js
export const runtimeReady = loadLarkDocRuntime()   // ← 模块顶层，立即执行
```

`lark-doc-element.umd.min.js`（678 B）一被 `<script>` 加载，立刻 `appendChild` 插入 runtime `<script>` 拉 613 KB —— **不管页面上有没有 `<lark-doc>`、有没有进视口**。首页只要引了这个脚本，613 KB 就进关键路径。

改成按需触发：

```js
const RUNTIME_FILE = 'lark-doc-element.runtime.umd.min.js'
let runtimePromise = null

export function loadLarkDocRuntime() { /* 原实现，改为写入 runtimePromise 后复用 */ }

/** 首个 <lark-doc> 进入视口（或已存在且可交互）时才拉 runtime */
function arm() {
  if (typeof document === 'undefined') return
  const kick = () => { loadLarkDocRuntime() }

  // 1) 脚本执行时文档里已有元素：直接进观察队列
  // 2) 之后动态插入的元素：MutationObserver 补挂
  // 3) 兜底：requestIdleCallback 后仍无元素则不预载，等首次 createElement
  const watch = el => observer.observe(el)
  const observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { observer.disconnect(); mo.disconnect(); kick() }
  }, { rootMargin: '400px' })   // 提前 400px，滚动到之前就开始拉

  document.querySelectorAll(DEFAULT_TAG).forEach(watch)
  const mo = new MutationObserver(() => document.querySelectorAll(DEFAULT_TAG).forEach(watch))
  mo.observe(document.documentElement, { childList: true, subtree: true })
}

arm()
export const runtimeReady = () => runtimePromise || loadLarkDocRuntime()
```

**为什么安全**：`customElements.define()` 会**自动 upgrade 文档中已存在的同名元素**（W3C 标准行为，`register.js` 的 `upgradeLarkDoc` 就是这条的兜底）。所以「先有 `<lark-doc>`、后 define」是合法状态，属性在 upgrade 前已挂在 DOM 上不会丢。需要补的只有一个占位样式，避免未定义元素塌成 inline：

```css
lark-doc:not(:defined) { display: block; min-height: var(--lark-doc-placeholder-height, 320px); }
```

**收益**：应用加载路径上 Element 体积 **613 KB → 0**（无 `<lark-doc>` 或未入视口时）。首屏含编辑器时 → 613 KB 但**延后到可见时**，与 ESM `import()` 同语义。
**风险**：低。不改任何宿主写法、不改 `LarkDocRuntime` 全局、不改 `dist/` 目录约定（`build-artifacts.md` 已写明「主 loader + 同目录 runtime」）。回滚 = 恢复 `export const runtimeReady = loadLarkDocRuntime()` 一行。
**唯一语义变化**：宿主若在 runtime 到达前直接读 `window.LarkDocRuntime`，拿到 `undefined`。正确用法是 `await LarkDoc.runtimeReady()` —— 这本来就是异步契约，只是以前恰好同步可用。**需要在 `performance.md` 与 `compatibility.md` 各记一条。**

### 7.4 L1 业务分组侧载：按「用户什么时候会用到」切 18 组

沿用 `src/features/element.js` 的 `groups` 表机制（运行时 `<script>` 拉 `lark-doc-element.umd.min.<group>.js`），把业务面按**首次真实使用时机**分组。用 `reach(entry, blocked)` 只切断「进入种子集合的静态边」实测（去重后，共享依赖不被重复计数）。「单文件剩余」= 614,339 减去累计增量：

| 顺序 | 组 | 种子 | 增量 gzip | 单文件剩余 | 落地手段 |
| ---: | --- | ---: | ---: | ---: | --- |
| — | 现状 | — | — | 614,339 | — |
| 1 | J 顶部工具栏 | 4 | +24,879 | 589,460 | 静态桩（3/4 无 data/computed） |
| 2 | A 评论 | 5 | +23,246 | 566,214 | **必须异步补挂**（`commentsMixin` 有 74 data + 8 computed） |
| 3 | H 块手柄 / 块菜单 | 3 | +13,041 | 553,173 | 静态桩 |
| 4 | K 表格工具 | 3 | +12,796 | 540,377 | 静态桩（`tableInteractionMixin` 有 data，走异步） |
| 5 | B 版本历史 | 3 | +11,297 | 529,080 | 静态桩 |
| 6 | P 日历 / ISV / 关联 | 4 | +10,440 | 518,640 | 静态桩 |
| 7 | L 浮层 / 弹窗 | 8 | +9,075 | 509,565 | 静态桩（8 个全无 data/computed） |
| 8 | G 斜杠菜单 | 3 | +8,971 | 500,594 | 静态桩 |
| 9 | I 浮动工具栏 | 4 | +8,100 | 492,494 | 静态桩 |
| 10 | C 分享 / 权限 | 2 | +8,016 | 484,478 | 判据留首屏 + 方法异步 |
| 11 | E 提醒 / 通知 | 3 | +7,375 | 477,103 | 异步（`reminderMixin` 16 data + 10 computed） |
| 12 | M AI | 2 | +6,813 | 470,290 | 异步 |
| 13 | F 封面 / 文档信息 | 3 | +2,964 | 467,326 | 异步（`coverMixin` 7 data） |
| 14 | D 导出 / 转换 | 7 | +2,053 | 465,273 | 异步闸（点击才走） |
| 15 | R 代码语言 | 1 | +1,835 | 463,438 | 静态桩 |
| 16 | Q 大纲 / 编号 | 1 | +1,227 | 462,211 | 静态桩 |
| 17 | N 模板库 | 1 | +991 | 461,220 | 异步闸 |
| 18 | O 搜索 | 3 | +625 | 460,595 | 静态桩 |
| | **合计** | **60** | **+153,744** | **460,595** | 从 613 KB 降到 **460 KB** |

单做 L1 就降到 460,595；L1.5 与 L1 都落地后到 264,138，正好压到 L1 档的 264 KB 线（7.8 的收紧阶梯按 L1.5 → L1 顺序算）。**收益前四位（J/A/H/K）占 73,962 = 总收益的 48%**，如果只做四组就有 48% 的效果。

**关键实现区分（这是上一版没做对的）**：

- **静态桩可零风险**：上一版探针统计了 54 个 mixin 的 `data` / `computed` / `methods` / `watch` 顶层键数，其中 **20 个是 `data = 0 && computed = 0` 纯 methods/watch**（`toolbarUi` / `overlaysUi` / `linkToolsUi` / `dialogsUi` / `commandMenuUi` / `calloutToolsUi` / `helpFabUi` / `extendedOverlaysUi` / `overlayDismiss` / `blockHandleUi` / `tableToolsUi` / `colorPaletteUi` / `searchPanelUi` / `isvPanelUi` / `calendarSearchUi` / `documentSearch` / `documentMenuView` / `docModes` / `mentionUi` / `panelsUi`）。
  这些可以直接替换成 `{ methods: { …空实现 } }` 的桩，侧载到达后 `Object.defineProperty` 覆盖即可 —— **不需要 `nativeOptionsHost` 支持后挂层**，也不碰 `data()` 在 host 创建时同步求值那条约束。上一版把全部 20 个都当成「必须等 Phase 0」，把工作量估大了。
- **只有 12 个必须异步补挂**（`comments` 74+8、`share` 27+18、`versioning` 27+14、`reminder` 16+10、`notify` 15+5、`export` 11+10、`cover` 7+4、`viewModes` 5+7、`readingMode` 0+9、`revision` 3+3、`calendar` / `isv` / `relationBitable` 少量）。**只对这 12 个走 Phase 0 的后挂通道。**

### 7.5 L1.5 外置动态边：再拿 217,596 —— 本方案最大的一块

上表把「已被某个业务面独占的代码」搬出去。但实测还暴露了一件更关键的事：

> **⚠ 本节结论已作废（2026-11-17）。** 下面这张「可达 / 未达」分布是拿 `bundle.cache.modules[].dependencies` 做 BFS 算出来的，而 `inlineDynamicImports: true` 时 cache **不含动态边**，动态入口的整棵子树会被记成「静态不可达」。关掉折叠重新出图后的事实是：单静态 chunk `3,963,848 B / 523 模块`，`prosemirror-*`、`@tiptap/*` 全在里面；42 条动态边只指向 `remoteConversion`、`stage`、`dialogs`、`tooltip`、`snapshot` 等小功能，合计约 120 KB。**继续往下读之前请先接受这一点：没有「把 prosemirror 外置」这条路。**

```
产物 556 模块 / 614,339 gzip
├── 可达（从 standalone.js 沿静态 + 动态边）    289 模块 / 396,743   ← 错：实际 523 模块
└── 未达（只经 import() 到达，被 inlineDynamicImports 内联在文件里）  295 模块 / 217,596  ← 错
```

**这 295 个模块里包含几乎全部 prosemirror**：`prosemirror-view` 37,496、`model` 18,725、`tables` 12,918、`transform` 12,914、`state` 5,405、`commands` 4,017、`history` 2,636 ……，还有 `nodeviews` 全量（`code-block` 5,781 / `image` 4,334 / `poll` 3,033 …）和 `blocks` 全量（36 个模块 30,243）。

**它们本来就不是首屏必需**——否则不会写成 `import()`。`inlineDynamicImports: true` 只是把「一次异步解析」压成了「同文件内的代码 + 一次微任务」，字节照付、解析照做，但**首屏并没有用到它们**。

把它们改成真正的 `<script>` 侧载，文件和收益都成立：

```js
// src/features/element.js —— 与现有 7 组同一张表，只加 engine 组
const groups = {
  engine: ['engine'],   // → lark-doc-element.umd.min.engine.js，含 prosemirror 全家 + nodeviews + blocks
  …已有 7 组
}
```

配套需要两件事，仓库都已有现成机制：
1. **新 UMD target**：`rollup.config.mjs` 的 `targets` 加 `feature:engine:umd`（与 `feature:ui:umd` / `feature:math:umd` 同构，`inlineDynamicImports: false` 才能真出 chunk）。
2. **命名空间适配**：`import()` 返回模块命名空间，`loadScript` 返回全局对象。`registerFeature(name, loader)` 的 loader 契约本来就是「返回模块命名空间」，`loadFeature('engine')` 拿到后即可 `Object.assign` —— 现有 `ui` / `document` 两组已经在这么做。

**收益**：单文件 614,339 → **396,743**（-35%），且此收益**与 L1 的 153,744 完全不重叠**（一个在可达集、一个在未达集）。

**代价（必须写清楚）**：首次进入编辑器时会多一次 ≈ 217 KB 的脚本请求，把「同步解析」换成「异步请求」。所以 **L1.5 必须与 L0 一起上**——L0 让用户看不到编辑器时不拉任何东西，L1.5 让看到时才拉「骨架 + 引擎两部分」。单独做 L1.5 会让首屏可编辑时间变差。这正是 ESM 侧 `inlineDynamicImports: false` 已经在享受的语义，Element 侧只是补齐。

### 7.6 L2 CSS 随组下沉：CSS 不需要单独机制

CSS 在 Element 产物里是**单一模块** `style.css`（265,008 renderedLength / 39,797 gzip），由 `style.css` 的 13 条 `@import` 静态聚合而成。它被 `src/web-component/index.js:32` 直接 import，所以**任何业务组切断都带不走它**。

但 `postcss` 的 `inject` 是**跟着 import 图走**的：把某条 `@import` 从全局 `style.css` 挪到组入口文件（如 `commentsMixin.js` 里 `import '../../styles/comments.css'`），CSS 就会跟着组进 `lark-doc-element.umd.min.comments.js`。**所以 CSS 拆分是 L1 的副作用，零额外机制。**

按「用到才有意义」排序（源体积 → 压缩后估算，比例 0.4346 = 265,008 / 609,819）：

| 文件 | 源字节 | 估 gzip | 处置 |
| --- | ---: | ---: | --- |
| `lark-doc.css` | 293,540 | 19,155 | **留首屏**（主编辑样式） |
| `deferred-ui.css` | 131,946 | 8,611 | 随 L 组（浮层/弹窗）下沉 —— 名字就叫 deferred |
| `comments.css` | 61,565 | 4,017 | 随 A 组 |
| `theme-dark.css` | 24,472 | 1,597 | 检测 `prefers-color-scheme: dark` 或 `data-theme` 时再注入 |
| `versioning.css` | 21,958 | 1,433 | 随 B 组 |
| `theme-preset-pcvue.css` | 14,623 | 954 | 仅在 `preset: 'pcvue'` 时注入 |
| `code-block.css` | 12,241 | 799 | 随已侧载的 `highlight` 组（现在漏在首屏） |
| `share.css` | 11,717 | 765 | 随 C 组 |
| `template-library.css` | 8,328 | 543 | 随 N 组 |
| `print.css` | 7,878 | 514 | `@media print`，随 `beforeprint` 注入 |
| `mobile-selection.css` | 4,033 | 263 | 仅在移动端 UA 注入 |
| `reading.css` | 3,734 | 244 | 随阅读模式 |
| `theme-preset-feishu.css` / 其余 | 13,784 | 900 | 留首屏（默认预设） |
| **可下沉合计** | **302,495** | **≈ 21,038** | 首屏 CSS 39,797 → **≈ 18,759** |

### 7.7 L3 垫片裁剪：core-js 21,139 gzip / 173 模块

`src/web-component/index.js` 显式 import 了 `core-js/features/{array/find-last, array/find-last-index, array/at, structured-clone, object/has-own, string/replace-all}`。这 6 个 feature 拖进 173 个模块 21 KB gzip（主要成本是 `web.structured-clone` 2,794 + `collection-strong` 1,163 + `dom-exception.constructor` 855）。

`object/has-own` 与 `string/replace-all` 在目标浏览器（Chrome 93+ / Safari 15.4+ / Firefox 92+）已原生，可去掉；`array/at` / `find-last` / `find-last-index` 视 `browserslist` 保留。**保守省 8–12 KB，全去 + 收紧 `browserslist` 省 21,139。**

注意 `structured-clone` 是 `documentSnapshot` / 协作路径的真实依赖，**不要为了体积把它删掉**——该 feature 只应在「目标浏览器已原生 `structuredClone`」时降级为空。

### 7.8 叠加收益与预算口径

四层互不重叠（L1.5 在未达集，L1 在可达集，L2 在 CSS 模块，L3 在垫片）：

```
现状                                614,339
  L1.5 外置动态边（engine 组）      -196,457  →  417,882   （-32%，一次改动，最大）
  L1   切 18 组业务面                -153,744  →  264,138   （-56% 累计）
  L3   裁 core-js（保守 10 KB）      -10,000   →  254,138
  L2   CSS 随组下沉                  -21,038   →  233,100   （-62% 累计）
  --------------------------------------------------
  单文件下限                         ≈ 233,100
  首屏残余构成：tiptap/core 76,913 + src/core 41,073 + src/ui 22,373
              + components 14,342 + CSS 18,759 + 骨架 48,234
```

**233 KB 是「不改内核」条件下的地板**。剩下的都是真首屏必需：`@tiptap/core` 静态部分、块渲染骨架、顶栏/工具栏、主编辑样式、Vue 2 host 与 mount。

**三层加起来才完整回答「应用加载时太大」**：

| 层 | 作用 | 应用加载路径 | 首次可见时 |
| --- | --- | ---: | ---: |
| 改造前 | — | **678 B + 613 KB** | — |
| L0 | runtime 移出加载路径 | **678 B + 1.5 KB** | 613 KB |
| L0 + L2a（core-js） | 垫片按特性检测拉 | 1,579 B | 596,892 |
| L0 + L2a + L2b（CSS） | 样式独立成文件并行解析 | 1,579 B | **555,370 + 40,601（并行）** |

**预算口径必须跟着改**。475 KB 现在是「单文件大小」，它既衡量不到 L0 的收益，也量不出 CSS 与垫片拆分的收益。已在 `package.json` 拆成三条：

| 指标 | 改造前 | 现在 | 当前卡法 |
| --- | ---: | ---: | --- |
| `element` 引导文件（应用加载路径） | 678 B | 1,579 B | `1.7 KB` 硬上限 |
| `element` runtime（首次可见时拉取） | 613,000 | 555,370 | `560 KB` 硬上限（620 → 600 → 560） |
| `element` polyfill 包（仅旧浏览器） | — | 17,224 | `18 KB` 硬上限 |
| `element` 样式表（与内核并行） | 内联在 JS 里 | 40,601 | 不单独卡（并入内核口径观察） |
| 组包总量（首次全功能交互后） | 1,817,000 | 1,817,000 | 不卡（本来就按需） |

逐档收紧而不是一步到位：一次收到目标值会让门禁在整个实施期内恒红，失去「有没有回退」的信号。

### 7.9 已落地实测（2026-11-17）

做了两件事，都验证过产物、单测与产物门禁：

| 项 | 做法 | 结果 |
| --- | --- | --- |
| L2a 卸 core-js | 6 个 ES2022/2023 API 拆成 `src/web-component/polyfills.js` → 独立 UMD；`loader.js` 用 `needsPolyfills()` 特性检测决定拉不拉，且**先补丁后内核** | runtime 模块 556 → 382，gzip 614,339 → 596,892；补丁包 17,224，现代浏览器 0 请求 |
| L2b 卸 CSS | `cssInjection` 不再接管 `elementRuntime`；target 改 `css: 'lark-doc-element.css'`，postcss `extract` 直接产出压缩样式表；loader 注入 `<link>` 且排在 `<script>` 之前 | JS 内 265 KB 字符串消失，gzip 596,892 → 555,370；样式 40,601 独立可缓存、与内核并行解析 |

两处踩坑记录：

1. `canReuseBuild` 用 `expectedFiles(name).every(file => graph[file]?.entry)` 校验图，而构建图只收 chunk；把 `lark-doc-element.css` 加进 `expectedFiles` 后这条恒假，构建报「产物或构建图验证失败」。已改为先 `.filter(file => /\.m?js$/)` 再校验。
2. 单测里拔 API 模拟旧浏览器必须登记原描述符并复原：vitest 自身依赖 `Object.hasOwn` 与 `Array.prototype.at`，漏复原会让 runner 在收尾阶段崩；圈定「任一项缺失即触发」的用例只能挑 `findLast` / `findLastIndex`。

### 7.10 落地顺序与风险

| 阶段 | 改动面 | 收益 | 风险 | 建议 |
| --- | --- | ---: | --- | --- |
| **L0** | `loader.js` 一个文件 | 613 KB 移出加载路径 | 低（`customElements` upgrade 是标准行为） | 已完成 |
| ~~L1.5~~ | — | — | 前提被实测推翻 | **不做** |
| **L2a** | `polyfills.js` + loader 门禁 + 一个 UMD target | -17,447 | 低（现代浏览器 0 请求，旧环境行为不变） | 已完成 |
| **L2b** | `cssInjection` 收口 + loader 注入 `<link>` | -41,522 | 低（样式表与内核同目录，加载顺序已用单测锁住） | 已完成 |
| **L1** | 18 组，按第 1–4 组先做 | -153,744（前四组 73,962） | 中低（20 组静态桩零风险，12 组需 Phase 0） | 分批 PR，按收益排序 |

**L0 单独上线就能解决用户感知的问题**；L1.5 + L1 + L2 + L3 是「首次可见时」的优化。两者不要捆在一个 PR 里，否则回滚粒度会丢。

---

## 八、验收与回滚

### 每档必跑

```bash
node scripts/check-rollup-artifacts.mjs --size     # 五条预算
npm run check:gate                                  # 行为回归
```

外加针对本档改动面的增量用例（按既定约定不跑全量）：

| 档 | 增量用例 |
| --- | --- |
| Phase 0 | `nativeOptionsHost` 单测；`created`/`watch`/`computed` 覆盖顺序用例 |
| A | 面板打开路径：大纲 / 搜索 / 版本 / 日历 / ISV / 提醒 / 封面 |
| B | 浮层关闭路径（Esc、点击外部）、链接悬停、斜杠菜单、块手柄、表格工具 |
| C | 评论：选中评论、图片评论、通知跳转、只读态 |
| **L0** | **① 文档无 `<lark-doc>` 时 runtime 零请求；② 元素在视口外不请求、滚入前 400px 请求；③ 动态插入元素能触发；④ `runtimeReady()` 在未触发时调用能立即拉取；⑤ 已存在元素在 define 后正确 upgrade、属性不丢** |
| L1 | 静态桩组：首次点击后方法可用的 18 条路径；异步组：双击/连点不重复加载 |
| L2 | 每份下沉 CSS 在对应面板打开后生效（`getComputedStyle` 断言 1 条关键属性） |
| L3 | 目标浏览器矩阵：Chrome 93 / Safari 15.4 / Firefox 92 的 6 个 API 原生行为 |

### 回滚

每档的种子集合写在 `nativeEditorHost.js` 的 **一个常量数组**里，不散落在各文件：

```js
const FIRST_SCREEN_MIXINS = [viewModesMixin, selectionPacingMixin, bubbleMenuMixin, …]
const DEFERRED_GROUPS = {
  panels: () => Promise.all([import('./…/panelsUiMixin'), …]),
  menus:  () => Promise.all([import('./…/commandMenuMixin'), …]),
  comments: () => Promise.all([import('./…/commentsMixin')]),
}
```

回滚 = 把某一组从 `DEFERRED_GROUPS` 挪回 `FIRST_SCREEN_MIXINS`，一行改动，不动 Phase 0。

Element 侧同理：18 组写成 `src/features/element.js` 的 `groups` 表新增条目（与现有 7 组同一张表），回滚 = 删条目。**L0 回滚 = 恢复 `loader.js` 的 `export const runtimeReady = loadLarkDocRuntime()` 一行。**

### 观测

拆分后必须能回答「用户第一次点分享等了多久」。加一条开发期埋点：`registerLayers` 完成时记 `performance.mark('layer:<name>')`，与已有的 `createLazyUi` 埋点对齐。生产环境默认关闭。

L0 额外加两条：`performance.mark('lark-doc:runtime-kick')`（观察器触发）与 `lark-doc:runtime-ready`（onload），两者之差就是「可见到可编辑」的延迟，这是 L0 唯一的风险面。

---

## 九、为什么不是「抬预算了事」

| 选项 | 代价 |
| --- | --- |
| 把 ESM 抬到 390 KB | 承认 74 KB 回退是永久性的，且下次再涨 30 KB 又要抬一次 |
| 本方案 B 档 | 一次改动拿回 96 KB，回到 0.14.5 的成本水位，且未来新增功能可以默认进惰性组 |
| 只做 A 档 | 拿到 32 KB 但仍超 41 KB，问题半解决 |

`src` 从 0.14.5 到现在涨了 145 KB，其中 B 档能拆回的 96 KB 是「结构性可拆」的部分。剩下的 ~49 KB 是首屏必需的编辑路径与零散增长（选区同步、输入规则、顶栏装配等），B 档拆不动，C 档也拆不动。**B 档做完，ESM 回到能与 0.14.5 直接对比的水位**，这是这次拆分的真实目标。

---

## 附录：探针口径与复现

- 数据源：`dist/lark-doc-graph.json`（787 KB，每 target 一张表，每项 `{entry, runtime, modules, imports, dynamicImports}`）。
- 模块级体积：`getRollupConfig(target)` → `rollup(config)` → `bundle.generate` → `chunk.modules[id].renderedLength`。
- **换算比率必须区分两组口径**，混用会系统性算错：
  | 用途 | 公式 | `esm` | `elementRuntime` |
  | --- | --- | ---: | ---: |
  | 整块搬运（「这份 UMD 整包不加载」） | `gzip(chunk) / raw(chunk)` | 0.156 | **0.2873** |
  | 模块级折算（「这 20 个模块消失后省多少」） | `gzip(chunk) / Σ renderedLength` | ≈ 0.13 | **0.1501** |
  Element 的 `ΣrenderedLength = 4,094,035` 是产物 `raw = 2,138,051` 的 **1.915 倍** —— `renderedLength` 记录的是 **terser 压缩前**长度。拿 0.2873 折算模块会高估压缩率低的模块（上一版把 CSS 算成 76 KB 就是这么错的，实测 39,797）。
- 依赖边取法：**`output` chunk 的 `modules[id]` 没有 `importedIds`**，必须从 `bundle.cache.modules[].dependencies` / `.dynamicDependencies` 取，再用同一套 `norm()` 归一化绝对路径。第一次跑出「可达 1 / 556」就是踩了这个坑。
- 切断口径：`reach(entry, blocked)` 只在 `blocked.has(next) && !blocked.has(id)` 时跳过入边——即**只切断进入种子模块的静态边**，种子之外的共享依赖仍由其它路径到达。把「完整静态闭包」当切断集会得到全 0 的错误结论。
- Element 的产物是 **1 个 chunk / 556 模块**，其中从 `standalone.js` 沿静态 + 动态边可达的只有 **289 模块 / 396,743 gzip**，另外 **295 模块 / 217,596 gzip** 只经 `import()` 到达（`inlineDynamicImports: true` 把它们内联在文件里）。这两半**都在同一个文件里**，所以「切走收益」要从 614,339 直接减，不能把二者相加或相减。
- 18 组的收益是「可达集内」的增量累计；L1.5 的收益是「未达集」整体外置。两者不相交，可叠加。
- 初始图遍历：`scripts/artifact-graph.js` 的 `artifactFiles(dist, target, includeDynamic)`，`scope: "editor"` 的预算剔除 `runtime: true` 的 chunk。
