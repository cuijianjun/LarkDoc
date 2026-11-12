/**
 * P2-01 图片 NodeView（09 §5.3，规格见 02 §11）。
 *
 * 这一层守的是「core 里那份纯 DOM NodeView 的契约」，不再依赖任何 UI 框架：
 *   - DOM 骨架与 class 名：NodeView 与 renderHTML 共用 `.lark-doc-image*`，
 *     样式只有一套（lark-doc.css 的图片分区），改 class 名会同时打死两条路径；
 *   - 所有属性写入都走文档（setNodeMarkup），DOM 只是投影 —— 因此每次断言
 *     都同时看「文档里的 attrs」和「DOM 的反映」；
 *   - 宽度 40–2400 且拒绝带单位字符串；只读态一律不写、也不挂工具条；
 *   - 工具条是 hover 真增删（不是 display 切换），160ms 延时卸载；
 *   - 裁剪只保存归一化边界，原图和附件不变，兼容旧版原图映射；
 *   - 离线拦截降级为占位卡且不渲染 img（不发外部请求）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createImageNodeView, clampImageWidth, imageWidthError } from '../../src/core/nodeviews/image'
import { BLOCKED_IMAGE_PLACEHOLDER } from '../../src/core/policy/network'
import { sanitizeHTML, validateDocument } from '../../src/core/documentOperations'
import { getNodeView, setNodeView } from '../../src/core/nodeviews/registry'
import { dragImageCrop, imageCropGeometry, normalizeImageCrop } from '../../src/core/media/image-crop'
import { createImageViewer } from '../../src/core/nodeviews/image-viewer'

const SRC = 'https://cdn.example.com/a.png'
const ORIGINAL = 'https://cdn.example.com/original.png'

it('评论附件可指定100%初始预览，正文继续默认适应窗口', () => {
  for (const initialScale of [undefined, 1]) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const viewer = createImageViewer({ host, images: [{ src: SRC }], initialScale })
    try {
      const image = host.querySelector('.lark-doc-image-viewer-image')
      Object.defineProperties(image, { naturalWidth: { value: 323 }, naturalHeight: { value: 275 } })
      image.dispatchEvent(new Event('load'))
      expect(host.querySelector('.lark-doc-image-viewer-toolbar').textContent).toContain(initialScale ? '100%' : '251%')
    } finally { viewer.destroy(); host.remove() }
  }
})

/**
 * 用真实 Editor 提供 state / dispatch，但由测试自己持有 NodeView 实例。
 * 这样属性写入经过真实 schema 校验，同时能直接调用返回值里的联调通道
 * （在浏览器里等价于点工具条 / 填对话框）。PM 自己那份渲染实例照常存在，
 * 两者共享同一份文档，互不干扰。
 */
function mountImageNodeView(attrs = {}, options = {}) {
  const editor = new Editor({
    extensions: createLarkDocExtensions(options.resolveImageFile ? { resolveImageFile: options.resolveImageFile } : {}),
    content: { type: 'doc', content: [{ type: 'image', attrs: { src: SRC, ...attrs } }] },
  })
  if (options.editable === false) editor.setEditable(false)
  let nodeView = null
  const view = {
    get state() { return editor.state },
    dispatch(tr) {
      editor.view.dispatch(tr)
      // 不回调 update 就会拿陈旧 attrs 覆盖上一次写入（第二次改属性时才会暴露）。
      if (nodeView) nodeView.update(editor.state.doc.firstChild)
    },
  }
  const extension = { options: options.resolveImageFile ? { resolveImageFile: options.resolveImageFile } : {} }
  nodeView = createImageNodeView({ editor, view, node: editor.state.doc.firstChild, getPos: () => 0, extension })
  return {
    editor,
    nodeView,
    attrs: () => editor.state.doc.firstChild.attrs,
    cleanup: () => { nodeView.destroy(); editor.destroy() },
  }
}

const mounted = []
function mount(attrs, options) {
  const harness = mountImageNodeView(attrs, options)
  mounted.push(harness)
  return harness
}

afterEach(() => {
  while (mounted.length) mounted.pop().cleanup()
  vi.useRealTimers()
})

function decodedImage(nodeView) {
    const image = nodeView.dom.querySelector('.lark-doc-image-img')
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 323 }, naturalHeight: { configurable: true, value: 275 } })
    image.dispatchEvent(new Event('load'))
    return image
}

describe('Feishu inline crop metadata and lifecycle', () => {
  it('uses eight inline handles and commits normalized crop bounds without uploading or changing the source', async () => {
    const resolveImageFile = vi.fn()
    const { nodeView, attrs } = mount({ src: ORIGINAL, attchId: 'original', width: 463 }, { resolveImageFile })
    decodedImage(nodeView)
    expect(nodeView.openCrop()).toBe(true)
    expect(nodeView.dom.querySelector('.lark-doc-media-backdrop')).toBeNull()
    expect(nodeView.dom.querySelectorAll('[data-crop-handle]')).toHaveLength(8)
    nodeView.setCropArea({ x: 0, y: 0, width: 87.04, height: 100 })
    expect(await nodeView.applyCrop()).toBe(true)
    expect(attrs()).toMatchObject({ src: ORIGINAL, attchId: 'original', width: 463, crop: [0, 0, 0.8704, 1] })
    expect(attrs()).toMatchObject({ naturalWidth: 323, naturalHeight: 275 })
    expect(resolveImageFile).not.toHaveBeenCalled()
    expect(nodeView.dom.querySelector('[data-crop-handle]')).toBeNull()
    expect(nodeView.reset()).toBe(true)
    expect(attrs()).toMatchObject({ src: ORIGINAL, attchId: 'original', width: 463, crop: null })
  })

  it('round-trips crop and base dimensions through HTML/JSON and rejects malformed bounds', () => {
    const { editor, attrs } = mount({ width: 463, naturalWidth: 323, naturalHeight: 275, crop: [0.0864, 0, 1, 1] })
    expect(attrs().crop).toEqual([0.0864, 0, 1, 1])
    editor.commands.ensureLarkDocBlockIds()
    const json = validateDocument(editor.getJSON(), editor.schema)
    const html = sanitizeHTML(editor.getHTML())
    editor.commands.setContent(html)
    expect(editor.getJSON()).toEqual(json)
    for (const crop of [[0, 0, 1], [-0.1, 0, 1, 1], [0.8, 0, 0.2, 1], [0, 0, 1, Infinity], [0, 0, 1, '1']]) {
      expect(() => validateDocument({ type: 'doc', content: [{ type: 'image', attrs: { src: SRC, crop } }] }, editor.schema)).toThrow()
    }
  })

  it('cancels modified drafts on Escape or readonly and preserves serialized geometry', () => {
    const { editor, nodeView, attrs } = mount({ width: 463, naturalWidth: 323, naturalHeight: 275, crop: [0.0864, 0, 1, 1] })
    decodedImage(nodeView)
    const saved = { ...attrs() }
    nodeView.openCrop()
    nodeView.setCropArea({ x: 20, y: 20, width: 50, height: 50 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(nodeView.dom.querySelector('[data-crop-handle]')).toBeNull()
    expect(attrs()).toEqual(saved)
    nodeView.openCrop()
    nodeView.setCropArea({ x: 30, y: 20, width: 40, height: 50 })
    editor.setEditable(false)
    expect(nodeView.dom.querySelector('[data-crop-handle]')).toBeNull()
    expect(attrs()).toEqual(saved)
    expect(nodeView.openCrop()).toBe(false)
  })

  it('cancels crop and pending replacement when ProseMirror reuses the view for another image', async () => {
    let complete
    const editor = new Editor({ extensions: createLarkDocExtensions({ resolveImageFile: () => new Promise(resolve => { complete = resolve }) }), content: { type: 'doc', content: [{ type: 'image', attrs: { src: SRC, blockId: 'image_a' } }] } })
    try {
      const originalDOM = editor.view.nodeDOM(0)
      decodedImage({ dom: originalDOM })
      originalDOM.dispatchEvent(new MouseEvent('mouseenter'))
      originalDOM.querySelector('[aria-label="裁剪"]').click()
      expect(originalDOM.querySelectorAll('[data-crop-handle]')).toHaveLength(8)
      editor.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: ORIGINAL, blockId: 'image_b' } }] })
      expect(editor.view.nodeDOM(0)).toBe(originalDOM)
      expect(originalDOM.querySelector('[data-crop-handle]')).toBeNull()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      expect(editor.state.doc.firstChild.attrs.crop).toBeNull()
      const input = originalDOM.querySelector('.lark-doc-image-replace-input')
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'a.png', { type: 'image/png' })] })
      input.dispatchEvent(new Event('change'))
      editor.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: '/third.png', blockId: 'image_c' } }] })
      complete({ src: '/late.png', attchId: 'late' })
      await Promise.resolve()
      expect(editor.state.doc.firstChild.attrs).toMatchObject({ src: '/third.png', blockId: 'image_c', crop: null })
    } finally { editor.destroy() }
  })

  it.each([['bottom-right', 50], ['top-right', 50], ['bottom-left', -50], ['top-left', -50]])('centered resize %s tracks the pointer and clipped fraction', (corner, dx) => {
    const { nodeView, attrs, editor } = mount({ width: 463, naturalWidth: 323, naturalHeight: 275, crop: [0, 0, 0.5, 1], align: 'center' })
    const image = nodeView.dom.querySelector('.lark-doc-image-img')
    image.getBoundingClientRect = () => ({ width: 463 })
    const update = vi.fn()
    editor.on('update', update)
    nodeView.dom.querySelector(`[data-corner="${corner}"]`).dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(attrs().width).toBe(463)
    expect(update).not.toHaveBeenCalled()
    nodeView.dom.querySelector(`[data-corner="${corner}"]`).dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + dx }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(attrs().width).toBe(663)
    expect(attrs().crop).toEqual([0, 0, 0.5, 1])
  })
})

/** 让裁剪链路跑得通：jsdom 没有真实解码器和 canvas。 */
describe('P2-01 图片宽度校验', () => {
  it('合法区间是 40–2400 且拒绝带单位的字符串', () => {
    expect(clampImageWidth(40)).toBe(40)
    expect(clampImageWidth(2400)).toBe(2400)
    expect(clampImageWidth(320.4)).toBe(320)
    expect(clampImageWidth(39)).toBeNull()
    expect(clampImageWidth(2401)).toBeNull()
    // 历史坑：拖动时读到的是 '600px'，Number() 会得 NaN 而不是 600。
    expect(clampImageWidth('600px')).toBeNull()
    expect(clampImageWidth('600')).toBe(600)
    expect(clampImageWidth(null)).toBeNull()
    expect(imageWidthError(39)).toBe('图片宽度须为 40–2400 像素')
    expect(imageWidthError(320)).toBe('')
  })
})

describe('P2-01 图片 DOM 骨架与样式契约', () => {
  it('figure > frame > shell > img + 四角手柄，题注与输入通道同层', () => {
    const { nodeView } = mount()
    const dom = nodeView.dom
    expect(dom.tagName).toBe('FIGURE')
    expect(dom.classList.contains('lark-doc-image')).toBe(true)
    expect(dom.getAttribute('data-type')).toBe('image')
    expect(dom.getAttribute('contenteditable')).toBe('false')
    expect(dom.getAttribute('data-align')).toBe('center')

    const frame = dom.querySelector(':scope > .lark-doc-image-frame')
    const shell = frame.querySelector(':scope > .lark-doc-image-shell')
    const img = shell.querySelector(':scope > .lark-doc-image-img')
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe(SRC)
    expect(img.getAttribute('draggable')).toBe('false')
    // 未设宽度时不能写死像素，否则「永不放大」就废了（靠 CSS max-width 兜）。
    expect(img.style.width).toBe('')

    const handles = Array.from(shell.querySelectorAll('.lark-doc-image-resize'))
    expect(handles.map((handle) => handle.getAttribute('data-corner'))).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    handles.forEach((handle) => {
      expect(handle.tagName).toBe('BUTTON')
      expect(handle.classList.contains('is-hidden')).toBe(true)
      expect(handle.getAttribute('aria-label')).toContain('调整图片宽度')
    })
    dom.dispatchEvent(new window.MouseEvent('mouseenter'))
    handles.forEach((handle) => expect(handle.classList.contains('is-hidden')).toBe(false))
    dom.dispatchEvent(new window.MouseEvent('mouseleave'))
    handles.forEach((handle) => expect(handle.classList.contains('is-hidden')).toBe(true))

    expect(dom.querySelector('figcaption.lark-doc-image-caption-text')).not.toBeNull()
    expect(dom.querySelector('input.lark-doc-image-caption')).not.toBeNull()
    expect(dom.querySelector('input.lark-doc-image-replace-input').getAttribute('accept')).toBe('image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/x-bmp,image/x-ms-bmp')
    expect(dom.querySelector('p.lark-doc-media-error').classList.contains('is-hidden')).toBe(true)
    // 离线占位卡常驻 DOM、默认隐藏（切 src 不需要重建节点）。
    expect(dom.querySelector('.lark-doc-image-blocked').classList.contains('is-hidden')).toBe(true)
  })

  it('离线拦截的 src 降级为占位卡且不渲染 img', () => {
    const { nodeView } = mount({ src: BLOCKED_IMAGE_PLACEHOLDER, originalSrc: ORIGINAL })
    const dom = nodeView.dom
    const img = dom.querySelector('.lark-doc-image-img')
    const blocked = dom.querySelector('.lark-doc-image-blocked')
    expect(dom.classList.contains('is-blocked')).toBe(true)
    expect(img.classList.contains('is-hidden')).toBe(true)
    // 不发外部请求：src 直接摘掉。
    expect(img.hasAttribute('src')).toBe(false)
    expect(blocked.classList.contains('is-hidden')).toBe(false)
    expect(blocked.getAttribute('role')).toBe('img')
    expect(blocked.querySelector('code').textContent).toBe(ORIGINAL)
    expect(blocked.querySelector('[aria-label="替换图片"]').disabled).toBe(true)
    dom.querySelectorAll('.lark-doc-image-resize').forEach((handle) => {
      expect(handle.classList.contains('is-hidden')).toBe(true)
    })
  })

  it('拦截卡在有上传能力时提供可见替换按钮并可用 Enter 触发文件选择', () => {
    const resolveImageFile = vi.fn()
    const { nodeView } = mount({ src: BLOCKED_IMAGE_PLACEHOLDER, originalSrc: ORIGINAL }, { resolveImageFile })
    const input = nodeView.dom.querySelector('.lark-doc-image-replace-input')
    const click = vi.spyOn(input, 'click')
    const replace = nodeView.dom.querySelector('.lark-doc-image-blocked-replace')

    expect(replace.disabled).toBe(false)
    replace.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(click).toHaveBeenCalledOnce()
  })
})

describe('P2-01 图片属性写入走文档', () => {
  it('宽度 / 题注 / 对齐都落到 attrs，再把结果投影回 DOM', () => {
    const { nodeView, attrs } = mount()
    expect(nodeView.setWidth(320)).toBe(true)
    expect(attrs().width).toBe(320)
    expect(nodeView.dom.querySelector('.lark-doc-image-img').style.width).toBe('320px')

    expect(nodeView.setCaption('图 1 说明')).toBe(true)
    expect(attrs().caption).toBe('图 1 说明')
    const captionText = nodeView.dom.querySelector('.lark-doc-image-caption-text')
    expect(captionText.textContent).toBe('图 1 说明')
    expect(captionText.classList.contains('is-hidden')).toBe(false)

    expect(nodeView.setAlign('right')).toBe(true)
    expect(attrs().align).toBe('right')
    expect(nodeView.dom.getAttribute('data-align')).toBe('right')

    // 越界不写文档，只把错误文案放出来。
    expect(nodeView.setWidth(10)).toBe(false)
    expect(attrs().width).toBe(320)
    const errorLine = nodeView.dom.querySelector('.lark-doc-media-error')
    expect(errorLine.textContent).toBe('图片宽度须为 40–2400 像素')
    expect(errorLine.classList.contains('is-hidden')).toBe(false)
    // 非法值不清空上一次的合法宽度
    expect(nodeView.dom.querySelector('.lark-doc-image-img').style.width).toBe('320px')

    expect(nodeView.setAlign('justify')).toBe(false)
    expect(attrs().align).toBe('right')
  })

  it('只读态一律不写文档、不挂工具条、不进题注编辑', () => {
    const { nodeView, attrs } = mount({}, { editable: false })
    expect(nodeView.setWidth(320)).toBe(false)
    expect(nodeView.setCaption('说明')).toBe(false)
    expect(nodeView.setAlign('left')).toBe(false)
    expect(nodeView.reset()).toBe(false)
    expect(attrs().width).toBeNull()
    expect(attrs().caption).toBe('')

    nodeView.mountToolbar()
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).toBeNull()

    nodeView.enterCaptionEdit()
    expect(nodeView.dom.querySelector('.lark-doc-image-caption').classList.contains('is-hidden')).toBe(true)
    nodeView.dom.querySelectorAll('.lark-doc-image-resize').forEach((handle) => {
      expect(handle.classList.contains('is-hidden')).toBe(true)
    })
  })

  it('编辑态切只读时立刻收起工具条与手柄', () => {
    const { nodeView, editor } = mount()
    nodeView.mountToolbar()
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).not.toBeNull()
    editor.setEditable(false)
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).toBeNull()
    nodeView.dom.querySelectorAll('.lark-doc-image-resize').forEach((handle) => {
      expect(handle.classList.contains('is-hidden')).toBe(true)
    })
  })
})

describe('P2-01 图片工具条', () => {
  it('源工具条八项动作和分隔符，对齐状态跟随文档', () => {
    const { nodeView } = mount({ src: SRC, originalSrc: SRC, width: 320 })
    nodeView.mountToolbar()
    const toolbar = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    expect(toolbar.querySelectorAll('button')).toHaveLength(8)
    expect(toolbar.querySelectorAll('.lark-doc-image-toolbar-divider')).toHaveLength(2)

    const pressed = Array.from(toolbar.querySelectorAll('button[data-align-value]'))
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.getAttribute('data-align-value'))
    expect(pressed).toEqual(['center'])

    expect([...toolbar.querySelectorAll('button')].map(button => button.dataset.action)).toEqual(['crop', 'caption', 'left', 'center', 'right', 'copy', 'share', 'comment'])
    expect(toolbar.querySelectorAll('svg')).toHaveLength(8)

  })

  it('shows Reset only for an actual crop and keeps the resized width when clicked', () => {
    const { nodeView, attrs } = mount({ src: SRC, width: 463, crop: [0, 0, 0.8704, 1], naturalWidth: 323, naturalHeight: 275 })
    nodeView.mountToolbar()
    const toolbar = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    expect(toolbar.querySelectorAll('button')).toHaveLength(9)
    expect(toolbar.classList.contains('has-reset')).toBe(true)
    toolbar.querySelector('[data-action="reset"]').click()
    expect(attrs()).toMatchObject({ src: SRC, width: 463, crop: null })
    expect(toolbar.querySelectorAll('button')).toHaveLength(8)
    expect(toolbar.querySelector('[data-action="reset"]')).toBeNull()
  })

  it('独立core没有宿主动作时明确禁用复制分享评论，拦住UI事件', () => {
    const { nodeView } = mount()
    nodeView.mountToolbar()
    const toolbar = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    for (const action of ['copy', 'share', 'comment']) expect(toolbar.querySelector(`[data-action="${action}"]`).disabled).toBe(true)
    // 工具条自己的事件不能漏进 ProseMirror 的 keymap。
    expect(nodeView.stopEvent({ target: toolbar.querySelector('button') })).toBe(true)
    expect(nodeView.stopEvent({ target: nodeView.dom.querySelector('.lark-doc-image-img') })).toBe(false)
    expect(nodeView.stopEvent(null)).toBe(false)
  })

  it('hover 挂载、离开 160ms 后卸载（真实增删节点）', () => {
    vi.useFakeTimers()
    const { nodeView } = mount()
    const dom = nodeView.dom
    expect(dom.querySelector('.lark-doc-image-toolbar')).toBeNull()

    dom.dispatchEvent(new window.MouseEvent('mouseenter'))
    expect(dom.querySelector('.lark-doc-image-toolbar')).not.toBeNull()

    // 鼠标进到工具条上（跨 8px 间隙）不能闪掉
    const toolbar = dom.querySelector('.lark-doc-image-toolbar')
    toolbar.dispatchEvent(new window.MouseEvent('mouseenter'))
    vi.advanceTimersByTime(400)
    expect(dom.querySelector('.lark-doc-image-toolbar')).not.toBeNull()

    dom.dispatchEvent(new window.MouseEvent('mouseleave'))
    expect(dom.querySelector('.lark-doc-image-toolbar')).not.toBeNull()
    vi.advanceTimersByTime(200)
    expect(dom.querySelector('.lark-doc-image-toolbar')).toBeNull()
  })
})

describe('P2-01 图片题注就地编辑', () => {
  it('进入编辑显示输入框，提交写回文档', () => {
    const { nodeView, attrs } = mount({ src: SRC, caption: '旧说明' })
    const captionText = nodeView.dom.querySelector('.lark-doc-image-caption-text')
    const captionInput = nodeView.dom.querySelector('.lark-doc-image-caption')
    expect(captionText.textContent).toBe('旧说明')
    expect(captionInput.classList.contains('is-hidden')).toBe(true)

    nodeView.enterCaptionEdit()
    expect(captionText.classList.contains('is-hidden')).toBe(true)
    expect(captionInput.classList.contains('is-hidden')).toBe(false)
    expect(captionInput.value).toBe('旧说明')

    captionInput.value = '新说明'
    nodeView.commitCaption()
    expect(attrs().caption).toBe('新说明')
    expect(captionText.textContent).toBe('新说明')
    expect(captionInput.classList.contains('is-hidden')).toBe(true)
  })
})

describe('P2-01 图片裁剪与重置', () => {
  it('替换传入 source；失败保留旧图，重新选择同文件仍可成功', async () => {
    let fail = true
    const resolveImageFile = vi.fn(async () => { if (fail) throw new Error('denied'); return { src: '/replacement.png', attchId: null } })
    const { nodeView, attrs } = mount({}, { resolveImageFile })
    const input = nodeView.dom.querySelector('.lark-doc-image-replace-input')
    const file = new File(['png'], 'same.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(nodeView.dom.querySelector('.lark-doc-media-error').textContent).toBe('denied'))
    expect(attrs().src).toBe(SRC)
    fail = false
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(attrs().src).toBe('/replacement.png'))
    expect(resolveImageFile).toHaveBeenCalledTimes(2)
    expect(resolveImageFile).toHaveBeenLastCalledWith(file, { source: 'replace' })
    expect(input.value).toBe('')
  })

  it.each(['readonly', 'destroy'])('替换等待中 %s 后晚结果保留旧图', async action => {
    let complete
    const { nodeView, attrs, editor } = mount({}, { resolveImageFile: () => new Promise(resolve => { complete = resolve }) })
    const input = nodeView.dom.querySelector('.lark-doc-image-replace-input')
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['png'], 'a.png', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change'))
    if (action === 'readonly') { editor.setEditable(false); editor.setEditable(true) }
    else nodeView.destroy()
    complete({ src: '/late.png', attchId: null })
    await Promise.resolve()
    expect(attrs().src).toBe(SRC)
  })

  it('拒绝越界与零面积，未加载时不能打开裁剪', () => {
    const { nodeView, attrs } = mount({ src: ORIGINAL, attchId: 'original' })
    expect(nodeView.openCrop()).toBe(false)
    decodedImage(nodeView)
    expect(nodeView.openCrop()).toBe(true)
    const initial = { ...attrs() }
    for (const bounds of [[0.6, 0, 1.2, 0.5], [0, 0, 0, 1], [0, NaN, 1, 1]]) {
      expect(nodeView.setCropArea(bounds)).toBe(false)
      expect(nodeView.applyCrop()).toBe(false)
      expect(attrs()).toEqual(initial)
    }
    expect(nodeView.dom.querySelector('.lark-doc-media-error').textContent).toContain('裁剪区域须在原图范围内')
    nodeView.setCropArea([0.1, 0.1, 0.6, 0.6])
    expect(nodeView.applyCrop()).toBe(true)
    expect(attrs()).toMatchObject({ src: ORIGINAL, attchId: 'original', crop: [0.1, 0.1, 0.6, 0.6] })
  })

  it('无需上传配置；重入后保留裁剪边界，未更改提交不产生文档更新', () => {
    const { nodeView, attrs, editor } = mount({ width: 463 })
    expect(nodeView.reset()).toBe(false)
    decodedImage(nodeView)
    nodeView.openCrop()
    nodeView.setCropArea([0.1, 0.2, 0.9, 0.8])
    expect(nodeView.applyCrop()).toBe(true)
    nodeView.openCrop()
    const region = nodeView.dom.querySelector('.lark-doc-crop-region')
    expect(region.style.left).toBe('10%')
    expect(region.style.height).toBe('60%')
    const updated = vi.fn()
    editor.on('update', updated)
    expect(nodeView.applyCrop()).toBe(true)
    expect(updated).not.toHaveBeenCalled()
    expect(attrs().width).toBe(463)
  })

  it('旧版物理裁剪附件仍能恢复，保持已有缩放宽度', () => {
    const { nodeView, attrs } = mount({ src: SRC, originalSrc: ORIGINAL, attchId: 'old-crop', originalAttchId: 'original', width: 463 })
    expect(nodeView.reset()).toBe(true)
    expect(attrs()).toMatchObject({ src: ORIGINAL, attchId: 'original', width: 463, crop: null })
    expect(nodeView.reset()).toBe(false)
  })

  it('拖动角、边和区域受原图边界及最小尺寸约束', () => {
    dragImageCrop([0.1, 0.2, 0.9, 0.8], 'move', 1, -1).forEach((value, index) => expect(value).toBeCloseTo([0.2, 0, 1, 0.6][index]))
    expect(dragImageCrop([0, 0, 1, 1], 'se', -0.25, -0.5)).toEqual([0, 0, 0.75, 0.5])
    expect(dragImageCrop([0, 0, 1, 1], 'nw', 2, 2, 0.1, 0.2)).toEqual([0.9, 0.8, 1, 1])
    expect(dragImageCrop([0, 0, 1, 1], 'wrong', 0, 0)).toBeNull()
    expect(normalizeImageCrop([0, 0, 1, 1])).toBeNull()
    expect(normalizeImageCrop([0, 0, 0.870412, 1])).toEqual([0, 0, 0.8704, 1])
    const geometry = imageCropGeometry(463, 394.195, [0, 0, 0.8704, 1])
    expect(geometry.width).toBeCloseTo(402.9952)
    expect(geometry.height).toBeCloseTo(394.195)
  })
})

describe('P2-01 图片预览与销毁', () => {
  it.each([[8, 8, null], [323, 275, [0, 0, 0.01, 1]]])('shrinks tiny and thin cropped images all the way to the minimum (%s×%s)', (width, height, crop) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const viewer = createImageViewer({ host, images: [{ src: SRC, crop }] })
    try {
      const root = viewer.dom, image = root.querySelector('img')
      Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } })
      image.dispatchEvent(new Event('load'))
      root.querySelector('[data-viewer-action="original"]').click()
      const button = root.querySelector('[data-viewer-action="out"]')
      const scale = () => Number(root.querySelector('.lark-doc-image-viewer-projection').style.transform.match(/scale\(([^)]+)\)/)[1])
      for (let step = 0; step < 60 && !button.disabled; step += 1) {
        const before = scale()
        button.click()
        expect(scale()).toBeLessThan(before)
      }
      expect(scale()).toBe(0.1)
      expect(button.disabled).toBe(true)
    } finally { viewer.destroy(); host.remove() }
  })
  it('matches measured sub-100% raster rounding while preserving the original aspect ratio', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const viewer = createImageViewer({ host, images: [{ src: SRC }] })
    try {
      const root = viewer.dom, image = root.querySelector('img')
      Object.defineProperties(image, { naturalWidth: { value: 323 }, naturalHeight: { value: 275 } })
      image.dispatchEvent(new Event('load'))
      const button = action => root.querySelector(`[data-viewer-action="${action}"]`)
      const scale = () => Number(root.querySelector('.lark-doc-image-viewer-projection').style.transform.match(/scale\(([^)]+)\)/)[1])
      button('original').click()
      button('out').click()
      expect(scale()).toBeCloseTo(240 / 275, 6)
      button('out').click()
      expect(scale()).toBeCloseTo(246 / 323, 6)
      button('in').click()
      expect(scale()).toBeCloseTo(246 / 323 * 1.15, 6)
      button('out').click()
      expect(scale()).toBeCloseTo(210 / 275, 6)
    } finally { viewer.destroy(); host.remove() }
  })
  it('预览挂进块内（能读到 .lark-doc 的主题 token）并可关闭', () => {
    const { nodeView } = mount()
    expect(nodeView.openPreview()).toBe(true)
    const shell = nodeView.dom.querySelector('.lark-doc-image-viewer-shell')
    expect(shell).not.toBeNull()
    expect(shell.getAttribute('role')).toBe('dialog')
    expect(shell.querySelector('img').getAttribute('src')).toBe(SRC)
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-close')).not.toBeNull()
    nodeView.closePreview()
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
  })

  it('viewer navigates images, zooms, restores fit, rotates and releases its drag listeners on Escape', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onClose = vi.fn(), onComment = vi.fn()
    const viewer = createImageViewer({ host, images: [{ src: SRC }, { src: ORIGINAL }], onClose, onComment })
    try {
      const root = viewer.dom, image = root.querySelector('img')
      Object.defineProperties(image, { naturalWidth: { value: 323 }, naturalHeight: { value: 275 } })
      image.dispatchEvent(new Event('load'))
      const button = action => root.querySelector(`[data-viewer-action="${action}"]`)
      expect(root.querySelectorAll('.lark-doc-image-viewer-toolbar button')).toHaveLength(8)
      expect(button('previous').disabled).toBe(true)
      button('next').click()
      expect(image.getAttribute('src')).toBe(ORIGINAL)
      expect(button('next').disabled).toBe(true)
      image.dispatchEvent(new Event('load'))
      button('original').click()
      expect(root.querySelector('.lark-doc-image-viewer-percentage').textContent).toBe('100%')
      for (let count = 0; count < 30 && !button('in').disabled; count += 1) button('in').click()
      expect(root.querySelector('.lark-doc-image-viewer-percentage').textContent).toBe('500%')
      expect(button('in').disabled).toBe(true)
      for (let count = 0; count < 60 && !button('out').disabled; count += 1) button('out').click()
      expect(root.querySelector('.lark-doc-image-viewer-percentage').textContent).toBe('10%')
      expect(button('out').disabled).toBe(true)
      button('original').click()
      button('in').click()
      expect(root.querySelector('.lark-doc-image-viewer-percentage').textContent).toBe('115%')
      button('out').click()
      expect(root.querySelector('.lark-doc-image-viewer-percentage').textContent).toBe('100%')
      button('rotate').click()
      expect(root.querySelector('.lark-doc-image-viewer-projection').style.transform).toContain('rotate(90deg)')
      button('comment').click()
      expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ src: ORIGINAL }), true, root)
      expect(root.classList.contains('has-comments')).toBe(true)
      button('previous').click()
      expect(root.classList.contains('has-comments')).toBe(false)
      expect(button('comment').getAttribute('aria-pressed')).toBe('false')
      button('comment').click()
      button('original').click()
      image.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
      expect(root.querySelector('.lark-doc-image-viewer-projection').style.transform).toContain('translate(0px, 0px)')
      root.querySelector('.lark-doc-image-viewer-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }))
      expect(root.querySelector('.lark-doc-image-viewer-percentage').textContent).toBe('100%')
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(host.children).toHaveLength(0)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onComment).toHaveBeenLastCalledWith(expect.objectContaining({ src: SRC }), false, root)
      viewer.destroy()
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally { viewer.destroy(); host.remove() }
  })

  it('鼠标按下前未选中的图片第一次只选择，第二次点击才预览', () => {
    const { editor, nodeView } = mountImageNodeView()
    try {
      const image = nodeView.dom.querySelector('.lark-doc-image-img')
      image.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, detail: 1 }))
      nodeView.selectNode()
      image.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
      image.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, detail: 1 }))
      image.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeTruthy()
    } finally { nodeView.destroy(); editor.destroy() }
  })

  it('编辑器祖先不拦截预览箭头，预览内的文字输入仍保留自己的方向键', () => {
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    document.body.appendChild(host)
    const viewer = createImageViewer({ host, images: [{ src: SRC }, { src: ORIGINAL }] })
    try {
      const root = viewer.dom
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      expect(root.querySelector('.lark-doc-image-viewer-position').textContent).toBe('2/2')
      const input = document.createElement('textarea')
      root.appendChild(input)
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      input.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(root.querySelector('.lark-doc-image-viewer-position').textContent).toBe('2/2')
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
      expect(root.querySelector('.lark-doc-image-viewer-position').textContent).toBe('1/2')
    } finally { viewer.destroy(); host.remove() }
  })

  it('边界按钮变为禁用后把焦点归还预览，Esc仍能关闭', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const viewer = createImageViewer({ host, images: [{ src: SRC }, { src: ORIGINAL }], index: 1 })
    try {
      const root = viewer.dom, previous = root.querySelector('[data-viewer-action="previous"]')
      previous.focus()
      previous.click()
      expect(previous.disabled).toBe(true)
      expect(document.activeElement).toBe(root)
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(host.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
    } finally { viewer.destroy(); host.remove() }
  })

  it('拦截态预览转成替换入口', () => {
    const { nodeView } = mount({ src: BLOCKED_IMAGE_PLACEHOLDER })
    expect(nodeView.openPreview()).toBe(false)
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
  })

  it('destroy 收掉工具条、原位裁剪与预览，移除全局监听', () => {
    const { nodeView } = mount({ src: SRC, originalSrc: ORIGINAL })
    nodeView.mountToolbar()
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).not.toBeNull()
    decodedImage(nodeView)
    nodeView.openCrop()
    expect(nodeView.dom.querySelectorAll('[data-crop-handle]')).toHaveLength(8)
    expect(nodeView.openPreview()).toBe(false)
    nodeView.closeDialog()
    nodeView.openPreview()
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).not.toBeNull()

    nodeView.destroy()
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).toBeNull()
    expect(nodeView.dom.querySelector('[data-crop-handle]')).toBeNull()
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
    expect(nodeView.openCrop()).toBe(false)
    expect(nodeView.openPreview()).toBe(false)
  })
})

describe('P2-01 三端装配', () => {
  it('适配层注册表优先，core 自带实现兜底', () => {
    setNodeView('image', undefined)
    expect(getNodeView('image')).toBeUndefined()
    const extensions = createLarkDocExtensions()
    const image = extensions.find((extension) => extension.name === 'image')
    // Tiptap 扩展实例上配置项挂在 config 上，方法体本身不依赖 this
    expect(image.config.addNodeView.call(image)).toBe(createImageNodeView)

    const custom = () => ({ dom: document.createElement('div') })
    setNodeView('image', custom)
    expect(createLarkDocExtensions().find((extension) => extension.name === 'image').config.addNodeView()).toBe(custom)
    // 复原，避免污染同文件里后续用例
    setNodeView('image', undefined)
  })

  it('真实 Editor 装上后 DOM 里是同一套 class（样式单一命中）', () => {
    const editor = new Editor({ extensions: createLarkDocExtensions(), content: { type: 'doc', content: [{ type: 'image', attrs: { src: SRC } }] } })
    try {
      expect(editor.view.dom.querySelector('figure.lark-doc-image[data-type="image"]')).not.toBeNull()
      expect(editor.view.dom.querySelector('.lark-doc-image-frame .lark-doc-image-img')).not.toBeNull()
    } finally {
      editor.destroy()
    }
  })
})
