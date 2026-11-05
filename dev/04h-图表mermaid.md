<!-- 由 DEVELOPMENT.md §4 拆出，是「4.8 图表（mermaid）」的唯一出处。 -->
# 4.8 图表（mermaid）

> 所属：[回归防护清单](./04-回归防护清单.md)　|　总导航：[`dev/00-INDEX.md`](./00-INDEX.md)

### 4.8 图表（mermaid）

- vendored UMD（`src/assets/vendor/`）必须排除在 Babel 之外；库的 Rollup 构建已处理。宿主直接编译源码时也应排除，避免注入 `core-js require` 破坏浏览器端脚本。
- **加载契约（当前版本）**：`diagram.js` 用 `import()` 懒 chunk（`loadMermaidModule`），不再 file-loader 落盘 + 运行时插 `<script>` 裸路径（内网必 404）。回落顺序：`window.mermaid` 已有 → 直接复用；否则通过 `lark-doc/mermaid-vendor` 构建别名动态导入。**别改回注入式**；只有显式传 `config.performance.diagramScriptUrl` 才走 `loadMermaidScript` 逃生舱（此时 DOM 里才有 `script[data-lark-doc-diagram="mermaid"]`）。
- vendored 产物是 UMD，跨模块包装后接口可能位于 `namespace.default`；取值用 `(m && m.default) || m`，并校验 `typeof mermaid.initialize === 'function'`。
- 默认 ESM、CJS 与 Element UMD 都按需加载图表区块；直接部署时保留完整 `dist/` 同位资源。`full` 是显式全量入口。不要套用旧 Webpack `LimitChunkCountPlugin` 的推断。
- jsdom 无真实布局，错误态断言应验证错误原因、源码可见和回调；真实渲染必须在浏览器看到 SVG。`test/unit/code-block-nodeview.test.js` 覆盖详细图表错误和高亮同语言失败后恢复，不能将它当成图表成功渲染证据。
- 工具栏、插入「＋」和斜杠菜单统一六种图表类型及各自图标，选择后都走 `insertDiagramType(type)`。hover 保活、延迟收起、快速重入取消关闭、视口边界由 `test/unit/dom-renderer-contract.test.js` 守护。
- 浏览器端识别 `.lark-doc-diagram` 预览层，不是 `code.language-mermaid`（node-view-content 不渲染 code 元素）。
- `flowchart / class / state` 用 `{ htmlLabels: false }` + 显式字体栈（mermaid 默认栈 + CJK 兜底，**禁止 'inherit'**）；标签是 SVG `<text>`，不要再加 foreignObject CSS 隔离规则（已删除）。

---
