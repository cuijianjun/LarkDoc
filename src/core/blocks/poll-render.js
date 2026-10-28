/**
 * 投票块 `poll` 的纯函数层（P5-03）—— requirements/02 §23（DOM / 几何 / 时序）、§19.1 ⑥（数据模型）。
 *
 * 分工同 `./sheet-render.js`：不 import tiptap、不碰 DOM、不读主题，只做「数据归一 + 几何真值 +
 * 本地状态机」。块定义在 `./poll.js`，交互在 `../nodeviews/poll.js`，两边都从这里取数。
 *
 * 🔴 V1 范围（已拍板，别顺手扩张）：不做日期选择器日历（「定时截止」只置成「明天 18:00」）；
 * 不做 header「更多」菜单三态；不发任何真实请求（票数由本地状态机维护，接 provider 时整体替换）。
 *
 * 数据形状照 §19.1 ⑥，其中 `key`（A/B/C…）是**纯展示派生值、不落库**。唯一例外是
 * `votes` / `voted`：规格 payload 没有它们（真实票数由服务端给），但 V1 要跑通「发布 → 投票 →
 * 结果条」这条本地闭环必须自己记账；接真 provider 时由服务端返回值覆盖，不参与上报。
 */

export const POLL_VERSION = 1

/** 四种态。`closed` 只改文案与可投性，**不改块高**（§23 实测 249 恒定）。 */
export const POLL_STATUS = {
  DRAFT: 'draft',
  OPEN: 'open',
  VOTED: 'voted',
  CLOSED: 'closed',
}

/** 上限。`options` 规格未给实测值，V1 取 50 —— 必须 > 26，否则 `optionLabel` 的「超 26 项回落数字」分支永远走不到。 */
export const POLL_LIMITS = {
  options: 50,
  titleLength: 100,
  optionLength: 100,
  bytes: 32 * 1024,
}

/**
 * 几何真值，全部来自 §23 的 batch 实测（单位 px）。
 *
 * 只放**会被断言或参与计算**的数：写样式的数值在 CSS 里各写一份，两边同源于
 * 这里的话反而要 JS 动态注入行内样式（sheet 不需要，poll 也不需要）。
 */
export const POLL_GEOMETRY = {
  /** 块 534×480；卡片 500 宽、左右各内缩 17（`500 = 534 − 34`）、顶边 +1（`604 − 603`）。 */
  blockWidth: 534, blockHeight: 480, cardWidth: 500, cardInset: 17,
  /** header 78 = 上 12 + 标题行 30 + 标签行 22 + 下 14。 */
  headerHeight: 78, headerPaddingTop: 12, headerPaddingX: 12, headerPaddingBottom: 14,
  titleHeight: 30, titleWidth: 417, labelsHeight: 22,
  labelHeight: 16, labelRadius: 4, labelFontSize: 10,
  /** content 上 / 左内边距 16；选项行 468×34、行距 44 = 34 + 10（加一项块高 +44）。 */
  contentPaddingTop: 16, contentPaddingX: 16,
  optionWidth: 468, optionHeight: 34, optionGap: 10, optionInputWidth: 430, optionActionWidth: 32,
  adderHeight: 26, dividerHeight: 2,
  /** 配置区 468×170，行高两档 44 / 57；开关轨道 40×22、白球 18、偏移 +2。 */
  configHeight: 170, configRowHeight: 57,
  switchWidth: 40, switchHeight: 22, switchKnob: 18, switchKnobOffset: 2,
  /** footer 64 = 16 + 32 + 16；结果条 450 宽、左缩进 18、右不留缩进（`638 + 450 = 620 + 468`）、高 4。 */
  footerHeight: 64, footerPadding: 16, footerButtonHeight: 32, resultRowHeight: 34,
  progressWidth: 450, progressInset: 18, progressHeight: 4,
}

/** 块高：编辑态随选项数线性增长；发布后恒 228；投票后 249。 */
export const POLL_HEIGHT = {
  draftBase: 480,
  optionStep: 44,
  published: 228,
  voted: 249,
}

/** UTF-8 字节数。自己数而不是 `TextEncoder`：Node 14 与 jsdom 都不保证有全局。 */
export function byteLength(text) {
  let bytes = 0
  for (const char of String(text || '')) {
    const code = char.codePointAt(0)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code < 0x10000) bytes += 3
    else bytes += 4
  }
  return bytes
}

/** 选项序号：A…Z，超过 26 项回落数字（§19.1 ⑥ 的派生口径）。 */
export function optionLabel(index) {
  const value = Number(index)
  if (!Number.isFinite(value) || value < 0) return ''
  return value < 26 ? String.fromCharCode(65 + value) : String(Math.floor(value) + 1)
}

/**
 * 文本清洗：逐码点剔掉控制字符（含换行）、折成单行、按字符数截断。
 *
 * 用逐码点而不是正则，是为了绕开 eslint 的 `no-control-regex`；顺带正确处理
 * 代理对（emoji 被 `slice` 切半会变成替换符）。
 */
export function cleanText(value, limit) {
  if (value === null || value === undefined) return ''
  const text = Array.from(String(value))
    .map((char) => {
      const code = char.codePointAt(0)
      return code < 0x20 || code === 0x7f ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const max = Number.isFinite(limit) ? limit : POLL_LIMITS.optionLength
  return Array.from(text).slice(0, max).join('')
}

function createOption(index) {
  return { id: `opt_${index + 1}`, text: '' }
}

/** 默认块：标题空 + 两个空选项（§23：插入即落块，无配置面板）。 */
export function defaultPoll() {
  return {
    v: POLL_VERSION,
    title: '',
    options: [createOption(0), createOption(1)],
    multiple: false,
    anonymous: false,
    deadline: null,
    published: false,
    votes: {},
    voted: [],
  }
}

/**
 * 归一化：补齐缺省、裁掉超限、丢掉指向不存在选项的票、**剥掉 `key`**。
 *
 * 永远返回一个结构完整的对象 —— 上层不用再写 `options || []` 这类兜底，
 * 渲染层也就能假定「有 2 个以上选项」。
 */
export function normalizePoll(input) {
  const source = input && typeof input === 'object' ? input : {}
  const title = cleanText(source.title, POLL_LIMITS.titleLength)

  const options = []
  const seen = new Set()
  const rawOptions = Array.isArray(source.options) ? source.options : []
  rawOptions.slice(0, POLL_LIMITS.options).forEach((option, index) => {
    const raw = option && typeof option === 'object' ? option : { text: option }
    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.id) ? raw.id : `opt_${index + 1}`
    while (seen.has(id)) id = `${id}_${index + 1}`
    seen.add(id)
    options.push({ id, text: cleanText(raw.text, POLL_LIMITS.optionLength) })
  })
  while (options.length < 2) {
    let id = `opt_${options.length + 1}`
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    options.push({ id, text: '' })
  }

  const votes = {}
  const sourceVotes = source.votes && typeof source.votes === 'object' ? source.votes : {}
  for (const option of options) {
    const count = Number(sourceVotes[option.id])
    if (Number.isFinite(count) && count > 0) votes[option.id] = Math.floor(count)
  }

  const voted = []
  const sourceVoted = Array.isArray(source.voted) ? source.voted : []
  for (const option of options) {
    if (sourceVoted.includes(option.id) && !voted.includes(option.id)) voted.push(option.id)
  }

  const deadline = typeof source.deadline === 'string' && !Number.isNaN(Date.parse(source.deadline))
    ? source.deadline
    : null

  return {
    v: POLL_VERSION,
    title,
    options,
    multiple: source.multiple === true,
    anonymous: source.anonymous === true,
    deadline,
    published: source.published === true,
    votes,
    voted,
  }
}

/** 解析序列化后的字符串；任何一步不合法返 `null`（调用方据此退回占位块）。 */
export function readPoll(raw) {
  if (typeof raw !== 'string' || !raw) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch (_) { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (parsed.v !== undefined && parsed.v !== POLL_VERSION) return null
  return normalizePoll(parsed)
}

/** 序列化：超 32 KB 直接抛错，由命令层的 try 转成 `return false`。 */
export function encodePoll(input) {
  const parsed = normalizePoll(input)
  const text = JSON.stringify(parsed)
  if (byteLength(text) > POLL_LIMITS.bytes) throw new Error('poll payload exceeds limit')
  return text
}

function nextOptionId(state) {
  const used = new Set(state.options.map((option) => option.id))
  let index = state.options.length + 1
  while (used.has(`opt_${index}`)) index += 1
  return `opt_${index}`
}

/**
 * 当前态。`deadline` 用注入的 `now` 判，方便单测钉死时间（默认取真实时钟）。
 *
 * 顺序不能换：**已投优先于已截止** —— 投过票的人再打开已截止的投票，看到的
 * 仍是结果条（§23：截止只换 tag 文案与可投性，结果条与块高都不动）。
 */
export function pollStatus(poll, now) {
  const state = normalizePoll(poll)
  if (!state.published) return POLL_STATUS.DRAFT
  if (state.voted.length) return POLL_STATUS.VOTED
  const clock = Number.isFinite(now) ? now : Date.now()
  if (state.deadline && Date.parse(state.deadline) <= clock) return POLL_STATUS.CLOSED
  return POLL_STATUS.OPEN
}

/** 能不能投：已发布 + 还没投过 + 没过截止。匿名/多选都不影响这条判定。 */
export function canVote(poll, now) {
  return pollStatus(poll, now) === POLL_STATUS.OPEN
}

/** 块高（px）。三档之外不再细分：截止不改高。 */
export function blockHeight(poll) {
  const state = normalizePoll(poll)
  if (!state.published) {
    return POLL_HEIGHT.draftBase + POLL_HEIGHT.optionStep * (state.options.length - 2)
  }
  return state.voted.length ? POLL_HEIGHT.voted : POLL_HEIGHT.published
}

/**
 * 计票 + 百分比。
 *
 * 🔴 进度条色是 `#336DF4`（与复选框勾选色同源），**不是**主色 —— 别顺手统一。
 * 宽度按真实票数占比算：实测样本是 1:0，两种算法都得 100% / 0%，所以用比例制；
 * 多选项下的表现规格未实测，比例制是最合理的推导（注释在此，别当成实测值）。
 */
export function tally(poll) {
  const state = normalizePoll(poll)
  const rows = state.options.map((option, index) => ({
    id: option.id,
    text: option.text,
    label: optionLabel(index),
    votes: state.votes[option.id] || 0,
    chosen: state.voted.includes(option.id),
  }))
  const total = rows.reduce((sum, row) => sum + row.votes, 0)
  const counted = rows.map((row) => {
    const percent = total ? (row.votes / total) * 100 : 0
    return { ...row, percent, width: percent }
  })
  return { total, rows: counted }
}

/** 百分比文案：一位小数（实测是 `100.0%` / `0.0%` 这种带一位的写法）。 */
export function formatPercent(value) {
  const num = Number(value)
  return `${(Number.isFinite(num) ? num : 0).toFixed(1)}%`
}

/**
 * header 标签文案与配色键。
 *
 * 三开关联动只换文案、**不改块高**（§23 实测 78 恒定）：
 *   - 多选开关 → 单选 / 多选（前两枚是强调色软底）
 *   - 匿名开关 → 实名 / 匿名
 *   - 定时截止 → 追加一枚截止 chip（开）或去掉（关）
 *   - 未发布 → 追加「投票尚未发布」（橙色，唯一带 warn 色调的）
 * 数量：未发布 3 枚、已发布 2 枚、已截止 3 枚（截止 chip 换成「已截止」）。
 */
export function headerLabels(poll, now) {
  const state = normalizePoll(poll)
  const labels = [
    { key: 'mode', text: state.multiple ? '多选' : '单选', tone: 'accent' },
    { key: 'identity', text: state.anonymous ? '匿名' : '实名', tone: 'accent' },
  ]
  if (!state.published) {
    labels.push({ key: 'state', text: '投票尚未发布', tone: 'warn' })
    return labels
  }
  // 票数 tag 排在「截止」**之前**（§23 实测：新增的「1」插在匿名之后、截止之前）。
  const { total } = tally(state)
  if (total > 0) labels.push({ key: 'total', text: String(total), tone: 'accent' })
  if (state.deadline) {
    const closed = pollStatus(state, now) === POLL_STATUS.CLOSED
    labels.push({ key: 'deadline', text: closed ? '已截止' : deadlineLabel(state.deadline), tone: 'accent' })
  }
  return labels
}

/**
 * 截止 chip 文案：`明天 18:00 截止` —— 三段式（相对日 + 时间 + 截止），实测 81×16。
 *
 * V1 的 deadline 只可能来自「定时截止」开关（明天 18:00），所以这里只处理
 * 今天 / 明天 / 更远三种相对日，不做真正的日历格式化。
 */
export function deadlineLabel(deadline, now) {
  const time = new Date(deadline)
  if (Number.isNaN(time.getTime())) return ''
  const clock = Number.isFinite(now) ? now : Date.now()
  const today = new Date(clock)
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOfDay(time) - startOfDay(today)) / 86400000)
  const hh = String(time.getHours()).padStart(2, '0')
  const mm = String(time.getMinutes()).padStart(2, '0')
  const day = days === 0 ? '今天' : days === 1 ? '明天' : `${time.getMonth() + 1}月${time.getDate()}日`
  return `${day} ${hh}:${mm} 截止`
}

/** 「明天 18:00」的 ISO 值；开关打开时用它填 deadline。 */
export function tomorrowDeadline(now) {
  const clock = new Date(Number.isFinite(now) ? now : Date.now())
  const target = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + 1, 18, 0, 0, 0)
  return target.toISOString()
}

/**
 * 发布前置校验：标题必填、至少一项选项有内容。
 *
 * 只填标题时按钮视觉已经是主色可点（实测如此），所以**视觉态与可发布态是两个
 * 谓词** —— 见 `publishReady`；点下去只提示、不发布。
 */
export function publishHint(poll) {
  const state = normalizePoll(poll)
  if (!state.title) return '请输入标题'
  if (!state.options.some((option) => option.text)) return '请输入选项内容'
  return null
}

export function publishReady(poll) {
  return publishHint(poll) === null
}

/**
 * 本地状态机。纯函数：不改入参，永远返回新对象。
 *
 * action 一览：
 *   { type: 'title', value }
 *   { type: 'option', id, value }
 *   { type: 'addOption' } / { type: 'removeOption', id }
 *   { type: 'toggle', key: 'multiple' | 'anonymous' | 'deadline' }
 *   { type: 'publish' }
 *   { type: 'vote', ids: string[] }
 */
export function pollReducer(poll, action, now) {
  const state = normalizePoll(poll)
  const act = action && typeof action === 'object' ? action : {}
  switch (act.type) {
    case 'title':
      return { ...state, title: cleanText(act.value, POLL_LIMITS.titleLength) }
    case 'option':
      return {
        ...state,
        options: state.options.map((option) => (option.id === act.id
          ? { ...option, text: cleanText(act.value, POLL_LIMITS.optionLength) }
          : option)),
      }
    case 'addOption':
      if (state.options.length >= POLL_LIMITS.options) return state
      return { ...state, options: [...state.options, { id: nextOptionId(state), text: '' }] }
    case 'removeOption': {
      // 最少保留两项：一项的投票没有意义，也让「加选项」有确定的起点。
      if (state.options.length <= 2) return state
      const options = state.options.filter((option) => option.id !== act.id)
      if (options.length === state.options.length) return state
      const votes = { ...state.votes }
      delete votes[act.id]
      return { ...state, options, votes, voted: state.voted.filter((id) => id !== act.id) }
    }
    case 'toggle':
      if (act.key === 'multiple') return { ...state, multiple: !state.multiple }
      if (act.key === 'anonymous') return { ...state, anonymous: !state.anonymous }
      if (act.key === 'deadline') {
        return { ...state, deadline: state.deadline ? null : tomorrowDeadline(now) }
      }
      return state
    case 'publish':
      if (state.published || !publishReady(state)) return state
      return { ...state, published: true }
    case 'vote': {
      if (!canVote(state, now)) return state
      const ids = (Array.isArray(act.ids) ? act.ids : [act.ids])
        .filter((id) => typeof id === 'string' && state.options.some((option) => option.id === id))
      const picked = state.multiple ? [...new Set(ids)] : ids.slice(0, 1)
      if (!picked.length) return state
      const votes = { ...state.votes }
      for (const id of picked) votes[id] = (votes[id] || 0) + 1
      return { ...state, votes, voted: picked }
    }
    default:
      return state
  }
}
