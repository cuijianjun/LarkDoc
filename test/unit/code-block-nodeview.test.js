// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import highlighter from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { sanitizeHTML, validateDocument } from '../../src/core/documentOperations'
import revisionMixin from '../../src/components/lark-doc/editor/revisionMixin'
import { languageLoaders } from '../../src/core/nodeviews/code-languages'

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  codeBlock: { group: 'block', content: 'text*', attrs: { language: { default: 'plaintext' } } },
} })
const mounted = []
const unregister = []
const editors = []

describe('新增语言真实词法', () => {
  const samples = [
    ['abap', `DATA(text) = 'It''s "safe"'. WRITE |Count: { 42 }|.`, { keyword: ['DATA', 'WRITE'], string: [`'It''s "safe"'`], number: ['42'] }],
    ['apex', `trigger Demo on Account (before insert) { List<Account> a = [SELECT Id FROM Account WHERE Name = 'Acme']; Integer n = 42; }`, { keyword: ['trigger', 'SELECT', 'WHERE'], built_in: ['List', 'Integer'], string: ["'Acme'"], number: ['42'] }],
    ['cobol', '       01 ITEM-1 PIC 9(3) VALUE 42.', { keyword: ['PIC', 'VALUE'], type: ['9(3)'], number: ['01', '42'] }],
    ['graphql', 'query X($id: ID!) { user(id: $id) @skip(if: false) { name } }', { keyword: ['query'], variable: ['$id'], built_in: ['ID'], meta: ['@skip'], literal: ['false'] }],
    ['solidity', 'contract Vault { uint256 public n = 1_000; bytes2 tag = hex"abcd"; bool b = true; }', { keyword: ['contract', 'public'], built_in: ['uint256', 'bytes2', 'bool'], number: ['1_000'], string: ['hex"abcd"'], literal: ['true'] }],
  ]
  const render = async (language, source) => {
    const grammar = await languageLoaders[language]()
    highlighter.registerLanguage(language, grammar.default || grammar)
    const result = highlighter.highlight(source, { language, ignoreIllegals: true })
    expect(result.errorRaised).toBeUndefined()
    const node = document.createElement('code')
    node.innerHTML = result.value
    expect(node.textContent).toBe(source)
    return node
  }
  it.each(samples)('%s 按本语言注册与标记，保留源代码', async (language, source, expected) => {
    const node = await render(language, source)
    for (const [type, tokens] of Object.entries(expected)) {
      const actual = [...node.querySelectorAll(`.hljs-${type}`)].map(element => element.textContent)
      for (const token of tokens) expect(actual).toContain(token)
    }
  })
  it.each(['01 123-NAME PIC X.', '01 123-DATA PIC X.', '01 ITEM_DATA PIC X.', 'MOVE +123 TO ITEM-1.'])('COBOL 名称不拆成数字或关键词：%s', async source => {
    const node = await render('cobol', `>>SOURCE FORMAT FREE\n${source}`)
    expect([...node.querySelectorAll('.hljs-number')].map(e => e.textContent)).toEqual(source.startsWith('MOVE') ? ['+123'] : ['01'])
    expect([...node.querySelectorAll('.hljs-keyword')].map(e => e.textContent)).not.toContain('DATA')
  })
  it('COBOL 显式free格式中的引号不误作固定列注释', async () => {
    const node = await render('cobol', '>>SOURCE FORMAT FREE\nMOVE "*x" TO X.\nMOVE "/tmp" TO PATH.')
    expect(node.querySelector('.hljs-comment')).toBeNull()
    expect([...node.querySelectorAll('.hljs-string')].map(e => e.textContent)).toEqual(['"*x"', '"/tmp"'])
    const fixed = await render('cobol', '>>SOURCE FORMAT FIXED\nABC123* DISPLAY "NOT CODE"')
    expect(fixed.querySelector('.hljs-comment')?.textContent).toBe('ABC123* DISPLAY "NOT CODE"')
  })
  it.each(['abap', 'apex', 'cobol', 'graphql', 'solidity'])('%s 字面量中HTML保持转义', async language => {
    const node = await render(language, language === 'apex' ? "'<img src=x onerror=alert(1)>'" : '"<img src=x onerror=alert(1)>"')
    expect(node.querySelector('img')).toBeNull()
  })
})
let createCodeBlockNodeView
let registerFeature

beforeEach(async () => {
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
  }))
  vi.resetModules()
  ;({ createCodeBlockNodeView } = await import('../../src/core/nodeviews/code-block'))
  ;({ registerFeature } = await import('../../src/core/features/registry'))
  highlighter.registerLanguage('javascript', javascript)
})

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  mounted.splice(0).forEach(view => view.destroy())
  unregister.splice(0).forEach(dispose => dispose())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.textContent = ''
})

function mount(language = 'js', options = {}) {
  const node = schema.node('codeBlock', { language }, schema.text('const answer = 42'))
  const view = createCodeBlockNodeView({ node, editor: { isEditable: true }, extension: { options } })
  mounted.push(view)
  document.body.appendChild(view.dom)
  return { view, node, highlight: view.dom.querySelector('.lark-doc-code-highlight code') }
}

describe('Feishu code block closed interaction', () => {
  function realCode(content = '<pre data-language="plaintext"><code>const answer = 42</code></pre><p>after</p>') {
    const editor = new Editor({ element: document.createElement('div'), extensions: createLarkDocExtensions(), content })
    editors.push(editor)
    document.body.appendChild(editor.view.dom)
    return editor
  }

  it('offers the exact 71 source languages with ordered-subsequence search and literal spaces', async () => {
    const { codeBlockLanguageOptions, filterCodeBlockLanguages } = await import('../../src/core/nodeviews/code-block')
    const choices = codeBlockLanguageOptions(true)
    expect(choices).toHaveLength(71)
    expect(choices[0].label).toBe('Plain Text')
    expect(choices.at(-1).label).toBe('YAML')
    expect(choices.some(item => item.label === 'Mermaid 图表')).toBe(false)
    expect(filterCodeBlockLanguages('jpt').map(item => item.label)).toEqual(['JavaScript'])
    expect(filterCodeBlockLanguages('jv').map(item => item.label)).toEqual(['Java', 'JavaScript', 'Objective-C'])
    expect(filterCodeBlockLanguages('PYtHon').map(item => item.label)).toEqual(['Python'])
    expect(filterCodeBlockLanguages(' python')).toEqual([])
    expect(filterCodeBlockLanguages('Python ')).toEqual([])
  })

  it('edits caption, searches language, toggles wrap, remembers new-block preferences and survives HTML/JSON', () => {
    const editor = realCode()
    const code = editor.view.dom.querySelector('.lark-doc-code')
    const caption = code.querySelector('input[aria-label="代码块标题"]')
    expect(caption).not.toBeNull()
    caption.value = 'example.js'
    caption.dispatchEvent(new Event('input', { bubbles: true }))
    caption.dispatchEvent(new Event('blur'))
    const wrap = code.querySelector('[aria-label="自动换行"]')
    expect(wrap).not.toBeNull()
    wrap.click()
    code.querySelector('button[aria-label="代码语言"]').click()
    const menu = document.querySelector('.lark-doc-code-language-menu')
    expect(menu).not.toBeNull()
    const search = menu.querySelector('input')
    search.value = 'jpt'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1)
    menu.querySelector('[role="option"]').click()
    expect(editor.getJSON().content[0].attrs).toMatchObject({ caption: 'example.js', wrap: true, language: 'javascript' })
    const html = sanitizeHTML(editor.getHTML())
    editor.commands.setContent(html)
    expect(editor.getJSON().content[0].attrs).toMatchObject({ caption: 'example.js', wrap: true, language: 'javascript' })
    const json = validateDocument(editor.getJSON(), editor.schema)
    expect(json.content[0].attrs.wrap).toBe(true)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.setCodeBlock()
    const codeBlocks = editor.getJSON().content.filter(node => node.type === 'codeBlock')
    expect(codeBlocks).toHaveLength(2)
    expect(codeBlocks.at(-1).attrs).toMatchObject({ language: 'javascript', wrap: true, caption: '' })
  })

  it('restores an empty caption on blur, supports undo and blocks readonly changes', () => {
    const editor = realCode()
    const code = editor.view.dom.querySelector('.lark-doc-code')
    const caption = code.querySelector('input[aria-label="代码块标题"]')
    expect(caption).not.toBeNull()
    caption.value = ''
    caption.dispatchEvent(new Event('blur'))
    expect(caption.value || caption.placeholder).toBe('代码块')
    code.querySelector('[aria-label="自动换行"]').click()
    expect(editor.getJSON().content[0].attrs.wrap).toBe(true)
    editor.commands.undo()
    expect(editor.getJSON().content[0].attrs.wrap).toBe(false)
    editor.setEditable(false)
    code.querySelector('[aria-label="自动换行"]').click()
    caption.value = 'forbidden'
    caption.dispatchEvent(new Event('input', { bubbles: true }))
    expect(editor.getJSON().content[0].attrs).toMatchObject({ caption: '', wrap: false })
    expect(() => validateDocument({ type: 'doc', content: [{ type: 'codeBlock', attrs: { wrap: 'yes' } }] }, editor.schema)).toThrow()
  })

  it('keeps folding outside document history and resets folding on a new view', () => {
    const editor = realCode()
    const code = editor.view.dom.querySelector('.lark-doc-code')
    const caption = code.querySelector('input[aria-label="代码块标题"]')
    caption.value = '长'.repeat(1001)
    caption.dispatchEvent(new Event('input', { bubbles: true }))
    caption.blur()
    expect(editor.getJSON().content[0].attrs.caption).toHaveLength(1001)
    const saved = editor.getJSON()
    code.querySelector('[aria-label="折叠代码块"]').click()
    expect(code.classList.contains('is-collapsed')).toBe(true)
    expect(code.querySelector('.lark-doc-code-body').style.display).toBe('none')
    expect(editor.getJSON()).toEqual(saved)
    editor.commands.undo()
    expect(code.classList.contains('is-collapsed')).toBe(true)
    const reloaded = realCode(saved)
    expect(reloaded.view.dom.querySelector('.lark-doc-code.is-collapsed')).toBeNull()
    expect(reloaded.getJSON().content[0].attrs.caption).toHaveLength(1001)
  })

  it('keeps one gutter number per logical line and offsets after a wrapped line', async () => {
    const editor = realCode()
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = Document.prototype.createRange.call(document)
      range.getClientRects = () => range.toString() === 'wrapped'
        ? [{ top: 0, bottom: 22, height: 22 }, { top: 22, bottom: 44, height: 22 }, { top: 44, bottom: 66, height: 22 }]
        : [{ top: 0, bottom: 22, height: 22 }]
      return range
    })
    editor.commands.setContent('<pre data-code-wrap="true"><code>first\nwrapped\nlast</code></pre>')
    const numbers = () => [...editor.view.dom.querySelectorAll('.lark-doc-code-line-numbers > span')]
    await vi.waitFor(() => expect(numbers().map(node => [node.textContent, node.style.height])).toEqual([
      ['1', '22px'], ['2', '66px'], ['3', '22px'],
    ]))
    editor.view.dom.querySelector('[aria-label="取消自动换行"]').click()
    await vi.waitFor(() => expect(numbers().map(node => node.style.height)).toEqual(['22px', '22px', '22px']))
  })

  it('supports keyboard search, literal no-result queries, outside close and readonly close', () => {
    const editor = realCode()
    const trigger = editor.view.dom.querySelector('[aria-label="代码语言"]')
    trigger.click()
    let search = document.querySelector('.lark-doc-code-language-search')
    search.value = ' python'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.querySelector('.lark-doc-code-language-empty').textContent).toBe('无匹配结果')
    expect(document.querySelector('[role="option"]')).toBeNull()
    search.value = 'jpt'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.getJSON().content[0].attrs.language).toBe('javascript')
    expect(document.querySelector('.lark-doc-code-language-menu')).toBeNull()
    trigger.click()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(document.querySelector('.lark-doc-code-language-menu')).toBeNull()
    trigger.click()
    search = document.querySelector('.lark-doc-code-language-search')
    expect(search).not.toBeNull()
    editor.setEditable(false)
    expect(document.querySelector('.lark-doc-code-language-menu')).toBeNull()
    trigger.click()
    expect(document.querySelector('.lark-doc-code-language-menu')).toBeNull()
  })

  it.each([['js', 'JavaScript', 'javascript'], ['ts', 'TypeScript', 'typescript'], ['htm', 'XML', 'xml']])('keeps the active item consistent for legacy %s when pressing Enter', (alias, label, value) => {
    const editor = realCode(`<pre data-language="${alias}"><code>text</code></pre>`)
    editor.view.dom.querySelector('[aria-label="代码语言"]').click()
    const menu = document.querySelector('.lark-doc-code-language-menu')
    expect(menu.querySelector('[aria-selected="true"]').textContent).toBe(label)
    expect(menu.querySelector('.is-highlight').textContent).toBe(label)
    menu.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.getJSON().content[0].attrs.language).toBe(value)
  })

  it('keeps pasted captions within the document string boundary and round-trips the maximum', () => {
    const editor = realCode()
    const input = editor.view.dom.querySelector('[aria-label="代码块标题"]')
    input.value = 'x'.repeat(100001) + '\u0000'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.value).toHaveLength(100000)
    expect(editor.getJSON().content[0].attrs.caption).toBe('x'.repeat(100000))
    expect(() => validateDocument(editor.getJSON(), editor.schema)).not.toThrow()
    const html = sanitizeHTML(editor.getHTML())
    editor.commands.setContent(html)
    expect(editor.getJSON().content[0].attrs.caption).toHaveLength(100000)
    for (const caption of ['x'.repeat(100001), 'x\u0000']) {
      const doc = { type: 'doc', content: [{ type: 'codeBlock', attrs: { caption } }] }
      expect(() => validateDocument(doc, editor.schema)).toThrow()
    }
  })

  it('locks the caption in suggest mode while keeping code editable, then unlocks on edit without remounting', () => {
    const editor = realCode()
    const input = editor.view.dom.querySelector('[aria-label="代码块标题"]')
    const host = { editor, mode: 'suggest', interactionMode: 'suggest', updateRevisionPanels() {} }
    revisionMixin.methods.syncRevisionTracking.call(host)
    expect(editor.isEditable).toBe(true)
    expect(input.disabled).toBe(true)
    input.value = 'forbidden'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(editor.getJSON().content[0].attrs.caption).toBe('')
    host.mode = host.interactionMode = 'edit'
    revisionMixin.methods.syncRevisionTracking.call(host)
    expect(input.disabled).toBe(false)
    input.value = 'allowed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(editor.getJSON().content[0].attrs.caption).toBe('allowed')
  })

  it('copies unchanged text with a three-second toast and clears feedback on destroy', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { view } = mount('plaintext')
    await view.copyCode()
    expect(writeText).toHaveBeenCalledWith('const answer = 42')
    expect(view.dom.querySelector('.lark-doc-code-copy').textContent).toBe('复制')
    const status = view.dom.querySelector('[role="status"]')
    expect(status.textContent).toBe('复制成功')
    vi.advanceTimersByTime(2999)
    expect(status.textContent).toBe('复制成功')
    vi.advanceTimersByTime(1)
    expect(status.textContent).toBe('')
    await view.copyCode()
    view.destroy()
    mounted.splice(mounted.indexOf(view), 1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('代码块加载失败后的恢复', () => {
  it('同一语言下次更新重新加载，并复用并发请求而不自动循环重试', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('temporary highlight chunk 404')).mockResolvedValue(highlighter)
    unregister.push(registerFeature('highlight', loader))
    const first = mount()
    const second = mount('javascript')
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    // 等待失败链结束；两份视图仍显示经过转义的源码。
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(first.highlight.querySelector('.hljs-keyword')).toBeNull()
    expect(second.highlight.querySelector('.hljs-keyword')).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)

    first.view.update(first.node)
    second.view.update(second.node)
    await vi.waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2)
      expect(first.highlight.querySelector('.hljs-keyword').textContent).toBe('const')
      expect(second.highlight.querySelector('.hljs-number').textContent).toBe('42')
    })
    expect(first.view.dom.querySelector('button[aria-label="代码语言"]').textContent).toBe('JavaScript')
    expect(first.node.attrs.language).toBe('js')
  })

  it('语言注册失败也能在同语言更新时恢复', async () => {
    const loaded = new Set()
    const registerLanguage = vi.fn().mockImplementationOnce(() => { throw new Error('temporary language failure') }).mockImplementation((name, grammar) => { highlighter.registerLanguage(name, grammar); loaded.add(name) })
    const runtime = {
      getLanguage: name => loaded.has(name),
      registerLanguage,
      highlight: highlighter.highlight.bind(highlighter),
    }
    unregister.push(registerFeature('highlight', () => runtime))
    const { view, node, highlight } = mount('sql')
    await vi.waitFor(() => expect(registerLanguage).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(highlight.querySelector('span')).toBeNull()
    view.update(node)
    await vi.waitFor(() => {
      expect(registerLanguage).toHaveBeenCalledTimes(2)
      expect(highlight.querySelector('.hljs-number').textContent).toBe('42')
    })
  })

  it('恢复真实图表错误原因并只通知一次应用回调', async () => {
    const error = new Error('temporary mermaid chunk 404')
    unregister.push(registerFeature('mermaid', () => Promise.reject(error)))
    const onDiagramError = vi.fn()
    const { view } = mount('mermaid', { onDiagramError })
    await vi.waitFor(() => expect(onDiagramError).toHaveBeenCalledTimes(1))
    expect(onDiagramError).toHaveBeenCalledWith(error)
    expect(view.dom.querySelector('.lark-doc-diagram-error').textContent).toContain('temporary mermaid chunk 404')
    expect(view.getState().diagramError).toContain('temporary mermaid chunk 404')
    expect(view.dom.querySelector('.lark-doc-code-body').style.display).toBe('')
  })

  it('图表解析失败不残留全局错误 SVG，保留错误回调并可修正后恢复', async () => {
    const error = new Error('Parse error on line 2')
    const mermaid = {
      initialize: vi.fn(),
      render: vi.fn(async (id, source) => {
        const container = document.createElement('div')
        container.id = `d${id}`
        container.innerHTML = '<svg><text class="error-text">Syntax error in text</text></svg>'
        document.body.appendChild(container)
        if (source === 'const answer = 42') throw error
        container.remove()
        return { svg: '<svg><text>恢复成功</text></svg>' }
      }),
    }
    unregister.push(registerFeature('mermaid', () => mermaid))
    const onDiagramError = vi.fn()
    const { view } = mount('mermaid', { onDiagramError })
    await vi.waitFor(() => expect(onDiagramError).toHaveBeenCalledTimes(1))
    expect(onDiagramError).toHaveBeenCalledWith(error)
    expect(view.getState().diagramError).toBe(error.message)
    expect(view.dom.querySelector('.lark-doc-diagram-error').textContent).toBe(error.message)
    expect(view.dom.querySelector('.lark-doc-code-body').style.display).toBe('')
    expect(document.querySelector('body > div[id^="dlark-doc-diagram-"]')).toBeNull()

    view.update(schema.node('codeBlock', { language: 'mermaid' }, schema.text('graph TD\n A --> B')))
    await vi.waitFor(() => expect(view.dom.querySelector('.lark-doc-diagram-svg svg')).not.toBeNull())
    expect(view.getState().diagramError).toBe('')
    expect(onDiagramError).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.error-text')).toBeNull()
  })

  it('销毁视图后迟到的失败仍清理自身临时节点，不删除其他并发图表', async () => {
    const pending = []
    unregister.push(registerFeature('mermaid', () => ({
      initialize: vi.fn(),
      render: (id) => new Promise((resolve, reject) => {
        const container = document.createElement('div')
        container.id = `d${id}`
        document.body.appendChild(container)
        pending.push({ container, resolve, reject })
      }),
    })))
    const onDiagramError = vi.fn()
    const first = mount('mermaid', { onDiagramError })
    const second = mount('mermaid')
    const unrelated = document.createElement('div')
    unrelated.id = 'dhost-mermaid'
    document.body.appendChild(unrelated)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    first.view.destroy()
    mounted.splice(mounted.indexOf(first.view), 1)
    pending[0].reject(new Error('late parse error'))
    await vi.waitFor(() => expect(pending[0].container.isConnected).toBe(false))
    expect(onDiagramError).not.toHaveBeenCalled()
    expect(pending[1].container.isConnected).toBe(true)
    expect(unrelated.isConnected).toBe(true)

    pending[1].resolve({ svg: '<svg><text>另一个图表</text></svg>' })
    await vi.waitFor(() => expect(second.view.dom.querySelector('.lark-doc-diagram-svg svg')).not.toBeNull())
    expect(pending[1].container.isConnected).toBe(false)
    expect(unrelated.isConnected).toBe(true)
  })
})
