/**
 * P6b-01 评论的**纯 Node 部分** —— requirements/04 §3.1、05 §5.5。
 *
 * 只测不碰 DOM 的三块：
 *   1. `core/blocks/comment.js` —— 收集 / 区间 / 定位 / 高度 / mark 契约；
 *   2. `core/comments/binding.js` —— 块表抽取、协同态探测、重绑（块没了只降级）；
 *   3. `editor/commentsMixin.js` 的导出纯函数 + capability 闸门（用假 `this` 调方法，
 *      不挂 Vue 实例 —— 组件渲染交给浏览器侧用例）。
 *
 * 刻意不测的：面板 DOM、像素、hover 菜单的展开。那部分要靠 jsdom 与真实编辑器，
 * 放进来只会把「逻辑回归」和「视觉回归」搅在一起。
 *
 * 文档对象一律用**最小替身**（只有 `descendants`）：`collectComments` 只承诺读
 * `node.isText / marks / nodeSize / text / pos`，造一个真 ProseMirror 文档要拖进
 * 整张 schema，反而把这条契约测糊了。
 */
import { describe, expect, it } from 'vitest'
import {
  COMMENT_CONTROL_IDS,
  COMMENT_HEIGHTS,
  COMMENT_PANEL,
  COMMENT_REPLY_MENU_IDS,
  LarkDocComment,
  collectComments,
  commentAt,
  commentMarkOf,
  commentPanelHeight,
  commentRanges,
  normalizeComment,
  partitionCommentThreads,
  readComment,
} from '../../src/core/blocks/comment'
import {
  bindThreads,
  collabYdocOf,
  documentBlockIds,
  resolveAnchorCodec,
} from '../../src/core/comments/binding'
import { plainAnchorCodec } from '../../src/core/comments/anchor'
import commentsMixin, {
  COMMENT_GATES,
  commentDraftText,
  commentGate,
  commentRelativeTime,
} from '../../src/components/lark-doc/editor/commentsMixin'

/** 造一个只带 comment mark 的文本节点替身。 */
function textNode(text, pos, threadId) {
  return {
    isText: true,
    text,
    nodeSize: text.length,
    marks: threadId ? [{ type: { name: 'comment' }, attrs: { threadId } }] : [],
    attrs: {},
  }
}

/**
 * 把若干 `[text, threadId]` 拼成有 `descendants` 的假文档。
 *
 * 全部文本节点按**同一段落内的连续文本**排布：pos 从 1 起（父节点内 +1），后一段紧贴
 * 前一段末尾。ProseMirror 划词跨 mark 边界时就是这样一串相邻文本节点 —— 合并逻辑
 * 真正要覆盖的就是这种形态（跨段落的片段本来就不该并成一条）。
 */
function fakeDoc(segments) {
  let pos = 1
  const nodes = segments.map(([text, threadId]) => {
    const node = textNode(text, pos, threadId)
    node.start = pos
    pos += text.length
    return node
  })
  return {
    descendants(visit) {
      nodes.forEach((node) => visit(node, node.start))
    },
  }
}

/**
 * 造一个能调 mixin 方法的假 `this`。
 *
 * 必须把 methods 整体摊上去：闸门是两层的（`commentAllowed` → `commentCan`），只塞
 * `session` 会让内层调用 undefined。摊完再覆盖需要的字段（如 `commentAuthor`）。
 */
function mixinCtx(extra) {
  const ctx = { ...extra }
  const methods = commentsMixin.methods
  Object.keys(methods).forEach((key) => {
    if (typeof ctx[key] !== 'function') ctx[key] = methods[key]
  })
  return ctx
}

describe('comment mark 契约', () => {
  it('mark 名与 inclusive 都是写死的，改了会让旧文档里的高亮跟着新打字延伸', () => {
    expect(LarkDocComment.name).toBe('comment')
    // Tiptap 把 create() 的入参留在 `.config` 上（不是 `.options`），与 addAttributes 同源。
    expect(LarkDocComment.config.inclusive).toBe(false)
  })

  it('属性只有 threadId，不带坐标（05 §5.5⑥：位置走 blockId + 块内偏移）', () => {
    const attrs = LarkDocComment.config.addAttributes.call({})
    expect(Object.keys(attrs)).toEqual(['threadId'])
  })

  it('normalizeComment 给空 threadId 兜一个本地 id，非空则原样返回', () => {
    expect(normalizeComment({ threadId: 't-1' }).threadId).toBe('t-1')
    expect(normalizeComment({}).threadId).not.toBe('')
    expect(normalizeComment(null).threadId).not.toBe('')
  })

  it('readComment 只认 comment mark；commentMarkOf 取第一条', () => {
    const mark = { type: { name: 'comment' }, attrs: { threadId: 't-9' } }
    expect(readComment(mark).threadId).toBe('t-9')
    expect(readComment({ type: { name: 'bold' }, attrs: {} })).toBeNull()
    const node = { marks: [{ type: { name: 'bold' }, attrs: {} }, mark] }
    expect(commentMarkOf(node)).toBe(mark)
    expect(commentMarkOf({ marks: [] })).toBeNull()
  })
})

describe('collectComments / commentRanges / commentAt', () => {
  it('同 threadId 且位置相邻的片段合并成一条（划词跨 mark 边界会被拆成多个文本节点）', () => {
    const doc = fakeDoc([['第一段', 't-1'], ['接着', 't-1'], ['别的', 't-2']])
    const items = collectComments(doc)
    expect(items).toHaveLength(2)
    expect(items[0].threadId).toBe('t-1')
    expect(items[0].text).toBe('第一段接着')
    // 相邻文本节点之间不留空位：上一条的 to 就是下一条的 from。
    expect(items[0].to).toBe(items[1].from)
  })

  it('同 threadId 但中间隔着别的文本时不合并（两段各自成条）', () => {
    const doc = fakeDoc([['甲', 't-1'], ['夹', 't-2'], ['乙', 't-1']])
    expect(collectComments(doc)).toHaveLength(3)
  })

  it('结果按文档序，不按 threadId 排序', () => {
    const doc = fakeDoc([['一', 't-2'], ['二', 't-1']])
    expect(collectComments(doc).map((item) => item.threadId)).toEqual(['t-2', 't-1'])
  })

  it('commentRanges 只返回该 threadId 的区间', () => {
    const doc = fakeDoc([['甲', 't-1'], ['乙', 't-2'], ['丙', 't-1']])
    expect(commentRanges(doc, 't-1')).toHaveLength(2)
    expect(commentRanges(doc, 't-3')).toEqual([])
  })

  it('commentAt：to 是开区间（光标停在标记末尾不算「在评论里」）', () => {
    const doc = fakeDoc([['甲乙丙', 't-1']])
    const [range] = commentRanges(doc, 't-1')
    expect(commentAt(doc, range.from)).toBe('t-1')
    expect(commentAt(doc, range.to - 1)).toBe('t-1')
    expect(commentAt(doc, range.to)).toBe('')
    expect(commentAt(doc, range.from - 1)).toBe('')
  })

  it('空文档 / 替身不合规时不抛', () => {
    expect(collectComments(null)).toEqual([])
    expect(collectComments({})).toEqual([])
    expect(commentAt(null, 0)).toBe('')
  })
})

describe('面板几何常量与高度', () => {
  it('宽度恒定 270、x 常驻 1214（04 §3.1④）', () => {
    expect(COMMENT_PANEL.width).toBe(270)
    expect(COMMENT_PANEL.x).toBe(1214)
    expect(COMMENT_PANEL.headerWidth).toBe(268)
    expect(COMMENT_PANEL.headerHeight).toBe(35)
    expect(COMMENT_PANEL.replyHeight).toBe(61)
    expect(COMMENT_PANEL.buttonGroupWidth).toBe(96)
  })

  it('三态高度：空 150 / 输入中 238 / 已提交 1 条 156', () => {
    expect(commentPanelHeight(0, false)).toBe(COMMENT_HEIGHTS.empty)
    expect(commentPanelHeight(1, true)).toBe(COMMENT_HEIGHTS.drafting)
    expect(commentPanelHeight(1, false)).toBe(COMMENT_HEIGHTS.submittedOne)
  })

  it('每条新增回复 +61（旧记 55 已作废）', () => {
    expect(commentPanelHeight(2, false) - commentPanelHeight(1, false)).toBe(61)
    expect(commentPanelHeight(3, true) - commentPanelHeight(2, true)).toBe(61)
  })

  it('头部六控件的顺序不可颠倒；回复行菜单四项顺序固定', () => {
    expect(COMMENT_CONTROL_IDS).toEqual(['go-next', 'go-previous', 'split', 'copyAnchor', 'resolve', 'more'])
    expect(COMMENT_REPLY_MENU_IDS).toEqual(['edit', 'translate', 'delete', 'report'])
  })
})

describe('bindThreads（块没了只降级，不吸附）', () => {
  it('块还在就是 bound，块被删只标 unbound —— 绝不就近挂到别的块', () => {
    const threads = [
      { id: 't-1', blockId: 'b-1', replies: [] },
      { id: 't-2', blockId: 'b-gone', replies: [] },
    ]
    const result = bindThreads(['b-1', 'b-2'], threads, plainAnchorCodec)
    expect(result).toHaveLength(2)
    expect(result[0].bound).toBe(true)
    expect(result[1].bound).toBe(false)
    // 降级的那条 blockId 必须原样留着，不能变成 b-1 / b-2。
    expect(result[1].blockId).toBe('b-gone')
  })

  it('脏条目（null / 数组）被过滤，不抛', () => {
    expect(bindThreads(['b-1'], [null, 42, []], plainAnchorCodec)).toEqual([])
  })

  it('不改入参（Provider 的返回值常被直接丢进来）', () => {
    const threads = [{ id: 't-1', blockId: 'b-1', replies: [] }]
    bindThreads(['b-1'], threads, plainAnchorCodec)
    expect(threads[0].bound).toBeUndefined()
  })

  it('传 ProseMirror 文档时从文档里抽 blockId 集合', () => {
    const doc = {
      descendants(visit) {
        visit({ attrs: { blockId: 'b-1' } }, 1)
        visit({ attrs: {} }, 3)
        visit({ attrs: { blockId: '' } }, 5)
      },
    }
    expect(Array.from(documentBlockIds(doc))).toEqual(['b-1'])
  })
})

describe('resolveAnchorCodec（core 不 import yjs，靠注入）', () => {
  const fakeYdoc = { get: () => ({}) }

  it('没注入工厂 → plain（单机模式的合法路径）', () => {
    expect(resolveAnchorCodec(null, {})).toBe(plainAnchorCodec)
    expect(resolveAnchorCodec(null)).toBe(plainAnchorCodec)
  })

  it('注入了工厂但拿不到 ydoc → 仍是 plain，不抛', () => {
    const factory = () => ({ encode: (a) => a, decode: (p) => p })
    expect(resolveAnchorCodec({ state: { plugins: [] } }, { createYjsCodec: factory })).toBe(plainAnchorCodec)
  })

  it('工厂抛错也退回 plain，不让「加一条评论」整体失败', () => {
    const factory = () => { throw new Error('yjs 未安装') }
    expect(resolveAnchorCodec(null, { createYjsCodec: factory, ydoc: fakeYdoc })).toBe(plainAnchorCodec)
  })

  it('拿到 ydoc 时用工厂产出的 codec', () => {
    const codec = { encode: (a) => a, decode: (p) => p }
    const factory = (options) => {
      expect(options.ydoc).toBe(fakeYdoc)
      return codec
    }
    const result = resolveAnchorCodec(null, { createYjsCodec: factory, ydoc: fakeYdoc })
    expect(result).not.toBe(plainAnchorCodec)
    expect(typeof result.encode).toBe('function')
  })

  it('collabYdocOf 只认 y-sync 插件，其它插件带 .doc 也不算协同文档', () => {
    const ydoc = { get: () => ({}) }
    const editor = {
      state: {
        plugins: [
          { spec: { key: { key: 'otherPlugin' } }, getState: () => ({ doc: ydoc }) },
          { spec: { key: { key: 'y-sync$' } }, getState: () => ({ binding: { doc: ydoc } }) },
        ],
      },
    }
    expect(collabYdocOf(editor)).toBe(ydoc)
    expect(collabYdocOf({ state: { plugins: [] } })).toBeNull()
    expect(collabYdocOf(null)).toBeNull()
    // 插件状态里没有 Y.Doc 形态（没有 get）→ 不算。
    expect(collabYdocOf({
      state: { plugins: [{ spec: { key: { key: 'y-sync$' } }, getState: () => ({ binding: { doc: {} } }) }] },
    })).toBeNull()
  })
})

describe('partitionCommentThreads 复用数据层判定（不另写一份）', () => {
  it('bound / unbound 与 partitionThreads 一致', () => {
    const threads = [
      { id: 't-1', blockId: 'b-1', replies: [] },
      { id: 't-2', blockId: 'b-x', replies: [] },
    ]
    const result = partitionCommentThreads(threads, ['b-1'])
    expect(result.bound.map((item) => item.id)).toEqual(['t-1'])
    expect(result.unbound.map((item) => item.id)).toEqual(['t-2'])
  })
})

describe('capability 闸门（只走 capability，不自判角色）', () => {
  it('动作 → capability 的映射表', () => {
    expect(COMMENT_GATES.create).toBe('canComment')
    expect(COMMENT_GATES.reply).toBe('canComment')
    expect(COMMENT_GATES.remove).toBe('canComment')
    expect(COMMENT_GATES.resolve).toBe('canResolveComment')
    expect(COMMENT_GATES.reopen).toBe('canResolveComment')
  })

  it('不在表里的动作返回空串 —— 别默认放行', () => {
    expect(commentGate('copyAnchor')).toBe('')
    expect(commentGate('')).toBe('')
  })

  it('没配 session 时按 DEFAULT_CAPABILITIES 放行（八项默认 true）', () => {
    const ctx = mixinCtx({ session: null })
    expect(ctx.commentCan('canComment')).toBe(true)
    expect(ctx.commentAllowed('create')).toBe(true)
  })

  it('canComment=false 时建/回复/删除都被拦，解决仍走自己的钥匙', () => {
    const ctx = mixinCtx({ session: { can: (cap) => cap !== 'canComment' } })
    expect(ctx.commentAllowed('create')).toBe(false)
    expect(ctx.commentAllowed('reply')).toBe(false)
    expect(ctx.commentAllowed('remove')).toBe(false)
    expect(ctx.commentAllowed('resolve')).toBe(true)
  })

  it('canResolveComment=false 只拦解决/重开，不拦回复', () => {
    const ctx = mixinCtx({ session: { can: (cap) => cap !== 'canResolveComment' } })
    expect(ctx.commentAllowed('resolve')).toBe(false)
    expect(ctx.commentAllowed('reopen')).toBe(false)
    expect(ctx.commentAllowed('reply')).toBe(true)
  })

  it('无权限时写操作直接返回 null，不落任何状态', async () => {
    let replied = 0
    const ctx = mixinCtx({
      session: { can: () => false, getProvider: () => ({ reply: async () => { replied += 1 } }) },
      commentDrafts: { 't-1': '你好' },
    })
    expect(await ctx.submitCommentDraft('t-1')).toBeNull()
    expect(replied).toBe(0)
    expect(await ctx.resolveComment('t-1')).toBeNull()
  })

  it('草稿写了字但无 canComment 时，setCommentDraft 不写草稿', () => {
    const written = {}
    const ctx = mixinCtx({ session: { can: () => false }, commentDrafts: {}, $set: (o, k, v) => { written[k] = v } })
    ctx.setCommentDraft('t-1', '文本')
    expect(ctx.commentDrafts['t-1']).toBeUndefined()
    expect(written['t-1']).toBeUndefined()
  })
})

describe('面板取值纯函数', () => {
  it('草稿：没写过是空串（空串 = 不浮出取消/发送）', () => {
    expect(commentDraftText({}, 't-1')).toBe('')
    expect(commentDraftText({ 't-1': '' }, 't-1')).toBe('')
    expect(commentDraftText({ 't-1': 'abc' }, 't-1')).toBe('abc')
    expect(commentDraftText(null, 't-1')).toBe('')
    expect(commentDraftText({ 't-1': 42 }, 't-1')).toBe('')
  })

  it('相对时间：刚刚 / N 分钟前 / N 小时前 / M-D', () => {
    const now = new Date(2026, 9, 27, 12, 0, 0).getTime()
    expect(commentRelativeTime(now, now)).toBe('刚刚')
    expect(commentRelativeTime(now, now - 59000)).toBe('刚刚')
    expect(commentRelativeTime(now, now - 120000)).toBe('2 分钟前')
    expect(commentRelativeTime(now, now - 7200000)).toBe('2 小时前')
    expect(commentRelativeTime(now, new Date(2026, 9, 25, 8, 0, 0).getTime())).toBe('10-25')
    expect(commentRelativeTime(now, 0)).toBe('')
  })

  it('菜单可见性：编辑只给自己的、举报只给别人的（04 §3.1④-3 B）', () => {
    const ctx = mixinCtx({ commentAuthor: { id: 'u-1', name: '我' } })
    const visible = ctx.commentMenuVisible.bind(ctx)
    const mine = { author: { id: 'u-1' } }
    const other = { author: { id: 'u-2' } }
    expect(visible({ id: 'edit' }, mine)).toBe(true)
    expect(visible({ id: 'edit' }, other)).toBe(false)
    expect(visible({ id: 'report' }, other)).toBe(true)
    expect(visible({ id: 'report' }, mine)).toBe(false)
    expect(visible({ id: 'delete' }, other)).toBe(true)
    // 作者 id 缺失 → 判不出归属，两边都不给。
    expect(visible({ id: 'edit' }, { author: { id: '' } })).toBe(false)
  })

  it('头部按钮禁用：到头灰掉，无权限灰掉，其余不灰', () => {
    const ctx = mixinCtx({
      commentPanels: [{ id: 't-1' }, { id: 't-2' }],
      session: { can: () => false },
    })
    expect(ctx.commentControlDisabled('go-previous', 't-1')).toBe(true)
    expect(ctx.commentControlDisabled('go-next', 't-2')).toBe(true)
    expect(ctx.commentControlDisabled('go-next', 't-1')).toBe(false)
    expect(ctx.commentControlDisabled('resolve', 't-1')).toBe(true)
    // 「更多」是本地 UI 态（私有评论开关），不看 capability —— 无权限也不灰。
    expect(ctx.commentControlDisabled('more', 't-1')).toBe(false)
    // 不在面板里的线程：跳转键灰掉。
    expect(ctx.commentControlDisabled('go-next', 't-9')).toBe(true)
  })
})
