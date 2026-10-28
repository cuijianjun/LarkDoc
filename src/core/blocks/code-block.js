/** 代码块扩展：语言标记进 data-language，并透传图表/高亮性能配置。 */
import CodeBlock from '@tiptap/extension-code-block'
import { clampBlockIndent } from '../documentOperations'
// 代码块 NodeView（语言下拉 / 高亮 / 图表）查注册表，注册表实现见 core/nodeviews/registry。
import { getNodeView } from '../nodeviews/registry'

function codeExtension(config) {
  return CodeBlock.extend({
    addAttributes() {
      return {
        language: { default: 'plaintext', parseHTML: (el) => el.getAttribute('data-language') || Array.from(el.firstElementChild?.classList || []).find((name) => name.startsWith('language-'))?.slice(9) || 'plaintext', renderHTML: ({ language }) => ({ 'data-language': /^[\w+-]{0,32}$/.test(language) ? language : 'plaintext' }) },
        // 飞书的代码块可以整体缩进（缩进的是盒子，不是盒内文本），上限与文本块一致。
        indent: {
          default: 0,
          parseHTML: (el) => clampBlockIndent(el.getAttribute('data-indent')),
          renderHTML: ({ indent }) => (clampBlockIndent(indent) ? { 'data-indent': clampBlockIndent(indent) } : {}),
        },
      }
    },
    // 代码块 NodeView（语言下拉 / 高亮 / 图表）查注册表。
    addNodeView() { const view = getNodeView('codeBlock'); if (view) return view },
  }).configure({
    syntaxHighlight: config?.performance?.syntaxHighlight !== false,
    diagram: config?.features?.diagram !== false,
    diagramScriptUrl: (config?.performance && config.performance.diagramScriptUrl) || null,
  })
}

export { codeExtension }
