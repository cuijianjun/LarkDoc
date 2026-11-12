/** 代码块扩展：语言标记进 data-language，并透传图表/高亮性能配置。 */
import CodeBlock from '@tiptap/extension-code-block'
import { clampBlockIndent } from '../documentOperations'
// 代码块 NodeView（语言下拉 / 高亮 / 图表）查注册表，注册表实现见 core/nodeviews/registry。
// 阶段 2 起代码块是 core 自带的纯 DOM NodeView（三端共用），无人注册时直接回落它。
import { getNodeView } from '../nodeviews/registry'
import { createCodeBlockNodeView } from '../nodeviews/code-block'
import { validateAttribute } from './shared'

function codeExtension(config) {
  return CodeBlock.extend({
    // Source code accepts revision suggestions, while ordinary formatting stays disabled.
    marks: 'revision',
    addAttributes() {
      return {
        language: { default: 'plaintext', parseHTML: (el) => el.getAttribute('data-language') || Array.from(el.firstElementChild?.classList || []).find((name) => name.startsWith('language-'))?.slice(9) || 'plaintext', renderHTML: ({ language }) => ({ 'data-language': /^[\w+-]{0,32}$/.test(language) ? language : 'plaintext' }) },
        caption: {
          default: '',
          validate: validateAttribute('codeBlock.caption', value => typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')),
          parseHTML: el => el.getAttribute('data-caption') || '',
          renderHTML: ({ caption }) => caption ? { 'data-caption': caption } : {},
        },
        wrap: {
          default: false,
          parseHTML: el => el.getAttribute('data-code-wrap') === 'true',
          renderHTML: ({ wrap }) => wrap ? { 'data-code-wrap': 'true' } : {},
        },
        deletionRevisionId: {
          default: '',
          validate: validateAttribute('codeBlock.deletionRevisionId', value => typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')),
          parseHTML: el => el.getAttribute('data-deletion-revision-id') || '',
          renderHTML: ({ deletionRevisionId }) => deletionRevisionId ? { 'data-deletion-revision-id': deletionRevisionId } : {},
        },
        deletionAuthor: {
          default: '',
          validate: validateAttribute('codeBlock.deletionAuthor', value => typeof value === 'string' && value.length <= 100000 && !value.includes('\u0000')),
          parseHTML: el => el.getAttribute('data-deletion-author') || '',
          renderHTML: ({ deletionAuthor }) => deletionAuthor ? { 'data-deletion-author': deletionAuthor } : {},
        },
        // 飞书的代码块可以整体缩进（缩进的是盒子，不是盒内文本），上限与文本块一致。
        indent: {
          default: 0,
          parseHTML: (el) => clampBlockIndent(el.getAttribute('data-indent')),
          renderHTML: ({ indent }) => (clampBlockIndent(indent) ? { 'data-indent': clampBlockIndent(indent) } : {}),
        },
      }
    },
    addStorage() { return { lastLanguage: 'plaintext', lastWrap: false } },
    addCommands() {
      const attributes = (state, value) => ({
        ...(state.selection.$from.parent.type.name === this.name ? state.selection.$from.parent.attrs : {
          language: this.editor.storage[this.name].lastLanguage,
          wrap: this.editor.storage[this.name].lastWrap,
        }),
        ...value,
      })
      return {
        ...this.parent?.(),
        setCodeBlock: value => ({ commands, state }) => commands.setNode(this.name, attributes(state, value)),
        toggleCodeBlock: value => ({ commands, state }) => commands.toggleNode(this.name, 'paragraph', attributes(state, value)),
      }
    },
    // 代码块 NodeView（语言下拉 / 高亮 / 图表）查注册表。
    addNodeView() { return getNodeView('codeBlock') || createCodeBlockNodeView },
  }).configure({
    syntaxHighlight: config?.performance?.syntaxHighlight !== false,
    diagram: config?.features?.diagram !== false,
    diagramScriptUrl: (config?.performance && config.performance.diagramScriptUrl) || null,
  })
}

export { codeExtension }
