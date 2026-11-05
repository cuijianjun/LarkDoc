/**
 * 特性包：Markdown 双向转换（阶段 4）。
 *
 * dist/features/markdown.js：marked + turndown 一起出包，引入即完成
 * 'markdown' 注册（loader resolve { marked, TurndownService }）。lite 主
 * 产物的 md 导入 / md 导出从可读报错恢复为完整转换。
 */
import { registerFeature } from '../core/features/registry'
import { marked } from 'marked'
import TurndownService from 'turndown'

registerFeature('markdown', () => Promise.resolve({ marked, TurndownService }))
