# 安装、兼容与懒加载速查

本页汇总安装入口、样式、低频能力和部署注意事项。以当前 `package.json` 的 `exports` 和实际源码为准：当前 dev 仍使用 Vue2 渲染层，不能套用原生 DOM 分支的无 Vue 主入口、`lite` 或 `features/*` 子入口说明。

## 1. 按宿主选择公开入口

| 宿主或用途 | 入口 | 前置条件 |
| --- | --- | --- |
| Vue 2.7 命令式工作台 | `import { LarkDoc } from 'lark-doc'` | 使用兼容的 Vue2 / Tiptap Vue2 依赖 |
| Vue 2.7 组件 | `LarkDocEditor`、`LarkDocWorkspace`，从主入口导入 | 组件按 Vue2 契约注册 |
| Vue3 / React / 无框架 | `lark-doc/element` | 预打包 Element 内联 Vue2，避免宿主解析主入口的 Vue2 组件 |
| Vue3 属性桥接 | `lark-doc/vue3` 或 `lark-doc/adapters/vue3` | 先引入 Element；模板标签配置 `isCustomElement` |
| React 声明式桥接 | `lark-doc/react` 或 `lark-doc/adapters/react` | 先引入 Element；按适配器契约传 props 和事件 |
| 协同客户端 | `lark-doc/collab` | 显式安装并配置可选协同 peer 和服务端 |
| 静态页 / CDN / 内网 | `dist/lark-doc-element.umd.min.js` | 同位托管整套 `dist/` |

`lark-doc/legacy` 当前仍映射到同一套 Vue2 主产物，不是另一套独立的原生编辑器。各环境完整示例见[各环境引入对照](./environments)。

webpack4 不读取 `exports`：子入口改用公开的 `dist/` 路径。当前包保留 `browser` 指向 UMD，不能套用原生分支“删除 browser 后主入口必须 alias CJS”的结论；如宿主明确选择 CJS，应同时显式引入 CSS。详见[安装与引用总表](./install)。

## 2. 样式与资源

支持 `exports` 的构建器优先使用公开样式子路径：

```js
import 'lark-doc/style.css'
```

不读取 `exports` 的旧构建器使用完整路径：

```js
import 'lark-doc/dist/lark-doc.css'
// Element：import 'lark-doc/dist/lark-doc-element.umd.min.js'
```

Element 自行注入样式；字体和异步区块仍需要可访问。不要仅复制主 JS：静态部署应保留整个 `dist/`，包含 `lark-doc-element.umd.min.*.js`、CSS 与 `fonts/`，避免首次打开正常、插公式或图表时才 404。

Element 被宿主再次打包时，必要时在挂载前设置 `window.__LARK_DOC_PUBLIC_PATH__` 指向实际托管目录。ESM 使用相对 chunk 地址，不能把文件名当作裸包 specifier。具体目录与格式见[打包产物与按需加载](./build-artifacts)。

## 3. 重依赖按需加载

当前完整入口内置 KaTeX、Mermaid、Office、Markdown 和 Highlight 的加载逻辑，按内容或操作触发。`features` 控制能力是否启用，`toolbarKeys` 控制工具栏显示，二者不能互相替代。

| 能力 | 触发时机 | 说明 |
| --- | --- | --- |
| KaTeX | 首次渲染公式或使用公式弹窗 | 保留本地 CSS 和字体 |
| Mermaid | 显示图表块 | 可通过宿主配置接管渲染器来源 |
| Office | Word 导入 / 导出 | 涉及 `docx` / `mammoth` |
| Markdown | Markdown 导入 / 导出 | 使用本地转换依赖 |
| Highlight | 渲染代码块 | 按需加载高亮实现 |

当前没有公开 `lark-doc/lite` 或 `lark-doc/features/*`，不能照抄这些 import；也不能把另一个分支生成的 feature 文件复制过来就认为已接入。独立入口需要配套注册表、构建脚本与导出契约，而不仅是增加一个 `exports` 字段。

## 4. 模板与数据层用法

模板、评论、版本、Provider、迁移能力当前由主入口导出；它们并非都拥有独立子入口：

| 能力 | 当前公开导出 | 用途 |
| --- | --- | --- |
| 模板 | `LarkDocTemplateLibrary`、`TEMPLATES`、`templateLibrary` | Vue2 模板面板、模板数据与运算 |
| 评论 | `comments` 命名空间 | 线程模型、锚点与内存 Provider |
| 版本 | `versioning` 命名空间 | 快照、保留和恢复模型、内存 Provider |
| Provider | `providers`、`createDocumentSession` | 宿主契约校验与会话接入 |
| 迁移 | `migrations` 命名空间 | 旧记录升级 |

Vue2 宿主可以按下列方式接入现有数据层：

```js
import { LarkDoc, comments, versioning, providers, migrations } from 'lark-doc'

// 内存实现用于演示；生产环境按同一契约替换为实际服务。
const commentProvider = comments.createMemoryCommentsProvider()
const versionProvider = versioning.createMemoryVersioningProvider()
const persistence = providers.createLocalPersistence(window.localStorage)

const doc = new LarkDoc({
  element: '#editor',
  content: migrations.migrateRecordContent(rawRecord.json, rawRecord.schemaVersion),
  persistence,
  comments: commentProvider,
  versioning: versionProvider,
})
```

其中 `rawRecord` 由宿主读取。自定义持久化必须实现 `load/save/snapshots/snapshot/restore` 全部方法；`createPersistenceProvider` 校验适配器形状，不会自动把业务 API 转为完整后端。模板面板使用 Vue2 组件契约，见[模板](../blocks/templates)，不能以原生 `createTemplateLibrary({ host })` 工厂替代。

评论与版本的生产持久化、鉴权和面板由宿主接入，不要将 API key 或业务数据库连接写进默认配置。完整协同连接、会话和服务端契约见[协同与权限](./collaboration)与[协同服务端契约](./collab-server)；仅安装 `lark-doc/collab` 不等于协同已可用。

## 5. 页面级懒加载

Vue3 / React 宿主可以在客户端按页面加载 Element，而不是直接加载仍依赖 Vue2 的源码主入口：

```js
async function openEditor(host, content) {
  // host 为已挂载的 DOM 容器；仅在客户端调用。
  const { mountLarkDoc } = await import('lark-doc/element')
  return mountLarkDoc(host, { content, storage: 'none' })
}

// 页面卸载时调用返回实例的 destroy()。
```

SSR 中不在服务端模块顶层引入 Element；把 import 和创建实例放到客户端生命周期。webpack4 将示例中的子路径替换为 `lark-doc/dist/lark-doc-element.umd.min.js`。

## 6. 常见故障排查

| 现象 | 先检查 |
| --- | --- |
| Vue3 主入口出现 `Vue.extend` 错误 | 是否误让宿主 Vue3 接管了 Vue2 渲染层；改用 Element / adapter |
| Vue/React 标签空白 | 是否先引入 Element，Vue3 是否放行自定义标签 |
| 公式、Word、图表操作时 404 | 是否完整复制 `dist/`、字体及对应 chunk，基址是否正确 |
| `features/*` 或 `lite` 无法解析 | 当前 dev 未公开这些入口，使用完整入口的内置懒加载 |
| SSR 报 `document is not defined` | import 和挂载是否限制在客户端 |
| 协同依赖缺失 | 是否安装匹配的可选 peer，并实际配置服务端和 Provider |
| 配置后功能入口仍不见 | 分别检查 `features`、`toolbarKeys` 和只读 / 权限约束 |

本页是不同来源文档增量对 dev 实际契约的适配，不代表已经执行构建或浏览器验收。开发时按 `DEVELOPMENT.md` 选择局部门禁；发布前再依仓库约定完整验收，不能用其他 worktree 的旧产物替代当前源码的构建结果。
