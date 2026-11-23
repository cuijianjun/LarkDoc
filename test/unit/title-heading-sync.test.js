// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { LarkDoc } from '../../src/LarkDoc'
import { collectHeadingEntries, headingOutlineText } from '../../src/core/documentOperations'

const mounted = []

function mountDoc() {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const doc = new LarkDoc({ element, title: '文档标题', content: '<h1>文档标题</h1><p>正文段落</p>' })
  mounted.push(doc)
  return { element, doc, editor: doc.getEditor() }
}

function firstHeading(editor) {
  return collectHeadingEntries(editor.state.doc).find(e => e.level === 1 && !e.hidden)
}

afterEach(() => {
  mounted.splice(0).forEach(doc => doc.destroy())
  localStorage.clear()
})

describe('顶栏标题与正文首个 H1 联动', () => {
  it('改顶栏标题时正文首个 H1 同步为新标题', () => {
    const { element, doc, editor } = mountDoc()
    const input = element.querySelector('input[aria-label="文档标题"]')
    expect(input).not.toBeNull()

    input.value = '顶栏改的标题'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(doc.getTitle()).toBe('顶栏改的标题')
    expect(headingOutlineText(firstHeading(editor).node)).toBe('顶栏改的标题')
  })

  it('正文没有 H1 时改顶栏标题只更新标题本身，不报错', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const doc = new LarkDoc({ element, title: '原标题', content: '<p>只有段落</p>' })
    mounted.push(doc)
    const input = element.querySelector('input[aria-label="文档标题"]')

    input.value = '新标题'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(doc.getTitle()).toBe('新标题')
    expect(collectHeadingEntries(doc.getEditor().state.doc).filter(e => e.level === 1)).toHaveLength(0)
  })

  it('改正文首个 H1 时顶栏标题同步为新标题', async () => {
    const { element, doc, editor } = mountDoc()
    const input = element.querySelector('input[aria-label="文档标题"]')
    const entry = firstHeading(editor)

    editor.chain()
      .setTextSelection({ from: entry.pos + 1, to: entry.pos + 1 + entry.node.content.size })
      .insertContent('正文改的标题')
      .run()
    await Promise.resolve()

    expect(headingOutlineText(firstHeading(editor).node)).toBe('正文改的标题')
    expect(doc.getTitle()).toBe('正文改的标题')
    expect(input.value).toBe('正文改的标题')
  })
})
