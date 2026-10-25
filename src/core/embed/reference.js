/**
 * 引用型卡片（P3-08）—— `sub_page_list` / `source_synced` / `reference_synced` 的骨架。
 *
 * **三个块共用一张卡，不是三个节点**：它们的 schema、序列化、导出、动作冒泡行为
 * 完全一致，差别只有「标题文案 + 有没有子页面计数 + 换绑时填什么」。造三个节点会让
 * 每个下游（schema / 导出 / 粘贴 / 块菜单 / 迁移）各写三遍 `if (kind === ...)`，
 * 而 09 §3.4 反对「一个节点带 kind」的理由是「schema/序列化/导出行为都不同」——
 * 这里三者同形，正是 kind 属性该用的场景（同 `callout` 的 `type`）。
 *
 * 所以引用描述落在 `cardEmbed` 的卡片上：`providerId` = 块类型名，`resourceId` =
 * 被引用的对象，`reference` = 引用状态。`reference` 是 `core/embed/card.js`
 * normalizeCard 唯一额外保留的键（见该文件的注释），因为八字段的卡形状装不下状态机。
 *
 * **为什么状态要落库、不能现算**：宿主拿不到「源还在不在」。`stale` 是宿主同步时
 * 发现源被删/无权访问后**写回来**的事实，编辑器只负责渲染。想靠 `resourceId` 非空
 * 就判「还有效」，等于永远显示不出来「引用失效」——那正是 P3-08 的验收项。
 *
 * 状态机三态，没有第四态（多一态就要多一条 UI 分支，而三态已经覆盖全部现实）：
 *
 * | 状态 | 含义 | 卡面 | 动作 |
 * | --- | --- | --- | --- |
 * | `bound` | 引用有效 | 正常 | 打开（子页面列表加「新建」） |
 * | `stale` | 引用失效（源删了 / 无权 / 同步中断） | **置灰** + 原因 | 重新绑定 |
 * | `unbound` | 从没绑过（空态插入） | 置灰 + 空态文案 | 重新绑定 |
 *
 * 这张表就是验收项「引用失效 → 置灰卡 + 可重新绑定」的全部实现依据：
 * 置灰由 `referenceState` 驱动（`blocks/card-embed.js` 写 `data-reference-state`，
 * CSS 按它上色），重新绑定是 `REFERENCE_COMMAND.REBIND` 一条命令动作。
 */

/** 三种引用块。值即飞书块类型名，也是卡片 `providerId` —— 一份清单，别在别处再拼。 */
export const REFERENCE_KINDS = Object.freeze(['sub_page_list', 'source_synced', 'reference_synced'])

/** 三态。字符串落库，不能改值（改了等于让老文档的引用全部变「未绑定」）。 */
export const REFERENCE_STATE = Object.freeze({
  BOUND: 'bound',
  STALE: 'stale',
  UNBOUND: 'unbound',
})

const STATES = [REFERENCE_STATE.BOUND, REFERENCE_STATE.STALE, REFERENCE_STATE.UNBOUND]

/**
 * 引用卡的动作命令 id。`kind: 'command'` 而不是 `open`：目标是文档内对象（resourceId），
 * 没有可跳转的 URL —— 硬造一个 href 只会让宿主去猜路由。
 */
export const REFERENCE_COMMAND = Object.freeze({
  OPEN: 'reference.open',
  REBIND: 'reference.rebind',
  CREATE: 'reference.create',
})

const LIMITS = Object.freeze({
  resourceId: 128,
  sourceTitle: 120,
  reason: 200,
  count: 9999,
})

/**
 * 每种引用的文案。**全部集中在这里**：散到三处渲染分支里，改一个词要改三遍，
 * 而且必然漂移（历史上标题菜单就分叉过三轮）。
 */
const KIND_SPEC = Object.freeze({
  sub_page_list: {
    title: '子页面列表',
    empty: '目录下暂无子页面',
    open: '打开目录',
    rebind: '重新绑定目录',
    create: '新建子页面',
    stale: '引用的目录已不存在，或当前账号无权访问',
  },
  source_synced: {
    title: '同步块',
    empty: '同步源内容尚未加载',
    open: '打开源文档',
    rebind: '重新指定同步源',
    create: '',
    stale: '同步源已被删除，或当前账号无权访问',
  },
  reference_synced: {
    title: '同步块副本',
    empty: '副本内容随源块更新',
    open: '打开源块',
    rebind: '重新绑定同步源',
    create: '',
    stale: '源同步块已不可用，副本停止更新',
  },
})

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 文本字段：去首尾空白 + 按**字符**（不是码元）截断，避免劈开 emoji 的代理对。 */
function text(value, limit) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.length > limit ? Array.from(trimmed).slice(0, limit).join('') : trimmed
}

export function isReferenceKind(kind) {
  return REFERENCE_KINDS.indexOf(kind) !== -1
}

/** 块类型名 → 中文名（宿主侧菜单 / 提示文案用）。未知 kind 返回空串，不抛错。 */
export function referenceKindLabel(kind) {
  return isReferenceKind(kind) ? KIND_SPEC[kind].title : ''
}

/**
 * 读路径：从卡片里解出引用状态。**永不影响卡片本身、永不抛错**。
 *
 * 非引用卡（providerId 不在三种之内）返回 null —— 调用方据此判断「这不是引用卡」，
 * 而不是去猜一个默认状态。
 *
 * 状态兜底顺序：显式 `state` → 有 `resourceId` 算 `bound` → 否则 `unbound`。
 * 兜底存在的意义是兼容「别人写的、没有 reference 字段的」老数据，别把它们的
 * 引用卡一律画成置灰。
 */
export function readReference(card) {
  if (!isPlain(card)) return null
  const kind = card.providerId
  if (!isReferenceKind(kind)) return null
  const raw = isPlain(card.reference) ? card.reference : {}
  const source = isPlain(raw.source) ? raw.source : {}
  const target = text(card.resourceId, LIMITS.resourceId)
  const explicit = STATES.indexOf(raw.state) >= 0 ? raw.state : null
  const count = Number.isInteger(raw.count) && raw.count >= 0 ? Math.min(raw.count, LIMITS.count) : null
  return {
    kind,
    state: explicit || (target ? REFERENCE_STATE.BOUND : REFERENCE_STATE.UNBOUND),
    reason: text(raw.reason, LIMITS.reason),
    count,
    source: {
      resourceId: text(source.resourceId, LIMITS.resourceId),
      title: text(source.title, LIMITS.sourceTitle),
    },
  }
}

/**
 * 写路径：收敛成落库形状（`state` 永远显式，读的时候不必再兜底）。
 *
 * 由 `normalizeCard` 在 providerId 是引用类型时调用；非引用卡不走这里，
 * 所以卡片的 `reference` 键只会在引用卡上出现。
 */
export function toStoredReference(kind, resourceId, input) {
  const parsed = readReference({ providerId: kind, resourceId, reference: input })
  return {
    state: parsed.state,
    reason: parsed.reason,
    count: parsed.count,
    source: parsed.source,
  }
}

/**
 * 引用描述 → 卡面三件套（title / desc / fields）+ 动作表。
 *
 * 写路径与状态流转**共用这一个函数**：`buildReferenceCard` 和 `withReference` 都从这里
 * 拿展示结果。分两份写的话，「换绑之后标题还是旧的」这类问题一定会出现——
 * 因为换绑改的是 `resourceId`，而标题是上一次描述的产物。
 */
export function describeReference(kind, resourceId, reference) {
  const spec = KIND_SPEC[kind]
  const state = reference.state
  const target = text(resourceId, LIMITS.resourceId)
  const sourceTitle = reference.source.title

  const fields = []
  if (sourceTitle) fields.push({ label: '来源', value: sourceTitle })
  if (kind === 'sub_page_list' && reference.count !== null) {
    fields.push({ label: '子页面', value: `${reference.count} 个` })
  }

  let desc = spec.empty
  if (state === REFERENCE_STATE.STALE) {
    desc = reference.reason || spec.stale
  } else if (kind === 'sub_page_list' && reference.count !== null && reference.count > 0) {
    desc = `共 ${reference.count} 个子页面`
  }

  const actions = []
  if (state === REFERENCE_STATE.BOUND) {
    // 没有目标就没有「打开」——留一个点了没反应的按钮比不给按钮更糟。
    if (target) actions.push({ id: 'open', label: spec.open, kind: 'command', commandId: REFERENCE_COMMAND.OPEN })
    if (kind === 'sub_page_list') {
      actions.push({ id: 'create', label: spec.create, kind: 'command', commandId: REFERENCE_COMMAND.CREATE })
    }
  } else {
    actions.push({ id: 'rebind', label: spec.rebind, kind: 'command', commandId: REFERENCE_COMMAND.REBIND })
  }

  return { title: spec.title, desc, fields, actions }
}

/** 描述符 → 卡片对象（未序列化；`setReferenceCard` 再交给 `encodeCard`）。 */
function cardOf(kind, resourceId, reference) {
  const view = describeReference(kind, resourceId, reference)
  return {
    providerId: kind,
    resourceId: resourceId || null,
    payload: { title: view.title, desc: view.desc, fields: view.fields, cover: null },
    actions: view.actions,
    reference,
  }
}

/**
 * 写路径入口：造一张新的引用卡。
 *
 * 只有 `kind` 不合格会抛错（调用方转成「命令返回 false」）。其余字段一律收敛：
 * 少给 `resourceId` 就是 `unbound` 空态卡，少给 `source` 就少一个「来源」字段——
 * 空态是**必须能存下来**的（用户先在文档里放一个「待绑定的同步块」是合法操作）。
 */
export function buildReferenceCard(input) {
  const source = isPlain(input) ? input : {}
  const kind = source.kind
  if (!isReferenceKind(kind)) throw new Error('无效引用卡：kind')
  const resourceId = text(source.resourceId, LIMITS.resourceId) || null
  const reference = toStoredReference(kind, resourceId, {
    state: source.state,
    reason: source.reason,
    count: source.count,
    source: source.source,
  })
  return cardOf(kind, resourceId, reference)
}

/**
 * 状态流转的**唯一**步骤：合入 patch → 重新描述 → 返回新卡片对象。
 *
 * 返回 null 表示「这不是引用卡」，调用方（命令）据此返回 false，不要静默改坏普通卡。
 * patch 的语义是「只覆盖给了的字段」：`reason` 传空串是**有效**的（清掉上次的失效原因），
 * 所以这里判 `undefined` 而不是判真值。
 */
export function withReference(card, patch) {
  const current = readReference(card)
  if (!current) return null
  const next = isPlain(patch) ? patch : {}
  const pick = (value, fallback) => (value === undefined ? fallback : value)
  const nextSource = isPlain(next.source) ? next.source : {}
  const resourceId = text(pick(next.resourceId, card.resourceId), LIMITS.resourceId) || null
  const reference = toStoredReference(current.kind, resourceId, {
    state: pick(next.state, current.state),
    reason: pick(next.reason, current.reason),
    count: pick(next.count, current.count),
    source: {
      resourceId: pick(nextSource.resourceId, current.source.resourceId),
      title: pick(nextSource.title, current.source.title),
    },
  })
  return cardOf(current.kind, resourceId, reference)
}

/** 宿主同步时发现源没了：置灰 + 写回原因。 */
export function markReferenceStale(card, reason) {
  return withReference(card, { state: REFERENCE_STATE.STALE, reason: reason === undefined ? '' : reason })
}

/**
 * 用户重新绑定：换成新目标，状态回 `bound`、清掉失效原因。
 *
 * `count` 显式传 `null` 才能清空（子页面列表换目录后，旧目录的计数必须消失）——
 * 所以这里直接把 `count` 交给 patch，由宿主决定「新的有几个子页面」。
 */
export function rebindReference(card, target) {
  const next = isPlain(target) ? target : {}
  return withReference(card, {
    state: REFERENCE_STATE.BOUND,
    reason: '',
    resourceId: next.resourceId,
    count: next.count === undefined ? null : next.count,
    source: {
      resourceId: next.source && next.source.resourceId !== undefined ? next.source.resourceId : '',
      title: next.source && next.source.title !== undefined ? next.source.title : '',
    },
  })
}

/** 卡片当前是不是置灰态（渲染层与 CSS 共用一条判定，避免两处口径漂移）。 */
export function isReferenceInactive(card) {
  const reference = readReference(card)
  if (!reference) return false
  return reference.state !== REFERENCE_STATE.BOUND
}
