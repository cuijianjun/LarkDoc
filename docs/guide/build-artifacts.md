# 打包产物与按需加载

库包统一使用 Rollup。默认、full、lite、Element 和 Vue2 options 兼容入口均不导入、内联或 external Vue，不依赖 Webpack runtime；宿主应用继续使用自身的 Vue CLI、Webpack、Vite 或其他工具链。

## 入口与样式

| 公开入口 | 产物 / 用途 | 样式 |
| --- | --- | --- |
| `lark-doc` | `module` / 浏览器 import 为 `dist/lark-doc.esm.js`；`main` / require 为 `dist/lark-doc.common.js` | 显式引 `lark-doc/style.css` |
| `lark-doc/full` | `dist/lark-doc-full.{esm,common}.js`；保留默认 API 并静态注册全部五个本地 feature，补充模板、评论、版本、Provider 和迁移导出 | 显式引 `lark-doc/style.css` |
| `lark-doc/lite` | `dist/lark-doc-lite.esm.js`；整个依赖图排除 KaTeX、Mermaid、Office、Markdown 和高亮实现 | 显式引 `lark-doc/style.css` |
| `lark-doc/features/*` | `dist/features/*.js`；按需注册 math / mermaid / office / markdown / highlight | math ESM 另引 dist/features/math.css；UMD math 注入样式，保留字体 |
| `lark-doc/element` 的 import | `dist/lark-doc-element.esm.js`；自定义元素与原生动态 import，供打包器消费 | 随 JS 注入 |
| `lark-doc/element` 的 require / CDN | `dist/lark-doc-element.umd.min.js` 主 loader + 同目录 `lark-doc-element.runtime.umd.min.js`；浏览器直挂，功能实现从同目录 feature UMD 加载 | 随 runtime 注入 |
| `lark-doc/vue2` / `lark-doc/legacy` | `dist/lark-doc-vue2.{esm,common}.js`；普通 options 对象，渲染仍为原生 DOM | 显式引随包的 `dist/lark-doc.css` |
| `lark-doc/vue3` / `lark-doc/react` | `dist/lark-doc-{vue3,react}.mjs`；属性、property、事件和方法桥接，需先注册 Element | 不含编辑器样式 |
| `lark-doc/collab` | `dist/lark-doc-collab.esm.js` / `dist/lark-doc-collab.common.js`；协同依赖保持 external，由宿主提供单例 | 无 |

显式协同入口面向支持 package exports 的现代 bundler 与 Node22；webpack4 的验证范围是普通主入口，不包含外部协同栈。
| `lark-doc/plugin` | `dist/plugin.{mjs,cjs}`；宿主资源构建辅助 | 无 |

full 会立即初始化包括 Mermaid 在内的浏览器特性；在 SSR 中将 full / Element 的导入放到客户端生命周期。Node14 构建及 DOM 测试不代表支持无 DOM 渲染。

默认入口的推荐写法始终是 `import { LarkDoc } from 'lark-doc'` 与 `new LarkDoc(options)`。Vue2 options 对象从 `lark-doc/vue2` 引入；full 不包含协同，仍须显式导入 `lark-doc/collab`。

## 模块、语法与部署

- ESM 压缩保留类名，避免 webpack4 将具名类表达式的内部构造器误判为同名 import；兼容验收包含实际创建编辑器与渲染图表，不能仅以编译无错通过。
- webpack4 按 `module` 选择主 ESM；该入口及其可达 chunk 已纳入语法降级，不再要求 `lark-doc$` 指向 CJS 的宿主 alias。本轮同包真实 webpack4.47 / Node14 消费编译通过，实际选择 module 根入口，未加 alias 或额外 Babel。
- webpack4 不读取 `exports`，**深子路径**仍写实际文件，例如 `lark-doc/dist/lark-doc.css`、`lark-doc/dist/lark-doc-vue2.common.js`。新 Element ESM 使用 import.meta.url 定位字体，面向现代 Vite/webpack5，不在 webpack4 根 ESM 的兼容保证内；旧宿主标签方案可独立 script 引 UMD。
- 默认 / full / lite / Element ESM 保留原生动态 import，由宿主输出共享和异步 chunk；文件名可包含 Rollup hash，不依赖固定的 `tiptap.esm.js` 或 `vendor.esm.js` 名称。
- CJS 使用相对 require 加载兄弟 chunk，不能只复制主文件。ProseMirror 通过已声明的直接依赖加载；CJS 预算也包含其真实 require 闭包。
- npm 的 ESM/CJS 使用同一套 PM 依赖；`browser` 对象只把 `dist/pm/*.js` 映射到对应 `prosemirror-*` 包。浏览器直挂 ESM 则加载 dist/pm 中的离线模块，它们计入完整初始图，不能只复制入口。Element UMD 保持内置 PM。
- 协同需 ESM SDK + ESM collab + ESM Yjs，或 CJS SDK + CJS collab + require Yjs。Node 条件选 CJS，Node 侧请整组使用 require。混合模块及 UMD 外部协同在挂载前拒绝，不能靠改插件 key 掩盖运行时类身份冲突。
- Element UMD 从主脚本同目录加载 `lark-doc-element.umd.min.{math,mermaid,office,markdown,highlight}.js`。普通 bundler import 使用 Element ESM，不需要把 UMD 再包一遍。
- 默认 / full / legacy / Element ESM 及 Mermaid feature ESM 引用同一份 `lark-doc-mermaid-runtime.esm.js`；CJS 引用同格式的 `.common.js`。默认仍懒加载，full 仍静态加载，lite 不引用共享 Mermaid；CDN feature UMD 自含实现。共享文件也是语法、体积、离线和缓存校验对象，不是外网依赖。
- 静态托管保留完整 `dist/`：主文件、共享/异步 chunk、feature 文件、CSS 与 `fonts/`。不要依赖旧 Webpack 的 `publicPath:'auto'` 或 `__LARK_DOC_PUBLIC_PATH__` 说明来配置当前 Rollup 产物。

语法降级、压缩和运行时 polyfill 是三件事：ES2018 语法检查验证解析能力；terser 压缩减小体积；入口 core-js 补齐已声明的运行时 API。它们不能互相替代，也不等于任意旧浏览器都已实测。

<span id="构建与校验"></span>

库的编译命令和发布检查由维护者执行，见[仓库开发指南](https://github.com/cuijianjun/LarkDoc/blob/master/docs/guide/development.md)。应用接入按[环境示例](/examples/)选择入口即可。

## 体积与加载 {#体积口径}

默认入口按需加载公式、图表、Office 等能力；`full` 静态引入全部能力，`lite` 由应用自行注册需要的 feature。对比时同时关注入口与实际加载的依赖，不能只比较入口文件大小。

历史构建耗时、完整依赖图和预算检查记录保留在仓库的[性能验收资料](https://github.com/cuijianjun/LarkDoc/blob/master/docs/guide/performance.md)。
