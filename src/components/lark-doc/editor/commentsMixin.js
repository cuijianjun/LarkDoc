/**
 * 评论面板状态机（P6b-01）—— requirements/04 §3.1、05 §5.5。
 *
 * 规格口径（改之前先读 04 §3.1）：
 *   1. **权限只走 capability，不自判角色**。建 / 回复 → `canComment`；解决 / 重开 →
 *      `canResolveComment`。无权限时面板照样挂载、按钮置灰（CSS `--ld-text-disabled`），
 *      点击直接 return —— 不隐藏（隐藏会让用户以为文档没有评论功能）。
 *   2. **锚点是 blockId + 块内偏移**（05 §5.5⑥）。本 mixin 只在「落 mark」时用一次
 *      ProseMirror 的 from / to，线程身份一律走 blockId。
 *   3. **块没了只降级 unbound，绝不就近吸附**。失联线程不进 `commentPanels`（没位置可画），
 *      由 `commentUnboundThreads` 交给宿主决定怎么提示。
 *   4. **`⌘+Enter` 不提交**（04 §3.1⑤ 实测）。所以草稿只有「点发送」一条出口，
 *      本 mixin 不绑任何 keydown 提交。
 *
 * 五条负结论（别实现）：
 *   - 「编辑 / 翻译 / 举报」：04 §3.1④-3 B 的四项菜单里，V1 只做**删除**。编辑要 Provider
 *     的 `editReply`（`COMMENT_METHODS` 五方法里没有它），翻译与举报要外部服务 —— 菜单项
 *     照样渲染（照像素与顺序），但点「编辑 / 翻译 / 举报」不做任何事。
 *   - 「回复行的『添加表情回复』『引用回复』接功能」：④-2 只测到尺寸与位置，没给行为，
 *     照渲染、点了静默（见 `runCommentReplyControl`）。
 *   - 「解决 / 重开放进面板头『更多』」：④-3 的 🔴 修正历史记录明确这是错的，二者是头部
 *     独立按钮。面板头「更多」只有「私有评论」开关。
 *   - 「删除加二次确认」：④-3 B 写明无二次确认，且飞书未加 `delete-item` 红字变体。
 *   - 「已解决线程还占面板位」：⑤ 写明 resolve 后面板关闭、正文高亮转灰，已解决线程从
 *     `commentPanels` 里移除。
 */
import {
  COMMENT_CONTROLS,
  COMMENT_HEIGHTS,
  COMMENT_PANEL,
  COMMENT_PRIVATE_SWITCH,
  COMMENT_REPLY_CONTROLS,
  COMMENT_REPLY_CONTROL_IDS,
  COMMENT_REPLY_MENU_ITEMS,
  commentPanelHeight,
} from '../../../core/blocks/comment'
import { unreadCount } from '../../../core/comments/index'
import { bindThreads, resolveAnchorCodec } from '../../../core/comments/binding'
import { normalizeAuthor } from '../../../core/comments/thread'

/** 面板与正文右缘的间距（实测 1214 - 1202，与修订面板同口径）。 */
const COMMENT_ANCHOR_GUTTER = 12
/** 贴视口边的最小留白，与 isv 面板同口径。 */
const COMMENT_VIEWPORT_MARGIN = 8
/** 两个面板纵向叠放时的间隙。**不属于面板几何**（04 §3.1④ 没测），故不进 `COMMENT_PANEL`。 */
const COMMENT_PANEL_GAP = 8

/**
 * 头部控件 id → 图标键。
 *
 * 「更多」刻意给空串：飞书那颗是三点省略号，图标库里没有对应字形，由 CSS 画圆点
 * （见 `styles/comments.css` 的 `.lark-doc-comment-dots`）—— 不为它去改共享的 `icons.js`。
 */
const COMMENT_CONTROL_ICONS = Object.freeze({
  'go-next': 'rev-next',
  'go-previous': 'rev-prev',
  copyAnchor: 'link',
  resolve: 'rev-accept',
  more: '',
})

/** 回复行 hover 三按钮 id → 图标键（同样没有表情 / 省略号字形，走 CSS 与近似符号）。 */
const COMMENT_REPLY_ICONS = Object.freeze({ emoji: 'sparkle', quote: 'block-quote', more: '' })

/** 控件的无障碍名。不写 `title`：飞书的气泡是组件画的，原生 title 会多一层灰底气泡。 */
const COMMENT_CONTROL_LABELS = Object.freeze({
  'go-next': '下一条评论',
  'go-previous': '上一条评论',
  copyAnchor: '复制锚点',
  resolve: '解决评论',
  more: '更多',
})

const COMMENT_REPLY_CONTROL_LABELS = Object.freeze({ emoji: '添加表情回复', quote: '引用回复', more: '更多菜单' })

/**
 * 写操作 → 需要哪个 capability。
 * 表在这里是因为「哪些动作归哪把钥匙」只有一处答案，散在各个方法里迟早会漏一个。
 */
export const COMMENT_GATES = Object.freeze({
  create: 'canComment',
  reply: 'canComment',
  remove: 'canComment',
  resolve: 'canResolveComment',
  reopen: 'canResolveComment',
})

/** 动作 → capability；不在表里的动作返回空串（= 不需要闸门，别默认放行）。 */
export function commentGate(action) {
  return COMMENT_GATES[action] || ''
}

/** 草稿文本：没写过草稿就是空串（空串 = 不浮出「取消 / 发送」，见 04 §3.1⑤）。 */
export function commentDraftText(drafts, threadId) {
  const source = drafts && typeof drafts === 'object' ? drafts : {}
  const value = source[threadId]
  return typeof value === 'string' ? value : ''
}

/** 「刚刚 / N 分钟前 / N 小时前 / M-D」。04 §3.1④ 只实测到「刚刚」，其余按同族口径推。 */
export function commentRelativeTime(now, at) {
  const time = Number.isFinite(at) ? at : 0
  if (!time) return ''
  const delta = Math.max(0, (Number.isFinite(now) ? now : 0) - time)
  if (delta < 60000) return '刚刚'
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`
  const date = new Date(time)
  return `${date.getMonth() + 1}-${date.getDate()}`
}

export default {
  data() {
    return {
      /** Provider 返回并经 `bindThreads` 绑过的线程（含 resolved，面板自己过滤）。 */
      commentThreads: [],
      /** 点亮 / 展开输入的线程 id。飞书的面板只对一条线程展开输入区。 */
      commentActiveThreadId: '',
      /** threadId → 草稿文本。Vue 2 加新键必须走 `$set`，见 `setCommentDraft`。 */
      commentDrafts: {},
      /** 已读线程 id：未读数按它与 `commentThreads` 做差集。 */
      commentReadIds: [],
      /** 「私有评论」开关为开的线程 id（开关是本地态，Provider 无对应方法）。 */
      commentPrivateIds: [],
      /** 面板头「更多」下拉打开的线程 id（同时只允许一个，关别的靠它互斥）。 */
      commentMoreThreadId: '',
      /** 回复行「更多」菜单：`{ threadId, commentId }`，空串 = 关着。 */
      commentMenuThreadId: '',
      commentMenuCommentId: '',
      /** 带几何的面板列表（bound 且未解决），与 `revisionPanels` 同形态。 */
      commentPanels: [],
      /** 协同宿主注入 yjs codec 工厂的入口；不注入就走 plain（core 不 import yjs）。 */
      commentAnchorOptions: {},
    }
  },
  computed: {
    /** 面板的无障碍名（类比修订面板的 `revisionPanelTitle`）。 */
    commentPanelTitle() {
      return '评论'
    },
    /** 「私有评论」的标题与说明：文案在 core 常量里，面板不另抄一份。 */
    commentPrivateTitle() {
      return COMMENT_PRIVATE_SWITCH.title
    },
    commentPrivateHint() {
      return COMMENT_PRIVATE_SWITCH.hint
    },
    /** 头部控件组的六项，顺序来自 core 常量；`split` 走分割条分支。 */
    commentControls() {
      return COMMENT_CONTROLS.map((item) => ({
        id: item.id,
        label: COMMENT_CONTROL_LABELS[item.id] || item.id,
        split: item.tone === 'split',
        icon: COMMENT_CONTROL_ICONS[item.id] || '',
        iconSize: item.iconSize,
        tone: item.tone,
      }))
    },
    /** 回复行 hover 的三按钮：每格 14×14、步进 25（04 §3.1④-2）。 */
    commentReplyControls() {
      return COMMENT_REPLY_CONTROL_IDS.map((id) => ({
        id,
        label: COMMENT_REPLY_CONTROL_LABELS[id] || id,
        icon: COMMENT_REPLY_ICONS[id] || '',
        iconSize: COMMENT_REPLY_CONTROLS.size,
      }))
    },
    /** 回复行「更多」菜单的四项，顺序固定（04 §3.1④-3 B）。 */
    commentMenuItems() {
      return COMMENT_REPLY_MENU_ITEMS.map((item) => ({ id: item.id, label: item.label, submenu: Boolean(item.submenu) }))
    },
    /** 未解决且未读的条数（已解决线程不提醒，见 state.js 文件头）。 */
    commentUnread() {
      return unreadCount(this.commentThreads, this.commentReadIds)
    },
    /** 失联线程（块被删）：面板画不出位置，交给宿主提示「原引用已删除」。 */
    commentUnboundThreads() {
      return this.commentThreads.filter((thread) => !thread.bound)
    },
    /** 锚点 codec：协同态由宿主注入工厂，否则 plain。 */
    commentAnchorCodec() {
      return resolveAnchorCodec(this.editor, this.commentAnchorOptions)
    },
    /** 当前用户（写路径的 author）。没有 session 时回落本地作者，`buildReply` 要非空 id。 */
    commentAuthor() {
      const user = this.session && this.session.user ? this.session.user : null
      return normalizeAuthor(user || { id: 'local-user', name: '我' })
    },
  },
  mounted() {
    // 宿主的 `mounted` 在本钩子之后才建编辑器 —— 延一帧再拉评论、挂监听。
    this.$nextTick(() => {
      if (!this.editor) return
      this.editor.view.dom.addEventListener('pointerdown', this.onCommentPointerDown)
      this.loadComments()
    })
    window.addEventListener('scroll', this.onCommentViewportChange, true)
    window.addEventListener('resize', this.onCommentViewportChange)
  },
  beforeDestroy() {
    window.removeEventListener('scroll', this.onCommentViewportChange, true)
    window.removeEventListener('resize', this.onCommentViewportChange)
    if (this.editor && this.editor.view && this.editor.view.dom) {
      this.editor.view.dom.removeEventListener('pointerdown', this.onCommentPointerDown)
    }
  },
  methods: {
    // —— 闸门与 Provider ——
    /** 单一判定入口：没配 session 时按 DEFAULT_CAPABILITIES（八项默认 true）放行。 */
    commentCan(capability) {
      const session = this.session
      if (!session || typeof session.can !== 'function') return true
      return session.can(capability)
    },
    /** 写操作的统一闸门；返回 false 时调用方直接 return（UI 侧同步置灰）。 */
    commentAllowed(action) {
      const gate = commentGate(action)
      if (!gate) return false
      return this.commentCan(gate)
    },
    commentProvider() {
      const session = this.session
      if (!session || typeof session.getProvider !== 'function') return null
      return session.getProvider('comments')
    },

    // —— 读取与绑定 ——
    async loadComments() {
      const provider = this.commentProvider()
      if (!provider) {
        this.commentThreads = []
        this.commentPanels = []
        return []
      }
      const documentId = this.session && this.session.documentId ? this.session.documentId : ''
      const threads = await provider.list({ documentId })
      this.commentThreads = bindThreads(this.editor ? this.editor.state.doc : null, threads, this.commentAnchorCodec)
      this.updateCommentPanels()
      return this.commentThreads
    },

    // —— 写操作（全部过闸门）——
    /**
     * 划词建评论：先建线程（拿到服务端 id），再把 mark 落到选区上。
     *
     * 顺序不能反：mark 的 threadId 就是线程身份，先落 mark 只能先造一个本地 id，
     * 之后还要回头改一遍文档 —— 多一次事务、多一处可能错位。
     */
    async createCommentFromSelection(content) {
      if (!this.commentAllowed('create')) return null
      if (!this.editor || !this.writable()) return null
      const text = typeof content === 'string' ? content.trim() : ''
      if (!text) return null
      const range = this.commentSelectionRange()
      if (!range) return null
      const provider = this.commentProvider()
      if (!provider) return null
      const thread = await provider.createThread({
        blockId: range.blockId,
        author: this.commentAuthor,
        content: text,
        anchor: { blockId: range.blockId, offset: range.offset, length: range.length },
        quote: range.text,
      })
      this.applyCommentMark(thread.id, range.from, range.to)
      await this.loadComments()
      this.activateComment(thread.id)
      return thread
    },
    /** 发送草稿：空草稿不发（04 §3.1②「未输入时无取消/发送按钮」）。 */
    async submitCommentDraft(threadId) {
      if (!this.commentAllowed('reply')) return null
      const text = commentDraftText(this.commentDrafts, threadId).trim()
      if (!text) return null
      const provider = this.commentProvider()
      if (!provider) return null
      const reply = await provider.reply({ threadId, author: this.commentAuthor, content: text })
      this.clearCommentDraft(threadId)
      await this.loadComments()
      return reply
    },
    async resolveComment(threadId) {
      if (!this.commentAllowed('resolve')) return null
      const provider = this.commentProvider()
      if (!provider) return null
      const thread = await provider.resolve(threadId)
      if (this.commentActiveThreadId === threadId) this.commentActiveThreadId = ''
      await this.loadComments()
      return thread
    },
    async reopenComment(threadId) {
      if (!this.commentAllowed('reopen')) return null
      const provider = this.commentProvider()
      if (!provider) return null
      const thread = await provider.reopen(threadId)
      await this.loadComments()
      return thread
    },
    /**
     * 删单条回复（**无二次确认**，04 §3.1④-3）。
     * `deleteReply` 不在 `COMMENT_METHODS` 五方法里，Provider 没给就只清本地态 ——
     * 面板不该因为 Provider 少一个可选项就报错。
     */
    async deleteCommentReply(threadId, commentId) {
      if (!this.commentAllowed('remove')) return null
      const provider = this.commentProvider()
      if (provider && typeof provider.deleteReply === 'function') {
        await provider.deleteReply({ threadId, commentId })
        await this.loadComments()
        return true
      }
      this.commentThreads = this.commentThreads.map((thread) => {
        if (thread.id !== threadId) return thread
        return { ...thread, replies: thread.replies.filter((reply) => reply.id !== commentId) }
      })
      this.updateCommentPanels()
      return true
    },

    // —— 选区 → 锚点 ——
    /**
     * 当前选区落在哪个块、块内偏移多少。空选区 / 找不到带 blockId 的祖先都返回 null
     * （05 §5.5 要求 `blockId` 是身份主键，没有块 id 的选区不该建评论）。
     */
    commentSelectionRange() {
      if (!this.editor) return null
      const state = this.editor.state
      const selection = state.selection
      if (!selection || selection.empty) return null
      const from = selection.from
      const to = selection.to
      const resolved = state.doc.resolve(from)
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        const node = resolved.node(depth)
        const blockId = node.attrs && typeof node.attrs.blockId === 'string' ? node.attrs.blockId.trim() : ''
        if (!blockId) continue
        const contentStart = resolved.before(depth) + 1
        return {
          blockId,
          offset: Math.max(0, from - contentStart),
          length: Math.max(0, to - from),
          from,
          to,
          text: state.doc.textBetween(from, to, '\n', ' '),
        }
      }
      return null
    },
    /** 把 comment mark 落到一段选区上（mark 没注册时静默：`setComment` 命令不存在）。 */
    applyCommentMark(threadId, from, to) {
      if (!this.editor || typeof this.editor.commands.setComment !== 'function') return false
      const size = this.editor.state.doc.content.size
      const start = Math.max(0, Math.min(from, size))
      const end = Math.max(start, Math.min(to, size))
      this.editor.chain().focus().setTextSelection({ from: start, to: end }).setComment({ threadId }).setTextSelection(end).run()
      return true
    },

    // —— 草稿 ——
    setCommentDraft(threadId, text) {
      if (!threadId || !this.commentAllowed('reply')) return
      this.$set(this.commentDrafts, threadId, typeof text === 'string' ? text : '')
    },
    clearCommentDraft(threadId) {
      if (!threadId) return
      this.$set(this.commentDrafts, threadId, '')
    },
    commentHasDraft(threadId) {
      return commentDraftText(this.commentDrafts, threadId).trim().length > 0
    },

    // —— 点亮、已读、跳转 ——
    activateComment(threadId) {
      const next = threadId || ''
      if (next === this.commentActiveThreadId) return
      this.commentActiveThreadId = next
      if (next) this.markCommentRead(next)
      this.$nextTick(() => this.placeCommentPanels())
    },
    markCommentRead(threadId) {
      if (!threadId || this.commentReadIds.indexOf(threadId) !== -1) return
      this.commentReadIds = this.commentReadIds.concat([threadId])
    },
    /** 面板头「下一条 / 上一条」：只在面板顺序里前后跳，跳出去不动（同修订面板口径）。 */
    goComment(threadId, direction) {
      const index = this.commentPanels.findIndex((item) => item.id === threadId)
      if (index === -1) return
      const next = this.commentPanels[index + (direction < 0 ? -1 : 1)]
      if (!next) return
      this.activateComment(next.id)
      this.scrollCommentIntoView(next.blockId)
    },
    scrollCommentIntoView(blockId) {
      if (!this.editor) return
      const pos = this.commentBlockPos(blockId)
      if (pos < 0) return
      try {
        const at = this.editor.view.domAtPos(pos)
        const node = at.node && at.node.nodeType === 3 ? at.node.parentNode : at.node
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      } catch (error) {
        // 滚不动不影响点亮结果，静默（没有 toast 位）。
      }
    },
    commentBlockPos(blockId) {
      if (!this.editor || typeof blockId !== 'string' || !blockId) return -1
      let found = -1
      this.editor.state.doc.descendants((node, pos) => {
        if (found !== -1) return false
        if (node.attrs && node.attrs.blockId === blockId) {
          found = pos
          return false
        }
        return true
      })
      return found
    },

    // —— 开关与菜单 ——
    toggleCommentPrivate(threadId) {
      if (!threadId) return
      const on = this.commentPrivateIds.indexOf(threadId) !== -1
      this.commentPrivateIds = on
        ? this.commentPrivateIds.filter((id) => id !== threadId)
        : this.commentPrivateIds.concat([threadId])
    },
    commentPrivate(threadId) {
      return this.commentPrivateIds.indexOf(threadId) !== -1
    },
    toggleCommentMoreMenu(threadId) {
      this.commentMoreThreadId = this.commentMoreThreadId === threadId ? '' : threadId
    },
    toggleCommentReplyMenu(threadId, commentId) {
      const same = this.commentMenuThreadId === threadId && this.commentMenuCommentId === commentId
      this.commentMenuThreadId = same ? '' : threadId
      this.commentMenuCommentId = same ? '' : commentId
    },
    closeCommentMenus() {
      this.commentMoreThreadId = ''
      this.commentMenuThreadId = ''
      this.commentMenuCommentId = ''
    },
    /**
     * 回复行三按钮派发：V1 只有「更多」有行为。
     * 「添加表情回复」要表情面板、「引用回复」要把引用回填进输入区的协议，04 §3.1④-2
     * 两处都没给 —— 按钮照像素渲染，点了静默，不私自替飞书定语义。
     */
    runCommentReplyControl(id, threadId, commentId) {
      if (id === 'more') return this.toggleCommentReplyMenu(threadId, commentId)
      return undefined
    },
    /** 回复行「更多」的四项派发：V1 只有「删除」有行为（见文件头负结论）。 */
    runCommentMenuItem(id, threadId, commentId) {
      this.closeCommentMenus()
      if (id === 'delete') return this.deleteCommentReply(threadId, commentId)
      return undefined
    },
    /**
     * 回复行「更多」的可见性：编辑只给自己的、举报只给别人的（04 §3.1④-3 B 备注列）。
     * 作者 id 缺失时两边都不显示 —— 判不出归属就别给一条点了没反应的菜单项。
     */
    commentMenuVisible(item, reply) {
      const meta = COMMENT_REPLY_MENU_ITEMS.find((entry) => entry.id === item.id)
      if (!meta) return true
      const owner = reply && reply.author ? reply.author.id : ''
      const mine = Boolean(owner) && owner === this.commentAuthor.id
      if (meta.ownOnly) return mine
      if (meta.othersOnly) return Boolean(owner) && !mine
      return true
    },
    /** 头部六按钮派发。`resolve` 在已解决面板里换成 `reopen`（重开在已解决面板）。 */
    runCommentControl(id, threadId) {
      if (id === 'go-next') return this.goComment(threadId, 1)
      if (id === 'go-previous') return this.goComment(threadId, -1)
      if (id === 'resolve') return this.resolveComment(threadId)
      if (id === 'reopen') return this.reopenComment(threadId)
      if (id === 'copyAnchor') return this.copyCommentAnchor(threadId)
      if (id === 'more') return this.toggleCommentMoreMenu(threadId)
      return undefined
    },
    /**
     * 复制锚点：把引用原文放进剪贴板（04 §3.1④ `_copyAnchor-btn`）。
     * 剪贴板不可用时静默 —— 面板没有 toast 位，报错只会吓到人。
     */
    copyCommentAnchor(threadId) {
      const item = this.commentThreads.find((thread) => thread.id === threadId)
      const text = item ? this.commentQuoteOf(item) : ''
      if (!text) return false
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
      if (!clipboard || typeof clipboard.writeText !== 'function') return false
      clipboard.writeText(text).catch(() => {})
      return true
    },
    commentControlDisabled(id, threadId) {
      if (id === 'go-next' || id === 'go-previous') {
        const index = this.commentPanels.findIndex((item) => item.id === threadId)
        if (index === -1) return true
        return id === 'go-next' ? index >= this.commentPanels.length - 1 : index <= 0
      }
      if (id === 'resolve' || id === 'reopen') return !this.commentAllowed(id)
      return false
    },

    // —— 几何 ——
    /** 由宿主的 `onTransaction` 调；只做「过滤 + 清理失效 id」，几何交给下一帧。 */
    updateCommentPanels() {
      if (!this.editor) {
        this.commentPanels = []
        this.commentActiveThreadId = ''
        return
      }
      const items = this.commentThreads.filter((thread) => thread.bound && !thread.resolved)
      if (this.commentActiveThreadId && !items.some((thread) => thread.id === this.commentActiveThreadId)) {
        this.commentActiveThreadId = ''
      }
      this.commentPanels = items.map((thread) => ({ ...thread, left: 0, top: 0 }))
      this.$nextTick(() => this.placeCommentPanels())
    },
    placeCommentPanels() {
      const view = this.editor && this.editor.view
      if (!view || !this.commentPanels.length) return
      const bound = view.dom.getBoundingClientRect()
      const maxLeft = window.innerWidth - COMMENT_PANEL.width - COMMENT_VIEWPORT_MARGIN
      const left = Math.max(COMMENT_VIEWPORT_MARGIN, Math.min(maxLeft, bound.right + COMMENT_ANCHOR_GUTTER))
      const bottomLimit = window.innerHeight - COMMENT_VIEWPORT_MARGIN
      let floor = COMMENT_VIEWPORT_MARGIN
      this.commentPanels = this.commentPanels.map((item) => {
        const pos = this.commentBlockPos(item.blockId)
        let anchorTop = bound.top
        if (pos >= 0) {
          try {
            anchorTop = view.coordsAtPos(pos + 1).top
          } catch (error) {
            anchorTop = bound.top
          }
        }
        const height = commentPanelHeight(item.replies.length, this.commentHasDraft(item.id))
        let top = Math.max(floor, anchorTop)
        // 放不下就上收，但**不收过前一块**，否则两个面板会叠在一起。
        if (top + height > bottomLimit) top = Math.max(floor, bottomLimit - height)
        floor = top + height + COMMENT_PANEL_GAP
        return { ...item, left, top }
      })
    },
    onCommentViewportChange() {
      if (this.commentPanels.length) this.placeCommentPanels()
    },

    // —— 渲染给面板的取值 ——
    commentPanelHeightOf(item) {
      return commentPanelHeight(item.replies.length, this.commentHasDraft(item.id))
    },
    commentPanelStyle(item) {
      return { left: `${item.left}px`, top: `${item.top}px` }
    },
    commentDraftOf(threadId) {
      return commentDraftText(this.commentDrafts, threadId)
    },
    commentTimeAt(at) {
      return commentRelativeTime(Date.now(), at)
    },
    commentAuthorName(author) {
      const name = author && typeof author.name === 'string' ? author.name.trim() : ''
      return name || '我'
    },
    /** 引用头：优先用落库时的快照文本，没有就退回锚点块的第一段（飞书同样是快照）。 */
    commentQuoteOf(item) {
      return typeof item.quote === 'string' && item.quote ? item.quote : ''
    },
    commentTextareaHeight(item) {
      return this.commentHasDraft(item.id) ? COMMENT_HEIGHTS.textareaActive : COMMENT_HEIGHTS.textarea
    },
    /** 点正文高亮点亮对应线程（与 04 §3.1② 的双向跳转一致）。 */
    onCommentPointerDown(event) {
      const target = event.target
      const container = target && typeof target.closest === 'function' ? target.closest('.lark-doc-comment') : null
      if (!container) return
      this.activateComment(container.getAttribute('data-thread-id') || '')
    },
  },
}
