/** 代码块扩展：语言标记进 data-language，并透传图表/高亮性能配置。 */
import CodeBlock from '@tiptap/extension-code-block'
import { TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { clampBlockIndent } from '../documentOperations'
// 代码块 NodeView（语言下拉 / 高亮 / 图表）查注册表，注册表实现见 core/nodeviews/registry。
// 阶段 2 起代码块是 core 自带的纯 DOM NodeView（三端共用），无人注册时直接回落它。
import { getNodeView } from '../nodeviews/registry'
import { createCodeBlockNodeView } from '../nodeviews/code-block'
import { validateAttribute } from './shared'

function editCode(editor, kind, { state, tr, dispatch }) {
  if (!['tab', 'untab', 'enter', 'above', 'below'].includes(kind)) return false
  const { view } = editor
  const { selection } = state
  const { $from, $to, from, to } = selection
  if (!editor.isEditable || view.composing || !$from.sameParent($to) || $from.parent.type.name !== 'codeBlock') return false
  if (!dispatch) return true
  const text = $from.parent.textContent, start = $from.start()
  const offset = from - start, end = to - start
  const lineStart = text.slice(0, offset).lastIndexOf('\n') + 1
  const mappingStart = tr.steps.length
  closeHistory(tr)
  if (kind === 'tab' || kind === 'untab') {
    const multiline = text.slice(offset, end).includes('\n')
    if (!multiline) {
      if (kind === 'tab') tr.insertText('    ', from, from)
      else {
        const spaces = text.slice(lineStart, offset).match(/ {1,4}$/)?.[0].length || 0
        if (spaces) tr.delete(from - spaces, from)
      }
    } else {
      const lines = [lineStart]
      for (let i = lineStart; i < end; i += 1) if (text[i] === '\n') lines.push(i + 1)
      lines.reverse().forEach(pos => {
        if (kind === 'tab') tr.insertText('    ', start + pos, start + pos)
        else {
          const spaces = text.slice(pos).match(/^ {1,4}/)?.[0].length || 0
          if (spaces) tr.delete(start + pos, start + pos + spaces)
        }
      })
    }
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.slice(mappingStart).map(selection.anchor), tr.mapping.slice(mappingStart).map(selection.head)))
  } else {
    const cursor = kind === 'enter' ? offset : end
    const beginning = text.slice(0, cursor).lastIndexOf('\n') + 1
    const indent = Math.min(text.slice(beginning).match(/^[\t ]*/)[0].length, cursor - beginning)
    const newline = '\n' + ' '.repeat(indent)
    let at = from, caret
    if (kind === 'above') { at = start + beginning + indent; caret = at }
    else if (kind === 'below') { const next = text.indexOf('\n', cursor); at = start + (next < 0 ? text.length : next) }
    tr.insertText(newline, at, kind === 'enter' ? to : at)
    tr.setSelection(TextSelection.create(tr.doc, caret ?? at + newline.length))
  }
  tr.scrollIntoView()
  return true
}

function codeExtension(config) {
  return CodeBlock.extend({
    // Source code accepts revision suggestions, while ordinary formatting stays disabled.
    marks: 'revision',
    addKeyboardShortcuts() {
      const input = kind => this.editor.isActive('codeBlock') && (!this.editor.isEditable || this.editor.view.composing) || this.editor.commands.editCode(kind)
      return {
        ...this.parent?.(),
        Tab: () => input('tab'),
        'Shift-Tab': () => input('untab'),
        Enter: () => input('enter'),
        'Mod-Enter': () => input('below'),
        'Shift-Mod-Enter': () => input('above'),
        'Mod-a': () => {
          const { $from, $to } = this.editor.state.selection
          if (!this.editor.isEditable || !$from.sameParent($to) || $from.parent.type.name !== this.name) return false
          const from = $from.start(), to = $from.end()
          // A second select-all can expand to the document; an empty source
          // stays scoped so replacing it cannot remove neighbouring blocks.
          if (from !== to && $from.pos === from && $to.pos === to) return false
          return this.editor.commands.setTextSelection({ from, to })
        },
      }
    },
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
        editCode: kind => props => editCode(this.editor, kind, props),
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
