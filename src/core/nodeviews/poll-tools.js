/** 仅在打开投票更多操作时加载，避免配置 UI 占用编辑器首包。 */
export function createPollTools({ current, editable, apply, showHint }) {
  const el = document.createElement('div')
  el.className = 'lark-doc-poll-tools'
  el.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:12px'
  const label = document.createElement('label')
  label.textContent = '截止时间'
  label.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px'
  const input = document.createElement('input')
  input.type = 'datetime-local'
  input.setAttribute('aria-label', '投票截止时间')
  label.appendChild(input)
  const button = text => {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = text
    return node
  }
  const save = button('保存截止时间')
  const clear = button('取消定时截止')
  const end = button('结束投票')
  for (const node of [input, save, clear, end]) node.style.cssText = 'min-width:0;max-width:100%;padding:4px 8px;border:1px solid var(--ld-border);border-radius:4px;background:var(--ld-bg-surface);color:var(--ld-text);font:inherit'
  save.addEventListener('click', () => {
    if (!editable()) return
    const time = input.value ? new Date(input.value).getTime() : NaN
    if (!Number.isFinite(time) || time <= Date.now()) { showHint('请选择未来的截止时间'); return }
    apply({ type: 'deadline', value: new Date(time).toISOString() })
  })
  clear.addEventListener('click', () => apply({ type: 'deadline', value: null }))
  end.addEventListener('click', () => apply({ type: current().deadline && Date.parse(current().deadline) <= Date.now() ? 'reopen' : 'close' }))
  el.append(label, save, clear, end)
  return {
    el,
    update(open) {
      el.style.display = open ? 'flex' : 'none'
      const poll = current()
      input.disabled = save.disabled = clear.disabled = end.disabled = !editable()
      end.hidden = !poll.published
      end.textContent = poll.deadline && Date.parse(poll.deadline) <= Date.now() ? '重新开放投票' : '结束投票'
      if (document.activeElement !== input) {
        const time = poll.deadline ? new Date(poll.deadline) : null
        input.value = time ? new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
      }
    },
    destroy() { el.remove() },
  }
}
