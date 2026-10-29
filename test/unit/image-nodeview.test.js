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
 *   - 裁剪走宿主上传、originalSrc 保留原图，reset 能还原；
 *   - 离线拦截降级为占位卡且不渲染 img（不发外部请求）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createLarkDocExtensions } from '../../src/components/lark-doc/extensions'
import { createImageNodeView, clampImageWidth, imageWidthError } from '../../src/core/nodeviews/image'
import { BLOCKED_IMAGE_PLACEHOLDER } from '../../src/core/policy/network'
import { getNodeView, setNodeView } from '../../src/core/nodeviews/registry'

const SRC = 'https://cdn.example.com/a.png'
const ORIGINAL = 'https://cdn.example.com/original.png'

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

/** 让裁剪链路跑得通：jsdom 没有真实解码器和 canvas。 */
function stubImagePipeline({ pixels = 100, upload } = {}) {
  const saved = {
    Image: window.Image,
    getContext: window.HTMLCanvasElement.prototype.getContext,
    toBlob: window.HTMLCanvasElement.prototype.toBlob,
  }
  window.Image = class {
    constructor() { this.naturalWidth = pixels; this.naturalHeight = pixels }
    set src(value) { this.currentSrc = value; if (this.onload) this.onload() }
  }
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} })
  window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new window.Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
  const calls = []
  const resolveImageFile = async (file) => {
    calls.push(file)
    return upload ? upload(file, calls.length) : { src: 'https://cdn.example.com/cropped.png', attchId: 'crop-1' }
  }
  const restore = () => {
    window.Image = saved.Image
    window.HTMLCanvasElement.prototype.getContext = saved.getContext
    window.HTMLCanvasElement.prototype.toBlob = saved.toBlob
  }
  return { resolveImageFile, calls, restore }
}

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
      expect(handle.classList.contains('is-hidden')).toBe(false)
      expect(handle.getAttribute('aria-label')).toContain('调整图片宽度')
    })

    expect(dom.querySelector('figcaption.lark-doc-image-caption-text')).not.toBeNull()
    expect(dom.querySelector('input.lark-doc-image-caption')).not.toBeNull()
    expect(dom.querySelector('input.lark-doc-image-replace-input').getAttribute('accept')).toBe('image/png,image/jpeg,image/gif,image/webp')
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
    dom.querySelectorAll('.lark-doc-image-resize').forEach((handle) => {
      expect(handle.classList.contains('is-hidden')).toBe(true)
    })
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
  it('8 项按钮按 04 §1.3 顺序落 data-name，分隔线只有 1 条且插在对齐三连之后', () => {
    const { nodeView } = mount({ src: SRC, originalSrc: ORIGINAL, width: 320 })
    nodeView.mountToolbar()
    const toolbar = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    // 双层：外层只管定位（fixed 310×42 / z86 / 透明），白底 + 阴影在内层面板
    const panel = toolbar.querySelector(':scope > .lark-doc-image-toolbar-panel')
    expect(panel).not.toBeNull()

    const buttons = Array.from(toolbar.querySelectorAll('button'))
    expect(buttons).toHaveLength(8)
    // 顺序与 data-name 逐字照抄 `04 §1.3`（e2e 拿 data-name 对锚，改字等于改契约）
    expect(buttons.map((button) => button.getAttribute('data-name'))).toEqual([
      'Crop', 'caption',
      'align left', 'align center', 'align right',
      'copyAnchorLink', 'shareTextLink', 'comment',
    ])
    // 图标走 24×24 SVG（不靠文字 glyph），aria-label / title 同源
    expect(buttons[0].querySelector('svg')).not.toBeNull()
    expect(buttons[0].getAttribute('aria-label')).toBe('裁剪')
    expect(buttons[0].getAttribute('title')).toBe('裁剪')

    // 分隔线只有 1 条，位置在 align right 与 copyAnchorLink 之间（5→6 步距 49 的来源）
    const dividers = Array.from(panel.children)
      .filter((child) => child.classList.contains('lark-doc-image-toolbar-divider'))
    expect(dividers).toHaveLength(1)
    expect(dividers[0].previousElementSibling.getAttribute('data-name')).toBe('align right')
    expect(dividers[0].nextElementSibling.getAttribute('data-name')).toBe('copyAnchorLink')
  })

  it('当前对齐态同时挂 .menu-item-actived 与 aria-pressed（视觉一条、读屏一条）', () => {
    const { nodeView } = mount({ src: SRC })
    nodeView.mountToolbar()
    const aligned = () => Array.from(nodeView.dom.querySelectorAll('.lark-doc-image-toolbar button[data-align-value]'))
    expect(aligned()).toHaveLength(3)
    expect(aligned().filter((button) => button.classList.contains('menu-item-actived'))
      .map((button) => button.getAttribute('data-align-value'))).toEqual(['center'])
    expect(aligned().filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)

    // 换对齐：class 与 aria 一起跟着走
    expect(nodeView.setAlign('right')).toBe(true)
    expect(aligned().filter((button) => button.classList.contains('menu-item-actived'))
      .map((button) => button.getAttribute('data-align-value'))).toEqual(['right'])
    expect(aligned().filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.getAttribute('data-align-value'))).toEqual(['right'])
  })

  it('fixed 外层按图片矩形落位：块上方 8px、水平居中，贴顶时翻到块下方', () => {
    const { nodeView } = mount({ src: SRC })
    const img = nodeView.dom.querySelector('.lark-doc-image-img')
    // jsdom 的 getBoundingClientRect 恒为 0，这里给一段真实几何
    img.getBoundingClientRect = () => ({ left: 400, top: 300, width: 320, height: 200, right: 720, bottom: 500 })
    nodeView.mountToolbar()
    const toolbar = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    // 居中：400 + 320/2 − 310/2 = 405；上方：300 − 42 − 8 = 250
    expect(toolbar.style.left).toBe('405px')
    expect(toolbar.style.top).toBe('250px')

    // 贴视口顶（上方不足 8px）时翻到块下方，别被裁掉
    img.getBoundingClientRect = () => ({ left: 0, top: 20, width: 320, height: 200, right: 320, bottom: 220 })
    nodeView.unmountToolbar()
    nodeView.mountToolbar()
    const again = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    expect(again.style.left).toBe('8px')
    expect(again.style.top).toBe('228px')
  })

  it('工具条交互元素被 stopEvent 拦住；没有 blockId 时评论项隐藏', () => {
    const { nodeView } = mount()
    nodeView.mountToolbar()
    const toolbar = nodeView.dom.querySelector('.lark-doc-image-toolbar')
    // 评论要有 blockId 才能定位 thread，没有就整项隐藏（不是禁用）
    expect(toolbar.querySelector('button[data-name="comment"]').hidden).toBe(true)
    // 工具条自己的事件不能漏进 ProseMirror 的 keymap。
    expect(nodeView.stopEvent({ target: toolbar.querySelector('button') })).toBe(true)
    expect(nodeView.stopEvent({ target: nodeView.dom.querySelector('.lark-doc-image-img') })).toBe(false)
    expect(nodeView.stopEvent(null)).toBe(false)
  })

  it('有 blockId 时评论项显示并抛出带 blockId 的事件', () => {
    const { nodeView, editor } = mount({ src: SRC, blockId: 'blk-image-1' })
    nodeView.mountToolbar()
    const comment = nodeView.dom.querySelector('.lark-doc-image-toolbar button[data-name="comment"]')
    expect(comment.hidden).toBe(false)
    const received = []
    editor.on('commentBlock', (payload) => received.push(payload))
    comment.click()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ blockId: 'blk-image-1', type: 'image' })
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
  it('非法裁剪区域不上传；合法裁剪更新 src/attchId 并保留原图映射，可重置', async () => {
    const stub = stubImagePipeline()
    try {
      const { nodeView, attrs } = mount(
        { src: ORIGINAL, attchId: 'original' },
        { resolveImageFile: stub.resolveImageFile },
      )
      expect(nodeView.openCrop()).toBe(true)
      const region = nodeView.dom.querySelector('.lark-doc-crop-region')
      expect(region.style.left).toBe('10%')
      expect(region.style.width).toBe('80%')

      nodeView.setCropArea({ x: 60, y: 0, width: 60, height: 50 })
      expect(await nodeView.applyCrop()).toBe(false)
      expect(stub.calls).toHaveLength(0)
      expect(nodeView.dom.querySelector('.lark-doc-media-dialog .lark-doc-media-error').textContent)
        .toBe('裁剪区域须在原图范围内，宽高必须大于零')

      nodeView.setCropArea({ x: 10, y: 10, width: 50, height: 50 })
      expect(await nodeView.applyCrop()).toBe(true)
      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0].type).toBe('image/png')
      expect(stub.calls[0].name).toBe('cropped-image.png')
      expect(attrs().src).toBe('https://cdn.example.com/cropped.png')
      expect(attrs().attchId).toBe('crop-1')
      expect(attrs().originalSrc).toBe(ORIGINAL)
      expect(attrs().originalAttchId).toBe('original')
      // 裁剪成功要收掉对话框
      expect(nodeView.dom.querySelector('.lark-doc-media-backdrop')).toBeNull()

      expect(nodeView.reset()).toBe(true)
      expect(attrs().src).toBe(ORIGINAL)
      expect(attrs().attchId).toBe('original')
    } finally {
      stub.restore()
    }
  })

  it('裁剪结果上传失败时不改文档、不关窗、恢复按钮', async () => {
    const stub = stubImagePipeline({ upload: () => null })
    try {
      const { nodeView, attrs } = mount({ src: ORIGINAL }, { resolveImageFile: stub.resolveImageFile })
      nodeView.openCrop()
      expect(await nodeView.applyCrop()).toBe(false)
      expect(attrs().src).toBe(ORIGINAL)
      expect(attrs().originalSrc).toBeNull()
      const apply = nodeView.dom.querySelector('.lark-doc-media-dialog > button')
      expect(apply.disabled).toBe(false)
      expect(apply.textContent).toBe('应用裁剪')
    } finally {
      stub.restore()
    }
  })

  it('没有原图映射时 reset 不写文档；未配置上传时裁剪给出明确报错', async () => {
    const { nodeView, attrs } = mount()
    expect(nodeView.reset()).toBe(false)
    expect(attrs().src).toBe(SRC)

    const stub = stubImagePipeline()
    try {
      expect(nodeView.openCrop()).toBe(true)
      expect(await nodeView.applyCrop()).toBe(false)
      expect(nodeView.dom.querySelector('.lark-doc-media-dialog .lark-doc-media-error').textContent)
        .toBe('未配置图片上传，无法保存裁剪结果')
    } finally {
      stub.restore()
    }
  })
})

describe('P2-01 图片预览与销毁', () => {
  it('双击预览挂进块内（能读到 .lark-doc 的主题 token）并可关闭', () => {
    const { nodeView } = mount()
    expect(nodeView.openPreview()).toBe(true)
    const shell = nodeView.dom.querySelector('.lark-doc-image-viewer-shell')
    expect(shell).not.toBeNull()
    expect(shell.getAttribute('role')).toBe('dialog')
    expect(shell.querySelector('img').getAttribute('src')).toBe(SRC)
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-close')).not.toBeNull()

    // 八层结构：遮罩 / 内容区 / 图片 / 工具条（prev · page · next · divider · more · scale · 菜单）
    expect(shell.querySelector('.lark-doc-image-viewer-mask')).not.toBeNull()
    expect(shell.querySelector('.lark-doc-image-viewer-content')).not.toBeNull()
    const toolbar = shell.querySelector('.lark-doc-image-viewer-toolbar')
    expect(toolbar.classList.contains('is-hidden')).toBe(false)
    expect(toolbar.querySelector('.lark-doc-image-viewer-toolbar-list')).not.toBeNull()
    expect(toolbar.querySelectorAll('.lark-doc-image-viewer-btn')).toHaveLength(3)
    expect(toolbar.querySelector('.lark-doc-image-viewer-page')).not.toBeNull()
    expect(toolbar.querySelector('.lark-doc-image-viewer-divider')).not.toBeNull()
    expect(toolbar.querySelector('.lark-doc-image-viewer-scale')).not.toBeNull()
    expect(toolbar.querySelector('.lark-doc-image-viewer-menu').hidden).toBe(true)

    nodeView.closePreview()
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
  })

  it('拦截态预览转成替换入口', () => {
    const { nodeView } = mount({ src: BLOCKED_IMAGE_PLACEHOLDER })
    expect(nodeView.openPreview()).toBe(false)
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
  })

  it('destroy 收掉工具条、对话框与预览', () => {
    const { nodeView } = mount({ src: SRC, originalSrc: ORIGINAL })
    nodeView.mountToolbar()
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).not.toBeNull()
    // openCrop() 会主动卸载工具条（对话框顶掉它），所以挂载断言必须放在它之前
    nodeView.openCrop()
    expect(nodeView.dom.querySelector('.lark-doc-media-backdrop')).not.toBeNull()
    nodeView.openPreview()
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).not.toBeNull()

    nodeView.destroy()
    expect(nodeView.dom.querySelector('.lark-doc-image-toolbar')).toBeNull()
    expect(nodeView.dom.querySelector('.lark-doc-media-backdrop')).toBeNull()
    expect(nodeView.dom.querySelector('.lark-doc-image-viewer-shell')).toBeNull()
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
