# 更新日志

本文件按 `MASTER_PLAN.md` 的阶段推进记录**对外契约**变化。语义化版本：宿主接入写法变了才动 minor/major。

## 未发布（0.13.0 开发线）

### 阶段 1-A · 包契约收敛

**对外变化**

| 项 | 变化 | 是否 BREAKING |
|---|---|---|
| `browser` 字段 | **删除** | 否（0.12 及以前指向 UMD，是 bug 不是特性；删掉后 webpack4/5 与 vite 才不会被拖进 UMD 档。webpack4 宿主改用**一行 alias** 到 CJS 档，见阶段 1-C） |
| `unpkg` / `jsdelivr` | 由 `dist/lark-doc.umd.min.js` 改指 **`dist/lark-doc-element.umd.min.js`** | 否（CDN 直挂本来就该挂元素档：自带内联 Vue、`<lark-doc>` 开箱可用） |
| `sideEffects` | 由 `["**/*.css","**/*.scss","dist/*"]` 收窄为 **CSS/SCSS + UMD/CJS 档** | **是**（见下） |
| `exports` | 新增 `./lite`、`./features/*`、`./plugin`；保留 `./dist/*` 逃生口 | 否（新增；三个子入口的产物分别在阶段 7 / 4 / 6 落地） |

**BREAKING 说明（唯一一条）**

`sideEffects` 不再含 `dist/*` —— 打包器现在认为 **`dist/lark-doc.esm.js` 是纯模块**。
如果你的代码里有「`import { X } from 'lark-doc'` 但一个导出都不用」这种写法，`X` 之外的整个包会被**整体丢弃**（这正是目的）。

需要保留副作用的入口请显式写副作用导入，它们不受影响：

```js
import 'lark-doc/element'          // 自定义元素自注册 —— 保留
import 'lark-doc/style.css'        // 样式 —— 保留
```

**样式本来就要求显式引入**（所有产物都是 CSS 抽取产物，JS 不带注入逻辑），所以这一条对按文档接入的宿主零影响。

**实测（`npm run check:pkg` 之外的人工验证，webpack 5 / Vite 8 双端）**

| 入口写法 | webpack 5 | Vite 8（rollup） |
|---|---|---|
| `import { LarkDoc } from 'lark-doc'`（不使用） | `151 B`（收窄前 `1,922,452 B`） | `0.05 kB` |
| `import 'lark-doc/element'`（纯副作用） | `1,695,666 B` 保留 | 保留 |
| `import { TOOLBAR_KEYS } from 'lark-doc'` | `1,922,429 B` | — |

字体（KaTeX 28 个 woff/woff2）在两端都被自动 emit，无需任何 `public/` 手工拷贝。

**新增校验**

- `npm run check:pkg`（已挂进 `check:deploy`）：校验 `exports` / `main` / `module` / `unpkg` / `files` / `sideEffects` 的每个落点真实存在，并禁止 `browser` 字段复活、`sideEffects` 回到 `dist/*` 一网打尽写法。

### 阶段 1-B · 钉死闸门（与 1-A 同批）

**纯内部加固，对外无变化**：`scripts/check-architecture.js` 追加 R1 / R2 / R3 三条闸门，防止架构在后续阶段悄悄回退。

| 闸门 | 守什么 |
|---|---|
| R1 | `src/core/**` 零框架引用 —— 禁 `vue` / `@tiptap/vue-*` / `@vue/*` / `.vue`（当前 117 个文件全过） |
| R2 | `.vue` 清单**只减不增**（基线固化在 `scripts/architecture-baseline.json`） |
| R3 | 挂载器契约恰好五个动作：`mount` / `update` / `destroy` / `getInstance` / `getRoot`，不多不少 |

顺手修正：`src/mount/vueRenderer.js` 头部注释写「四个动作」，实际导出五个（`getRoot` 是第五个）。

### 阶段 1-C · webpack 4 只留一行 alias

删掉 `browser` 字段的副作用是：webpack4 顺着 `resolve.mainFields`（默认 `['browser','module','main']`）会落到
`module` → `esm.js`，而 esm 档里有 `new URL('./fonts/x.woff2', import.meta.url)`，acorn 6.4.2 解析不了 →
`Module parse failed`。

解决办法不是把 `browser` 加回来（那等于把这份 SD 的老毛病恢复），而是**把 webpack4 唯一还会吃的那一档
——CJS——也降到 ES2018**，然后让宿主用一行 alias 明确指过去：

```js
// vue.config.js —— 唯一的编译工具配置
resolve: { alias: { 'lark-doc$': 'lark-doc/dist/lark-doc.common.js' } }
```

**内部改动**

| 项 | 变化 |
|---|---|
| `npm run build` | 加 `LARK_DOC_LEGACY=1`：CJS 档与 UMD / element 同享 `legacy-syntax.js` 的语法降级（可选链 / 空值合并 / 逻辑赋值 / 数字分隔符 / 省略绑定 catch / class 字段） |
| 产物 | `dist/lark-doc.common.js` 现在是 ES2018（此前含 454 处 `?.` / 300 处 `??`，webpack4 直接拒编译） |
| `npm run check:legacy` | **新增闸门**（已挂进 `check:artifacts`）：用 acorn 以 `ecmaVersion 2018` 真实解析 `common.js` / `umd.min.js` / `element.umd.min.js`，任一份降级失效立刻 EXIT=1 |
| size-limit | ESM 285 → **290 kB**、CJS 2500 → **2600 KB**：阶段 2 把代码块 NodeView 下沉进 core 后主包真实增重 2.4 kB，降级又给 CJS 加了 ~1%。两档都会在阶段 3（CJS 拆块）/ 阶段 4（`features/*` 子路径）回落 |

顺带的收益：webpack4 走 CJS 档后拿到的是**单文件、区块全内联**的形态，所以不再出现「首屏正常、一插公式就 404」，
`window.__LARK_DOC_PUBLIC_PATH__` 对它也不再需要（只有继续用 UMD / element 旁挂懒区块档时才设）。

代价：宿主必须显式引样式（`import 'lark-doc/dist/lark-doc.css'`）——CJS 档是 CSS 抽取产物，不像 UMD 那样随 JS 注入。
这条本来就是硬要求，见 README「样式」一行。

