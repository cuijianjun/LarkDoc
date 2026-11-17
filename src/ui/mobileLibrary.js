import { iconNode } from './icon'
import { lockPageScroll, setText } from './dom'

// Directory contents belong to the host. Authorization.searchDocuments is only
// a bounded search result, never a substitute for an entire knowledge tree.
export function createMobileLibrary(options) {
  const layer = document.createElement('section'), mask = document.createElement('button'), drawer = document.createElement('aside')
  layer.className = 'lark-doc-mobile-library'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-label', '我的文档库')
  mask.className = 'lark-doc-mobile-library-mask'; mask.type = 'button'; mask.tabIndex = -1; mask.setAttribute('aria-label', '关闭知识库目录')
  drawer.className = 'lark-doc-mobile-library-drawer'
  const head = document.createElement('header'), title = document.createElement('h2'), closeButton = document.createElement('button')
  title.textContent = '我的文档库'; closeButton.type = 'button'; closeButton.setAttribute('aria-label', '收起知识库目录')
  closeButton.append(iconNode('chevronDown', 20), iconNode('chevronDown', 20)); head.append(title, closeButton)
  const search = document.createElement('div'), input = document.createElement('input'), cancel = document.createElement('button')
  search.className = 'lark-doc-mobile-library-search'; input.type = 'search'; input.placeholder = '搜索'; input.maxLength = 128; input.setAttribute('aria-label', '搜索文档库')
  cancel.type = 'button'; cancel.textContent = '取消'; cancel.hidden = true; search.append(iconNode('search', 18), input, cancel)
  const heading = document.createElement('h3'), status = document.createElement('p'), retry = document.createElement('button'), tree = document.createElement('div'), sdk = document.createElement('button')
  heading.textContent = '知识库目录'; status.setAttribute('role', 'status'); retry.type = 'button'; retry.textContent = '重试'; retry.hidden = true
  tree.className = 'lark-doc-mobile-library-tree'; tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', '知识库目录')
  sdk.type = 'button'; sdk.className = 'lark-doc-mobile-library-sdk'; sdk.textContent = '文档功能'; sdk.setAttribute('aria-label', '文档功能')
  drawer.append(head, search, heading, status, retry, tree, sdk); layer.append(mask, drawer)
  let state = {}, scope = null, owner, generation = 0, navigation = null, release, timer, composing = false, disposed = false, items = []
  const open = () => layer.isConnected
  const valid = () => !disposed && open() && scope?.current() === true
  function close(restore = true) {
    generation++; navigation = null; clearTimeout(timer); composing = false; items = []; tree.replaceChildren(); tree.removeAttribute('aria-busy'); input.value = ''; input.placeholder = '搜索'; cancel.hidden = true; layer.remove()
    release?.(); release = null; scope = null
    options.onOpen?.(false)
    if (restore) options.trigger?.focus({ preventScroll: true })
  }
  function normalize(values, seen = new Set(), depth = 0) {
    if (!Array.isArray(values) || depth > 8) throw new Error('DIRECTORY_INVALID')
    return values.map(value => {
      const id = value?.id || value?.docId, name = value?.displayName
      if (seen.size >= 200 || typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(id) || seen.has(id) || typeof name !== 'string' || !name || name.length > 255 || /[\p{Cc}]/u.test(name)) throw new Error('DIRECTORY_INVALID')
      seen.add(id)
      if (value.docId !== undefined && (typeof value.docId !== 'string' || !/^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(value.docId))) throw new Error('DIRECTORY_INVALID')
      if (Array.isArray(value.children)) return { id, docId: value.docId, displayName: name, children: normalize(value.children, seen, depth + 1) }
      if (!value.docId) throw new Error('DIRECTORY_INVALID')
      return { id, docId: value.docId, displayName: name }
    })
  }
  function render(values, parent = tree) {
    parent.replaceChildren()
    values.forEach(item => {
      const itemNode = document.createElement('div'), line = document.createElement('div'), row = document.createElement('button')
      itemNode.setAttribute('role', 'treeitem'); itemNode.className = 'lark-doc-mobile-library-item'; line.className = 'lark-doc-mobile-library-line'
      row.type = 'button'; row.className = 'lark-doc-mobile-library-row'
      row.disabled = navigation !== null
      const label = document.createElement('span'); label.className = 'lark-doc-mobile-library-label'; label.textContent = item.displayName
      row.append(iconNode(item.docId ? 'library-document' : 'chevronDown', 18), label)
      if (item.docId === state.currentDocumentId) row.setAttribute('aria-current', 'page')
      line.append(row); itemNode.append(line); parent.append(itemNode)
      if (item.children) {
        const group = document.createElement('div'), expand = document.createElement('button')
        group.setAttribute('role', 'group'); group.hidden = true; expand.type = 'button'; expand.className = 'lark-doc-mobile-library-expand'; expand.setAttribute('aria-label', `展开 ${item.displayName}`); expand.setAttribute('aria-expanded', 'false'); expand.append(iconNode('chevronDown', 14))
        expand.disabled = navigation !== null
        line.prepend(expand); itemNode.append(group); itemNode.setAttribute('aria-expanded', 'false')
        const toggle = () => { if (!valid()) return close(); if (navigation !== null) return; group.hidden = !group.hidden; expand.setAttribute('aria-expanded', String(!group.hidden)); expand.setAttribute('aria-label', `${group.hidden ? '展开' : '收起'} ${item.displayName}`); itemNode.setAttribute('aria-expanded', String(!group.hidden)); if (!group.hidden) render(item.children, group) }
        expand.addEventListener('click', toggle)
        if (!item.docId) row.addEventListener('click', toggle)
      }
      if (item.docId) row.addEventListener('click', async () => {
        if (!valid() || !row.isConnected) return close()
        if (navigation !== null) return
        const ticket = ++generation; navigation = ticket
        if (tree.contains(document.activeElement)) closeButton.focus()
        tree.querySelectorAll('button').forEach(button => { button.disabled = true }); tree.setAttribute('aria-busy', 'true'); setText(status, '正在打开文档…')
        try {
          const accepted = await options.openDocument(item.docId)
          if (!valid() || ticket !== generation) return
          if (accepted === true) close()
          else setText(status, '暂时无法打开该文档。')
        } catch { if (valid() && ticket === generation) setText(status, '暂时无法打开该文档。') }
        finally { if (navigation === ticket) { navigation = null; tree.removeAttribute('aria-busy'); tree.querySelectorAll('button').forEach(button => { button.disabled = false }) } }
      })
    })
  }
  async function load() {
    clearTimeout(timer)
    if (!valid()) return close()
    const ticket = ++generation, query = input.value
    if (navigation === null) tree.removeAttribute('aria-busy')
    if (document.activeElement === retry) closeButton.focus()
    items = []; tree.replaceChildren(); retry.hidden = true; setText(status, '加载中…'); heading.textContent = query ? '搜索结果' : '知识库目录'
    try {
      const value = query ? await scope.provider.searchDocuments({ query }) : await options.directory?.()
      if (!valid() || ticket !== generation || query !== input.value) return
      const supplied = !query && value?.status === 'resolved'
      items = normalize(query ? value.items : supplied ? value.items : state.currentDocumentId ? [{ docId: state.currentDocumentId, displayName: state.title || '未命名文档' }] : [])
      render(items)
      setText(status, !query && !supplied ? '完整目录由宿主应用提供。' : items.length ? '' : '未找到文档')
    } catch (error) {
      if (!valid() || ticket !== generation) return
      setText(status, error?.code === 'LIBRARY_LIMIT' ? '目录较大，请使用搜索查找文档。' : '加载失败，请重试。'); retry.hidden = error?.code === 'LIBRARY_LIMIT'
    }
  }
  mask.addEventListener('click', () => close()); closeButton.addEventListener('click', () => close()); retry.addEventListener('click', load)
  sdk.addEventListener('click', () => { close(false); options.openSdk() })
  input.addEventListener('focus', () => { input.placeholder = '输入关键词'; cancel.hidden = false })
  input.addEventListener('input', () => { generation++; tree.replaceChildren(); clearTimeout(timer); if (!composing) timer = setTimeout(load, 150) })
  input.addEventListener('compositionstart', () => { composing = true; generation++; clearTimeout(timer) })
  input.addEventListener('compositionend', () => { composing = false; load() })
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !composing && !event.isComposing) { event.preventDefault(); load() } })
  cancel.addEventListener('click', () => { closeButton.focus(); input.value = ''; input.placeholder = '搜索'; cancel.hidden = true; input.blur(); load() })
  layer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const controls = [...drawer.querySelectorAll('button:not(:disabled),input')].filter(e => !e.closest('[hidden]'))
      const index = controls.indexOf(document.activeElement)
      if (event.shiftKey ? index <= 0 : index === controls.length - 1) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus() }
    }
  })
  return {
    el: layer,
    update(next) { if (open() && (!valid() || next.mobileHostHandler !== owner || next.headerVisible === false || window.innerWidth > 760)) close(false); state = next },
    open() {
      if (disposed || open() || window.innerWidth > 760) return
      scope = options.scope(); if (!scope?.current()) return
      owner = state.mobileHostHandler; options.host.append(layer)
      const locks = [...new Set([document.body, options.host.closest('.lark-doc')?.querySelector('.lark-doc-main')].filter(Boolean))].map(lockPageScroll)
      release = () => locks.reverse().forEach(fn => fn()); options.onOpen?.(true); closeButton.focus(); load()
    },
    close,
    destroy() { close(false); disposed = true },
  }
}
