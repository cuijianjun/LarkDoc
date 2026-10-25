/**
 * P2-04 文件 / 视频块：形态分流 / 大小口径 / 失败文案 / 落块属性 / NodeView 三形态。
 *
 * 三层用例：
 * 1. 纯判定层（core/media/file-block.js）——0 DOM，Node 14 可直接跑；
 * 2. 属性拼装（fileBlockAttrs）——token 兜底、viewType 推导；
 * 3. NodeView（core/nodeviews/file-block.js）——起真编辑器，验证
 *    「一个块壳三形态」「失败态照常落块且换文案」这两条 02 §19.5 的硬要求。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import {
  DEFAULT_FILE_MAX_SIZE, FILE_KIND, FILE_REJECT, FILE_VIEW_TYPES, fileBlockAttrs,
  fileFallbackText, fileFooterText, fileKindOf, fileRejectMessage, formatFileSize,
  isPreviewableKind, sortFileFiles,
} from '../../src/core/media/file-block'

const makeFile = (type, size = 1024, name = 'f.bin') => ({ name, type, size })

/** 造一台只放一个文件块的最小编辑器；`options` 透传给 extensions（注入换票器用）。 */
function mountFileBlock(attrs, options) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(options),
    content: { type: 'doc', content: [{ type: 'fileBlock', attrs }] },
  })
  return editor
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('fileKindOf：三种呈现形态由 mimeType 分流', () => {
  it('video/* 走播放器，大小写与空白不敏感', () => {
    for (const type of ['video/mp4', 'video/quicktime', 'VIDEO/MP4', ' video/webm ']) {
      expect(fileKindOf(type)).toBe(FILE_KIND.VIDEO)
    }
  })

  it('application/pdf 走 iframe viewer（唯一一个非视频却内嵌预览的形态）', () => {
    for (const type of ['application/pdf', 'APPLICATION/PDF']) {
      expect(fileKindOf(type)).toBe(FILE_KIND.PDF)
    }
  })

  it('其余一律卡片兜底：图片 / 压缩包 / 空值都不例外', () => {
    for (const type of ['image/png', 'application/zip', 'text/plain', '', null, undefined]) {
      expect(fileKindOf(type)).toBe(FILE_KIND.CARD)
    }
  })

  it('只有 video / pdf 需要挂预览元素', () => {
    expect(isPreviewableKind(FILE_KIND.VIDEO)).toBe(true)
    expect(isPreviewableKind(FILE_KIND.PDF)).toBe(true)
    expect(isPreviewableKind(FILE_KIND.CARD)).toBe(false)
  })
})

describe('formatFileSize：KB 起固定两位小数、无空格、1024 进制', () => {
  it('对齐 02 实测样本：recon-doc.pdf 40016 B → 39.08KB', () => {
    expect(formatFileSize(40016)).toBe('39.08KB')
  })

  it('45 MB 的视频显示 45.00MB（两位小数补齐，不写成 45MB）', () => {
    expect(formatFileSize(45 * 1024 * 1024)).toBe('45.00MB')
  })

  it('KB / MB / GB 逐级递进', () => {
    expect(formatFileSize(1024)).toBe('1.00KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.00MB')
    expect(formatFileSize(DEFAULT_FILE_MAX_SIZE)).toBe('10.00GB')
  })

  it('B 档取整数（实测无样本，不造「512.00B」这种形状）', () => {
    expect(formatFileSize(512)).toBe('512B')
    expect(formatFileSize(1023)).toBe('1023B')
  })

  it('0 / 负数 / 非法值统一退成 0B，不抛错', () => {
    for (const value of [0, -1, null, undefined, NaN, 'abc']) {
      expect(formatFileSize(value)).toBe('0B')
    }
  })
})

describe('fileFooterText：文件名缺失时不留孤零零的间隔点', () => {
  it('有名字：`名字 · 大小`', () => {
    expect(fileFooterText('recon-doc.pdf', 40016)).toBe('recon-doc.pdf · 39.08KB')
  })

  it('无名字：只剩大小', () => {
    expect(fileFooterText('', 40016)).toBe('39.08KB')
    expect(fileFooterText('   ', 40016)).toBe('39.08KB')
    expect(fileFooterText(null, 0)).toBe('0B')
  })
})

describe('fileFallbackText：失败文案分两套（视频那套字不一样）', () => {
  it('视频解码失败', () => {
    expect(fileFallbackText(FILE_KIND.VIDEO)).toBe('不支持的音频/视频格式 请下载文件后用其他软件打开')
  })

  it('PDF / 卡片：损坏或加密', () => {
    const text = '文件因损坏或加密等原因无法预览，请下载到本地打开'
    expect(fileFallbackText(FILE_KIND.PDF)).toBe(text)
    expect(fileFallbackText(FILE_KIND.CARD)).toBe(text)
  })

  it('两套文案不许合并成一条', () => {
    expect(fileFallbackText(FILE_KIND.VIDEO)).not.toBe(fileFallbackText(FILE_KIND.PDF))
  })
})

describe('fileRejectMessage：带文件名、上下限同句', () => {
  it('空文件与超限同一句话（02 L4188 原文口径）', () => {
    const text = '「a.mp4」上传失败，文件大小为 0 MB 或者大于 10.00GB'
    expect(fileRejectMessage(FILE_REJECT.EMPTY, { name: 'a.mp4' })).toBe(text)
    expect(fileRejectMessage(FILE_REJECT.SIZE, { name: 'a.mp4' })).toBe(text)
  })

  it('上限跟着 maxSize 走', () => {
    expect(fileRejectMessage(FILE_REJECT.SIZE, { name: 'b.zip', maxSize: 2048 }))
      .toBe('「b.zip」上传失败，文件大小为 0 MB 或者大于 2.00KB')
  })

  it('没有文件名时不硬塞空书名号', () => {
    expect(fileRejectMessage(FILE_REJECT.SIZE, { maxSize: DEFAULT_FILE_MAX_SIZE }))
      .toBe('上传失败，文件大小为 0 MB 或者大于 10.00GB')
  })

  it('未知原因有兜底文案', () => {
    expect(fileRejectMessage('WHATEVER')).toBe('文件上传失败')
  })
})

describe('sortFileFiles：不限 MIME，只查区间 (0, maxSize]', () => {
  it('任意类型都收（斜杠 file 的 accept 是 null）', () => {
    const files = [
      makeFile('video/mp4'),
      makeFile('application/pdf'),
      makeFile('application/zip'),
      makeFile('application/x-msdownload'),
      makeFile(''),
    ]
    const { accepted, rejected } = sortFileFiles(files, { maxSize: DEFAULT_FILE_MAX_SIZE })
    expect(accepted).toHaveLength(files.length)
    expect(rejected).toHaveLength(0)
  })

  it('0 字节按空文件拒，文案带名字', () => {
    const { accepted, rejected } = sortFileFiles([makeFile('video/mp4', 0, 'empty.mp4')])
    expect(accepted).toHaveLength(0)
    expect(rejected[0].code).toBe(FILE_REJECT.EMPTY)
    expect(rejected[0].message).toContain('「empty.mp4」')
  })

  it('超过上限拒，恰好等于上限放行（上限是闭区间）', () => {
    const max = 2048
    const { accepted, rejected } = sortFileFiles(
      [makeFile('application/pdf', max, 'edge.pdf'), makeFile('application/pdf', max + 1, 'big.pdf')],
      { maxSize: max },
    )
    expect(accepted.map((f) => f.name)).toEqual(['edge.pdf'])
    expect(rejected.map((r) => r.file.name)).toEqual(['big.pdf'])
    expect(rejected[0].code).toBe(FILE_REJECT.SIZE)
  })

  it('maxSize 传 null / 0 表示不限（只挡 0 字节）', () => {
    const files = [makeFile('video/mp4', 5 * 1024 * 1024 * 1024), makeFile('video/mp4', 0)]
    for (const maxSize of [null, undefined, 0]) {
      const { accepted, rejected } = sortFileFiles(files, { maxSize })
      expect(accepted).toHaveLength(1)
      expect(rejected).toHaveLength(1)
    }
  })

  it('顺序保持原样，空值跳过，非数组不炸', () => {
    const files = [makeFile('application/zip', 2, 'b.zip'), null, makeFile('application/zip', 1, 'a.zip')]
    expect(sortFileFiles(files).accepted.map((f) => f.name)).toEqual(['b.zip', 'a.zip'])
    expect(sortFileFiles(null).accepted).toEqual([])
    expect(sortFileFiles(undefined).rejected).toEqual([])
  })
})

describe('fileBlockAttrs：上传结果 → schema 属性', () => {
  it('宿主只给 url 时，url 兼任 token（块永远有稳定键）', () => {
    const attrs = fileBlockAttrs(makeFile('video/mp4', 40016, 'a.mp4'), { url: 'https://cdn.example.com/a.mp4' })
    expect(attrs).toMatchObject({
      token: 'https://cdn.example.com/a.mp4',
      src: 'https://cdn.example.com/a.mp4',
      name: 'a.mp4',
      size: 40016,
      mimeType: 'video/mp4',
      viewType: 'Preview',
      coverUrl: null,
    })
  })

  it('attchId 优先于 token、token 优先于 url', () => {
    const byAttch = fileBlockAttrs(makeFile('application/pdf'), { attchId: 'boxcn1', token: 't2', url: 'https://x/y.pdf' })
    expect(byAttch.token).toBe('boxcn1')
    const byToken = fileBlockAttrs(makeFile('application/pdf'), { token: 't2', url: 'https://x/y.pdf' })
    expect(byToken.token).toBe('t2')
  })

  it('viewType 按形态推导：能内嵌的 Preview，其余 Card', () => {
    expect(fileBlockAttrs(makeFile('application/pdf')).viewType).toBe('Preview')
    expect(fileBlockAttrs(makeFile('application/zip')).viewType).toBe('Card')
  })

  it('宿主显式指定 viewType 时以宿主为准，非法值回落推导', () => {
    expect(fileBlockAttrs(makeFile('video/mp4'), { viewType: 'Card' }).viewType).toBe('Card')
    expect(fileBlockAttrs(makeFile('video/mp4'), { viewType: 'bogus' }).viewType).toBe('Preview')
    expect(FILE_VIEW_TYPES).toContain(fileBlockAttrs(makeFile('video/mp4')).viewType)
  })

  it('上传结果里的 mimeType / size / name 覆盖源文件（服务端可能改写）', () => {
    const attrs = fileBlockAttrs(makeFile('application/octet-stream', 1, 'raw.bin'), { mimeType: 'application/pdf', size: 2048, name: 'report.pdf' })
    expect(attrs).toMatchObject({ mimeType: 'application/pdf', size: 2048, name: 'report.pdf', viewType: 'Preview' })
  })

  it('coverUrl 只收非空字符串', () => {
    expect(fileBlockAttrs(makeFile('video/mp4'), { coverUrl: 'https://x/c.png' }).coverUrl).toBe('https://x/c.png')
    expect(fileBlockAttrs(makeFile('video/mp4'), { coverUrl: '' }).coverUrl).toBeNull()
  })
})

describe('schema：fileBlock 是原子块，blockId 可写', () => {
  const schema = getSchema(createLarkDocExtensions())

  it('节点存在且是 atom（一次 Backspace 整块删掉的前提）', () => {
    const spec = schema.nodes.fileBlock
    expect(spec).toBeTruthy()
    expect(spec.isAtom).toBe(true)
    expect(spec.spec.selectable).toBe(true)
  })

  it('data-block-type 恒为 file —— 没有 video 节点类型', () => {
    expect(schema.nodes.video).toBeUndefined()
    const json = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'fileBlock', attrs: { mimeType: 'video/mp4' } }] }).toJSON()
    expect(json.content[0].type).toBe('fileBlock')
  })

  it('setFileBlock：有 token 或 src 才落块，两个都没有直接拒', () => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    try {
      const ok = editor.chain().setFileBlock({ token: 'boxcn1', name: 'a.mp4', size: 40016, mimeType: 'video/mp4', viewType: 'Preview' }).run()
      expect(ok).toBe(true)
      expect(editor.getJSON().content[0]).toMatchObject({
        type: 'fileBlock',
        attrs: { token: 'boxcn1', name: 'a.mp4', size: 40016, mimeType: 'video/mp4', viewType: 'Preview' },
      })
      const before = editor.getJSON().content.length
      expect(editor.chain().setFileBlock({ name: 'orphan.bin' }).run()).toBe(false)
      expect(editor.getJSON().content.length).toBe(before)
    } finally { editor.destroy() }
  })
})

describe('NodeView：一个块壳三形态', () => {
  it('video/mp4 落播放器 + footer（名字 · 大小）', () => {
    const editor = mountFileBlock({ token: 'tk', src: 'https://cdn.example.com/a.mp4', name: 'a.mp4', size: 40016, mimeType: 'video/mp4', viewType: 'Preview' })
    try {
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      expect(figure).toBeTruthy()
      expect(figure.getAttribute('data-block-type')).toBe('file')
      const video = figure.querySelector('video.lark-doc-file-video')
      expect(video).toBeTruthy()
      expect(video.getAttribute('src')).toBe('https://cdn.example.com/a.mp4')
      expect(video.hasAttribute('controls')).toBe(true)
      expect(figure.querySelector('.lark-doc-file-name').textContent).toBe('a.mp4')
      expect(figure.querySelector('.lark-doc-file-size').textContent).toBe('39.08KB')
      expect(figure.querySelector('.lark-doc-file-download').getAttribute('href')).toBe('https://cdn.example.com/a.mp4')
      // 失败态元素不该预先出现在成功态里。
      expect(figure.querySelector('.lark-doc-file-fallback')).toBeNull()
    } finally { editor.destroy() }
  })

  it('application/pdf 落 iframe viewer，且没有播放器', () => {
    const editor = mountFileBlock({ src: 'https://cdn.example.com/recon-doc.pdf', name: 'recon-doc.pdf', size: 40016, mimeType: 'application/pdf', viewType: 'Preview' })
    try {
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      const frame = figure.querySelector('iframe.lark-doc-file-frame')
      expect(frame).toBeTruthy()
      expect(frame.getAttribute('src')).toBe('https://cdn.example.com/recon-doc.pdf')
      expect(frame.getAttribute('title')).toBe('recon-doc.pdf')
      expect(figure.querySelector('video')).toBeNull()
    } finally { editor.destroy() }
  })

  it('application/zip 落卡片，不挂任何预览元素', () => {
    const editor = mountFileBlock({ src: 'https://cdn.example.com/a.zip', name: 'a.zip', size: 1024, mimeType: 'application/zip', viewType: 'Card' })
    try {
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      expect(figure.querySelector('.lark-doc-file-card')).toBeTruthy()
      expect(figure.querySelector('.lark-doc-file-card-name').textContent).toBe('a.zip')
      expect(figure.querySelector('video')).toBeNull()
      expect(figure.querySelector('iframe')).toBeNull()
      expect(figure.querySelector('.lark-doc-file-fallback')).toBeNull()
    } finally { editor.destroy() }
  })

  it('视频解码失败：照常落块，只把预览区换成兜底文案（块高不变）', () => {
    const editor = mountFileBlock({ src: 'https://cdn.example.com/broken.mp4', name: 'broken.mp4', size: 45 * 1024 * 1024, mimeType: 'video/mp4', viewType: 'Preview' })
    try {
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      figure.querySelector('video').dispatchEvent(new Event('error'))

      const fallback = figure.querySelector('.lark-doc-file-fallback')
      expect(fallback).toBeTruthy()
      expect(figure.querySelector('video')).toBeNull()
      expect(fallback.querySelector('.lark-doc-media-error').textContent).toBe('不支持的音频/视频格式 请下载文件后用其他软件打开')
      expect(fallback.querySelector('.lark-doc-file-fallback-meta').textContent).toBe('broken.mp4 · 45.00MB')
      // 与图片相反：失败也要留下载入口。
      expect(figure.querySelector('.lark-doc-file-download').getAttribute('href')).toBe('https://cdn.example.com/broken.mp4')
    } finally { editor.destroy() }
  })

  it('没有可预览地址：落块 + PDF 那套兜底文案，下载链接退成不可点', () => {
    const editor = mountFileBlock({ token: 'tk', name: 'recon-doc.pdf', size: 40016, mimeType: 'application/pdf', viewType: 'Preview' })
    try {
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      expect(figure.querySelector('.lark-doc-file-fallback .lark-doc-media-error').textContent)
        .toBe('文件因损坏或加密等原因无法预览，请下载到本地打开')
      const download = figure.querySelector('.lark-doc-file-download')
      expect(download.hasAttribute('href')).toBe(false)
      expect(download.getAttribute('aria-disabled')).toBe('true')
      expect(download.getAttribute('tabindex')).toBe('-1')
    } finally { editor.destroy() }
  })

  it('只存 token 时由 resolveFileUrl 换票，换到后挂播放器', async () => {
    const calls = []
    const editor = mountFileBlock(
      { token: 'boxcn-token', name: 'a.mp4', size: 40016, mimeType: 'video/mp4', viewType: 'Preview' },
      { resolveFileUrl: (token) => { calls.push(token); return 'https://cdn.example.com/signed.mp4' } },
    )
    try {
      await tick()
      expect(calls).toEqual(['boxcn-token'])
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      expect(figure.querySelector('video').getAttribute('src')).toBe('https://cdn.example.com/signed.mp4')
      expect(figure.querySelector('.lark-doc-file-download').getAttribute('href')).toBe('https://cdn.example.com/signed.mp4')
    } finally { editor.destroy() }
  })

  it('换票失败按失败态处理，不抛错', async () => {
    const editor = mountFileBlock(
      { token: 'boxcn-token', name: 'a.pdf', size: 40016, mimeType: 'application/pdf', viewType: 'Preview' },
      { resolveFileUrl: () => { throw new Error('boom') } },
    )
    try {
      await tick()
      const figure = editor.view.dom.querySelector('figure.lark-doc-file')
      expect(figure.querySelector('.lark-doc-file-fallback')).toBeTruthy()
      expect(figure.querySelector('iframe')).toBeNull()
    } finally { editor.destroy() }
  })
})
