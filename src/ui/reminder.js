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
}

function setClass(node, name, on) {
  node.classList.toggle(name, !!on)
}

export function createReminder({ host, handlers = {} } = {}) {
  const call = (name, ...args) => {
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
  calendar.append(calendarHead, weekdays, dayGrid)

  const options = document.createElement('div')
  options.className = 'lark-doc-reminder-options'
  const timeRow = document.createElement('div')
  timeRow.className = 'lark-doc-reminder-row is-time'
  const timeLabel = document.createElement('span')
  timeLabel.className = 'lark-doc-reminder-label'
  setText(timeLabel, '设置时间')
  const timeSelect = button('lark-doc-reminder-select', '设置时间')
  timeSelect.setAttribute('data-reminder', 'time')
  const timeText = document.createElement('span')
  const timeCaret = document.createElement('span')
  timeCaret.className = 'lark-doc-reminder-select-caret'
  timeCaret.setAttribute('aria-hidden', 'true')
  setText(timeCaret, '▾')
  timeSelect.append(timeText, timeCaret)
  preventMouseDown(timeSelect, () => call('onToggleTimes'))
  timeRow.append(timeLabel, timeSelect)

  const repeatRow = document.createElement('div')
  repeatRow.className = 'lark-doc-reminder-row is-repeat'
  const repeatLabel = document.createElement('span')
  repeatLabel.className = 'lark-doc-reminder-label'
  setText(repeatLabel, '提醒')
  const repeatSelect = button('lark-doc-reminder-select', '提醒')
  repeatSelect.setAttribute('data-reminder', 'repeat')
  repeatSelect.disabled = true
  const repeatText = document.createElement('span')
  repeatSelect.appendChild(repeatText)
  repeatRow.append(repeatLabel, repeatSelect)
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
    const nodes = state.timeOptions.map((slot) => {
      const node = button('lark-doc-reminder-time-row')
      node.setAttribute('role', 'option')
      const selected = slot === state.selectedTime
      node.setAttribute('aria-selected', selected ? 'true' : 'false')
      setClass(node, 'is-selected', selected)
      setText(node, slot)
      preventMouseDown(node, () => call('onChooseTime', slot))
      return node
    })
    syncChildren(times, nodes.map((node) => ({ node, on: true })))
  }

  function render() {
    applyStyle(popover, state.style)
    applyStyle(times, state.timesStyle)
    setText(calendarTitle, state.viewTitle)
    setText(timeText, state.selectedTime)
    setAttr(timeSelect, 'aria-expanded', state.timesOpen ? 'true' : 'false')
    setText(repeatText, state.repeatText)
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
      { node: times, on: state.open && state.timesOpen },
    ])
    mountNode(host, layer, true)
  }

  render()

  return {
    el: layer,
    update(patch = {}) {
      state = { ...state, ...patch }
      render()
    },
    destroy() {
      if (layer.parentNode) layer.parentNode.removeChild(layer)
    },
  }
}
