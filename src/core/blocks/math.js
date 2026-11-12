/** 公式扩展：行内/块级共用一套实现，只差 group 与渲染容器。 */
import { Node, mergeAttributes } from '@tiptap/core'
import { loadFeature } from '../features/registry'
import { createMathNodeView } from '../nodeviews/math'
import { validateAttribute } from './shared'

let katexPromise
/**
 * KaTeX 与它的样式一起按需加载：katex.css 有 118 KB（产物 CSS 的 2/3），
 * 文档里没有公式时完全不必下载。Rollup按入口选择抽取或注入样式；Element特性包同时定位同目录字体。
 *
 * 阶段 4：接入特性注册表 —— 注册了 'math' 特性（宿主加载 lark-doc/features/math.js）
 * 时直接用宿主提供的实例；否则走内置通道。'lark-doc/katex.css' 与
 * 'lark-doc/mermaid-vendor' 是构建期 alias 指定符：各构建（全量 / lite / 特性包）
 * 各自映射到真实文件或 stub，见 rollup.config.mjs 与 scripts/build-rollup.mjs。
 */
export function loadKatex() {
  // 每次先查注册表：lite曾取得占位实现后，补加载的feature仍能恢复。
  return loadFeature('math', () => {
    if (!katexPromise) {
      katexPromise = Promise.all([
        import(/* webpackChunkName: "math" */ 'katex'),
        import(/* webpackChunkName: "math" */ 'lark-doc/katex.css'),
      ]).then(([module]) => module.default || module).catch(error => {
        katexPromise = null
        throw error
      })
    }
    return katexPromise
  })
}

function mathExtension(name, onError, getRuntimeOptions) {
  // 保留公式节点的 JSON/HTML 契约；KaTeX 只在公式节点实际挂载时加载。
  const isBlock = name === 'blockMath'
  return Node.create({
    name,
    group: isBlock ? 'block' : 'inline',
    inline: !isBlock,
    atom: true,
    selectable: true,
    addOptions() { return { getRuntimeOptions: getRuntimeOptions || (() => ({})) } },
    addStorage() {
      const views = new Set()
      return { views, refresh: () => views.forEach(view => view.sync()) }
    },
    addAttributes() {
      return { latex: { default: '', validate: validateAttribute(`${name}.latex`, value => typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')), parseHTML: (el) => (el.getAttribute('data-latex') || '').slice(0, 100000).split('\u0000').join(''), renderHTML: ({ latex }) => ({ 'data-latex': latex }) } }
    },
    parseHTML() { return [{ tag: `${isBlock ? 'div' : 'span'}[data-type="${isBlock ? 'block-math' : 'inline-math'}"]` }] },
    renderHTML({ node, HTMLAttributes }) {
      return [isBlock ? 'div' : 'span', mergeAttributes(HTMLAttributes, { 'data-type': isBlock ? 'block-math' : 'inline-math', class: 'tiptap-mathematics-render' }), String(node.attrs.latex || '')]
    },
    addNodeView() {
      return props => createMathNodeView(props, { loadKatex, onError })
    },
  })
}

export { mathExtension }
