/**
 * 面板 / 宿主弹窗 —— 原生 DOM 版（`src/ui/` 积木 · 阶段 5 批次 4b）。
 *
 * 原 SFC 在本批次删除，这里是四个面板的唯一实现：
 *   ① `editor/OutlinePanel.vue`   —— 目录侧栏（210px sticky，父级另有一颗 ☰ 兄弟钮）
 *   ② `VersionPanel.vue`          —— 历史记录全屏层（左预览 + 右按天时间线）
 *   ③ toast                       —— 恢复成功等版本提示（`SaveVersionDialog.vue` 的残留物：
 *                                    手动另存为已按飞书口径改为后端自动记录，Dialog 下线）
 *   ④ `CommentPanel.vue`          —— 评论面板层（`display:contents` 容器 + 每线程一张卡）
 *
 * 模板库是**宿主侧**原生 UI（`src/ui/templateLibrary.js`，`src/index.js` 对外导出、独立路由），
 * 不在编辑器里，不在本文件里。
 *
 * `scripts/verify-browser-panels.js` 的 87 条断言逐字段量这里产出的 DOM，改之前先跑一遍。
 *
 * 五条与其它积木一致的规矩：
 * 1. **结构即契约**：类名 / `role` / `aria-*` / 段序逐字段复刻 SFC。
 * 2. **`v-if` → 真 insert/remove**：空态 / 降级态 / diff / 草稿按钮组 / 回复菜单
 *    一律走 `syncChildren`。这些段位断言量的是 `querySelector` 找不找得到，
 *    只 `display:none` 会被当场量出来。
 * 3. **一次建节点、之后只改属性**：目录条目、评论卡的 head/输入区/更多菜单都在工厂里
 *    建好，`update()` 只切类名与文案。重建会把焦点、hover 态与鼠标下的节点一起丢掉 ——
 *    评论的 textarea 尤其明显（重建一次等于用户打字打到一半光标被踢到末尾）。
 * 4. **关闭即摘节点**：面板开合走 `mountNode(host, el, on)`（只增删自己这一棵），
 *    `open: false` 时整棵从宿主摘掉，与 Vue 的销毁语义一致。
 * 5. **样式一律 `applyStyle`（替换语义）**：这些面板的 `left/top/height` 每帧重算，
 *    合并语义会把上一轮的位置留在原地。
 *
 * ⚠️ 四处**故意不统一**，别顺手改成「看起来更合理」的样子：
 * - `VersionPanel` 的 `Esc` **关不掉**：根节点只 `stop + prevent`，不接关闭逻辑 ——
 *   目的是拦住冒泡到 `overlayDismissMixin.closeOverlay()`（那条链里没有版本面板分支）。
 *   唯一出口是左栏顶栏的返回图标。
 * - `CommentPanel` 的根节点是 `@mousedown`（**没有** `.prevent`）：它要抢焦点去点亮线程；
 *   里面的按钮则一律 `.prevent`（点面板不能把焦点让给 body，否则编辑器选区掉了）。
 *   唯一例外是 textarea —— 它必须拿到焦点。
 * - 评论卡的 `:style` 在 SFC 里是**数组**（`[commentPanelStyle(item), { height }]` =
 *   合并语义）。原生层 `applyStyle` 是替换语义，所以由接线层先算成一份对象再传，
 *   不能分两次 `applyStyle`。
 * - `OutlinePanel` 的根 `aside` 必须是 `.lark-doc-body` 的**直接 flex 子元素**
 *   （`lark-doc.css` 里它是 `flex: 0 0 210px` + `position: sticky`）。它的宿主因此带
 *   `display: contents`，不占一格 flex。
 */

/*
 * 三个面板的实现已按「谁跟谁共享作用域」拆开，本文件只保留对外出口：
 *
 *   outlinePanel.js    ① 目录侧栏（一直独立）
 *   versionPanel.js    ②③ 历史记录全屏层 + 版本提示 toast
 *   commentPanel.js    ④ 评论面板层（含它独占的受控输入与富文本片段渲染）
 *   panelShared.js     handler 取值 / 受控输入回写 / 按钮抢焦点
 *
 * 拆的是文件边界，不是行为：导出名、类名、断言口径一律未变。旧的
 * `import { createCommentPanel } from './panels'` 不用改。
 */

/* ═══════════════════════════ ① 目录侧栏 ═══════════════════════════ */

/**
 * 目录侧栏（`OutlinePanel.vue`）。
 *
 * 宿主必须是 `.lark-doc-body` 里的 `ref="outlineHost"`（带 `display: contents`）：
 * `aside` 的 `flex: 0 0 210px` / `position: sticky` 都要求它是那层 flex 的直接子项。
 *
 * 条目按 `pos` 缓存：折叠 / 展开只改类名与条目集合，节点本身复用。
 * `hasChildren` 决定首格是折叠钮还是占位 span —— 两个节点都建好，用
 * `syncChildren` 二选一，等价于模板里的 `v-if` / `v-else`。
 *
 * state: `{ open, empty, pending, active, items: [{ pos, text, level, hasChildren, collapsed }] }`
 */
export { createOutlinePanel } from './outlinePanel'

/* ═══════════════════════ ②③ 历史记录与版本提示 ═══════════════════════ */

export { createVersionPanel, createVersionToast } from './versionPanel'

/* ═══════════════════════════ ④ 评论面板层 ═══════════════════════════ */

export { createCommentPanel } from './commentPanel'
