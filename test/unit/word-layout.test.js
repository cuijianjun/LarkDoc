// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { buildDocx } from '../../src/utils/export/docx'
import { normalizeExportDocument, serializeMarkdown } from '../../src/utils/export/markdown'
import { diagramPng, prepareWordDiagrams } from '../../src/utils/export/docx-visuals'
import { renderDiagram } from '../../src/core/diagram'

vi.mock('../../src/core/diagram', () => ({ renderDiagram: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); renderDiagram.mockReset() })

const text = value => ({ type: 'text', text: value })
const paragraph = (...content) => ({ type: 'paragraph', content })
const documentOf = content => ({ type: 'doc', content })
async function xmlOf(blob) {
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
  const zip = await JSZip.loadAsync(new Uint8Array(data))
  return { xml: await zip.file('word/document.xml').async('string'), zip }
}

describe('Word layout and editable formulas', () => {
  it('keeps unequal columns and nested rich content, while Markdown stays readable and flat', async () => {
    const source = documentOf([{ type: 'columns', content: [
      { type: 'column', attrs: { width: 30 }, content: [paragraph(text('左栏')), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('清单'))] }] }] },
      { type: 'column', attrs: { width: 70 }, content: [paragraph(text('右栏')), { type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } }] },
    ] }])
    const before = JSON.stringify(source)
    const word = normalizeExportDocument(source, { format: 'word' })
    expect(word.content[0].type).toBe('columns')
    expect(normalizeExportDocument(source).content.some(node => node.type === 'columns')).toBe(false)
    const { xml } = await xmlOf(await buildDocx(source))
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('w:val="nil"')
    expect(xml).toContain('w:type="pct" w:w="30%"')
    expect(xml).toContain('w:type="pct" w:w="70%"')
    expect(xml).toContain('左栏'); expect(xml).toContain('右栏'); expect(xml).toContain('清单')
    expect(xml).toContain('<m:f>')
    expect(serializeMarkdown(source)).toContain('左栏')
    expect(JSON.stringify(source)).toBe(before)
  })
  it('preserves inline context and native fractions, radicals, scripts, summation and matrices', async () => {
    const latex = '\\sum_{i=1}^{n}\\frac{x_i^2}{\\sqrt{y}} + \\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'
    const source = documentOf([paragraph(text('公式前'), { type: 'inlineMath', attrs: { latex } }, text('公式后'))])
    const { xml } = await xmlOf(await buildDocx(source))
    for (const tag of ['m:oMath', 'm:f', 'm:rad', 'm:sSubSup', 'm:nary', 'm:m', 'm:mr', 'm:d']) expect(xml.includes(`<${tag}`)).toBe(true)
    expect(xml).toContain('公式前'); expect(xml).toContain('公式后')
    expect(xml).not.toContain('\\frac')
  })
  it('reports unsupported or invalid equations and keeps their source without inventing a successful rendering', async () => {
    const report = {}
    const { xml } = await xmlOf(await buildDocx(documentOf([paragraph({ type: 'inlineMath', attrs: { latex: '\\notARealCommand{<bad&>}' } })]), { report }))
    expect(report.mathFallbacks).toBe(1)
    expect(xml).toContain('notARealCommand')
    expect(xml).not.toContain('<bad&>')
    expect(xml).not.toContain('<m:oMath')
  })
  it('keeps nested table cells valid and images proportional inside a narrow column', async () => {
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71]); new DataView(png.buffer).setUint32(16, 1000); new DataView(png.buffer).setUint32(20, 500)
    const source = documentOf([{ type: 'columns', content: [
      { type: 'column', attrs: { width: 30 }, content: [{ type: 'image', attrs: { src: 'local', width: 1000 } }] },
      { type: 'column', attrs: { width: 70 }, content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('嵌套表格'))] }] }] }] },
    ] }])
    const { xml } = await xmlOf(await buildDocx(source, { images: { local: png } }))
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    const extent = parsed.getElementsByTagName('wp:extent')[0]
    expect(Number(extent.getAttribute('cx'))).toBeLessThan(180 * 9525)
    expect(Number(extent.getAttribute('cx'))).toBe(2 * Number(extent.getAttribute('cy')))
    for (const cell of parsed.getElementsByTagName('w:tc')) expect(cell.lastElementChild.tagName).toBe('w:p')
  })
})

function mockRaster() {
  vi.stubGlobal('Image', class { set src(value) { if (value) queueMicrotask(() => this.onload?.()) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
    const data = new Uint8Array(24); data.set([137, 80, 78, 71])
    new DataView(data.buffer).setUint32(16, this.width); new DataView(data.buffer).setUint32(20, this.height)
    callback(new Blob([data], { type: 'image/png' }))
  })
}
const diagram = code => ({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [text(code)] })
const safeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><defs><marker id="arrow"/></defs><path marker-end="url(\'#arrow\')" d="M0 0L10 10"/></svg>'
describe('Word charts from the complete source', () => {
  it('rasterizes offscreen/nested charts, reuses identical renders and packages PNG bytes with source alt text', async () => {
    mockRaster(); renderDiagram.mockResolvedValue(safeSvg)
    const original = documentOf([diagram('graph TD; A-->B'), { type: 'columns', content: [{ type: 'column', content: [diagram('graph TD; A-->B')] }] }])
    const source = normalizeExportDocument(original, { format: 'word' }), report = {}
    const images = await prepareWordDiagrams(source, {}, {}, report)
    expect(renderDiagram).toHaveBeenCalledTimes(1)
    expect(Object.keys(images)).toHaveLength(2)
    expect(original.content[0].type).toBe('codeBlock')
    expect(source.content[0].attrs).toMatchObject({ width: 560, height: 280 })
    const { xml, zip } = await xmlOf(await buildDocx(source, { images }))
    expect(xml).toContain('<w:drawing>')
    expect(xml).toContain('Mermaid 源码：')
    expect(Object.keys(zip.files).some(name => /^word\/media\/.*\.png$/.test(name))).toBe(true)
    expect(report.chartFallbacks).toBeUndefined()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:diagram')
  })
  it('rejects external resources and preserves failed chart source with an honest fallback count', async () => {
    renderDiagram.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><image href="https://example.com/a.png"/></svg>')
    const source = documentOf([diagram('bad source')]), report = {}
    expect(await prepareWordDiagrams(source, {}, {}, report)).toEqual({})
    expect(report.chartFallbacks).toBe(1)
    expect(source.content[0].type).toBe('codeBlock')
    await expect(diagramPng(safeSvg.replace("url('#arrow')", 'url(https://example.com/a)'))).rejects.toThrow(/外部/)
  })
  it('cancels after async rendering and never treats cancellation as a chart fallback', async () => {
    mockRaster()
    let allowed = true
    renderDiagram.mockImplementation(async () => { allowed = false; return safeSvg })
    const report = {}
    await expect(prepareWordDiagrams(documentOf([diagram('graph TD; A-->B')]), {}, { shouldDownload: () => allowed }, report)).rejects.toThrow(/取消/)
    expect(report.chartFallbacks).toBeUndefined()
  })
})
