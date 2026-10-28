<!-- 由 DEVELOPMENT.md §4 拆出，是「4.8 图表（mermaid）」的唯一出处。 -->
# 4.8 图表（mermaid）

> 所属：[回归防护清单](./04-回归防护清单.md)　|　总导航：[`dev/00-INDEX.md`](./00-INDEX.md)

### 4.8 图表（mermaid）

- vendored UMD（`src/assets/vendor/`）**必须排除在 babel 之外**（包与宿主 `vue.config.js` 都要 `rule('js').exclude.add(...)`），否则 core-js require 注入会让浏览器端脚本崩溃。
- **加载契约（0.11.0 起）**：`diagram.js` 用 `import()` 懒 chunk（`loadMermaidModule`），不再 file-loader 落盘 + 运行时插 `<script>` 裸路径（内网必 404）。回落顺序：`window.mermaid` 已有 → 直接复用；否则 `import('../../assets/vendor/mermaid/mermaid.min.js')`。**别改回注入式**；只有显式传 `performance.diagramScriptUrl` 才走 `loadMermaidScript` 逃生舱（此时 DOM 里才有 `script[data-lark-doc-diagram="mermaid"]`）。
- vendored 产物是 UMD，webpack 按 CJS 处理后完整接口挂在 `namespace.default` —— 取值必须 `(m && m.default) || m`，并用 `typeof mermaid.initialize === 'function'` 校验，别只看 truthy。
- CJS 产物无 chunk（`LimitChunkCountPlugin`）→ mermaid 内联进 `common.js`，jsdom 里会**真执行**并因无布局 `render` 失败。断言口径因此是「错误态 UX」：`.lark-doc-diagram-error` 存在 + 源码区可见；真实渲染成功由 `verify-browser-mermaid.js` 覆盖。别写成「预览态源码区隐藏」，那依赖旧注入契约下的 `loading` 卡死状态。
- 浏览器端识别 `.lark-doc-diagram` 预览层，不是 `code.language-mermaid`（node-view-content 不渲染 code 元素）。
- `flowchart / class / state` 用 `{ htmlLabels: false }` + 显式字体栈（mermaid 默认栈 + CJK 兜底，**禁止 'inherit'**）；标签是 SVG `<text>`，不要再加 foreignObject CSS 隔离规则（已删除）。

---
