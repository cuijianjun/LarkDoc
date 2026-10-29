/** 公式扩展：行内/块级共用一套实现，只差 group 与渲染容器。 */
import { Node, mergeAttributes } from '@tiptap/core'
import { loadFeature } from '../features/registry'

let katexPromise
/**
 * KaTeX 与它的样式一起按需加载：katex.css 有 118 KB（产物 CSS 的 2/3），
 * 文档里没有公式时完全不必下载。样式写在 async 块里，webpack 会把它拆成
 * 独立的 CSS 块（lib 单文件构建则合并回主 CSS），无需运行时按 URL 拼路径。
 *
 * 阶段 4：接入特性注册表 —— 注册了 'math' 特性（宿主加载 lark-doc/features/math.js）
 * 时直接用宿主提供的实例；否则走内置通道。'lark-doc/katex.css' 与
 * 'lark-doc/mermaid-vendor' 是构建期 alias 指定符：各构建（全量 / lite / 特性包）
 * 各自映射到真实文件或 stub，见 vue.config.js / build-lite.js / build-features.js。
 */
export function loadKatex() {
  if (!katexPromise) {
    katexPromise = loadFeature('math', () =>
      Promise.all([
        import(/* webpackChunkName: "math" */ 'katex'),
        import(/* webpackChunkName: "math" */ 'lark-doc/katex.css'),
      ]).then(([module]) => module.default || module),
    )
  }
  return katexPromise
}

function mathExtension(name, onError) {
  // 保留公式节点的 JSON/HTML 契约；KaTeX 只在公式节点实际挂载时加载。
  const isBlock = name === 'blockMath'
  return Node.create({
    name,
    group: isBlock ? 'block' : 'inline',
    inline: !isBlock,
    atom: true,
    selectable: true,
    addAttributes() {
      return { latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') || '', renderHTML: ({ latex }) => ({ 'data-latex': String(latex || '').slice(0, 4096) }) } }
    },
    parseHTML() { return [{ tag: `${isBlock ? 'div' : 'span'}[data-type="${isBlock ? 'block-math' : 'inline-math'}"]` }] },
    renderHTML({ node, HTMLAttributes }) {
      return [isBlock ? 'div' : 'span', mergeAttributes(HTMLAttributes, { 'data-type': isBlock ? 'block-math' : 'inline-math', class: 'tiptap-mathematics-render' }), String(node.attrs.latex || '')]
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement(isBlock ? 'div' : 'span')
        let disposed = false
        let renderVersion = 0
        const render = (current) => {
          const version = ++renderVersion
          dom.className = 'tiptap-mathematics-render'
          dom.setAttribute('data-type', isBlock ? 'block-math' : 'inline-math')
          dom.setAttribute('data-latex', String(current.attrs.latex || '').slice(0, 4096))
          dom.textContent = current.attrs.latex
          loadKatex().then((katex) => {
            if (disposed || version !== renderVersion) return
            try { katex.render(current.attrs.latex, dom, { throwOnError: true, displayMode: isBlock, trust: false, strict: 'error' }) }
            catch (_) { dom.textContent = `公式错误：${current.attrs.latex}`; dom.classList.add('lark-doc-math-error'); if (onError) onError('公式无法解析，请检查 LaTeX 语法') }
          }).catch(() => { if (!disposed && version === renderVersion && onError) onError('公式渲染器加载失败') })
        }
        render(node)
        return { dom, update: (next) => { if (next.type !== node.type) return false; render(next); return true }, destroy: () => { disposed = true } }
      }
    },
  })
}

export { mathExtension }
