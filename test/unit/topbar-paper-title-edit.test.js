// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTopBar } from '../../src/ui/topBar'

const mounted = []
afterEach(() => { mounted.splice(0).reverse().forEach(ui => ui.destroy()); document.body.replaceChildren() })

function fixture(state = {}) {
  const host = document.createElement('section'), paper = document.createElement('div'), body = document.createElement('div')
  host.className = 'lark-doc'; paper.className = 'lark-doc-paper'; body.className = 'lark-doc-editor-content'
  paper.append(body); host.append(paper); document.body.append(host)
  let current = { title: 'Docker 本地协作文档', compactHeader: true, titleLength: 12, ...state }
  const updateTitle = vi.fn()
  const ui = createTopBar({ host, paperHost: paper, overlayHost: host, handlers: { updateTitle } })
  const paint = () => ui.update(current)
  paint(); mounted.push(ui)
  const heading = () => paper.querySelector('.lark-doc-mobile-document-title')
  const type = (text) => { const el = heading(); el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })) }
  return { ui, paper, updateTitle, heading, type, set: patch => { current = { ...current, ...patch }; paint() } }
}

describe('正文大标题可编辑', () => {
  it('紧凑头下渲染并可编辑，输入回写 updateTitle', () => {
    const { heading, updateTitle, type } = fixture()
    expect(heading()).not.toBeNull()
    expect(heading().getAttribute('contenteditable')).toBe('plaintext-only')
    expect(heading().textContent).toBe('Docker 本地协作文档')
    type('改名了')
    expect(updateTitle).toHaveBeenCalledWith('改名了')
    expect(heading().textContent).toBe('改名了')
  })

  it('只读时摘掉 contenteditable', () => {
    const { heading, set } = fixture()
    set({ readonly: true })
    expect(heading().getAttribute('contenteditable')).toBe('false')
  })

  it('超过 titleLength 输入被截断', () => {
    const { heading, updateTitle, type } = fixture()
    type('12345678901234567')
    expect(heading().textContent).toBe('123456789012')
    expect(updateTitle).toHaveBeenCalledWith('123456789012')
  })

  it('空标题不写占位文本，交给 data-placeholder', () => {
    const { heading, set } = fixture({ title: '' })
    expect(heading().textContent).toBe('')
    expect(heading().getAttribute('data-placeholder')).toBe('未命名文档')
    set({ title: '回来了' })
    expect(heading().textContent).toBe('回来了')
  })
})
