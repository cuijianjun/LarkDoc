/**
 * 行内内容组命令：行内公式、块公式与表情（P4「行内富内容与导航」期的落点）。
 * 注：需求 03 §3.4 ②把「公式」归常用分类（菜单 category 仍是『插入』），
 * 这里按 0.12 的组文件布局落在 inline 组——group 与菜单 category 是两个维度，互不影响。
 */
export const inlineCommands = [
  { id: 'inlineMath', label: '行内公式', category: '插入', plusCategory: '常用', glyph: 'TeX', tone: 'gray', keywords: 'math gongshi inline', group: 'inline', tier: 'required' },
  { id: 'blockMath', label: '块公式', category: '插入', plusCategory: '常用', glyph: '∑', tone: 'gray', keywords: 'math gongshi block', group: 'inline', tier: 'required' },
  { id: 'emoji', label: '表情', category: '插入', plusCategory: '常用', glyph: '☺', tone: 'yellow', keywords: 'emoji biaoqing smile', group: 'inline', tier: 'required' },
]
