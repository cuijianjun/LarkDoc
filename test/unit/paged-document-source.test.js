// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Schema, DOMParser as PMParser } from '@tiptap/pm/model'
import { createPagedDocumentSource, yieldDocumentTask } from '../../src/editor/pagedDocumentSource'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('超大HTML脚本预检可让出执行，跨片script仍在解析正文前拒绝', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now += 9)
  const yieldToMain = vi.fn(async () => {}), preparePage = vi.fn()
  const html = ' '.repeat(16 * 65536 - 4) + '<ScRiPt >escape</script>' + ' '.repeat(2 * 1024 * 1024)
  await expect(createPagedDocumentSource(html, { yieldToMain, preparePage })).rejects.toThrow('含脚本')
  expect(preparePage).not.toHaveBeenCalled()
  expect(yieldToMain.mock.calls.length).toBeGreaterThan(1)
})

it('超大空白HTML的预检可取消，取消后不解析或返回正文', async () => {
  let now = 0, calls = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now += 9)
  const abort = new AbortController(), preparePage = vi.fn()
  const yieldToMain = async () => { if (++calls === 2) abort.abort() }
  await expect(createPagedDocumentSource(' '.repeat(3 * 1024 * 1024), { yieldToMain, preparePage, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(preparePage).not.toHaveBeenCalled()
})

describe('cooperative document frame budget', () => {
  it.each(['frame', 'missing-frame', 'hidden'])('让出渲染预算且后台不挂起：%s', async mode => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'scheduler')
    const task = vi.fn(async () => {})
    Object.defineProperty(window, 'scheduler', { configurable: true, value: { yield: task } })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(mode === 'hidden')
    vi.spyOn(window.performance, 'now').mockReturnValue(mode === 'frame' ? 100000 : mode === 'missing-frame' ? 200000 : 300000)
    let callback
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(run => { callback = run; return 9944 })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    try {
      if (mode === 'missing-frame') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let complete = false
      const pending = yieldDocumentTask().then(() => { complete = true })
      await Promise.resolve()
      if (mode === 'hidden') { await pending; expect(frame).not.toHaveBeenCalled(); expect(task).toHaveBeenCalledOnce(); return }
      expect(complete).toBe(false)
      expect(frame).toHaveBeenCalledOnce()
      if (mode === 'frame') { callback(100000); await Promise.resolve(); expect(complete).toBe(false) }
      else await vi.advanceTimersByTimeAsync(64)
      await pending
      expect(cancel).toHaveBeenCalledWith(9944)
      if (mode === 'frame') { await yieldDocumentTask(); expect(task).toHaveBeenCalledOnce(); expect(frame).toHaveBeenCalledOnce() }
    } finally {
      if (descriptor) Object.defineProperty(window, 'scheduler', descriptor)
      else delete window.scheduler
    }
  })
})

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }] },
  heading: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'h1' }] },
  blockquote: { group: 'block', content: 'block+', parseDOM: [{ tag: 'blockquote' }] },
} })
const parse = html => {
  const dom = document.createElement('div')
  dom.innerHTML = html
  return PMParser.fromSchema(schema).parse(dom)
}

describe('paged import source', () => {
  it('packs short prepared fragments into bounded commit pages', async () => {
    const html = Array.from({ length: 13 }, (_, i) => `<p>${i}</p>`).join('')
    const source = await createPagedDocumentSource(html, { pageBlocks: 4, pageChars: 15,
      yieldToMain: async () => {}, preparePage: value => parse(value),
    })
    expect(source.pages.map(page => page.childCount)).toEqual([4, 4, 4, 1])
    expect(source.pages.every(page => page.content.size <= 15)).toBe(true)
    expect(source.pages.flatMap(page => page.content.content).map(node => node.textContent)).toEqual(Array.from({ length: 13 }, (_, i) => String(i)))
  })
  it('prepares bounded pages and yields before parsing the entire input', async () => {
    const content = Array.from({ length: 257 }, (_, i) => `<p>${i}</p>`).join('')
    let yielded = 0
    const parsedAfter = []
    const source = await createPagedDocumentSource(content, {
      pageBlocks: 16, pageChars: 128,
      yieldToMain: async () => { yielded++ },
      preparePage: value => { parsedAfter.push(yielded); return parse(value) },
    })
    expect(source.pageCount).toBeGreaterThan(16)
    expect(parsedAfter.every(value => value > 0)).toBe(true)
    expect(source.blockCount).toBe(257)
    expect(source.pages.every(page => page.childCount <= 16)).toBe(true)
    expect(source.pages.flatMap(page => page.content.content).map(node => node.textContent)).toEqual(Array.from({ length: 257 }, (_, i) => String(i)))
  })

  it('keeps quoted delimiters, comments, raw text and structural containers intact', async () => {
    const html = '<div><p title="a > b">one</p><!-- <p>fake</p> -->' +
      '<script>const text="<p>not a block</p>"</script><blockquote><p>two</p><p>three</p></blockquote><p>four</p></div>'
    const values = []
    await createPagedDocumentSource(html, { pageBlocks: 1, pageChars: 1,
      yieldToMain: async () => {}, preparePage: value => { values.push(value); return parse(value) },
    })
    const doc = schema.node('doc', null, values.flatMap(value => parse(value).content.content))
    expect(doc.toJSON()).toEqual(parse(html).toJSON())
    expect(values.some(value => value.includes('<blockquote><p>two</p><p>three</p></blockquote>'))).toBe(true)
  })

  it('uses ordinary div blocks as boundaries while retaining the outer layout wrapper', async () => {
    const html = '<div class="document">' + Array.from({ length: 30 }, (_, i) => `<div>${i}</div>`).join('') + '</div>'
    const source = await createPagedDocumentSource(html, { pageBlocks: 2, pageChars: 100, maxBlockChars: 200,
      yieldToMain: async () => {}, preparePage: value => parse(value),
    })
    expect(source.pageCount).toBeGreaterThan(10)
    expect(schema.node('doc', null, source.pages.flatMap(page => page.content.content)).toJSON()).toEqual(parse(html).toJSON())
  })

  it('flattens heading children across JSON pages without losing root validation', async () => {
    const root = { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'head' }], children: [
      { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
    ] }, { type: 'paragraph' }] }
    const originals = JSON.stringify(root), seen = []
    const source = await createPagedDocumentSource(root, { pageBlocks: 1, yieldToMain: async () => {}, preparePage: value => {
      seen.push(value); return schema.nodeFromJSON(value)
    } })
    expect(source.blockCount).toBe(3)
    expect(seen.map(value => value.content[0].type)).toEqual(['heading', 'paragraph', 'paragraph'])
    expect(seen[0].content[0].children).toBeUndefined()
    expect(JSON.stringify(root)).toBe(originals)
  })

  it('aborts between pages and rejects an unbounded single HTML container before DOM parsing', async () => {
    const abort = new AbortController()
    let parsed = 0
    await expect(createPagedDocumentSource('<p>a</p><p>b</p>', { pageBlocks: 1, signal: abort.signal,
      yieldToMain: async () => {}, preparePage: value => { parsed++; abort.abort(); return parse(value) },
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(parsed).toBe(1)
    await expect(createPagedDocumentSource('<blockquote>' + 'x'.repeat(200) + '</blockquote>', {
      maxBlockChars: 100, yieldToMain: async () => {}, preparePage: () => { throw Error('must not parse') },
    })).rejects.toThrow('单个内容块')
  })

  it('reads JSON text and record metadata by pages without parsing the whole array', async () => {
    const doc = { type: 'doc', content: Array.from({ length: 19 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `${index} ${String.fromCharCode(34, 93, 125, 92, 34)}` }] })) }
    const source = await createPagedDocumentSource(JSON.stringify({ title: 'record title', schemaVersion: 2, document: doc }), {
      format: 'json', pageBlocks: 3, yieldToMain: async () => {}, preparePage: page => schema.nodeFromJSON(page),
    })
    expect(source.title).toBe('record title')
    expect(source.pageCount).toBe(7)
    expect(source.blockCount).toBe(19)
    expect(schema.node('doc', null, source.pages.flatMap(page => page.content.content)).toJSON()).toEqual(doc)
    const spaced = await createPagedDocumentSource('{"type":"doc","content":[{"type":"paragraph"}' + ' '.repeat(70000) + ',{"type":"paragraph"}]}', {
      format: 'json', yieldToMain: async () => {}, preparePage: page => schema.nodeFromJSON(page),
    })
    expect(spaced.blockCount).toBe(2)
    for (const text of ['{"type":"doc","content":[{"type":"paragraph"},]}', '{"type":"doc","content":[],"content":[]}', '{"type":"doc","content":[{"type":"paragraph"}]} trailing',
      '{"type":"doc","content":[[' + Array.from({ length: 20 }, () => '{"type":"paragraph"}').join(',') + '}]}']) {
      await expect(createPagedDocumentSource(text, { format: 'json', maxBlockChars: 200, yieldToMain: async () => {}, preparePage: page => schema.nodeFromJSON(page) })).rejects.toThrow()
    }
  })

  it('splits an exported large heading section without treating all children as one block', async () => {
    const body = Array.from({ length: 41 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `${index} ${'文'.repeat(50)}` }] }))
    const root = { type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'A' }], children: [
      { type: 'heading', content: [{ type: 'text', text: 'B' }], children: body },
    ] }, { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] }] }
    const source = await createPagedDocumentSource(JSON.stringify({ schemaVersion: 3, document: root }), {
      format: 'json', pageBlocks: 4, pageChars: 500, maxBlockChars: 200,
      yieldToMain: async () => {}, preparePage: page => schema.nodeFromJSON(page),
    })
    expect(source.blockCount).toBe(44)
    expect(source.pages.every(page => page.childCount <= 4)).toBe(true)
    expect(source.pages.flatMap(page => page.content.content).map(node => node.textContent)).toEqual(['A', 'B', ...body.map(node => node.content[0].text), 'tail'])
    await expect(createPagedDocumentSource(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(500) }] }] }), {
      format: 'json', maxBlockChars: 200, yieldToMain: async () => {}, preparePage: page => schema.nodeFromJSON(page),
    })).rejects.toThrow('单个内容块')
  })
})
