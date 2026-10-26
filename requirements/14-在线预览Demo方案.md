# 14 · 在线预览 Demo 方案（GitHub Pages · 零侵入 · 改配置实时预览）

> **v3 修订（2026-10-24）**：按你新提的两条要求重写。
>
> | 你的要求 | 本版处置 |
> |---|---|
> | 代码里关于「云空间」的地方去掉 | 实测**仓库里 0 命中**（见 §0.1）；不删任何源文件，改为三条**可验证**的硬规则：产物不出现该词、示例代码不含云能力、运行时主动剥掉云相关入参 |
> | 上面预览 / 下面可折叠代码 / 代码可直接改 / 改完实时生效 | §5 整节重写为 **Playground 形态**，核心技术是「拦截式构造器 + 销毁重建 + 正文保全」（§5.4–§5.7） |
>
> v2 的结论仍然有效：**只新增文件、不改一个字**，复用现有 Actions → Pages 管线，2 分钟可完整回退。

---

## 0. 你的六条约束 → 六条铁律

| # | 你的约束 | 真实担心的东西 | 本方案的铁律 |
|---|---|---|---|
| 1 | 不可以影响这个包当前的开发项目文件 | `npm run check` / 发版 / size-limit 被搞坏 | **不修改任何现有文件**。`package.json`、`src/**`、`scripts/**`、`vue.config.js`、`test/**` 一行不动；只新增文件，且新增文件不在 lint / build / 发版范围内 |
| 2 | 不可以影响目前开发文档的对外预览 | 现在能正常打开的文档站被搞崩 | **不改文档站结构**：不碰 `docs/.vitepress/config.mts`、不改 workflow、不动现有 md 正文；上线前用本地构建 + 目录对比证明「除 `demo/` 外零变化」 |
| 3 | 我没有 CSDN | 不想为了看图去注册/搬运到第三方平台 | **零第三方平台**：不用 CSDN、Vercel、Netlify、Gitee Pages、也不用自建服务器 |
| 4 | 部署在 GitHub 就是希望免费 | 不想付钱、不想多养一个仓库 | **复用已有的 GitHub Actions → Pages 管线**，0 新增仓库、0 新增服务、0 元 |
| 5 | **代码里关于「云空间」的地方去掉** | 不想让 Demo 沾上「云文档 / 网盘 / 我的空间」那套产品语义 | **产物零命中 + 能力零开启 + 入参强制剥离**（三条硬规则见 §0.1） |
| 6 | **上预览、下可折叠代码、代码可改、实时生效** | 静态截图式 Demo 没用，接入者要能试 | **Playground**：代码区是真能编辑的源码，改完 ≤400ms 重建预览（§5） |
| — | （方案自身底线） | — | **2 分钟可完整回退**：删一个目录即可回到今天的状态 |

### 0.1 「云空间」这三个字：实测在仓库里 0 命中

| 检查范围 | 结果 |
|---|---|
| `src/**`（含 `.vue` / `.js`） | **0 命中** |
| `dist/**`（四个构建产物） | **0 命中** |
| `docs/**`、`examples/**`、`requirements/**`、`README.md` | **0 命中** |
| 唯一命中：`/Users/cjjxw/codex/飞书文档网页编辑器_需求文档.md` | **12 处**，行 42 与 11914–11924，全部是飞书功能清单里「云空间/运维」这一分类行（存储空间管理、离职数据转移、知识库批量操作…）—— **是竞品功能调研，不是代码** |

所以：**本仓库没有可删的「云空间」代码，不需要改任何源文件**（这也正好与约束 1 一致）。

但你这条要求真正指向的是「**别把 Demo 做成云文档那一套**」，所以我把它落成三条可验证的硬规则：

| 规则 | 落地方式 | 怎么验证 |
|---|---|---|
| **文案** | Demo 全部页面、示例代码、注释里不出现「云空间」，也不出现「我的空间 / 云端保存 / 文档列表 / 云盘」 | `grep -ri -e 云空间 -e 我的空间 -e 云端保存 -e 云盘 docs/public/demo` 必须 0 行 → 写进验收清单 |
| **能力** | 示例代码只传 `element / content / theme / readonly / config`，**不传** `persistence / uploader / ai / collab / session`；访问者若自己在代码里写了这几个键，页面**主动 `delete`** 后再实例化 | `assets/playground.js` 里集中 5 行 `delete options.xxx`，review 时一眼看完 |
| **默认** | `storage` 不传时，`LarkDoc` 内部会把 `features.persistence` 强制置 `false`（`src/LarkDoc.js:144-147`）→ Demo 不往访问者浏览器写草稿 | DevTools → Application → Local Storage 里不应出现 `tiptap-vue2:lark-doc:*` |

> 如果你指的是别的地方（比如某台机器上另一个页面的文案，或连需求文档那 12 行也要删），**给我路径我就照改** —— 这条我不猜。

---

## 1. 现状核实（13 条，本次新增 5 条并全部源码级验证）

| # | 事实 | 证据 | 对方案的影响 |
|---|---|---|---|
| 1 | 文档站已上线且由 Actions 部署 | `https://cuijianjun.github.io/LarkDoc/`；`deploy-docs.yml` 用 `upload-pages-artifact` + `deploy-pages` | 直接复用，不新建站点 |
| 2 | 触发条件只认 `docs/**` 和工作流文件本身 | `on.push.paths: ['docs/**', '.github/workflows/deploy-docs.yml']` | **只新增 `docs/` 下的文件就会自动部署，无需改 workflow** |
| 3 | 站点 base 是 `/LarkDoc/` | `docs/.vitepress/config.mts: base: '/LarkDoc/'` | Demo 地址就是 `.../LarkDoc/demo/` |
| 4 | `docs/public/` 被原样拷进产物根 | VitePress 约定；当前只有 1 个 `logo.svg` | 丢一个静态目录 = 立刻有 `/LarkDoc/demo/`，零配置 |
| 5 | lint 范围不含 docs | `package.json`: `"lint": "eslint --ext .js,.vue src scripts"` | Demo 的 JS 不会被 lint，不会让 `npm run check` 变红 |
| 6 | `docs/` 不进 npm 包 | `files: ["dist","src","style.css","README.md","DEMO_INTEGRATION_GUIDE.md","babel.config.js","vue.config.js"]` | Demo 与 vendor **不影响包体积** |
| 7 | element 产物完全自包含 | `publicPath=""`、无动态 chunk 引用、样式 `createElement("style")` 注入、`@font-face` 与 `url(` 均为 0 | **一个 `<script>` 就能跑**，不需要 CSS、不需要字体 |
| 8 | Vue2 UMD 依赖全局 Vue | `lark-doc.umd.min.js` 内 `e["Vue"]`；同样自带样式注入 | Vue2 页 = `vue.min.js` + `lark-doc.umd.min.js` |
| **9** | **`destroy()` 会移除根节点** | `mount/vueRenderer.js:56-67` → `el.parentNode.removeChild(el)` | **可以安全「销毁 → 重建」任意次，DOM 不叠加** —— Playground 的地基 |
| **10** | **`getJSON()` 的返回值能直接回传给 `content`** | `LarkDoc.getJSON()` → workspace → editor（Tiptap doc JSON）；`normalizeDocumentInput` 的 `input.type === 'doc'` 分支正好接住（`LarkDoc.js:59`）；`setContent` 走同一函数 | **「改配置不丢正文」成立**，这是 Playground 能用的前提 |
| **11** | **没有 `setConfig` / `updateConfig`** | 公开方法只有 `patchProps(props)` / `setReadonly(v)` / `getConfig()` | 改配置**只能重建**（`patchProps` 只对 WC 属性变化有意义，且改不了 extensions） |
| **12** | `theme` 是顶层选项，不是 config 字段 | `DEFAULTS.theme = 'light'`；`_applyHostAttributes()` 写 `data-theme` + `.lark-doc-dark` | 代码区把 `theme` 放在顶层，与 `readonly` 同级 |
| **13** | 默认 `storage: 'none'` 会强制关掉 persistence | `LarkDoc.js:144-147`：`if (this.options.storage !== 'local') raw.features.persistence = false` | Demo 天然不写 localStorage，与「去掉云空间语义」同向 |

---

## 2. 方案：一个纯静态目录，沿用现有管线

```
docs/public/demo/                    ← 唯一新增的目录
├── index.html                       Playground（上预览 / 下代码，Vue 2.7 命令式）
├── wc/index.html                    Web Component 静态示例（<lark-doc>）
├── vanilla/index.html               （阶段 B）裸 UMD 静态示例
├── assets/
│   ├── playground.js                ★ 核心：capture → 校验 → 重建 → 内容保全
│   ├── highlight.js                 自写 tokenizer（~70 行，不引依赖）
│   ├── sample.js                    示例正文（由本机编辑器 getJSON() 导出后固化）
│   ├── snippets.js                  3–5 个「常用改动」快捷插入
│   └── demo.css                     外壳样式（含分割条 / 折叠 / 错误条）
├── vendor/                          ← 由脚本同步，随 git 提交
│   ├── vue.min.js                   ~90KB   仅 Vue2 页
│   ├── lark-doc.umd.min.js          ~950KB  仅 Vue2 页
│   ├── lark-doc-element.umd.min.js  ~1.0MB 仅 WC 页
│   └── VERSION                      同步时的包版本号
└── (无 package.json、无 node_modules、无构建步骤)
```

上线地址：`https://cuijianjun.github.io/LarkDoc/demo/`。

### 2.1 为什么放 `docs/public/demo/`（四个候选位置对比）

| 位置 | 要改 CI | 会进 npm 包 | 会进 md 编译/侧边栏 | 回退成本 | 结论 |
|---|---|---|---|---|---|
| **`docs/public/demo/`** | **不用改** | 不会 | 不会（public 是资源区） | `git rm -r` 一个目录 | ✅ **选它** |
| 仓库根 `demo/` | 要改 workflow 加拷贝步 | 不会 | 不会 | 删目录 | ❌ 违反约束 1/2 |
| 独立仓库 + 独立 Pages | 不涉及本仓库 | 不会 | 不会 | 删仓库 | ❌ 与你「放在 lark-doc 文件夹里」相悖 |
| `gh-pages` 分支 | 要把 Pages 改成「分支部署」 | 不会 | 不会 | 改回 Actions 部署 | ❌ 两个来源争同一站点根，风险最大 |

### 2.2 为什么这不算「动文档站」

`docs/public/` 是 VitePress 的**静态资源区**，和「文档页面」是两套东西：不进 markdown 编译（不会因语法/死链让 `docs:build` 失败）、不进 `hashmap.json`（搜索索引一字节不变）、不进 sidebar/nav。**站点原有每一个 URL 的内容都不变，只是多了一个新 URL。**

---

## 3. 隔离边界

### 3.1 只新增（全部是新建文件，无一处修改）

| 路径 | 内容 | 大小 |
|---|---|---|
| `docs/public/demo/index.html` + `wc/` + `vanilla/` | 三个页面 | ~25KB |
| `docs/public/demo/assets/**` | `playground.js` / `highlight.js` / `sample.js` / `snippets.js` / `demo.css` | ~90KB（sample 占大头） |
| `docs/public/demo/vendor/**` | 三个产物 + VERSION | ~2.1MB |
| `scripts/demo-sync-vendor.mjs` | 同步脚本（新增文件，**不改 `package.json` 的 scripts**） | ~2KB |

### 3.2 绝不修改（逐条点名，便于你 review diff）

| 文件 | 为什么不能碰 |
|---|---|
| `package.json` | `files` / `scripts` / `size-limit` 任一变动都影响发版与体积门禁 |
| `src/**` | 包源码（含 `LarkDoc.js` —— Playground 只用现成 API，不为它加钩子） |
| `scripts/**`（新增脚本除外） | `check:*` 校验链 |
| `vue.config.js` / `babel.config.js` | 构建产物形态 |
| `test/**` | 单测与浏览器断言（165 条） |
| `.github/workflows/*.yml` | 部署链路 |
| `docs/.vitepress/config.mts` | 站点 base / nav / sidebar / 搜索 |
| `docs/**/*.md`（阶段 B 的 3 处链接除外） | 现有文档正文 |

### 3.3 唯一的例外：3 处链接（每条独立 commit）

| 文件 | 改法 | 风险 |
|---|---|---|
| `README.md` | 「完整文档」旁加一行 `在线预览：<绝对 URL>` | 零 |
| `docs/index.md` | `hero.actions` 末尾加第 4 个按钮「在线预览」 | 低（frontmatter 加一项） |
| `docs/guide/getting-started.md` | 概述段后加一行「先看效果 → <绝对 URL>」 | 零 |

**刻意不动 `config.mts` 的 nav**：导航属于站点结构，改错影响全站每一页。

---

## 4. 依赖来源：同源 vendor 优先，CDN 只做开关

| 来源 | 中国大陆可达性 | 永远最新 | 需提交文件 | 结论 |
|---|---|---|---|---|
| **同源 `vendor/`（GitHub Pages）** | 你的文档站已验证可访问 → 同一链路 | 否 | 是（~2.1MB） | ✅ **主源** |
| jsdelivr | 不稳定（历史多次被墙/降速） | ✅ | 否 | 🟡 只作 `?cdn=1` 手动切换 |
| unpkg | 慢 | ✅ | 否 | ❌ 不用 |

### 4.1 版本同步（零 CI 改动）

```bash
node scripts/demo-sync-vendor.mjs          # 从本地 dist/ 同步到 docs/public/demo/vendor/
node scripts/demo-sync-vendor.mjs --check  # 只检查，版本不一致退出码 1
```

步骤：读 `package.json` 的 `version` → 拷两个 UMD → 从 `node_modules/vue/dist/vue.min.js` 取 vue（缺则提示手放）→ 写 `vendor/VERSION`。**不挂 `prebuild`、不挂 CI**（改 `package.json` 或 workflow 都违反约束 1/2），发版后手动跑一次随发版 commit 提交。页面右上角显示 `v0.11.5`。

---

## 5. 页面设计：`/demo/` 是一个 Playground

### 5.1 三页分工（只有第一页是 Playground）

| 页 | 形态 | 依赖 | 面向谁 |
|---|---|---|---|
| `/demo/` | **Playground**：上预览 / 下可编辑代码 | `vue.min.js` + `lark-doc.umd.min.js` | 主流宿主（Vue 2）；唯一能传对象型能力的路径 |
| `/demo/wc/` | 静态示例：预览 + 只读代码 + 复制 | 仅 `lark-doc-element.umd.min.js`（自带 Vue 与样式） | Vue 3 / React / 无框架 |
| `/demo/vanilla/` | 静态示例：`window.LarkDoc` 直调 | 同第一页 | 验证「什么框架都不装也能用」 |

**只给 `/demo/` 做可编辑 Playground**，另两页保持只读代码。理由与「不保留两份 Web Component 示例」是同一条：**同一段可编辑源码维护三份必然分叉**，而 Playground 的价值 90% 在 Vue2 页（对象型能力、`theme`、`readonly` 都在这条路上）。

### 5.2 `/demo/` 布局

```
┌───────────────────────────────────────────────────────────────────┐
│ lark-doc 在线预览  [Vue 2][Web Component]                v0.11.5  │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│   预览区（上，默认 58% 高，可拖拽 / 双击分隔条复位）                │
│   #lark-doc-preview  · 直接可编辑 · 工具栏全开                      │
│   ┌─ 重建中 ──────────────────────────────────────────────┐        │
│   │ 顶部 2px 进度条（不遮内容）                            │        │
│   └───────────────────────────────────────────────────────┘        │
│                                                                   │
├═══════════════ 拖拽分隔条（8px，双击复位 58/42）═══════════════════┤
│ ▾ 初始化配置            ● 已应用   [只看正文] [重置示例] [复制]     │
│ ┌───────────────────────────────────────────────────────────────┐ │
│ │  1  // 改这段配置，预览立刻重建；正文内容会保留                 │ │
│ │  2  new LarkDoc({                                             │ │
│ │  3    element: '#lark-doc-preview',                           │ │
│ │  4    content: sample,          // 内置示例，不用改            │ │
│ │  5    theme: 'light',           // 'light' | 'dark'            │ │
│ │  6    readonly: false,                                        │ │
│ │  7    config: {                                               │ │
│ │  8      features: { ai: false, diagram: true },               │ │
│ │  9      layout: { headerVisible: true },                      │ │
│ │ 10      limits: { maxLength: 0 },                             │ │
│ │ 11      text: { placeholder: '输入正文，或输入 / 插入内容' },   │ │
│ │ 12    },                                                      │ │
│ │ 13  })                                                        │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ ✗ 第 9 行：Unexpected token }   ← 只在语法错时出现（预览保持上一个好状态）│
└───────────────────────────────────────────────────────────────────┘
```

设计取舍：

- **代码区默认展开**（你要的是「可折叠」，不是「默认收起」）—— 接入者第一眼就该看到代码；点标题栏箭头或 `⌘/Ctrl + J` 收起，收起状态记 `localStorage`。
- **代码区是唯一真源**。不做「左侧表单 + 右侧代码」双栏：两套状态必然打架（表单改了代码里的注释怎么办？），而且你要的就是「**代码里直接改**」。
- **示例正文手写一次、由编辑器导出**：`sample.js` 的值不是手敲的 JSON，而是本机把覆盖全部块类型的文档编辑好后 `getJSON()` 导出、格式化成 `sample.js`。**手写 Tiptap JSON 必然出错**（尤其是分栏、折叠、公式的 attrs）。
- **窄屏（< 880px）改成 tab**：`预览` / `代码` 二选一。上下分割在手机上两边都不够高。
- **不做**：文件树、多文档切换、路由、侧边栏 —— 那是「云文档产品」，正是你要去掉的东西。

### 5.3 代码区默认内容（13 行，故意短）

只暴露 4 组配置（`features` / `layout` / `limits` / `text`）+ 2 个顶层项（`theme` / `readonly`）。**不做 40 项全量表单** —— 配置项太多反而淹没重点，真要看全量请看文档里的配置表。

顶部 3 个 chip 是「快捷插入」：点 `只看正文` → 把 `readonly: false` 改成 `readonly: true`（幂等替换，不追加）；点 `深色` → 切 `theme`。它们**只改代码文本，不另有状态**。

### 5.4 核心机制：「改代码 → 实时生效」怎么实现

**不用字符串解析，也不用整段 `eval`**。做法是**注入一个假的构造函数**，让用户的代码原样执行一次，只把入参截下来：

```js
// assets/playground.js
const SAMPLE = window.__LARK_DOC_SAMPLE__   // 来自 sample.js

function captureOptions(code) {
  let captured = null
  // 假构造器：new 与不带 new 都能接住；返回值给个空壳防用户代码继续 chain
  const Fake = function (options) { captured = options || {}; return { destroy() {} } }
  Fake.prototype.destroy = function () {}

  // 只注入 3 个名字。用户代码里引用别的全局会抛 ReferenceError —— 这是我们想要的反馈
  const fn = new Function('LarkDoc', 'sample', code)
  fn(Fake, SAMPLE)

  if (!captured) throw new Error('没有找到 new LarkDoc({ ... })')
  return captured
}
```

为什么这么做：

| 备选 | 为什么不行 |
|---|---|
| 正则/字符串截取 `config: { ... }` | 用户一写注释、嵌套、尾逗号就崩；报错位置也没法给 |
| `JSON.parse` 只允许 JSON | 代码里就不能有注释、单引号、表达式 —— 那就不叫「代码」了 |
| `eval` 整段 + 真实例化 | 会真的建一个实例，白跑一次挂载；还得自己回收 |
| **假构造器捕获** | 用户代码 **100% 原样执行**，语法错由 JS 引擎给真实行号；我们只拿走 options，一次实例化都不浪费 |

**安全性**：`new Function` 只在这一个静态页里跑。访问者执行的是他自己刚敲的代码，跑在他自己的浏览器里 —— 这不是漏洞，这**就是功能**。所以不做 iframe 沙箱（同一页面要操作同一个 DOM，沙箱反而更麻烦），但在页面底部注明「这段代码只在本页执行，不会上传」。

**截下 options 之后，强制覆盖三项**（这是约束 5 的运行时兜底）：

```js
function sanitize(options) {
  options.element = previewEl          // 忽略代码里写的选择器，永远挂到预览区
  options.content = preserve || SAMPLE // 正文由页面管理，不由代码管理
  // 云能力一律剥掉：即使访问者自己加了，也不会生效
  delete options.persistence
  delete options.uploader
  delete options.ai
  delete options.collab
  delete options.session
  return options
}
```

### 5.5 生效判定：没变就不重建

```js
const key = JSON.stringify({ theme: o.theme, readonly: o.readonly, config: o.config })
if (key === lastKey) return   // 只改了注释 / 只改了空白 → 不重建
lastKey = key
rebuild()
```

**为什么必须短路**：防抖 400ms 后仍可能触发同一份配置（多敲了一个空格又删掉）。不短路的话每次都是 100–400ms 的编辑器重建，手感会碎。

### 5.6 重建流程：正文不能丢

```js
function rebuild(options) {
  const scrollTop = previewEl.scrollTop

  if (current) {
    preserve = current.getJSON()   // ← 必须在 destroy 之前取，之后就拿不到了
    current.destroy()              // 会 removeChild 根节点（§1 #9 已核实）
  }

  current = new window.LarkDoc({ ...options, content: preserve || SAMPLE })
  current.on('change', (payload) => { preserve = payload.json || current.getJSON() })

  requestAnimationFrame(() => { previewEl.scrollTop = scrollTop })
}
```

四件事都靠 §1 的三条核实支撑：

| 动作 | 依赖的事实 |
|---|---|
| 取正文再销毁 | #10 `getJSON()` 返回 doc JSON，且 `content` 能吃 doc JSON |
| 销毁不残留 | #9 `destroy()` 移除根节点 |
| 每次都要重新 new | #11 没有 `setConfig` |
| 滚动位置能恢复 | 预览区是 `overflow-y:auto` 的独立容器，`scrollTop` 可读可写 |

**「重置示例」**：`preserve = null` → 用 `SAMPLE` 重建。按钮上明写「会丢弃你刚才的编辑」，不弹二次确认（这是个 Demo，弹窗更烦）。

### 5.7 代码区的五条交互细节

| 细节 | 做法 | 为什么 |
|---|---|---|
| **防抖** | `input` 后 400ms 才编译；`⌘/Ctrl + Enter` 立即执行 | 打字过程中不重建 |
| **语法错不清空预览** | `try/catch` → 代码框底部红条显示 `第 N 行：<message>`，预览保持上一次成功的状态 | 「我一改就白屏」是最伤的体验 |
| **重建中不闪白** | 预览区保持 `min-height`，顶部 2px 进度条；重建 <300ms 时人眼几乎无感 | 避免每次改配置都闪一下 |
| **Tab 插入两空格** | `keydown` 拦 `Tab`（`preventDefault` + 手动插入） | 否则焦点跳走，没法写缩进 |
| **不高亮不换行** | `textarea` + 背后 `<pre>` 叠层（同字体/行高/内边距、`white-space: pre-wrap`、滚动同步），tokenizer 70 行正则覆盖 注释/字符串/数字/关键字/布尔 | 引 highlight.js 要多 30KB 且要处理 CDN 失败 |

### 5.8 折叠与分割

| 行为 | 规格 |
|---|---|
| 默认状态 | 展开（代码区 42%），折叠后预览区 100% |
| 折叠入口 | 标题栏箭头 ▾/▸、`aria-expanded`、`⌘/Ctrl + J` |
| 高度调整 | 拖拽 8px 分隔条，范围 20%–80%；双击复位 58/42 |
| 记忆 | `localStorage['lark-demo-code-height']`、`['lark-demo-code-collapsed']`（**只存这两个键**，不碰文档数据） |
| 窄屏 | < 880px 改 tab，折叠逻辑自动失效 |

---

## 6. 上线步骤（6 步，每步可验）

| 步 | 动作 | 验收 |
|---|---|---|
| 1 | `mkdir -p docs/public/demo/{assets,wc,vendor}` + 跑 `node scripts/demo-sync-vendor.mjs` | `vendor/` 三文件 + VERSION 就位 |
| 2 | 造 `sample.js`：本机编辑器写好覆盖全部块类型的文档 → `getJSON()` → 格式化成模块 | 预览区无一处报错、分栏/折叠/公式/mermaid 都在 |
| 3 | 写 `index.html` + `assets/playground.js` + `highlight.js` + `demo.css` | 本地 `python3 -m http.server` 下：改代码 400ms 内预览变、正文不丢、语法错有行号 |
| 4 | **本地构建对比** | `diff -r` 除 `demo/` 外必须为空（见 §6.1） |
| 5 | 补 `wc/` + `vanilla/` + 3 处链接（独立 commit） | 两页 200、链接可跳 |
| 6 | `git add docs/public/demo scripts/demo-sync-vendor.mjs` → commit → push `master` | Actions 自动跑，打开线上 URL 复验一遍 |

### 6.1 证明「没影响文档站」

```bash
cd docs
cp -r .vitepress/dist /tmp/dist-before     # 现有产物直接当基线
npm run docs:build
diff -r /tmp/dist-before .vitepress/dist | grep -v '^Only in .*: demo$'
# 期望：除 demo/ 目录外，0 差异
```

### 6.2 回退

```bash
git rm -r docs/public/demo && git commit -m "revert: remove online demo" && git push
```

约 2 分钟站点回到今天，**文档正文一行未变**。

---

## 7. 工期与验收

| 阶段 | 内容 | 工期 |
|---|---|---|
| **A** | `/demo/` Playground（布局 + 代码区 + 拦截重建 + 高亮 + 折叠拖拽）+ sample 导出 + vendor 脚本 + 3 处链接 | **2 天** |
| B | `/demo/wc/` + `/demo/vanilla/` + 窄屏 tab | 0.5–1 天 |
| C | 字体补齐（`fonts.css` + `dist/fonts` 540KB，只为公式观感）+ 样式打磨 | 0.5 天 |

比 v2 多 1 天，全部花在 Playground 那套「捕获 → 校验 → 重建 → 保全」上 —— 这是你这轮要求的核心，不是可选项。

### 验收清单

**功能**

- [ ] 线上 `/demo/` 200，页内可输入、折叠、插表格、切标题
- [ ] 改一行代码（如 `theme: 'dark'`）→ 400ms 内预览变化，**正文内容仍在**
- [ ] 把 `config.features.ai` 改 `true` → 工具栏 AI 入口出现（验证「配置真的生效」而不是只改了个变量）
- [ ] 故意写错语法 → 出现 `第 N 行` 错误条，**预览不白屏**
- [ ] 点「重置示例」→ 回到内置正文
- [ ] 折叠代码区 → 预览占满；刷新页面记忆保持
- [ ] 窄屏 880px 以下切到 tab
- [ ] `/demo/wc/` 200，`<lark-doc>` 正常渲染

**隔离与合规**

- [ ] `diff -r` 证明文档站除 `demo/` 外零变化
- [ ] `npm run lint` 输出里不出现 demo 文件
- [ ] `npm pack --dry-run` 文件列表里没有 `docs/`
- [ ] `grep -ri -e 云空间 -e 我的空间 -e 云端保存 -e 云盘 docs/public/demo` → **0 行**
- [ ] 示例代码里不出现 `persistence / uploader / ai / collab / session` 这些入参
- [ ] DevTools → Local Storage 无 `tiptap-vue2:lark-doc:*`（demo 不写文档数据）
- [ ] 控制台无 404（vendor 路径全部命中）

**稳定性**

- [ ] 连续改配置 20 次后，`document.querySelectorAll('*').length` 与初始相差 < 5%（重建不泄漏 DOM）
- [ ] 连续改配置 20 次后无 console error、无重复事件日志（`ready` 每次只出现一条）
- [ ] 回退演练过一次（删目录 → 部署 → 站点正常）

---

## 8. 明确不做

- ❌ 不建第二个仓库、不建 `gh-pages` 分支、不改任何 workflow
- ❌ 不加 devDependency，不引 vite / webpack 构建，不做 `npm i`
- ❌ 不用 CSDN / Vercel / Netlify / Gitee / 自建服务器 / 自定义域名
- ❌ **不做「云文档」式 UI**：没有文档列表、我的空间、云端保存、协同入口（约束 5）
- ❌ Demo 里不接协同（Pages 纯静态，没有 WebSocket 端点）
- ❌ **不做 40 项全量配置表单**（只暴露 4 组 + 2 个顶层项，其余看文档配置表）
- ❌ **不为 Playground 往 `src/**` 加钩子**：只用现成公开 API（`destroy` / `getJSON` / `on`）
- ❌ 不让代码框持久化（刷新回到默认代码，避免「改坏了刷新也回不来」）；只记折叠高度
- ❌ 不把 `examples/element-demo.html`（引用 `../dist/...`）当对外入口 —— `dist/` 是 gitignore 的，对外必然 404

---

## 9. 与 09 开发方案的关系

| 项 | 说明 |
|---|---|
| 归属 | **独立小任务**，不属 0.12 范围，不占 80–101 天工期 |
| 冲突面 | 只碰 `docs/public/`（新目录），与 `src/**` 重构完全不相交，可与 P0 并行 |
| 前置依赖 | 只需要 `dist/` 里有可用 UMD 产物（现在就有，0.11.5） |
| 注意 | 0.12 期间 `dist` 接口若有变（如 `beta.8`），Demo 仍是 0.11.5 的用法 —— 这正是「演示已发布版」的语义；等 `v0.12.0` 发了再同步 vendor |
| 顺带收益 | Playground 是**最省成本的配置项验证台**：以后怀疑某个 `features` 开关没生效，在这里改一行就能证伪，不用起一个宿主工程 |

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 重建丢正文 | 用户改个配置内容全没了 | `destroy` 前先 `getJSON()`（§5.6）；验收清单里有「改配置后正文仍在」；「重置示例」是唯一会清空的入口且已标注 |
| 重建频繁导致卡顿/内存涨 | 手感碎、标签页越用越重 | 400ms 防抖 + 同配置短路（§5.5）；验收含「连续 20 次后 DOM 节点数 < +5%」 |
| 访问者在代码里塞云能力 | 与约束 5 冲突 | `sanitize()` 里 `delete options.persistence/uploader/ai/collab/session`（§5.4） |
| `new Function` 被质疑 | 安全 review 不通过 | 只在本静态页执行访问者自己的代码，不上传、不落盘；页面底部注明；不用 iframe 是因为要操作同一 DOM |
| sample 手写 JSON 出错 | 预览区一开始就报错 | sample 由本机编辑器 `getJSON()` 导出后固化，不手敲 |
| vendor 忘记同步 | 展示旧版，不会坏 | 页面右上显示版本号；`--check` 发版后手动跑 |
| 站点体积 +2.2MB | demo 页首次稍慢（gzip 后约 300KB） | 只影响 demo 页；文档页不引用 vendor |
| 中国访问 `github.io` 偶发慢 | 加载慢 | 与现有文档站同源，你已验证可用；无更优免费方案 |
| 阶段 B 改 md 导致构建失败 | 文档站发版失败 | 改前本地 `docs:build`；3 条独立 commit 可单条 revert |
