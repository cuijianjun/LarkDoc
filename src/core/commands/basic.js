/**
 * 基础组命令（对齐需求 03 §3.4 ①「基础 16 项」：文本 / H1–H9 / 有序 / 无序 / 代码块 / 引用 / 分隔线 / 链接）。
 * CommandDef 契约见 requirements/09 §3.2：
 *   - group：12 分类之一，与文件所在组一致；
 *   - tier：required（功能完整）| skeleton（能插入能配置、渲染降级）| skip（菜单置灰的可见取舍）。
 * 菜单数组顺序由 core/commands/index.js 的显式 COMMAND_ORDER 统一保证，这里只管定义。
 */
const headingGlyphs = ['T', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9']

export const basicCommands = [
  { id: 'paragraph', label: '正文', category: '文字', plusCategory: '基础', glyph: headingGlyphs[0], tone: 'blue', keywords: 'text duanluo paragraph', group: 'basic', tier: 'required' },
  ...Array.from({ length: 9 }, (_, index) => ({ id: `heading${index + 1}`, label: `${'一二三四五六七八九'[index]}级标题`, category: '文字', plusCategory: index < 3 ? '基础' : '其他标题', glyph: headingGlyphs[index + 1], tone: 'blue', keywords: `h${index + 1} heading biaoti title`, group: 'basic', tier: 'required' })),
  { id: 'orderedList', label: '有序列表', category: '列表', plusCategory: '基础', glyph: '1≡', tone: 'indigo', keywords: 'list wuxu bulleted numbered youxu', group: 'basic', tier: 'required' },
  { id: 'bulletList', label: '无序列表', category: '列表', plusCategory: '基础', glyph: '•≡', tone: 'indigo', keywords: 'list wuxu bulleted', group: 'basic', tier: 'required' },
  { id: 'code', label: '代码块', category: '插入', plusCategory: '基础', glyph: '{}', tone: 'green', keywords: 'code daima', group: 'basic', tier: 'required' },
  { id: 'blockquote', label: '引用', category: '布局', plusCategory: '基础', glyph: '❝', tone: 'blue', keywords: 'quote yinyong', group: 'basic', tier: 'required' },
  { id: 'divider', label: '分割线', category: '布局', plusCategory: '基础', glyph: '≡', tone: 'orange', keywords: 'divider hr fengexian', group: 'basic', tier: 'required' },
  { id: 'link', label: '链接', category: '文字', plusCategory: '基础', glyph: '↗', tone: 'blue', keywords: 'link lianjie hyperlink', group: 'basic', tier: 'required' },
]
