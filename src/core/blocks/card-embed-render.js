/**
 * 卡片块的**渲染层纯函数**（P3-04 拆出）—— 把 `payload` 翻成 renderSpec 片段。
 *
 * 拆出来的原因：`card-embed.js` 是「schema + 命令 + renderHTML」三段式，字段/动作/封面
 * 这几个小渲染器加起来六十多行，留在原文件里会把块文件顶过 250 行（P0-04 拆块硬规则，
 * `check-architecture.js` 守着）。
 *
 * 这里**只放不依赖节点上下文的东西**：不读 `this`、不碰 editor、不碰 attrs 的块 id。
 * 所以它们能单独测，也不需要 Tiptap 运行时。
 */

/** 字段/动作的读取上限与 `core/embed/card.js` 的 LIMITS 一致，这里只管渲染期防御。 */
export const RENDER_LIMITS = Object.freeze({ title: 300, desc: 2000, fieldLabel: 40, fieldValue: 200, actionLabel: 40 })

export function renderText(value, limit) {
  return typeof value === 'string' && value ? Array.from(value).slice(0, limit).join('') : ''
}

export function renderFields(payload) {
  const fields = payload && Array.isArray(payload.fields) ? payload.fields : []
  return fields.reduce((acc, field) => {
    if (!field || typeof field !== 'object') return acc
    const label = renderText(field.label, RENDER_LIMITS.fieldLabel)
    const value = renderText(field.value, RENDER_LIMITS.fieldValue)
    if (!label || !value) return acc
    // ⚠️ renderSpec 只认「展平的 children」：`['div', attrs, childA, childB]`。
    // 把子 spec 收成一个数组当第三位会被递归当成单个 spec，然后因为
    // `structure[0]` 不是字符串抛 `RangeError: Invalid array passed to renderSpec`。
    acc.push(['div', { class: 'lark-doc-card-field' },
      ['dt', { class: 'lark-doc-card-field-label' }, label],
      ['dd', { class: 'lark-doc-card-field-value' }, value]])
    return acc
  }, [])
}

export function renderActions(actions) {
  const list = Array.isArray(actions) ? actions : []
  return list.reduce((acc, action, index) => {
    if (!action || typeof action !== 'object') return acc
    const id = typeof action.id === 'string' ? action.id : ''
    const label = renderText(action.label, RENDER_LIMITS.actionLabel)
    if (!id || !label) return acc
    acc.push(['span', {
      class: index === 0 ? 'lark-doc-card-action is-primary' : 'lark-doc-card-action',
      role: 'button',
      tabindex: '0',
      'data-card-action': id,
      'data-card-action-kind': action.kind === 'open' ? 'open' : 'command',
    }, label])
    return acc
  }, [])
}

/** 封面用 `background-image` 而不是 `img`：图挂了不会破图标（同 bookmark favicon 口径）。 */
export function renderCover(cover) {
  if (typeof cover !== 'string' || !cover) return null
  return ['div', {
    class: 'lark-doc-card-cover',
    role: 'img',
    'aria-label': '卡片封面',
    style: `background-image: url("${cover.replace(/"/g, '%22')}")`,
  }]
}

/** 无数据 / 未知来源共用的占位卡：复用 `unknown-block` 的 chrome，不新造一套令牌。 */
export function placeholder(title, sub) {
  return ['div', { class: 'lark-doc-unknown-card' },
    ['span', { class: 'lark-doc-unknown-card-icon', 'aria-hidden': 'true' }],
    ['span', { class: 'lark-doc-unknown-card-text' },
      ['span', { class: 'lark-doc-unknown-card-title' }, title],
      ['span', { class: 'lark-doc-unknown-card-sub' }, sub]],
  ]
}
