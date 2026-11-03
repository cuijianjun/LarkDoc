/**
 * 小组件组命令：图表（mermaid 渲染块）+ 目录导航（ISV 小组件）。
 *
 * 对齐需求 03 §3.4 ⑥「绘图」分类的 0.12 落点；画板 / 思维导图 / 流程图 / UML 等
 * EmbedDef 形态在 P3 期进 core/embed，不在这里重复造块。
 *
 * `catalogue`（09 §P4-04）：真飞书斜杠项文案就是「目录导航」（`data-name="HTML 块"` 那一段
 * 的下一项），英文叫 Table of Contents，所以 keywords 必须带 `toc` / `table of contents`
 * ——实测真飞书里打「table」也能命中它。
 * 它落的是 `isv` 节点（`kind: 'catalog'`），渲染成宿主 DOM 的目录树（02 §22 ④-5），
 * **不弹面板**，选完就地插块；但仍然 `plus: false`：真飞书「文档小组件」是斜杠菜单的
 * 分类，`+` 菜单的块级入口不承诺这块（目录要读全篇标题才有内容，空文档插了是个空灰底）。
 */
export const widgetCommands = [
  { id: 'diagram', label: '图表', category: '插入', plusCategory: '常用', glyph: '▥', tone: 'teal', keywords: 'diagram mermaid chart tubiao flowchart liuchengtu 图', group: 'widget', tier: 'required' },
  { id: 'catalogue', label: '目录导航', category: '文档小组件', plus: false, glyph: '☰', tone: 'gray', keywords: 'catalogue mulu daohang toc table of contents catalog outline widget', group: 'widget', tier: 'required' },
]
