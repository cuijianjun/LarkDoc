const headingGlyphs = ['T', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9']

export const COMMANDS = [
  { id: 'paragraph', label: '正文', category: '文字', plusCategory: '基础', glyph: headingGlyphs[0], tone: 'blue', keywords: 'text duanluo paragraph' },
  ...Array.from({ length: 9 }, (_, index) => ({ id: `heading${index + 1}`, label: `${'一二三四五六七八九'[index]}级标题`, category: '文字', plusCategory: index < 3 ? '基础' : '其他标题', glyph: headingGlyphs[index + 1], tone: 'blue', keywords: `h${index + 1} heading biaoti title` })),
  { id: 'orderedList', label: '有序列表', category: '列表', plusCategory: '基础', glyph: '1≡', tone: 'indigo', keywords: 'list wuxu bulleted numbered youxu' },
  { id: 'bulletList', label: '无序列表', category: '列表', plusCategory: '基础', glyph: '•≡', tone: 'indigo', keywords: 'list wuxu bulleted' },
  { id: 'taskList', label: '任务列表', category: '列表', plusCategory: '常用', glyph: '☑', tone: 'indigo', keywords: 'todo task renwu checkbox' },
  { id: 'code', label: '代码块', category: '插入', plusCategory: '基础', glyph: '{}', tone: 'green', keywords: 'code daima' },
  { id: 'blockquote', label: '引用', category: '布局', plusCategory: '基础', glyph: '❝', tone: 'blue', keywords: 'quote yinyong' },
  { id: 'divider', label: '分割线', category: '布局', plusCategory: '基础', glyph: '≡', tone: 'orange', keywords: 'divider hr fengexian' },
  { id: 'link', label: '链接', category: '文字', plusCategory: '基础', glyph: '↗', tone: 'blue', keywords: 'link lianjie hyperlink' },
  { id: 'callout', label: '高亮块', category: '布局', plusCategory: '常用', glyph: '▤', tone: 'orange', keywords: 'callout gaoliang highlight' },
  { id: 'columns', label: '分栏', category: '布局', plusCategory: '常用', glyph: 'Ⅱ', tone: 'indigo', submenu: '分栏', submenuType: 'columns', keywords: 'columns fenlan lianglan shuanglan sanlan 2 3 4 5' },
  { id: 'columns2', label: '双栏', category: '布局', plus: false, glyph: 'Ⅱ', tone: 'indigo', keywords: 'columns lianglan shuanglan 2' },
  { id: 'columns3', label: '三栏', category: '布局', plus: false, glyph: 'Ⅲ', tone: 'indigo', keywords: 'columns sanlan 3' },
  { id: 'columns4', label: '四栏', category: '布局', plus: false, glyph: 'Ⅳ', tone: 'indigo', keywords: 'columns silan 4' },
  { id: 'columns5', label: '五栏', category: '布局', plus: false, glyph: 'Ⅴ', tone: 'indigo', keywords: 'columns wulan 5' },
  { id: 'table', label: '表格', category: '插入', plusCategory: '常用', glyph: '▦', tone: 'teal', submenu: '表格', submenuType: 'table', keywords: 'table biaoge' },
  { id: 'image', label: '本地图片', category: '插入', plusCategory: '常用', glyph: '▧', tone: 'yellow', keywords: 'image tupian photo' },
  { id: 'inlineMath', label: '行内公式', category: '插入', plusCategory: '常用', glyph: 'TeX', tone: 'gray', keywords: 'math gongshi inline' },
  { id: 'blockMath', label: '块公式', category: '插入', plusCategory: '常用', glyph: '∑', tone: 'gray', keywords: 'math gongshi block' },
  { id: 'emoji', label: '表情', category: '插入', plusCategory: '常用', glyph: '☺', tone: 'yellow', keywords: 'emoji biaoqing smile' },
  { id: 'template', label: '模板', category: '插入', plusCategory: '常用', glyph: '◇', tone: 'indigo', submenu: '模板', submenuType: 'templates', keywords: 'template moban ben di local' },
  { id: 'ai', label: 'AI 改写', category: '智能', plus: false, glyph: '✦', tone: 'green', keywords: 'ai gaixie rewrite' },
]

const COMMAND_FEATURES = {
  table: 'tables', columns: 'columns', columns2: 'columns', columns3: 'columns', columns4: 'columns', columns5: 'columns',
  image: 'images', code: 'codeBlocks', inlineMath: 'math', blockMath: 'math', emoji: 'emoji', template: 'templates',
  callout: 'callouts', ai: 'ai',
}

export function filterCommands(query, kind = 'slash', config = null) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  // Feishu keeps the column count picker behind the single “分栏” entry.
  // The count options are implementation ids for the secondary picker, not
  // independent slash commands.
  const candidates = COMMANDS.filter((item) => {
    if (/^columns[2-5]$/.test(item.id)) return false
    const feature = COMMAND_FEATURES[item.id]
    if (feature && config?.features?.[feature] === false) return false
    if (Array.isArray(config?.commands?.disabled) && config.commands.disabled.includes(item.id)) return false
    if (Array.isArray(config?.commands?.allow) && config.commands.allow.length && !config.commands.allow.includes(item.id)) return false
    return kind !== 'plus' || item.plus !== false
  })
  const filtered = !needle ? candidates : candidates.filter((item) => `${item.label} ${item.id} ${item.keywords}`.toLocaleLowerCase().includes(needle))
  return filtered.map((item) => ({ ...item, category: kind === 'plus' ? (item.plusCategory || item.category) : item.category }))
}
