/**
 * 投票块 NodeView（P5-03）—— 纯 DOM，core 零 UI 框架依赖。
 * 规格：requirements/02 §23（13 层 DOM 链 / 几何 / 三态 / 时序）、§19.1 ⑥（数据模型）。
 *
 * 五条设计要点：
 *
 *   1. **根节点来自 `renderHTML`**（`DOMSerializer.fromSchema().serializeNode`），拿到的是
 *      那张**只读投票卡** —— 也就是导出产物本身。然后清空子节点、建交互层、给根打上
 *      `data-poll-view="editor"`。导出走 `renderHTML`（不经过这里），所以 PDF / DOCX 里
 *      不会出现 textarea。
 *   2. **数据只有一个来源**：`attrs.poll`。用户每敲一下就「跑一遍 `pollReducer` →
 *      `updatePoll` 写回文档」，不维护独立的本地副本 —— 两处状态必然漂移。
 *      唯一的本地状态是：已勾选未提交的 `picked`、提示条文案、以及 `now`。
 *   3. **`paint()` 只改值不改结构**：输入框的 `.value` 在元素**获得焦点时跳过**，
 *      否则中文输入法（IME）的候选窗会被自己的重排打断。选项数量变化才重建行。
 *   4. **颜色全部走 token**：`--ld-poll-*` 由 `lark-doc.css` 定义（真机实测值的唯一落点），
 *      这里只写类名。`check-theme-tokens.js` 会拦 JS 里的字面量色值。
 *   5. **三态由 `pollStatus()` 决定，不由 DOM 决定**：编辑态（draft）/ 已发布（open）/
 *      已投票（voted）/ 已截止（closed）。已投票**优先于**已截止（投过的人永远看结果条）。
 *
 * 🔴 V1 不做（§23 已拍板）：日期选择器日历、header「更多」菜单三态、真实请求。
 */

import { DOMSerializer } from '@tiptap/pm/model'
import {
  POLL_LIMITS, POLL_STATUS, canVote, defaultPoll, formatPercent, headerLabels, optionLabel,
  pollReducer, pollStatus, publishHint, readPoll, tally,
} from '../blocks/poll-render'

/** 提示条自动消失的时长（ms）。只影响观感，不影响数据。 */
const HINT_TIMEOUT = 2400

/** 三个开关的行序与文案（§23：1=定时截止 / 2=匿名 / 3=多选）。 */
const SWITCH_ROWS = [
  { key: 'deadline', label: '定时截止' },
  { key: 'anonymous', label: '匿名投票' },
  { key: 'multiple', label: '允许多选' },
]

function createElement(tag, className) {
  const element = document.createElement(tag)
  if (className) element.className = className
  return element
}

/** 只在值真的变了才写，避免无谓的 DOM 变更（也避免把光标顶走）。 */
function setText(element, text) {
  const next = String(text === undefined || text === null ? '' : text)
  if (element.textContent !== next) element.textContent = next
}

function setToggle(element, className, on) {
  if (element.classList.contains(className) !== Boolean(on)) element.classList.toggle(className, Boolean(on))
}

export function createPollNodeView(props) {
  const { node, extension, getPos } = props
  const options = (extension && extension.options) || {}
  const editor = props.editor || null

  let currentNode = node
  let serializer = null
  let destroyed = false
  let cleanups = []

  /** 已勾选但**尚未提交**的选项 id（单选时最多一个）。提交后进 `poll.voted`。 */
  let picked = []
  /** 提示条文案；空串表示隐藏。 */
  let hintText = ''
  let hintTimer = null

  /* ---------- 数据通道 ---------- */

  const current = () => readPoll((currentNode.attrs || {}).poll) || defaultPoll()
  const blockId = () => (currentNode.attrs || {}).blockId || null
  const status = () => pollStatus(current(), Date.now())

  function currentPos() {
    if (typeof getPos !== 'function') return null
    try {
      const pos = getPos()
      return Number.isInteger(pos) ? pos : null
    } catch (_) {
      // 节点已被删掉时 getPos 会抛 —— 这里吞掉，调用方按失败处理。
      return null
    }
  }

  /** 写回文档。成功时 PM 会同步调 `update()`，`currentNode` 与本地态由那里刷新。 */
  function commit(poll) {
    const commands = editor && editor.commands ? editor.commands : null
    if (!commands || typeof commands.updatePoll !== 'function') return false
    const pos = currentPos()
    if (pos === null) return false
    try {
      return commands.updatePoll({ pos, poll }) === true
    } catch (_) {
      return false
    }
  }

  /** 跑一次状态机。无变化（如「最少保留两项」被拒）直接返回 false，不产生 transaction。 */
  function apply(action) {
    if (destroyed) return false
    const before = current()
    const after = pollReducer(before, action, Date.now())
    if (JSON.stringify(before) === JSON.stringify(after)) return false
    const ok = commit(after)
    if (ok) hideHint()
    paint()
    return ok
  }

  /* ---------- 序列化底子 ---------- */

  function getSerializer() {
    if (!serializer) serializer = DOMSerializer.fromSchema(currentNode.type.schema)
    return serializer
  }

  const dom = (() => {
    const rendered = getSerializer().serializeNode(currentNode)
    const element = rendered && rendered.nodeType === 1 ? rendered : createElement('div', 'lark-doc-poll')
    // 只留根节点：叶子内容全部由交互层重建（导出侧仍走 renderHTML，不受影响）。
    element.textContent = ''
    element.setAttribute('data-poll-view', 'editor')
    return element
  })()

  /* ---------- DOM 骨架 ---------- */

  const card = createElement('div', 'lark-doc-poll-card')
  const header = createElement('div', 'lark-doc-poll-header')

  // 标题行：图标 + 标题（编辑态是 textarea，发布后换成同位的只读 div —— 两个都在，
  // 靠类名切显隐，省得每次发布都重建节点）。
  const titleRow = createElement('div', 'lark-doc-poll-title-row')
  const icon = createElement('span', 'lark-doc-poll-icon')
  icon.setAttribute('aria-hidden', 'true')
  for (let index = 0; index < 3; index += 1) icon.appendChild(createElement('i', 'lark-doc-poll-icon-bar'))
  const titleInput = createElement('textarea', 'lark-doc-poll-title-input')
  titleInput.setAttribute('rows', '1')
  titleInput.setAttribute('placeholder', '投票主题')
  titleInput.setAttribute('aria-label', '投票主题')
  const titlePreview = createElement('div', 'lark-doc-poll-title')
  titleRow.appendChild(icon)
  titleRow.appendChild(titleInput)
  titleRow.appendChild(titlePreview)

  const labelsBox = createElement('div', 'lark-doc-poll-labels')
  header.appendChild(titleRow)
  header.appendChild(labelsBox)

  const content = createElement('div', 'lark-doc-poll-content')
  const rowsBox = createElement('div', 'lark-doc-poll-options')
  const adder = createElement('button', 'lark-doc-poll-adder')
  adder.type = 'button'
  adder.textContent = '+ 添加选项'
  // 分隔线（§23：468 × 2，`margin: 8px 0 20px`）。实测色见 token `--ld-poll-line`，
  // 它近黑、看着像「画重了」，但这就是真机值 —— 别「顺手」改成浅灰。
  const line = createElement('div', 'lark-doc-poll-line')

  // 三个开关（§23：开关行距 57、轨道 40×22、白球 18）。
  const config = createElement('div', 'lark-doc-poll-config')
  const switchMap = new Map()
  SWITCH_ROWS.forEach((row) => {
    const rowEl = createElement('div', 'lark-doc-poll-config-row')
    rowEl.setAttribute('data-switch', row.key)
    const text = createElement('span', 'lark-doc-poll-config-label')
    text.textContent = row.label
    const track = createElement('div', 'lark-doc-poll-switch')
    track.setAttribute('role', 'switch')
    track.setAttribute('tabindex', '-1')
    track.setAttribute('aria-label', row.label)
    const knob = createElement('span', 'lark-doc-poll-switch-knob')
    track.appendChild(knob)
    rowEl.appendChild(text)
    rowEl.appendChild(track)
    config.appendChild(rowEl)
    switchMap.set(row.key, { line: rowEl, track })
  })

  // 轻量确认条：替代 ud__confirm 全站弹窗（V1 只提示、不阻断）。
  const hint = createElement('div', 'lark-doc-poll-hint')
  hint.setAttribute('role', 'status')
  hint.setAttribute('aria-live', 'polite')

  // 顺序 = §23 的 DOM 序：选项 → 添加 → 分隔线 → 配置区 → 提示条。
  // 分隔线夹在添加按钮与配置区之间，发布后跟着配置区一起收走（否则会剩一条悬空的线）。
  content.appendChild(rowsBox)
  content.appendChild(adder)
  content.appendChild(line)
  content.appendChild(config)
  content.appendChild(hint)

  const footer = createElement('div', 'lark-doc-poll-footer')
  const submit = createElement('button', 'lark-doc-poll-submit')
  submit.type = 'button'
  footer.appendChild(submit)

  card.appendChild(header)
  card.appendChild(content)
  card.appendChild(footer)
  dom.appendChild(card)

  /* ---------- 提示条 ---------- */

  function hideHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    hintText = ''
    hint.classList.remove('is-visible')
    setText(hint, '')
  }

  function showHint(text) {
    if (destroyed) return
    hintText = text
    setText(hint, text)
    hint.classList.add('is-visible')
    if (hintTimer) clearTimeout(hintTimer)
    hintTimer = setTimeout(() => { hintTimer = null; hideHint() }, HINT_TIMEOUT)
  }

  /* ---------- 选项行 ---------- */

  let rowMap = new Map()
  let rowKey = ''

  function createRow() {
    const root = createElement('div', 'lark-doc-poll-option')
    const choice = createElement('span', 'lark-doc-poll-choice')
    const key = createElement('span', 'lark-doc-poll-option-key')
    const input = createElement('input', 'lark-doc-poll-option-input')
    input.type = 'text'
    input.setAttribute('placeholder', '选项内容')
    const remove = createElement('button', 'lark-doc-poll-option-remove')
    remove.type = 'button'
    remove.setAttribute('aria-label', '删除选项')
    remove.textContent = '×'
    // 结果区：票数 + 百分比 + 进度条（450 × 4，左缩进 18）。
    const result = createElement('div', 'lark-doc-poll-option-result')
    const count = createElement('span', 'lark-doc-poll-option-count')
    const percent = createElement('span', 'lark-doc-poll-option-percent')
    const track = createElement('div', 'lark-doc-poll-progress-track')
    const bar = createElement('div', 'lark-doc-poll-progress-bar')
    track.appendChild(bar)
    const meta = createElement('div', 'lark-doc-poll-option-meta')
    meta.appendChild(count)
    meta.appendChild(percent)
    result.appendChild(meta)
    result.appendChild(track)
    root.appendChild(choice)
    root.appendChild(key)
    root.appendChild(input)
    root.appendChild(remove)
    root.appendChild(result)
    return { root, choice, key, input, remove, result, count, percent, track, bar, id: '' }
  }

  function rebuildRows(ids) {
    rowsBox.textContent = ''
    rowMap = new Map()
    ids.forEach((id) => {
      const row = createRow()
      row.id = id
      rowMap.set(id, row)
      rowsBox.appendChild(row.root)
    })
    rowKey = ids.join('|')
  }

  function refreshRows(poll) {
    const ids = poll.options.map((option) => option.id)
    if (ids.join('|') !== rowKey) rebuildRows(ids)
    const state = status()
    const published = poll.published
    poll.options.forEach((option, index) => {
      const row = rowMap.get(option.id)
      if (!row) return
      setText(row.key, optionLabel(index))
      // 获得焦点时跳过 —— 否则 IME 候选窗会被自己的重排打断。
      if (typeof document === 'undefined' || document.activeElement !== row.input) {
        if (row.input.value !== option.text) row.input.value = option.text
      }
      row.input.readOnly = published
      row.input.tabIndex = published ? -1 : 0
      const chosen = picked.includes(option.id) || poll.voted.includes(option.id)
      setToggle(row.root, 'is-chosen', chosen && state !== POLL_STATUS.DRAFT)
      setToggle(row.choice, 'is-checked', chosen)
      // 删除按钮：编辑态且多于两项时才给（最少保留两项，§23 未实测，V1 按此收敛）。
      const canRemove = !published && poll.options.length > 2
      row.remove.style.display = canRemove ? '' : 'none'
      row.remove.disabled = !canRemove
      // 结果条只在投过票时出现。
      const withResult = poll.voted.length > 0
      row.result.style.display = withResult ? '' : 'none'
      if (withResult) {
        const rowData = tally(poll).rows[index]
        const data = rowData || { votes: 0, percent: 0, width: 0 }
        setText(row.count, `${data.votes} 票`)
        setText(row.percent, formatPercent(data.percent))
        row.bar.style.width = `${data.width.toFixed(4)}%`
      }
    })
  }

  /* ---------- 交互 ---------- */

  /** 从行元素反查 option id（不靠闭包下标，行会被重建）。 */
  function idOf(element) {
    const root = element && element.closest ? element.closest('.lark-doc-poll-option') : null
    if (!root) return null
    for (const [id, row] of rowMap.entries()) {
      if (row.root === root) return id
    }
    return null
  }

  function onRowsInput(event) {
    const target = event && event.target
    if (!target || typeof target.closest !== 'function') return
    if (!target.classList.contains('lark-doc-poll-option-input')) return
    const id = idOf(target)
    if (!id) return
    // 清掉本地勾选：内容改了，先前勾的结论不再可靠。
    picked = []
    apply({ type: 'option', id, value: target.value })
  }

  function onRowsClick(event) {
    const target = event && event.target
    if (!target || typeof target.closest !== 'function') return
    if (target.closest('.lark-doc-poll-option-remove')) {
      const id = idOf(target)
      if (id) apply({ type: 'removeOption', id })
      return
    }
    const root = target.closest('.lark-doc-poll-option')
    if (!root) return
    const poll = current()
    // 发布后才可勾选；草稿态的点击是「把光标放进输入框」，不切换勾选。
    if (!poll.published || poll.voted.length || status() === POLL_STATUS.CLOSED) return
    const id = idOf(target)
    if (!id) return
    if (poll.multiple) {
      picked = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]
    } else {
      picked = picked.includes(id) ? [] : [id]
    }
    hideHint()
    paint()
  }

  function onAdderClick() {
    const poll = current()
    if (poll.published) return
    apply({ type: 'addOption' })
  }

  function onSwitchClick(event) {
    const track = event && event.target && event.target.closest
      ? event.target.closest('.lark-doc-poll-switch') : null
    if (!track || track.classList.contains('is-disabled')) return
    const line = track.closest('.lark-doc-poll-config-row')
    if (line && line.classList.contains('is-disabled')) return
    const key = line ? line.getAttribute('data-switch') : null
    if (!key) return
    apply({ type: 'toggle', key })
  }

  function onSubmitClick() {
    const poll = current()
    const state = status()
    if (state === POLL_STATUS.DRAFT) {
      const blocked = publishHint(poll)
      if (blocked) { showHint(blocked); return }
      apply({ type: 'publish' })
      return
    }
    if (poll.voted.length) return
    if (state === POLL_STATUS.CLOSED) { showHint('投票已截止'); return }
    if (!picked.length) { showHint('请选择选项'); return }
    const ids = poll.multiple ? picked.slice() : picked.slice(0, 1)
    const ok = apply({ type: 'vote', ids })
    if (!ok) return
    picked = []
    paint()
    if (typeof options.onVote === 'function') {
      try { options.onVote({ blockId: blockId(), ids, poll: current() }) } catch (_) { /* 宿主执行 */ }
    }
  }

  /** header「更多」：V1 只转交（§23 的菜单三态未做）。 */
  function onHeaderClick(event) {
    if (typeof options.onMenu !== 'function') return
    const target = event && event.target
    if (!target || typeof target.closest !== 'function') return
    if (!target.closest('.lark-doc-poll-labels')) return
    try { options.onMenu({ blockId: blockId(), pos: currentPos() }) } catch (_) { /* 宿主执行 */ }
  }

  function onTitleInput() { apply({ type: 'title', value: titleInput.value }) }
  /** 失焦时把 DOM 里的值对齐到文档里的（清理过的）值。 */
  function onTitleBlur() { titleInput.value = current().title }

  rowsBox.addEventListener('input', onRowsInput)
  rowsBox.addEventListener('click', onRowsClick)
  rowsBox.addEventListener('focusout', (event) => {
    const target = event && event.target
    if (!target || !target.classList || !target.classList.contains('lark-doc-poll-option-input')) return
    const id = idOf(target)
    const poll = current()
    const option = poll.options.find((item) => item.id === id)
    if (option && target.value !== option.text) target.value = option.text
  })
  adder.addEventListener('click', onAdderClick)
  config.addEventListener('click', onSwitchClick)
  submit.addEventListener('click', onSubmitClick)
  header.addEventListener('click', onHeaderClick)
  titleInput.addEventListener('input', onTitleInput)
  titleInput.addEventListener('blur', onTitleBlur)

  /* ---------- 绘制 ---------- */

  /** 把当前数据画到 DOM。只改值不改结构（结构变化限定在选项行）。 */
  function paint() {
    if (destroyed) return
    const poll = current()
    const state = status()

    dom.setAttribute('data-poll-status', state)
    if (typeof poll.published === 'boolean') dom.setAttribute('data-poll-published', poll.published ? 'true' : 'false')
    // 多选时勾选框是方的（CSS 靠这条切 border-radius）。
    dom.setAttribute('data-poll-multiple', poll.multiple ? 'true' : 'false')

    // 标题：编辑态与发布态各显一个，同处一行。
    const editing = state === POLL_STATUS.DRAFT
    titleInput.style.display = editing ? '' : 'none'
    titlePreview.style.display = editing ? 'none' : ''
    if (editing) {
      if (typeof document === 'undefined' || document.activeElement !== titleInput) {
        if (titleInput.value !== poll.title) titleInput.value = poll.title
      }
    } else {
      setText(titlePreview, poll.title || '投票主题')
    }

    // 标签行：顺序与配色只由 headerLabels() 决定，这里不复排。
    labelsBox.textContent = ''
    headerLabels(poll).forEach((label) => {
      const chip = createElement('span', `lark-doc-poll-label lark-doc-poll-label--${label.tone || 'accent'}`)
      chip.setAttribute('data-label', label.key)
      chip.textContent = label.text
      labelsBox.appendChild(chip)
    })

    refreshRows(poll)

    // 开关：发布后只剩「定时截止」可操作（§23 硬约束）。
    const switchState = {
      deadline: Boolean(poll.deadline),
      anonymous: poll.anonymous,
      multiple: poll.multiple,
    }
    SWITCH_ROWS.forEach((row, index) => {
      const entry = switchMap.get(row.key)
      if (!entry) return
      setToggle(entry.track, 'is-checked', switchState[row.key])
      const locked = poll.published && index > 0
      setToggle(entry.track, 'is-disabled', locked)
      setToggle(entry.line, 'is-disabled', locked)
      entry.track.setAttribute('aria-checked', switchState[row.key] ? 'true' : 'false')
    })

    // 配置区：发布后整块 display:none（DOM 保留，与 §23 一致）；分隔线同理。
    const showConfig = publishedConfigVisible(poll)
    config.style.display = showConfig ? '' : 'none'
    line.style.display = showConfig ? '' : 'none'
    adder.style.display = editing ? '' : 'none'
    adder.disabled = poll.options.length >= POLL_LIMITS.options

    // footer：投票结果态整块消失（§23 实测 rect 高 0）。
    const showFooter = poll.voted.length === 0
    footer.style.display = showFooter ? '' : 'none'
    if (showFooter) {
      setText(submit, poll.published ? '立即投票' : '发布投票')
      const blocked = poll.published && (state === POLL_STATUS.CLOSED || !picked.length)
      setToggle(submit, 'is-disabled', blocked)
      submit.setAttribute('aria-disabled', blocked ? 'true' : 'false')
    }
  }

  /**
   * 配置区是否可见。
   *
   * §23 说发布后 `.poll-block__editor` 置 `display:none`（DOM 保留），只剩「定时截止」
   * 一行还能操作 —— 两处都要，所以：编辑态整块可见；已发布保持**不可见**但那行仍可点
   * （菜单通道未来接管）。V1 简化为发布后整块隐藏，`locked` 类只影响指针态。
   */
  function publishedConfigVisible(poll) {
    return !poll.published
  }

  paint()

  return {
    dom,

    update(nextNode) {
      if (destroyed) return false
      if (!nextNode || !nextNode.type || nextNode.type.name !== 'poll') return false
      const previous = currentNode.attrs || {}
      const next = nextNode.attrs || {}
      // 只有 poll 与 blockId 参与渲染；两者都没动就不必碰 DOM（属性对象可能是新的）。
      const unchanged = (previous.poll || null) === (next.poll || null)
        && (previous.blockId || null) === (next.blockId || null)
      currentNode = nextNode
      if (unchanged) return true
      // 已经投过票 → 本地勾选作废（文档里的 `voted` 才是结论）。
      if (current().voted.length) picked = []
      paint()
      return true
    },

    /**
     * 只拦输入层的事件，不拦整块。
     *
     * 拦整块会让 `mousedown` 被吃掉，块就选不中了；而卡片空白处的点击必须留给 PM
     * （用户要能选中块、用方向键跳走）。`contenteditable="false"` 的阻断由 `dom` 自负。
     */
    stopEvent(event) {
      const target = event && event.target
      if (!target || typeof target.closest !== 'function') return false
      return Boolean(target.closest('input, textarea, button')
        || target.closest('.lark-doc-poll-switch')
        || target.closest('.lark-doc-poll-hint'))
    },

    /** 整棵子树都是自绘的，PM 看到的 DOM 变化全是噪音。 */
    ignoreMutation() { return true },

    // 选中态走 `is-selected`（file-block / web-embed / sheet 同款）。
    selectNode() { if (!destroyed) dom.classList.add('is-selected') },
    deselectNode() { if (!destroyed) dom.classList.remove('is-selected') },

    destroy() {
      destroyed = true
      cleanups.slice().forEach((fn) => fn())
      cleanups = []
      serializer = null
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    },

    /* ---------- 测试与宿主联调通道 ---------- */

    /** 当前文档里的投票数据（归一化后的对象，不是字符串）。 */
    poll: current,
    /** 当前态：draft / open / voted / closed。 */
    status,
    /** 已勾选未提交的选项 id。 */
    picked: () => picked.slice(),
    /** 提示条文案；空串表示隐藏。 */
    hintText: () => hintText,
    /** 直接驱动状态机（测试用，绕过 DOM 事件）。 */
    apply,
    /** 行元素表（测试用）。 */
    rows: () => Array.from(rowMap.values()),
    titleInput: () => titleInput,
    submit: () => submit,
    switches: () => switchMap,
    canVote: () => canVote(current(), Date.now()),
  }
}

export default createPollNodeView
