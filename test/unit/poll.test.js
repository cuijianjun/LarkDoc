// @vitest-environment jsdom
/**
 * P5-03 投票块 `poll` —— requirements/02 §23（DOM / 几何 / 三态 / 时序）、§19.1 ⑥（数据模型）。
 *
 * 三层用例对应三份实现：
 *   1. `core/blocks/poll-render.js` —— 几何真值 / 归一化 / 编解码 / 本地状态机（纯函数）。
 *      这一层是「534×480 / 78 / 44 步进 / 三态块高」的唯一落点，CSS 只是照着画。
 *   2. `core/blocks/poll.js` —— `renderHTML` **就是导出产物**：PDF / DOCX 里必须是一张只读
 *      投票卡，出现 textarea 就是错的。
 *   3. `core/nodeviews/poll.js` —— 编辑态在**同一份数据**上叠交互层，写入一律经
 *      `updatePoll` 落回文档（不维护本地副本，两处状态必然漂移）。
 *
 * 三态断言统一用 `pollStatus()` 的口径（**已投优先于已截止**），时间一律注入 `now`，
 * 不依赖真实时钟 —— 否则跨午夜跑会随机红。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { COMMANDS, commandFeatureOf, filterCommands } from '../../src/core/commands/index'
import {
  POLL_GEOMETRY, POLL_HEIGHT, POLL_LIMITS, POLL_STATUS, POLL_VERSION,
  blockHeight, byteLength, canVote, cleanText, deadlineLabel, defaultPoll, encodePoll, formatPercent,
  headerLabels, normalizePoll, optionLabel, pollReducer, pollStatus, publishHint, publishReady,
  readPoll, tally, tomorrowDeadline,
} from '../../src/registry/blocks'

/* ------------------------------------------------------------------ *
 * 测试脚手架
 * ------------------------------------------------------------------ */

const mounted = []

afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
})

/** 固定时间锚点：2025-06-15 10:00 本地时（周一，非夏令时边界）。 */
const NOW = new Date(2025, 5, 15, 10, 0, 0, 0).getTime()

/** 已发布 + 至少一项选项有内容的最小可发布草稿。 */
function filledDraft(overrides = {}) {
  return {
    ...defaultPoll(),
    title: '周五团建去哪儿',
    options: [
      { id: 'opt_1', text: '爬山' },
      { id: 'opt_2', text: '看电影' },
    ],
    ...overrides,
  }
}

/**
 * 挂一块投票，并取回**ProseMirror 亲建的那个** NodeView 实例。
 *
 * 别的块（sheet / bookmark）可以 `createXxxNodeView(...)` 旁路造一份，投票不行：
 * 它的写入路径是「`commit()` 发事务 → PM 回调 `update()` 把文档里的新数据刷回来」。
 * 旁路实例没注册进 PM，事务照发、回调永远不来，`poll()` 就永远停在初始值
 * ——「投票后票数没变」「外部改数据不刷新」都源于此，那是测试脚手架的问题，不是实现的问题。
 *
 * 取实例的路径：`view.docView.descAt(pos)` 拿到 `CustomNodeViewDesc`，它的 `spec`
 * 就是 NodeView 对象本身（prosemirror-view 1.42 `NodeViewDesc.create`）。
 *
 * `blockId` 真机由 `larkDocBlockId` 插件在文档变更时下发（`appendTransaction`）；
 * 这里用 `content` 直接造文档不产生变更事务，所以显式给一个 —— 真机文档里它本就该是
 * 字符串，拿 `null` 去断言等于在测一个不存在的状态。
 */
function mountPoll(attrs = {}, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(options),
    content: {
      type: 'doc',
      content: [{
        type: 'poll',
        attrs: {
          poll: encodePoll(attrs.poll || defaultPoll()),
          blockId: attrs.blockId === undefined ? 'blk_poll_test' : attrs.blockId,
        },
      }],
    },
  })
  mounted.push({ cleanup: () => editor.destroy() })
  document.body.appendChild(editor.view.dom)
  const desc = editor.view.docView.descAt(0)
  const nodeView = desc && desc.spec
  if (!nodeView || !nodeView.dom) throw new Error('poll 块没有挂上 NodeView')
  return { editor, view: editor.view, nodeView, dom: nodeView.dom }
}

function freshEditor(content) {
  const editor = new Editor({ extensions: createLarkDocExtensions({}), content })
  mounted.push({ cleanup: () => editor.destroy() })
  return editor
}

const pollsIn = (editor) => {
  const found = []
  editor.state.doc.descendants((node) => { if (node.type.name === 'poll') found.push(node) })
  return found
}

const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const typeInto = (element, value) => {
  element.value = value
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}

/* ------------------------------------------------------------------ *
 * ① 几何：§23 的实测数字唯一落点
 * ------------------------------------------------------------------ */

describe('几何常量（§23 ②）', () => {
  it('块 534×480 / 卡片 500 / 内缩 17 —— 500 = 534 − 34', () => {
    expect(POLL_GEOMETRY.blockWidth).toBe(534)
    expect(POLL_GEOMETRY.blockHeight).toBe(480)
    expect(POLL_GEOMETRY.cardWidth).toBe(500)
    expect(POLL_GEOMETRY.cardInset).toBe(17)
    expect(POLL_GEOMETRY.cardWidth).toBe(POLL_GEOMETRY.blockWidth - POLL_GEOMETRY.cardInset * 2)
  })

  it('header 78 = 12 + 30 + 22 + 14', () => {
    expect(POLL_GEOMETRY.headerHeight).toBe(78)
    expect(POLL_GEOMETRY.headerHeight).toBe(
      POLL_GEOMETRY.headerPaddingTop + POLL_GEOMETRY.titleHeight
      + POLL_GEOMETRY.labelsHeight + POLL_GEOMETRY.headerPaddingBottom,
    )
  })

  it('footer 64 = 16 + 32 + 16', () => {
    expect(POLL_GEOMETRY.footerHeight).toBe(64)
    expect(POLL_GEOMETRY.footerHeight).toBe(
      POLL_GEOMETRY.footerPadding * 2 + POLL_GEOMETRY.footerButtonHeight,
    )
  })

  it('选项行 468×34 / 输入 430 / 操作位 32 / 行距 44 = 34 + 10', () => {
    expect(POLL_GEOMETRY.optionWidth).toBe(468)
    expect(POLL_GEOMETRY.optionHeight).toBe(34)
    expect(POLL_GEOMETRY.optionStep || POLL_HEIGHT.optionStep).toBe(44)
    expect(POLL_HEIGHT.optionStep).toBe(POLL_GEOMETRY.optionHeight + POLL_GEOMETRY.optionGap)
    // 430 = 468 − 32 − 6（6 是删除按钮的 margin-left）
    expect(POLL_GEOMETRY.optionInputWidth).toBe(430)
    expect(POLL_GEOMETRY.optionActionWidth).toBe(32)
  })

  it('结果条 450×4，左缩进 18 —— 450 = 468 − 18（右侧不留缩进）', () => {
    expect(POLL_GEOMETRY.progressWidth).toBe(450)
    expect(POLL_GEOMETRY.progressInset).toBe(18)
    expect(POLL_GEOMETRY.progressHeight).toBe(4)
    expect(POLL_GEOMETRY.progressWidth).toBe(POLL_GEOMETRY.optionWidth - POLL_GEOMETRY.progressInset)
  })

  it('开关 40×22 / 白球 18 / 偏移 +2 / 配置行 57', () => {
    expect(POLL_GEOMETRY.switchWidth).toBe(40)
    expect(POLL_GEOMETRY.switchHeight).toBe(22)
    expect(POLL_GEOMETRY.switchKnob).toBe(18)
    expect(POLL_GEOMETRY.switchKnobOffset).toBe(2)
    expect(POLL_GEOMETRY.configRowHeight).toBe(57)
  })

  it('分隔线 2px（实测近黑，不是浅灰）', () => {
    expect(POLL_GEOMETRY.dividerHeight).toBe(2)
  })
})

describe('块高（§23 ③：编辑态 480 + 44 × (n − 2) / 已发布 228 / 已投票 249）', () => {
  it('草稿态随选项数线性增长', () => {
    expect(blockHeight(defaultPoll())).toBe(POLL_HEIGHT.draftBase)
    const three = pollReducer(defaultPoll(), { type: 'addOption' })
    expect(three.options).toHaveLength(3)
    expect(blockHeight(three)).toBe(480 + 44)
    const four = pollReducer(three, { type: 'addOption' })
    expect(blockHeight(four)).toBe(480 + 44 * 2)
    // 十个选项：480 + 44×8 = 832
    let many = four
    for (let index = 0; index < 6; index += 1) many = pollReducer(many, { type: 'addOption' })
    expect(many.options).toHaveLength(10)
    expect(blockHeight(many)).toBe(832)
  })

  it('已发布未投票恒 228，与选项数无关', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    expect(published.published).toBe(true)
    expect(blockHeight(published)).toBe(POLL_HEIGHT.published)
    let many = published
    for (let index = 0; index < 3; index += 1) many = pollReducer(many, { type: 'addOption' })
    expect(blockHeight(many)).toBe(228)
  })

  it('投过票 249；已截止不改高（249 恒定）', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    const voted = pollReducer(published, { type: 'vote', ids: ['opt_1'] })
    expect(blockHeight(voted)).toBe(POLL_HEIGHT.voted)
    expect(POLL_HEIGHT.voted).toBe(249)
    const closed = pollReducer({ ...voted, deadline: new Date(NOW - 1000).toISOString() }, { type: 'title', value: 'x' })
    expect(pollStatus(closed, NOW)).toBe(POLL_STATUS.VOTED)
    expect(blockHeight(closed)).toBe(249)
  })
})

/* ------------------------------------------------------------------ *
 * ② 归一化 / 编解码
 * ------------------------------------------------------------------ */

describe('normalizePoll（§19.1 ⑥）', () => {
  it('空入参 → 结构完整的默认块（2 个空选项、未发布、无截止）', () => {
    const state = normalizePoll(null)
    expect(state.v).toBe(POLL_VERSION)
    expect(state.title).toBe('')
    expect(state.options).toEqual([{ id: 'opt_1', text: '' }, { id: 'opt_2', text: '' }])
    expect(state.multiple).toBe(false)
    expect(state.anonymous).toBe(false)
    expect(state.deadline).toBeNull()
    expect(state.published).toBe(false)
    expect(state.votes).toEqual({})
    expect(state.voted).toEqual([])
  })

  it('`key` 是派生值，归一化时剥掉（不落库）', () => {
    const state = normalizePoll({ options: [{ id: 'opt_1', text: 'a', key: 'A' }] })
    expect(state.options[0]).toEqual({ id: 'opt_1', text: 'a' })
    expect('key' in state.options[0]).toBe(false)
  })

  it('少于两项补齐到两项，且 id 不与已有冲突', () => {
    const state = normalizePoll({ options: [{ id: 'opt_2', text: '只有一项' }] })
    expect(state.options).toHaveLength(2)
    const ids = state.options.map((option) => option.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('选项数裁到 POLL_LIMITS.options', () => {
    const options = Array.from({ length: POLL_LIMITS.options + 5 }, (_, index) => ({ id: `opt_${index + 1}`, text: 'x' }))
    expect(normalizePoll({ options }).options).toHaveLength(POLL_LIMITS.options)
  })

  it('非法 id 重新生成、重复 id 加后缀', () => {
    const state = normalizePoll({ options: [{ id: '带空格 的 id', text: 'a' }, { id: 'dup', text: 'b' }, { id: 'dup', text: 'c' }] })
    expect(state.options[0].id).toBe('opt_1')
    expect(state.options[1].id).toBe('dup')
    expect(state.options[2].id).not.toBe('dup')
    expect(new Set(state.options.map((option) => option.id)).size).toBe(3)
  })

  it('票只留存在于选项里的 id，非正数 / 非数字丢弃', () => {
    const state = normalizePoll({
      options: [{ id: 'opt_1', text: 'a' }, { id: 'opt_2', text: 'b' }],
      votes: { opt_1: 3, opt_2: 0, opt_9: 7, ghost: -2 },
    })
    expect(state.votes).toEqual({ opt_1: 3 })
  })

  it('`voted` 去重、只留存在的 id', () => {
    const state = normalizePoll({
      options: [{ id: 'opt_1', text: 'a' }, { id: 'opt_2', text: 'b' }],
      voted: ['opt_1', 'opt_1', 'opt_9'],
    })
    expect(state.voted).toEqual(['opt_1'])
  })

  it('非法 deadline 归 null；布尔字段只认 true', () => {
    expect(normalizePoll({ deadline: '不是日期' }).deadline).toBeNull()
    expect(normalizePoll({ deadline: 12345 }).deadline).toBeNull()
    const iso = new Date(NOW).toISOString()
    expect(normalizePoll({ deadline: iso }).deadline).toBe(iso)
    expect(normalizePoll({ multiple: 'true', anonymous: 1 }).multiple).toBe(false)
    expect(normalizePoll({ multiple: 'true', anonymous: 1 }).anonymous).toBe(false)
  })

  it('标题 / 选项文本都过 cleanText（剔除控制字符、折单行、截断）', () => {
    const state = normalizePoll({
      title: '  第一行\n第二行\t第三行  ',
      options: [{ id: 'opt_1', text: 'a\u0000b' }, { id: 'opt_2', text: 'x'.repeat(200) }],
    })
    expect(state.title).toBe('第一行 第二行 第三行')
    expect(state.options[0].text).toBe('a b')
    expect(state.options[1].text).toHaveLength(POLL_LIMITS.optionLength)
  })
})

describe('readPoll / encodePoll', () => {
  it('encode → read 往返等价', () => {
    const state = pollReducer(filledDraft(), { type: 'toggle', key: 'anonymous' })
    const back = readPoll(encodePoll(state))
    expect(back).toEqual(normalizePoll(state))
  })

  it('任何一步不合法都返 null（调用方据此退回占位块）', () => {
    expect(readPoll('')).toBeNull()
    expect(readPoll(null)).toBeNull()
    expect(readPoll('不是 JSON')).toBeNull()
    expect(readPoll('[]')).toBeNull()
    expect(readPoll('"字符串"')).toBeNull()
    expect(readPoll('{"v":99}')).toBeNull()
    // 没有 `v` 的旧数据允许（按当前版本归一化）。
    expect(readPoll('{}')).toEqual(normalizePoll({}))
  })

  it('encode 产物不超 32 KB 上限', () => {
    const heavy = normalizePoll({
      title: 't'.repeat(POLL_LIMITS.titleLength),
      options: Array.from({ length: POLL_LIMITS.options }, (_, index) => ({
        id: `opt_${index + 1}`, text: 'x'.repeat(POLL_LIMITS.optionLength),
      })),
    })
    const text = encodePoll(heavy)
    expect(byteLength(text)).toBeLessThanOrEqual(POLL_LIMITS.bytes)
  })
})

/* ------------------------------------------------------------------ *
 * ③ 文本小工具
 * ------------------------------------------------------------------ */

describe('byteLength / optionLabel / cleanText', () => {
  it('UTF-8 字节数：ASCII 1 / 两字节 2 / 汉字 3 / emoji 4', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('é')).toBe(2)
    expect(byteLength('中')).toBe(3)
    expect(byteLength('😀')).toBe(4)
    expect(byteLength(null)).toBe(0)
  })

  it('序号 A…Z，超 26 项回落数字', () => {
    expect(optionLabel(0)).toBe('A')
    expect(optionLabel(25)).toBe('Z')
    expect(optionLabel(26)).toBe('27')
    expect(optionLabel(27)).toBe('28')
    expect(optionLabel(-1)).toBe('')
    expect(optionLabel('abc')).toBe('')
  })

  it('cleanText 按码点截断，不把 emoji 切成半个', () => {
    const text = cleanText('😀😀😀', 2)
    expect(text).toBe('😀😀')
    expect(Array.from(text)).toHaveLength(2)
    expect(cleanText('  a   b  ')).toBe('a b')
    expect(cleanText(undefined)).toBe('')
  })
})

/* ------------------------------------------------------------------ *
 * ④ 三态判定
 * ------------------------------------------------------------------ */

describe('pollStatus / canVote（已投优先于已截止）', () => {
  it('未发布 → draft；已发布 → open', () => {
    expect(pollStatus(defaultPoll(), NOW)).toBe(POLL_STATUS.DRAFT)
    const published = pollReducer(filledDraft(), { type: 'publish' })
    expect(pollStatus(published, NOW)).toBe(POLL_STATUS.OPEN)
    expect(canVote(published, NOW)).toBe(true)
  })

  it('过了截止 → closed，且不能投', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    const closed = { ...published, deadline: new Date(NOW - 1000).toISOString() }
    expect(pollStatus(closed, NOW)).toBe(POLL_STATUS.CLOSED)
    expect(canVote(closed, NOW)).toBe(false)
  })

  it('🔴 已投产优先：投过票的人再看已截止的投票仍是 voted（结果条不消失）', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    const voted = pollReducer(published, { type: 'vote', ids: ['opt_1'] })
    const closedAndVoted = { ...voted, deadline: new Date(NOW - 1000).toISOString() }
    expect(pollStatus(closedAndVoted, NOW)).toBe(POLL_STATUS.VOTED)
    expect(canVote(closedAndVoted, NOW)).toBe(false)
  })

  it('截止时间恰好等于 now 算已截止（<= 不是 <）', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    expect(pollStatus({ ...published, deadline: new Date(NOW).toISOString() }, NOW)).toBe(POLL_STATUS.CLOSED)
  })

  it('草稿永远不能投', () => {
    expect(canVote(defaultPoll(), NOW)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤ 本地状态机
 * ------------------------------------------------------------------ */

describe('pollReducer（§19.1 ⑥ 的全部 action）', () => {
  it('title / option 走 cleanText 后落值', () => {
    const titled = pollReducer(defaultPoll(), { type: 'title', value: ' 团建 \n 投票 ' })
    expect(titled.title).toBe('团建 投票')
    const withText = pollReducer(titled, { type: 'option', id: 'opt_1', value: ' 爬山 ' })
    expect(withText.options[0].text).toBe('爬山')
    // 不存在的 id 原样返回（不报错、不新建行）
    expect(pollReducer(withText, { type: 'option', id: 'opt_9', value: 'x' }).options).toHaveLength(2)
  })

  it('addOption 追加空项、id 不与已有冲突', () => {
    const next = pollReducer(defaultPoll(), { type: 'addOption' })
    expect(next.options).toHaveLength(3)
    expect(next.options[2]).toEqual({ id: 'opt_3', text: '' })
    expect(next.options[2].id).not.toBe(next.options[0].id)
  })

  it('addOption 到上限后不再增长', () => {
    let state = defaultPoll()
    state = { ...state, options: Array.from({ length: POLL_LIMITS.options }, (_, index) => ({ id: `opt_${index + 1}`, text: '' })) }
    const next = pollReducer(state, { type: 'addOption' })
    expect(next.options).toHaveLength(POLL_LIMITS.options)
  })

  it('removeOption 最少留两项，并清掉该选项的票与我的选择', () => {
    let state = filledDraft()
    state = pollReducer(state, { type: 'addOption' })
    state = pollReducer(state, { type: 'publish' })
    state = pollReducer(state, { type: 'vote', ids: ['opt_1'] })
    const three = { ...state, options: [...state.options], voted: ['opt_1'], votes: { opt_1: 1 } }
    expect(three.options).toHaveLength(3)
    const removed = pollReducer(three, { type: 'removeOption', id: 'opt_1' })
    expect(removed.options).toHaveLength(2)
    expect(removed.votes).toEqual({})
    expect(removed.voted).toEqual([])
    // 只剩两项时再删无效
    expect(pollReducer(removed, { type: 'removeOption', id: 'opt_2' }).options).toHaveLength(2)
  })

  it('toggle 三键：multiple / anonymous 取反，deadline 落「明天 18:00」再关掉', () => {
    const multiple = pollReducer(defaultPoll(), { type: 'toggle', key: 'multiple' })
    expect(multiple.multiple).toBe(true)
    expect(pollReducer(multiple, { type: 'toggle', key: 'multiple' }).multiple).toBe(false)

    const anonymous = pollReducer(defaultPoll(), { type: 'toggle', key: 'anonymous' })
    expect(anonymous.anonymous).toBe(true)

    const on = pollReducer(defaultPoll(), { type: 'toggle', key: 'deadline' }, NOW)
    expect(on.deadline).toBe(tomorrowDeadline(NOW))
    const off = pollReducer(on, { type: 'toggle', key: 'deadline' }, NOW)
    expect(off.deadline).toBeNull()

    // 未知 key 原样返回
    expect(pollReducer(defaultPoll(), { type: 'toggle', key: 'ghost' }).multiple).toBe(false)
  })

  it('publish 前置校验不通过时什么都不做', () => {
    expect(pollReducer(defaultPoll(), { type: 'publish' }).published).toBe(false)
    const noOption = { ...defaultPoll(), title: '有标题' }
    expect(pollReducer(noOption, { type: 'publish' }).published).toBe(false)
    const ok = pollReducer(filledDraft(), { type: 'publish' })
    expect(ok.published).toBe(true)
    // 已发布再发布幂等
    expect(pollReducer(ok, { type: 'publish' }).published).toBe(true)
  })

  it('vote 单选只取第一个、多选去重，票数累加', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    const single = pollReducer(published, { type: 'vote', ids: ['opt_1', 'opt_2'] })
    expect(single.voted).toEqual(['opt_1'])
    expect(single.votes).toEqual({ opt_1: 1 })

    const multi = pollReducer({ ...published, multiple: true }, { type: 'vote', ids: ['opt_1', 'opt_2', 'opt_1'] })
    expect(multi.voted).toEqual(['opt_1', 'opt_2'])
    expect(multi.votes).toEqual({ opt_1: 1, opt_2: 1 })
  })

  it('vote 的 id 全部非法 / 已过期 → 不动', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    expect(pollReducer(published, { type: 'vote', ids: ['ghost'] }).votes).toEqual({})
    const closed = { ...published, deadline: new Date(NOW - 1000).toISOString() }
    expect(pollReducer(closed, { type: 'vote', ids: ['opt_1'] }, NOW).votes).toEqual({})
    // 草稿不能投
    expect(pollReducer(filledDraft(), { type: 'vote', ids: ['opt_1'] }, NOW).votes).toEqual({})
  })

  it('未知 action / 非对象 action 原样返回（不抛）', () => {
    expect(pollReducer(defaultPoll(), { type: 'ghost' }).title).toBe('')
    expect(pollReducer(defaultPoll(), null).title).toBe('')
    expect(pollReducer(defaultPoll(), 'x').title).toBe('')
  })

  it('纯函数：不改入参', () => {
    const source = filledDraft()
    const snapshot = JSON.stringify(source)
    pollReducer(source, { type: 'title', value: '改过' })
    pollReducer(source, { type: 'addOption' })
    pollReducer(source, { type: 'publish' })
    expect(JSON.stringify(source)).toBe(snapshot)
  })
})

/* ------------------------------------------------------------------ *
 * ⑥ 计票 / 标签 / 文案
 * ------------------------------------------------------------------ */

describe('tally / formatPercent（§23 ⑥ 结果条）', () => {
  it('1:0 样本 —— 选中项 100%，未选中 0%', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    const voted = pollReducer(published, { type: 'vote', ids: ['opt_1'] })
    const { total, rows } = tally(voted)
    expect(total).toBe(1)
    expect(rows[0]).toMatchObject({ label: 'A', votes: 1, percent: 100, chosen: true })
    expect(rows[1]).toMatchObject({ label: 'B', votes: 0, percent: 0, chosen: false })
    // `width` 与 `percent` 同源（行内样式的百分比直接取它）
    expect(rows[0].width).toBe(100)
  })

  it('零票时全是 0%（不出现 NaN）', () => {
    const { total, rows } = tally(filledDraft())
    expect(total).toBe(0)
    expect(rows.every((row) => row.percent === 0 && row.width === 0)).toBe(true)
  })

  it('百分比一位小数，非法值回落 0.0%', () => {
    expect(formatPercent(100)).toBe('100.0%')
    expect(formatPercent(33.333)).toBe('33.3%')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(NaN)).toBe('0.0%')
  })
})

describe('headerLabels（§23：tag 顺序 = 单选/实名 → 票数 → 截止）', () => {
  it('草稿态三条：单选 / 实名 / 投票尚未发布（橙色）', () => {
    const labels = headerLabels(defaultPoll(), NOW)
    expect(labels.map((label) => label.key)).toEqual(['mode', 'identity', 'state'])
    expect(labels.map((label) => label.text)).toEqual(['单选', '实名', '投票尚未发布'])
    expect(labels[2].tone).toBe('warn')
  })

  it('🔴 已发布后「投票尚未发布」整枚消失；票数 tag 排在截止**之前**', () => {
    let state = pollReducer(filledDraft({ multiple: true, anonymous: true }), { type: 'publish' })
    state = { ...state, deadline: tomorrowDeadline(NOW) }
    const beforeVote = headerLabels(state, NOW)
    expect(beforeVote.map((label) => label.key)).toEqual(['mode', 'identity', 'deadline'])
    expect(beforeVote[0].text).toBe('多选')
    expect(beforeVote[1].text).toBe('匿名')

    // 第三参必须是注入的 NOW：`vote` 分支用 `canVote(state, now)` 判截止，
    // 不传就走真实时钟，而这里的 deadline 是相对 NOW 的「明天」—— 真实时钟上早过期了。
    const voted = pollReducer(state, { type: 'vote', ids: ['opt_1'] }, NOW)
    const afterVote = headerLabels(voted, NOW)
    expect(afterVote.map((label) => label.key)).toEqual(['mode', 'identity', 'total', 'deadline'])
    expect(afterVote[2].text).toBe('1')
  })

  it('截止后文案变「已截止」', () => {
    const published = pollReducer(filledDraft(), { type: 'publish' })
    const closed = { ...published, deadline: new Date(NOW - 1000).toISOString() }
    const deadline = headerLabels(closed, NOW).find((label) => label.key === 'deadline')
    expect(deadline.text).toBe('已截止')
  })
})

describe('deadlineLabel / tomorrowDeadline / publishHint', () => {
  it('相对日三段式：今天 / 明天 / 更远', () => {
    const today = new Date(NOW)
    today.setHours(18, 0, 0, 0)
    expect(deadlineLabel(today.toISOString(), NOW)).toBe('今天 18:00 截止')
    expect(deadlineLabel(tomorrowDeadline(NOW), NOW)).toBe('明天 18:00 截止')
    const far = new Date(2025, 6, 1, 9, 5, 0, 0)
    expect(deadlineLabel(far.toISOString(), NOW)).toBe('7月1日 09:05 截止')
    expect(deadlineLabel('不是日期', NOW)).toBe('')
  })

  it('tomorrowDeadline 落在次日 18:00:00.000', () => {
    const date = new Date(tomorrowDeadline(NOW))
    expect(date.getDate()).toBe(16)
    expect(date.getHours()).toBe(18)
    expect(date.getMinutes()).toBe(0)
    expect(date.getSeconds()).toBe(0)
    expect(date.getMilliseconds()).toBe(0)
  })

  it('publishHint：标题优先，其次选项内容', () => {
    expect(publishHint(defaultPoll())).toBe('请输入标题')
    expect(publishHint({ ...defaultPoll(), title: '有标题' })).toBe('请输入选项内容')
    expect(publishHint(filledDraft())).toBeNull()
    expect(publishReady(filledDraft())).toBe(true)
    expect(publishReady(defaultPoll())).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * ⑦ 块定义层：renderHTML 就是导出产物
 * ------------------------------------------------------------------ */

describe('块定义（renderHTML = 导出产物）', () => {
  it('命令行表中 poll 在位：团队协作组、+ 菜单「常用」、受 insert 开关管', () => {
    const def = COMMANDS.find((item) => item.id === 'poll')
    expect(def).toBeTruthy()
    expect(def.label).toBe('投票')
    expect(def.category).toBe('团队协作')
    expect(def.plus).not.toBe(false)
    expect(def.plusCategory).toBe('常用')
    expect(def.tier).toBe('required')
    expect(commandFeatureOf('poll')).toBe('insert')
    // 斜杠与 + 两条动线都要能看到
    expect(filterCommands('投票').some((item) => item.id === 'poll')).toBe(true)
    expect(filterCommands('', 'plus').some((item) => item.id === 'poll')).toBe(true)
    expect(filterCommands('toupiao').some((item) => item.id === 'poll')).toBe(true)
  })

  it('导出件是一张只读投票卡：有卡片 / 标签 / 选项，没有输入控件', () => {
    const editor = freshEditor({
      type: 'doc',
      content: [{ type: 'poll', attrs: { poll: encodePoll(pollReducer(filledDraft(), { type: 'publish' })) } }],
    })
    const html = editor.getHTML()
    expect(html).toContain('data-type="poll"')
    expect(html).toContain('data-block-type="poll"')
    expect(html).toContain('lark-doc-poll-card')
    expect(html).toContain('lark-doc-poll-header')
    expect(html).toContain('lark-doc-poll-options')
    expect(html).toContain('周五团建去哪儿')
    expect(html).toContain('立即投票')
    // 标签行：`filledDraft()` 是单选 + 实名，所以这两枚必须在导出件里
    // （「匿名」只在 anonymous 为真时出现，别拿实名样本去断言它）。
    expect(html).toContain('单选')
    expect(html).toContain('实名')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('lark-doc-poll-switch')
  })

  it('投过票的导出件带结果条，宽度是行内百分比', () => {
    const voted = pollReducer(pollReducer(filledDraft(), { type: 'publish' }), { type: 'vote', ids: ['opt_1'] })
    const editor = freshEditor({ type: 'doc', content: [{ type: 'poll', attrs: { poll: encodePoll(voted) } }] })
    const html = editor.getHTML()
    expect(html).toContain('lark-doc-poll-progress')
    // 序列化出来的 inline style 是 `width: 100.0000%;`（冒号后有空格），别照 CSS 手写的写法断言。
    expect(html).toContain('width: 100.0000%')
    expect(html).toContain('width: 0.0000%')
    expect(html).toContain('1 票')
    expect(html).toContain('100.0%')
    expect(html).toContain('is-chosen')
  })

  it('草稿的 footer 文案是「发布投票」', () => {
    const editor = freshEditor({ type: 'doc', content: [{ type: 'poll', attrs: { poll: encodePoll(filledDraft()) } }] })
    expect(editor.getHTML()).toContain('发布投票')
  })

  it('parseHTML 只认带合法 data-poll 的 div，其余退化成 unknown-block', () => {
    const editor = freshEditor('')
    const payload = encodePoll(filledDraft()).replace(/"/g, '&quot;')
    editor.commands.setContent(`<div data-type="poll" data-poll="${payload}"></div>`)
    expect(pollsIn(editor)).toHaveLength(1)
    expect(readPoll(pollsIn(editor)[0].attrs.poll).title).toBe('周五团建去哪儿')

    const bad = freshEditor('')
    bad.commands.setContent('<div data-type="poll" data-poll="不是 JSON"></div>')
    expect(pollsIn(bad)).toHaveLength(0)
  })

  it('数据缺失时画占位而不是空白（导出一块白比一句说明更难定位）', () => {
    const editor = freshEditor({ type: 'doc', content: [{ type: 'poll', attrs: {} }] })
    expect(editor.getHTML()).toContain('投票数据缺失')
  })
})

/* ------------------------------------------------------------------ *
 * ⑧ 命令：setPoll / updatePoll
 * ------------------------------------------------------------------ */

describe('setPoll / updatePoll', () => {
  it('setPoll 无参落默认空投票', () => {
    const editor = freshEditor('')
    expect(editor.commands.setPoll()).toBe(true)
    const [node] = pollsIn(editor)
    expect(node).toBeTruthy()
    const state = readPoll(node.attrs.poll)
    expect(state.title).toBe('')
    expect(state.options).toHaveLength(2)
    expect(node.attrs.blockId).toBeTruthy()
  })

  it('setPoll 带参落指定数据', () => {
    const editor = freshEditor('')
    expect(editor.commands.setPoll(filledDraft())).toBe(true)
    expect(readPoll(pollsIn(editor)[0].attrs.poll).title).toBe('周五团建去哪儿')
  })

  it('updatePoll 改写指定位置的数据', () => {
    const editor = freshEditor('')
    editor.commands.setPoll(filledDraft())
    expect(editor.commands.updatePoll({ pos: 0, poll: { ...filledDraft(), title: '改过' } })).toBe(true)
    expect(readPoll(pollsIn(editor)[0].attrs.poll).title).toBe('改过')
  })

  it('updatePoll 越界 / pos 非法 / 位置不是投票块 → false（不抛）', () => {
    const editor = freshEditor('')
    editor.commands.setPoll(filledDraft())
    expect(editor.commands.updatePoll({ pos: 99, poll: filledDraft() })).toBe(false)
    expect(editor.commands.updatePoll({ pos: -1, poll: filledDraft() })).toBe(false)
    expect(editor.commands.updatePoll({ pos: '0', poll: filledDraft() })).toBe(false)
    // 指向文档末尾（不是块起点）也要拒
    const tail = editor.state.doc.content.size
    expect(editor.commands.updatePoll({ pos: tail, poll: filledDraft() })).toBe(false)
  })

  it('blockId 落在 BLOCK_ID_TYPES 里（否则永远是 null）', () => {
    const editor = freshEditor('')
    editor.commands.setPoll(filledDraft())
    expect(typeof pollsIn(editor)[0].attrs.blockId).toBe('string')
  })
})

/* ------------------------------------------------------------------ *
 * ⑨ NodeView：编辑态交互
 * ------------------------------------------------------------------ */

describe('NodeView 编辑态（三态由数据决定，不由 DOM 决定）', () => {
  it('初始是草稿态：标题可输入、配置区可见、footer 写「发布投票」', () => {
    const { nodeView, dom } = mountPoll()
    expect(dom.getAttribute('data-poll-view')).toBe('editor')
    expect(dom.getAttribute('data-poll-status')).toBe(POLL_STATUS.DRAFT)
    expect(nodeView.titleInput().style.display).toBe('')
    expect(nodeView.submit().textContent).toBe('发布投票')
    expect(nodeView.rows()).toHaveLength(2)
  })

  it('输入标题 → 落回文档（唯一数据源是 attrs.poll）', () => {
    const { editor, nodeView } = mountPoll()
    typeInto(nodeView.titleInput(), '周末团建')
    expect(nodeView.poll().title).toBe('周末团建')
    expect(readPoll(pollsIn(editor)[0].attrs.poll).title).toBe('周末团建')
  })

  it('输入选项 → 落回文档；本地勾选被清掉', () => {
    const { editor, nodeView } = mountPoll({ poll: pollReducer(filledDraft(), { type: 'publish' }) })
    const row = nodeView.rows()[0]
    typeInto(row.input, '改内容')
    expect(nodeView.poll().options[0].text).toBe('改内容')
    expect(readPoll(pollsIn(editor)[0].attrs.poll).options[0].text).toBe('改内容')
  })

  it('草稿点提交：标题空 → 提示「请输入标题」且不发布', () => {
    const { nodeView } = mountPoll()
    click(nodeView.submit())
    expect(nodeView.hintText()).toBe('请输入标题')
    expect(nodeView.poll().published).toBe(false)
    expect(nodeView.status()).toBe(POLL_STATUS.DRAFT)
  })

  it('草稿点提交：只有标题没有选项内容 → 提示「请输入选项内容」', () => {
    const { nodeView } = mountPoll({ poll: { ...defaultPoll(), title: '有标题' } })
    click(nodeView.submit())
    expect(nodeView.hintText()).toBe('请输入选项内容')
    expect(nodeView.poll().published).toBe(false)
  })

  it('填好点提交 → 发布：配置区与分隔线收走、「投票尚未发布」消失', () => {
    const { nodeView, dom } = mountPoll({ poll: filledDraft() })
    click(nodeView.submit())
    expect(nodeView.poll().published).toBe(true)
    expect(nodeView.status()).toBe(POLL_STATUS.OPEN)
    expect(dom.getAttribute('data-poll-status')).toBe(POLL_STATUS.OPEN)
    expect(nodeView.submit().textContent).toBe('立即投票')

    const labelKeys = Array.from(dom.querySelectorAll('.lark-doc-poll-labels .lark-doc-poll-label'))
      .map((chip) => chip.getAttribute('data-label'))
    expect(labelKeys).not.toContain('state')

    const config = dom.querySelector('.lark-doc-poll-config')
    const line = dom.querySelector('.lark-doc-poll-line')
    expect(config.style.display).toBe('none')
    expect(line.style.display).toBe('none')
    // DOM 保留（只是不可见）—— 与 §23 的 `display:none` 口径一致
    expect(config.querySelectorAll('.lark-doc-poll-switch')).toHaveLength(3)
  })

  it('三开关：multiple / anonymous 直接切 attrs；发布后只有「定时截止」不 locked', () => {
    const { nodeView, dom } = mountPoll()
    const switches = nodeView.switches()
    click(switches.get('multiple').track)
    expect(nodeView.poll().multiple).toBe(true)
    expect(dom.getAttribute('data-poll-multiple')).toBe('true')
    click(switches.get('anonymous').track)
    expect(nodeView.poll().anonymous).toBe(true)
    click(switches.get('deadline').track)
    expect(nodeView.poll().deadline).toBeTruthy()

    // 发布后：匿名 / 多选两行打 is-disabled（§23 硬约束）
    const published = mountPoll({ poll: pollReducer(filledDraft(), { type: 'publish' }) })
    const rows = published.dom.querySelectorAll('.lark-doc-poll-config-row')
    expect(rows[0].classList.contains('is-disabled')).toBe(false)
    expect(rows[1].classList.contains('is-disabled')).toBe(true)
    expect(rows[2].classList.contains('is-disabled')).toBe(true)
    // 点了也没反应
    click(published.nodeView.switches().get('multiple').track)
    expect(published.nodeView.poll().multiple).toBe(false)
  })

  it('加选项 → 块数据多一项；两项时删除按钮不可见，三项起可见', () => {
    const { nodeView, dom } = mountPoll()
    const adder = dom.querySelector('.lark-doc-poll-adder')
    expect(adder.textContent).toBe('+ 添加选项')
    click(adder)
    expect(nodeView.poll().options).toHaveLength(3)
    expect(nodeView.rows()).toHaveLength(3)
    const removes = nodeView.rows().map((row) => row.remove)
    expect(removes.every((button) => button.style.display === '')).toBe(true)

    click(removes[0])
    expect(nodeView.poll().options).toHaveLength(2)
    expect(nodeView.rows()).toHaveLength(2)
    expect(nodeView.rows().every((row) => row.remove.style.display === 'none')).toBe(true)
  })

  it('input 上的 stopEvent 才拦，空白处点击留给 PM 选块', () => {
    const { nodeView, dom } = mountPoll()
    expect(nodeView.stopEvent({ target: nodeView.titleInput() })).toBe(true)
    expect(nodeView.stopEvent({ target: nodeView.submit() })).toBe(true)
    expect(nodeView.stopEvent({ target: nodeView.rows()[0].input })).toBe(true)
    expect(nodeView.stopEvent({ target: dom })).toBe(false)
    expect(nodeView.stopEvent({ target: dom.querySelector('.lark-doc-poll-card') })).toBe(false)
    expect(nodeView.ignoreMutation()).toBe(true)
  })

  it('selectNode / deselectNode 切 is-selected', () => {
    const { nodeView, dom } = mountPoll()
    nodeView.selectNode()
    expect(dom.classList.contains('is-selected')).toBe(true)
    nodeView.deselectNode()
    expect(dom.classList.contains('is-selected')).toBe(false)
  })

  it('destroy 之后不再写文档', () => {
    const { nodeView } = mountPoll({ poll: filledDraft() })
    nodeView.destroy()
    expect(nodeView.apply({ type: 'title', value: '晚了' })).toBe(false)
  })
})

describe('NodeView 已发布态：投票与结果条', () => {
  const published = () => pollReducer(filledDraft(), { type: 'publish' })

  it('点行切换勾选，再点同一行取消（单选）', () => {
    const { nodeView } = mountPoll({ poll: published() })
    const row = nodeView.rows()[0]
    click(row.root)
    expect(nodeView.picked()).toEqual(['opt_1'])
    click(row.root)
    expect(nodeView.picked()).toEqual([])
  })

  it('单选：勾第二行会顶掉第一行', () => {
    const { nodeView } = mountPoll({ poll: published() })
    click(nodeView.rows()[0].root)
    click(nodeView.rows()[1].root)
    expect(nodeView.picked()).toEqual(['opt_2'])
  })

  it('多选：可以同时勾两行', () => {
    const { nodeView } = mountPoll({ poll: { ...published(), multiple: true } })
    click(nodeView.rows()[0].root)
    click(nodeView.rows()[1].root)
    expect(nodeView.picked()).toEqual(['opt_1', 'opt_2'])
  })

  it('没勾选就点「立即投票」→ 提示「请选择选项」', () => {
    const { nodeView } = mountPoll({ poll: published() })
    click(nodeView.submit())
    expect(nodeView.hintText()).toBe('请选择选项')
    expect(nodeView.poll().voted).toEqual([])
  })

  it('投票后：footer 整块消失、结果条出现、票数与百分比就位', () => {
    const { nodeView, dom } = mountPoll({ poll: published() })
    click(nodeView.rows()[0].root)
    click(nodeView.submit())

    expect(nodeView.poll().voted).toEqual(['opt_1'])
    expect(nodeView.poll().votes).toEqual({ opt_1: 1 })
    expect(nodeView.status()).toBe(POLL_STATUS.VOTED)
    expect(dom.querySelector('.lark-doc-poll-footer').style.display).toBe('none')

    const rows = nodeView.rows()
    expect(rows[0].result.style.display).toBe('')
    expect(rows[0].count.textContent).toBe('1 票')
    expect(rows[0].percent.textContent).toBe('100.0%')
    expect(rows[0].bar.style.width).toBe('100.0000%')
    expect(rows[1].count.textContent).toBe('0 票')
    expect(rows[1].percent.textContent).toBe('0.0%')
    expect(rows[1].bar.style.width).toBe('0.0000%')
    expect(rows[0].root.classList.contains('is-chosen')).toBe(true)
    expect(rows[0].choice.classList.contains('is-checked')).toBe(true)
  })

  it('投票后 `onVote` 收到 blockId 与选项 id', () => {
    const calls = []
    const { nodeView } = mountPoll({ poll: published() }, { onPollVote: (payload) => calls.push(payload) })
    click(nodeView.rows()[1].root)
    click(nodeView.submit())
    expect(calls).toHaveLength(1)
    expect(calls[0].ids).toEqual(['opt_2'])
    expect(typeof calls[0].blockId).toBe('string')
    expect(calls[0].poll.voted).toEqual(['opt_2'])
  })

  it('已投票后再点选项行不再切换（结论已定）', () => {
    const voted = pollReducer(published(), { type: 'vote', ids: ['opt_1'] })
    const { nodeView } = mountPoll({ poll: voted })
    click(nodeView.rows()[1].root)
    expect(nodeView.picked()).toEqual([])
  })

  it('已截止：点提交提示「投票已截止」，不能投', () => {
    const closed = { ...published(), deadline: new Date(Date.now() - 60000).toISOString() }
    const { nodeView } = mountPoll({ poll: closed })
    expect(nodeView.status()).toBe(POLL_STATUS.CLOSED)
    click(nodeView.rows()[0].root)
    expect(nodeView.picked()).toEqual([])
    click(nodeView.submit())
    expect(nodeView.hintText()).toBe('投票已截止')
    expect(nodeView.poll().voted).toEqual([])
  })

  it('草稿态点选项行只是把光标留输入框，不切勾选', () => {
    const { nodeView } = mountPoll({ poll: filledDraft() })
    click(nodeView.rows()[0].root)
    expect(nodeView.picked()).toEqual([])
  })

  it('发布后选项输入变只读、添加按钮藏起来', () => {
    const { nodeView, dom } = mountPoll({ poll: published() })
    expect(nodeView.rows().every((row) => row.input.readOnly)).toBe(true)
    expect(dom.querySelector('.lark-doc-poll-adder').style.display).toBe('none')
  })
})

describe('NodeView 与宿主文档同步', () => {
  it('update() 只比对 poll / blockId：没动就跳过重绘', () => {
    const { editor, nodeView } = mountPoll({ poll: filledDraft() })
    const same = editor.state.doc.firstChild
    expect(nodeView.update(same)).toBe(true)
    expect(nodeView.update({ type: { name: 'paragraph' }, attrs: {} })).toBe(false)
  })

  it('宿主从外部改数据后，DOM 跟着刷新', () => {
    const { editor, nodeView, dom } = mountPoll({ poll: filledDraft() })
    editor.commands.updatePoll({ pos: 0, poll: { ...filledDraft(), title: '外部改的', multiple: true } })
    expect(nodeView.poll().title).toBe('外部改的')
    expect(dom.getAttribute('data-poll-multiple')).toBe('true')
    expect(nodeView.titleInput().value).toBe('外部改的')
  })

  it('header 标签行点击只在宿主接了 onMenu 时才回调', () => {
    const calls = []
    const withMenu = mountPoll({ poll: filledDraft() }, { onPollMenu: (payload) => calls.push(payload) })
    click(withMenu.dom.querySelector('.lark-doc-poll-labels'))
    expect(calls).toHaveLength(1)
    expect(typeof calls[0].blockId).toBe('string')

    const without = mountPoll({ poll: filledDraft() })
    expect(() => click(without.dom.querySelector('.lark-doc-poll-labels'))).not.toThrow()
  })
})
