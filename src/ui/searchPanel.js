import { applyStyle, mountNode, setAttr, setText, syncChildren } from './dom'
import { iconNode } from './icon'

const PANEL_WIDTH = 406

function buttonNode(className, label) {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  if (label) node.setAttribute('aria-label', label)
  return node
}

function setDisabled(node, disabled) {
  node.disabled = !!disabled
  setAttr(node, 'disabled', disabled ? '' : null)
}

export function createSearchPanel({ host, handlers = {} } = {}) {
  let root = null
  let state = { open: false, isReplace: false, height: 186, style: {}, query: '', replacement: '', counterText: '0 / 0', readonly: false, hasMatches: false }
  let drag = null
  let input = null
  let bar = null

  function endDrag() {
    if (!drag) return
    drag = null
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', endDrag)
  }

  function onDragMove(event) {
    if (!drag) return
    const left = drag.left + event.clientX - drag.x
    const top = drag.top + event.clientY - drag.y
    handlers.onPosition?.({
      left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - PANEL_WIDTH)),
      top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - state.height)),
    })
  }

  function startDrag(event) {
    if (event.button) return
    const rect = root.getBoundingClientRect()
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', endDrag)
  }

  function build() {
    root = document.createElement('div')
    root.className = 'lark-doc-fr'
    root.setAttribute('role', 'search')
    root.setAttribute('aria-label', '查找和替换')

    bar = document.createElement('div')
    bar.className = 'lark-doc-fr-bar'
    bar.setAttribute('role', 'tablist')
    bar.setAttribute('aria-label', '查找替换')
    bar.addEventListener('pointerdown', startDrag)

    const findTab = buttonNode('lark-doc-fr-tab')
    findTab.setAttribute('role', 'tab')
    setText(findTab, '查找')
    findTab.addEventListener('click', () => handlers.onTab?.('find'))
    const replaceTab = buttonNode('lark-doc-fr-tab')
    replaceTab.setAttribute('role', 'tab')
    setText(replaceTab, '替换')
    replaceTab.addEventListener('click', () => handlers.onTab?.('replace'))
    const ink = document.createElement('span')
    ink.className = 'lark-doc-fr-ink'
    ink.setAttribute('aria-hidden', 'true')
    bar.append(findTab, replaceTab, ink)

    const pane = document.createElement('div')
    pane.className = 'lark-doc-fr-pane'
    const findField = document.createElement('div')
    findField.className = 'lark-doc-fr-field'
    const findLabel = document.createElement('label')
    findLabel.className = 'lark-doc-fr-label'
    findLabel.htmlFor = 'lark-doc-fr-find'
    setText(findLabel, '查找')
    const findInputWrap = document.createElement('div')
    findInputWrap.className = 'lark-doc-fr-input'
    input = document.createElement('input')
    input.id = 'lark-doc-fr-find'
    input.setAttribute('aria-label', '查找内容')
    input.placeholder = '在文档内查找'
    input.addEventListener('input', event => handlers.onQuery?.(event))
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); handlers.onNext?.(1) }
    })
    const counter = document.createElement('span')
    counter.className = 'lark-doc-fr-counter'
    findInputWrap.append(input, counter)
    findField.append(findLabel, findInputWrap)

    const replaceField = document.createElement('div')
    replaceField.className = 'lark-doc-fr-field'
    const replaceLabel = document.createElement('label')
    replaceLabel.className = 'lark-doc-fr-label'
    replaceLabel.htmlFor = 'lark-doc-fr-replace'
    setText(replaceLabel, '替换为')
    const replaceInputWrap = document.createElement('div')
    replaceInputWrap.className = 'lark-doc-fr-input'
    const replaceInput = document.createElement('input')
    replaceInput.id = 'lark-doc-fr-replace'
    replaceInput.setAttribute('aria-label', '替换为')
    replaceInput.placeholder = '请输入文字'
    replaceInput.addEventListener('input', event => handlers.onReplacement?.(event))
    replaceInputWrap.appendChild(replaceInput)
    replaceField.append(replaceLabel, replaceInputWrap)

    const actions = document.createElement('div')
    actions.className = 'lark-doc-fr-actions'
    const replaceAll = buttonNode('lark-doc-fr-btn is-primary')
    setText(replaceAll, '全部替换')
    replaceAll.addEventListener('click', () => handlers.onReplace?.(true))
    const replaceOne = buttonNode('lark-doc-fr-btn')
    setText(replaceOne, '替换')
    replaceOne.addEventListener('click', () => handlers.onReplace?.(false))
    const previous = buttonNode('lark-doc-fr-btn')
    setText(previous, '上一处')
    previous.addEventListener('click', () => handlers.onNext?.(-1))
    const next = buttonNode('lark-doc-fr-btn')
    setText(next, '下一处')
    next.addEventListener('click', () => handlers.onNext?.(1))
    actions.append(replaceAll, replaceOne, previous, next)

    const close = buttonNode('lark-doc-fr-close', '关闭查找')
    close.addEventListener('click', () => handlers.onClose?.())
    close.appendChild(iconNode('close', 20))
    pane.append(findField, replaceField, actions)
    root.append(bar, pane, close)
    root.__ld = { findTab, replaceTab, ink, pane, findField, findLabel, findInputWrap, replaceField, input, replaceInput, counter, actions, replaceAll, replaceOne, previous, next }
    root.addEventListener('keydown', event => event.stopPropagation())
  }

  function paint() {
    if (!root) build()
    const refs = root.__ld
    root.classList.toggle('is-replace', state.isReplace)
    setAttr(refs.findTab, 'aria-selected', state.isReplace ? 'false' : 'true')
    setAttr(refs.replaceTab, 'aria-selected', state.isReplace ? 'true' : 'false')
    refs.findTab.classList.toggle('is-active', !state.isReplace)
    refs.replaceTab.classList.toggle('is-active', state.isReplace)
    applyStyle(root, { ...(state.style || {}), height: `${state.height}px` })
    if (refs.input.value !== (state.query || '')) refs.input.value = state.query || ''
    if (refs.replaceInput.value !== (state.replacement || '')) refs.replaceInput.value = state.replacement || ''
    setText(refs.counter, state.counterText)
    setDisabled(refs.replaceAll, state.readonly || !state.hasMatches)
    setDisabled(refs.replaceOne, state.readonly || !state.hasMatches)
    setDisabled(refs.previous, !state.hasMatches)
    setDisabled(refs.next, !state.hasMatches)
    syncChildren(refs.findField, [
      { node: refs.findLabel, on: state.isReplace },
      { node: refs.findInputWrap, on: true },
    ])
    syncChildren(refs.pane, [
      { node: refs.findField, on: true },
      { node: refs.replaceField, on: state.isReplace },
      { node: refs.actions, on: true },
    ])
    if (state.open) {
      mountNode(host, root, true)
      if (!state.wasOpen) {
        refs.input.focus()
        const end = refs.input.value.length
        if (typeof refs.input.setSelectionRange === 'function') refs.input.setSelectionRange(end, end)
      }
    } else {
      endDrag()
      mountNode(host, root, false)
    }
  }

  return {
    get el() { return root },
    focus() { if (input) input.focus() },
    update(patch = {}) {
      const wasOpen = state.open
      state = { ...state, ...patch, wasOpen }
      paint()
    },
    destroy() { endDrag(); if (root) mountNode(host, root, false); root = null; input = null; bar = null },
  }
}
