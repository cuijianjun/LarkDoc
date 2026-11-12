/**
 * ReminderPopover 的原生 DOM 渲染器（阶段 5）。
 * 业务状态、定位与正文改写仍由 reminderMixin 持有；本模块只构建 DOM、同步模板语义并转发事件。
 */
import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'

function button(className, label) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  if (label) node.setAttribute('aria-label', label)
  return node
}

function preventMouseDown(node, handler) {
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    handler(event)
  })
  node.addEventListener('click', event => {
    if (event.detail !== 0) return
    event.preventDefault()
    handler(event)
  })
}

function setClass(node, name, on) {
  node.classList.toggle(name, !!on)
}

export function createReminder({ host, handlers = {} } = {}) {
  let destroyed = false, rendering = false, renderPending = false
  const call = (name, ...args) => {
    if (destroyed) return
    const handler = handlers[name]
    return typeof handler === 'function' ? handler(...args) : undefined
  }

  const layer = document.createElement('div')
  layer.className = 'lark-doc-reminder-layer'

  const popover = document.createElement('div')
  popover.className = 'lark-doc-reminder-popover'
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', '日期提醒')

  const body = document.createElement('div')
  body.className = 'lark-doc-reminder-body'
  const calendar = document.createElement('div')
  calendar.className = 'lark-doc-reminder-calendar'
  const calendarHead = document.createElement('div')
  calendarHead.className = 'lark-doc-reminder-calendar-head'
  const calendarTitle = document.createElement('span')
  calendarTitle.className = 'lark-doc-reminder-calendar-title'
  const yearButton = button('', '选择年份')
  const monthButton = button('', '选择月份')
  preventMouseDown(yearButton, () => call('onCalendarMode', 'year'))
  preventMouseDown(monthButton, () => call('onCalendarMode', 'month'))
  const calendarNav = document.createElement('span')
  calendarNav.className = 'lark-doc-reminder-calendar-nav'
  const previous = button('', '上个月')
  const next = button('', '下个月')
  setText(previous, '‹')
  setText(next, '›')
  preventMouseDown(previous, () => call('onShiftMonth', -1))
  preventMouseDown(next, () => call('onShiftMonth', 1))
  calendarNav.append(previous, next)
  calendarHead.append(calendarTitle, calendarNav)

  const weekdays = document.createElement('div')
  weekdays.className = 'lark-doc-reminder-week'
  weekdays.setAttribute('aria-hidden', 'true')
  const dayGrid = document.createElement('div')
  dayGrid.className = 'lark-doc-reminder-days'
  dayGrid.setAttribute('role', 'grid')
  const periodGrid = document.createElement('div')
  periodGrid.className = 'lark-doc-reminder-periods'
  periodGrid.setAttribute('role', 'grid')

  const options = document.createElement('div')
  options.className = 'lark-doc-reminder-options'
  const timeRow = document.createElement('div')
  timeRow.className = 'lark-doc-reminder-row is-time'
  const timeLabel = document.createElement('label')
  timeLabel.className = 'lark-doc-reminder-label'
  const hasTime = document.createElement('input')
  hasTime.type = 'checkbox'
  hasTime.setAttribute('aria-label', '设置时间开关')
  hasTime.addEventListener('change', () => call('onHasTime', hasTime.checked))
  timeLabel.addEventListener('mousedown', event => event.preventDefault())
  timeLabel.append(hasTime, document.createTextNode('设置时间'))
  const timeSelect = document.createElement('div')
  timeSelect.className = 'lark-doc-reminder-select'
  timeSelect.setAttribute('data-reminder', 'time')
  const timeText = document.createElement('input')
  timeText.type = 'search'
  timeText.setAttribute('aria-label', '设置时间')
  timeText.setAttribute('role', 'combobox')
  timeText.setAttribute('autocomplete', 'off')
  timeText.addEventListener('focus', () => call('onOpenTimes'))
  timeText.addEventListener('input', () => call('onEditTime', timeText.value))
  timeText.addEventListener('blur', () => call('onBlurTime'))
  timeText.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); call('onCommitTime', timeText.value); timeText.blur() }
    else if (event.key === 'Escape' && call('onTimeEscape', event)) event.stopPropagation()
  })
  const timeCaret = document.createElement('span')
  timeCaret.className = 'lark-doc-reminder-select-caret'
  timeCaret.setAttribute('aria-hidden', 'true')
  setText(timeCaret, '▾')
  timeSelect.append(timeText, timeCaret)
  timeSelect.addEventListener('mousedown', event => {
    if (event.target === timeText) return
    event.preventDefault()
    if (state.timesOpen) call('onToggleTimes')
    else { timeText.focus(); call('onOpenTimes') }
  })

  const repeatRow = document.createElement('div')
  repeatRow.className = 'lark-doc-reminder-row is-repeat'
  const repeatLabel = document.createElement('label')
  repeatLabel.className = 'lark-doc-reminder-label'
  const notify = document.createElement('input')
  notify.type = 'checkbox'
  notify.setAttribute('aria-label', '提醒开关')
  notify.addEventListener('change', () => call('onNotify', notify.checked))
  repeatLabel.addEventListener('mousedown', event => event.preventDefault())
  repeatLabel.append(notify, document.createTextNode('提醒'))
  const repeatSelect = button('lark-doc-reminder-select', '提醒')
  repeatSelect.setAttribute('data-reminder', 'offset')
  preventMouseDown(repeatSelect, () => call('onToggleOffsets'))
  const repeatText = document.createElement('span')
  const repeatCaret = timeCaret.cloneNode(true)
  repeatSelect.append(repeatText, repeatCaret)
  options.append(timeRow, repeatRow)

  const user = document.createElement('p')
  user.className = 'lark-doc-reminder-user'
  body.append(calendar, options, user)
  popover.appendChild(body)

  const times = document.createElement('div')
  times.className = 'lark-doc-reminder-times'
  times.setAttribute('role', 'listbox')
  times.setAttribute('aria-label', '提醒时间')

  layer.append(popover, times)
  let state = {
    open: false,
    hasTime: true,
    notify: true,
    offsetsOpen: false,
    offsetOptions: [],
    selectedOffset: 0,
    calendarMode: 'date',
    periods: [],
    viewYear: 0,
    viewMonth: 0,
    timesOpen: false,
    style: {},
    timesStyle: {},
    viewTitle: '',
    weekdays: [],
    cells: [],
    selectedTime: '',
    repeatText: '',
    user: '',
    timeOptions: [],
  }

  function renderWeekdays() {
    const nodes = state.weekdays.map((day) => {
      const node = document.createElement('span')
      setText(node, day)
      return node
    })
    syncChildren(weekdays, nodes.map((node) => ({ node, on: true })))
  }

  function renderDays() {
    const nodes = state.cells.map((cell) => {
      const node = button('lark-doc-reminder-day')
      node.setAttribute('role', 'gridcell')
      node.disabled = !!cell.outside
      node.setAttribute('aria-selected', cell.selected ? 'true' : 'false')
      node.setAttribute('aria-label', `${cell.year}年${cell.month + 1}月${cell.day}日`)
      setClass(node, 'is-outside', cell.outside)
      setClass(node, 'is-selected', cell.selected)
      setClass(node, 'is-today', cell.today)
      setText(node, cell.day)
      preventMouseDown(node, () => call('onChooseDay', cell))
      return node
    })
    syncChildren(dayGrid, nodes.map((node) => ({ node, on: true })))
  }

  function renderTimes() {
    const slots = state.offsetsOpen ? state.offsetOptions : state.timeOptions.map(value => ({ value, label: value }))
    const nodes = slots.map((slot) => {
      const node = button('lark-doc-reminder-time-row')
      node.setAttribute('role', 'option')
      const selected = slot.value === (state.offsetsOpen ? state.selectedOffset : state.selectedTime)
      node.setAttribute('aria-selected', selected ? 'true' : 'false')
      setClass(node, 'is-selected', selected)
      setText(node, slot.label)
      preventMouseDown(node, () => call(state.offsetsOpen ? 'onChooseOffset' : 'onChooseTime', slot.value))
      return node
    })
    syncChildren(times, nodes.map((node) => ({ node, on: true })))
  }

  function paint() {
    applyStyle(popover, state.style)
    applyStyle(times, state.timesStyle)
    setAttr(popover, 'data-reminder-tone', state.tone)
    setText(yearButton, state.calendarMode === 'year' ? state.viewTitle : `${state.viewYear}年`)
    setText(monthButton, `${state.viewMonth + 1}月`)
    setAttr(previous, 'aria-label', state.calendarMode === 'date' ? '上个月' : state.calendarMode === 'year' ? '前 20 年' : '上一年')
    setAttr(next, 'aria-label', state.calendarMode === 'date' ? '下个月' : state.calendarMode === 'year' ? '后 20 年' : '下一年')
    syncChildren(calendarTitle, [{ node: yearButton, on: true }, { node: monthButton, on: state.calendarMode !== 'year' }])
    const timeValue = state.timeDraft == null ? state.selectedTime : state.timeDraft
    if (timeText.value !== timeValue) timeText.value = timeValue || ''
    setAttr(timeText, 'aria-expanded', state.timesOpen ? 'true' : 'false')
    setAttr(timeSelect, 'aria-expanded', state.timesOpen ? 'true' : 'false')
    setText(repeatText, state.repeatText)
    setText(user, state.user ? `提醒：${state.user}` : '')
    hasTime.checked = state.hasTime
    notify.checked = state.notify
    timeLabel.classList.toggle('is-collapsed', !state.hasTime)
    syncChildren(timeRow, [{ node: timeLabel, on: true }, { node: timeSelect, on: state.hasTime }])
    syncChildren(repeatRow, [{ node: repeatLabel, on: true }, { node: repeatSelect, on: state.notify }])
    setAttr(repeatSelect, 'aria-expanded', String(state.offsetsOpen))
    setAttr(times, 'aria-label', state.offsetsOpen ? '提前提醒' : '提醒时间')
    periodGrid.classList.toggle('is-year', state.calendarMode === 'year')
    const periods = state.periods.map(cell => {
      const node = button('lark-doc-reminder-period')
      node.setAttribute('role', 'gridcell')
      node.setAttribute('aria-selected', String(cell.selected))
      setClass(node, 'is-selected', cell.selected)
      setText(node, cell.label)
      preventMouseDown(node, () => call('onChoosePeriod', cell.value))
      return node
    })
    syncChildren(periodGrid, periods.map(node => ({ node, on: true })))
    syncChildren(calendar, [{ node: calendarHead, on: true }, { node: weekdays, on: state.calendarMode === 'date' }, { node: dayGrid, on: state.calendarMode === 'date' }, { node: periodGrid, on: state.calendarMode !== 'date' }])
    renderWeekdays()
    renderDays()
    renderTimes()
    syncChildren(body, [
      { node: calendar, on: true },
      { node: options, on: true },
      { node: user, on: !!state.user },
    ])
    syncChildren(layer, [
      { node: popover, on: state.open },
      { node: times, on: state.open && (state.timesOpen || state.offsetsOpen) },
    ])
    if (!destroyed) mountNode(host, layer, true)
  }

  function render() {
    if (destroyed) return
    // Removing the focused time input/popover fires blur synchronously. Its
    // handler can update state, but must not mutate this same child list midway.
    if (rendering) { renderPending = true; return }
    rendering = true
    try {
      do {
        renderPending = false
        paint()
      } while (renderPending && !destroyed)
    } finally { rendering = false }
  }

  render()

  return {
    el: layer,
    update(patch = {}) {
      if (destroyed) return
      state = { ...state, ...patch }
      render()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      renderPending = false
      if (layer.parentNode) layer.parentNode.removeChild(layer)
    },
  }
}
