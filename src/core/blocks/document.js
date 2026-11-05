/** 文档级扩展：折叠、搜索、块把手、slash 监听与粘贴网络策略都挂在这个插件上。 */
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import {
  blockIdAt,
  collectBlockIdFixes,
  foldableIdPositions,
  foldedRange,
  getMentionMatch,
  getSlashMatch,
  mapHeadingFoldKeys,
  sanitizeHTML,
} from '../documentOperations'
import { createNetworkPolicy } from '../policy/network'
import { createDerivedIndex } from '../derive/index'
import { applyBlockIdFixes } from './block-fixes'
import { documentKey } from './document-key'
import { applyLineStartMarker, verticalBoundarySelection } from './document-helpers'
import { createDocumentCommands } from './document-commands'
import { createDocumentDecorations, updateDocumentDecorations } from './document-decorations'

/**
 * @param {object} options 装配层传下来的全部选项（`config` / 各类回调）
 * @param {object} [injected] 装配层已经造好的出网策略实例（P3-06）。
 *   传进来就共用同一个 —— 粘贴过滤、嵌入闸门、载入降级必须是同一套判定；
 *   单独调用（老宿主 / 测试）时按 `options.config.network` 现造一个。
 */
export function documentExtension(options, injected) {
  const enabled = (name) => options.config?.features?.[name] !== false
  // 粘贴/拖入的 HTML 先做安全清洗，再按离线策略拦截远端图片地址。
  const network = injected || createNetworkPolicy(options.config?.network)
  /**
   * 「这笔事务是不是远端同步来的」——**只有协同模式才注入**（P6a / 09 §5.7.2-1）。
   * core 不 import yjs：宿主从 `lark-doc/collab` 拿 `isRemoteTransaction` 塞进来，
   * 不装协同的宿主这里是 null，行为与 P5 逐字节一致。
   */
  const isRemoteTransaction = typeof options.isRemoteTransaction === 'function' ? options.isRemoteTransaction : null
  return Extension.create({
    name: 'larkDoc',
    priority: 1000,
    // `network` 挂在 storage 上：`LarkDocEditor.setContent` 的载入降级要复用同一实例，
    // 而不是再造一份（策略是纯函数，但两份实例会让「改了配置只生效一半」这种问题查不出来）。
    addStorage() { return { folded: new Set(), query: '', activeIndex: 0, handleHover: null, network } },
    addCommands() {
      return createDocumentCommands()
    },
    addKeyboardShortcuts() {
      return {
        // 飞书为标题加编号的快捷键：Mac Cmd+Shift+7 / Win Ctrl+Shift+7
        'Mod-Shift-7': () => {
          const { $from } = this.editor.state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === 'heading') return this.editor.commands.toggleLarkDocHeadingNumber($from.before(depth))
          }
          return false
        },
      }
    },
    addProseMirrorPlugins() {
      const storage = this.storage
      const editor = this.editor
      // P0-11（09 §3.7）：派生计算收拢进 DerivedIndex。
      // P7-01 起它是双路径的：`update(tr)` 收集脏区，`decorations()` 有脏区就只重扫脏区
      // （incremental），没有就整份重建（rebuild）—— 搜索词/折叠集合/把手悬停都走 tr meta，
      // 改的是装饰输入，走冷路径更稳；击键路径上是 pure-docChanged，永远走热路径。
      const derivedIndex = createDerivedIndex({
        // 编辑器宿主与测试桩可能没有 state/schema（check-lark-doc-core 的 mock
        // 只有 { isEditable }）：初始 doc 允许为 null，首次 update/decorations
        // 会用真实事务补上；查询方法对 null doc 有护栏。
        doc: editor.state?.doc ?? null,
        schema: editor.schema,
        rebuild: (state) => createDocumentDecorations({ state, storage, editor, enabled, options }),
        incremental: ({ state, previous, ranges }) => updateDocumentDecorations({ state, storage, editor, enabled, options, previous, ranges }),
      })
      let lastSlash = ''
      let lastMention = ''
      // 斜杠菜单此刻是否真的开着：handleKeyDown 靠它决定要不要把 ↑↓/Enter 的默认行为
      // 挡掉。判据与 `mentionActive` 同源（就是 reportSlash 算出来的那份 match）。
      let slashActive = false
      // `dismissed` 由 Esc 置起、下一次文档变更清掉：两个锚定在光标处的浮层
      // （斜杠菜单 / `@` 面板）共用它 —— 一次 Esc 只收当前层，别让另一个趁同帧重开。
      let dismissed = false
      // 面板此刻是否真的开着（Esc、组字、切到只读都会让它变 false）。`handleKeyDown`
      // 靠它决定要不要把 ↑↓/Enter/Tab 的默认行为挡掉。
      let mentionActive = false
      const reportSlash = (view) => {
        const match = enabled('insert') && editor.isEditable && !view.composing && !dismissed ? getSlashMatch(view.state) : null
        slashActive = !!match
        const serialized = JSON.stringify(match)
        if (lastSlash !== serialized) { lastSlash = serialized; if (options.onSlash) options.onSlash(match) }
      }
      // P4-01：`@` 提及面板的驱动源，形状与 reportSlash 逐行对齐（JSON 去重 + 同一批
      // 闸门），差别只有「关掉面板时回调收到的是 null」，正文一个字符都不动。
      const reportMention = (view) => {
        const match = enabled('insert') && editor.isEditable && !view.composing && !dismissed ? getMentionMatch(view.state) : null
        mentionActive = !!match
        const serialized = JSON.stringify(match)
        if (lastMention !== serialized) { lastMention = serialized; if (options.onMention) options.onMention(match) }
      }
      const reportFloats = (view) => { reportSlash(view); reportMention(view) }
      const clearFloats = () => {
        if (options.onSlash) options.onSlash(null)
        if (options.onMention) options.onMention(null)
        lastSlash = 'null'
        lastMention = 'null'
        mentionActive = false
        slashActive = false
      }
      return [new Plugin({
        key: documentKey,
        state: {
          init: () => null,
          apply: (tr) => {
            const action = tr.getMeta(documentKey)
            // 派生索引先行。只有「正文变了」或「本插件的 UI 状态变了」才可能改动装饰的
            // 输入（doc / query / activeIndex / folded / handleHover）：纯选区事务（点击、
            // 方向键、跨块保列）和别家插件的 meta 一律复用缓存，否则每个方向键都要全量重建。
            derivedIndex.update(tr, { touchesDecorations: tr.docChanged || !!action })
            if (tr.docChanged) { dismissed = false; storage.handleHover = null }
            if (action?.resetFolds) storage.folded.clear()
            if (action?.search !== undefined) { storage.query = action.search; storage.activeIndex = action.activeIndex }
            if (action?.handleHover !== undefined) storage.handleHover = action.handleHover
            if (action?.toggleFoldId) { if (storage.folded.has(action.toggleFoldId)) storage.folded.delete(action.toggleFoldId); else storage.folded.add(action.toggleFoldId) }
            if (action?.foldIds) {
              const index = foldableIdPositions(tr.doc)
              action.foldIds.forEach((id) => { if (index.has(id)) storage.folded.add(id) })
            }
            if (action?.reveal) {
              const index = foldableIdPositions(tr.doc)
              Array.from(storage.folded).forEach((id) => {
                const pos = index.get(id)
                if (pos === undefined) return
                const range = foldedRange(tr.doc, pos)
                if (range && action.reveal.from < range.to && action.reveal.to > range.from) storage.folded.delete(id)
              })
            }
            if (action?.foldByKeys) {
              // 旧版「层级+文本+同名序号」键 → 当前文档里对应标题的 blockId。
              const wanted = new Set(action.foldByKeys)
              mapHeadingFoldKeys(tr.doc).forEach((legacyKey, pos) => {
                if (!wanted.has(legacyKey)) return
                const id = blockIdAt(tr.doc, pos)
                if (id) storage.folded.add(id)
              })
            }
            // 标题被删除后，它的 id 会变成幽灵：跟着文档变化剪一次（折叠集合通常只有
            // 个位数，成本可忽略）。
            if (tr.docChanged && storage.folded.size) {
              const index = foldableIdPositions(tr.doc)
              Array.from(storage.folded).forEach((id) => { if (!index.has(id)) storage.folded.delete(id) })
            }
            return null
          },
        },
        // 新块（回车分段、粘贴、拖入、AI 插入）和重复块（复制粘贴）在这里补 blockId：
        // 已有 id 的块一字不动，只有缺失/重号的块在事务末尾被重新编号。
        // 注意它必须挂在 plugin spec 顶层，放进 props 里 ProseMirror 不会调用。
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          // 协同（P6a / 09 §5.7.2-1）：**远端事务一律不补 blockId**。
          // 补 ID 是随机的，两端各补一次就会"同一块两个 ID"，折叠与评论锚点立刻错位。
          // 判据由 collab 子入口注入（core 不知道 yjs 存在）：任一事务来自远端就整体跳过，
          // 本地那段改动会在本端被补上，再随同步传播给对方。
          if (isRemoteTransaction && transactions.some((transaction) => isRemoteTransaction(transaction))) return null
          // 注意 appendMapping 返回 undefined，不能写成 reduce 的累加器。
          const mapping = new Mapping()
          transactions.forEach((transaction) => mapping.appendMapping(transaction.mapping))
          const fixes = collectBlockIdFixes(newState.doc, { doc: oldState.doc, mapping })
          if (!fixes.length) return null
          const tr = newState.tr
          return applyBlockIdFixes(tr, fixes) ? tr : null
        },
        props: {
          transformPastedHTML: (html) => network.filterHtml(sanitizeHTML(html)),
          /**
           * 行首 `1.` + 空格 → 编号块（飞书的 markdown 快捷输入）。
           *
           * Tiptap 自带的 input rule 只认半角 `1.`、且只能包段落；这里补齐三种情况：
           * 1. 中文输入法打出的全角标记（`1。` / `1、` / `1）`）——它们到不了 Tiptap 的正则；
           * 2. 标题行 —— 标题不能包进列表，改成「标题 + 编号」（蓝色 1.），文字原样保留；
           * 3. 段落 —— 删掉标记后包成有序列表，序号从用户输入的数字起算（3. 开头就是 3.）。
           */
          handleTextInput: (view, from, to, text) => {
            if (!enabled('shortcuts') || text !== ' ' || view.composing) return false
            return applyLineStartMarker(view, from)
          },
          handleKeyDown: (view, event) => {
            if (enabled('shortcuts') && event.key === 'Backspace' && !view.composing && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && options.onBackspace?.(view)) {
              event.preventDefault()
              return true
            }
            // P4-01：`@` 面板开着时，↑↓/Enter/Tab 归面板用 —— 这里只挡默认行为
            // （preventDefault），事件照旧冒泡到组件层由 onMentionKeydown 真正消费。
            // 放在 Backspace 之后：否则退格删不掉刚敲的 `@`；放在跨块保列之前：否则
            // ArrowUp/ArrowDown 会先被 verticalBoundarySelection 吃掉。
            if (mentionActive && !view.composing && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) {
              if (event.key === 'Escape') {
                dismissed = true
                reportFloats(view)
                event.preventDefault()
                return true
              }
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter' || event.key === 'Tab') return true
            }
            // 斜杠菜单同理（同样是「只挡默认行为、事件照旧冒泡」）：不挡的话
            // ArrowDown 会被浏览器原生移动光标 → 选区变化 → slash match 消失 → 菜单
            // 先自己关掉，组件层永远收不到 ↑↓/Enter，底部那句「↑ ↓ 选择 · Enter 插入」
            // 就成了空话。Enter 不挡则会先分段、再关菜单，命令也插不进去。
            if (slashActive && !view.composing && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); return true }
            }
            // At a block boundary, keep the caret's horizontal goal when
            // crossing to the adjacent block. This makes ArrowUp and
            // ArrowDown symmetric instead of landing on the previous block's
            // end position.
            if (enabled('shortcuts') && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !view.composing && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) {
              const nextSelection = verticalBoundarySelection(view, event.key === 'ArrowUp' ? -1 : 1)
              if (nextSelection) {
                view.dispatch(view.state.tr.setSelection(nextSelection).scrollIntoView())
                event.preventDefault()
                return true
              }
            }
            if (event.key === 'Escape') { dismissed = true; reportFloats(view) }
            return false
          },
          handleDOMEvents: {
            compositionstart: () => { clearFloats(); return false },
            compositionend: (view) => { reportFloats(view); return false },
          },
          // 新块（回车分段、粘贴、拖入、AI 插入）和重复块（复制粘贴）在这里补 blockId：
          // 已有 id 的块一字不动，只有缺失/重号的块在事务末尾被重新编号。
          // 派生计算一律走 DerivedIndex（硬规则 13：不许在 props.decorations
          // 里直接全量重扫文档）——具体计算在 document-decorations.js。
          decorations: (state) => derivedIndex.decorations(state),
        },
        view: (view) => { reportFloats(view); return { update: reportFloats, destroy: clearFloats } },
      })]
    },
  })
}
