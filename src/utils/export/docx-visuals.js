import { renderDiagram } from '../../core/diagram'

function assertCurrent(settings) {
  if (typeof settings.shouldDownload === 'function' && settings.shouldDownload() !== true) throw new Error('导出已取消：文档、权限或导出条件已改变，请重新导出')
}

function blobBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then(buffer => new Uint8Array(buffer))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(new Error('图表图片读取失败'))
    reader.readAsArrayBuffer(blob)
  })
}

/** 使用浏览器 Image 解码 SVG，兼容 Safari；不把外部资源带入 canvas。 */
export async function diagramPng(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.localName !== 'svg' || doc.querySelector('parsererror, script, foreignObject, image, use, link')) throw new Error('图表包含不支持的资源')
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || /href$/i.test(attr.name)) throw new Error('图表包含外部行为')
      if (externalUrls(attr.value)) throw new Error('图表包含外部资源')
    }
  }
  for (const style of svg.querySelectorAll('style')) {
    if (/@import/i.test(style.textContent) || externalUrls(style.textContent)) throw new Error('图表包含外部样式')
  }
  const view = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const width = view.length === 4 ? view[2] : parseFloat(svg.getAttribute('width'))
  const height = view.length === 4 ? view[3] : parseFloat(svg.getAttribute('height'))
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value < 100000)) throw new Error('图表尺寸无效')
  const scale = Math.min(1, 560 / width, 720 / height)
  const size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
  svg.setAttribute('width', String(size.width * 2))
  svg.setAttribute('height', String(size.height * 2))
  svg.style.removeProperty('max-width')
  svg.style.removeProperty('width')
  svg.style.removeProperty('height')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
  const canvas = document.createElement('canvas')
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { image.onload = image.onerror = null; image.src = ''; reject(new Error('图表图片解码超时')) }, 10000)
      image.onload = () => { clearTimeout(timer); image.onload = image.onerror = null; resolve() }
      image.onerror = () => { clearTimeout(timer); image.onload = image.onerror = null; reject(new Error('图表图片解码失败')) }
      image.src = url
    })
    canvas.width = size.width * 2
    canvas.height = size.height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成图表图片')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图表图片生成失败')), 'image/png'))
    return { ...size, data: await blobBytes(blob) }
  } finally {
    URL.revokeObjectURL(url)
    canvas.width = canvas.height = 0
  }
}

function externalUrls(value) {
  return [...String(value).matchAll(/url\(([^)]*)\)/gi)].some(match => !/^#[\w:.-]+$/.test(match[1].trim().replace(/^(['"])(.*)\1$/, '$2')))
}

/** 从完整文档源码生成图表，包含尚未挂载或已经被虚拟化卸载的块。只修改导出快照。 */
export async function prepareWordDiagrams(source, images, settings, report) {
  const result = { ...images }
  const cache = new Map()
  let count = 0
  async function visit(parent) {
    if (!Array.isArray(parent.content)) return
    for (let index = 0; index < parent.content.length; index += 1) {
      assertCurrent(settings)
      const node = parent.content[index]
      if (!node || typeof node !== 'object') continue
      if (node.type === 'codeBlock' && String(node.attrs?.language || '').toLowerCase() === 'mermaid') {
        const code = (node.content || []).map(child => child.text || '').join('')
        try {
          if (!cache.has(code)) cache.set(code, renderDiagram(code, { theme: 'light' }).then(diagramPng))
          const png = await cache.get(code)
          assertCurrent(settings)
          let src
          do { src = `lark-doc-export-diagram:${++count}` } while (result[src])
          result[src] = png.data
          parent.content[index] = { type: 'image', attrs: { src, width: png.width, height: png.height, alt: '图表', caption: `Mermaid 源码：\n${code}` } }
        } catch (_) {
          assertCurrent(settings)
          report.chartFallbacks = (report.chartFallbacks || 0) + 1
        }
      } else await visit(node)
    }
  }
  await visit(source)
  return result
}
