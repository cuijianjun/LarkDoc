/**
 * 常用组命令（对齐需求 03 §3.4 ②「常用」口径中已实现的项：任务 / 图片 / 表格 / 分栏 / 高亮块 / 模板）。
 * 尚未实现的常用项（视频或文件、同步块、子文档）在 P2 / P1 期落位，届时追加定义即可。
 * columns2–5 是「分栏」二级选择器的实现 id，不作为独立命令暴露（filterCommands 里过滤）。
 */
export const commonCommands = [
  { id: 'taskList', label: '任务列表', category: '列表', plusCategory: '常用', glyph: '☑', tone: 'indigo', keywords: 'todo task renwu checkbox', group: 'common', tier: 'required' },
  { id: 'callout', label: '高亮块', category: '布局', plusCategory: '常用', glyph: '▤', tone: 'orange', keywords: 'callout gaoliang highlight', group: 'common', tier: 'required' },
  { id: 'columns', label: '分栏', category: '布局', plusCategory: '常用', glyph: 'Ⅱ', tone: 'indigo', submenu: '分栏', submenuType: 'columns', keywords: 'columns fenlan lianglan shuanglan sanlan 2 3 4 5', group: 'common', tier: 'required' },
  { id: 'columns2', label: '双栏', category: '布局', plus: false, glyph: 'Ⅱ', tone: 'indigo', keywords: 'columns lianglan shuanglan 2', group: 'common', tier: 'required' },
  { id: 'columns3', label: '三栏', category: '布局', plus: false, glyph: 'Ⅲ', tone: 'indigo', keywords: 'columns sanlan 3', group: 'common', tier: 'required' },
  { id: 'columns4', label: '四栏', category: '布局', plus: false, glyph: 'Ⅳ', tone: 'indigo', keywords: 'columns silan 4', group: 'common', tier: 'required' },
  { id: 'columns5', label: '五栏', category: '布局', plus: false, glyph: 'Ⅴ', tone: 'indigo', keywords: 'columns wulan 5', group: 'common', tier: 'required' },
  { id: 'table', label: '表格', category: '插入', plusCategory: '常用', glyph: '▦', tone: 'teal', submenu: '表格', submenuType: 'table', keywords: 'table biaoge', group: 'common', tier: 'required' },
  { id: 'image', label: '本地图片', category: '插入', plusCategory: '常用', glyph: '▧', tone: 'yellow', keywords: 'image tupian photo', group: 'common', tier: 'required' },
  { id: 'template', label: '模板', category: '插入', plusCategory: '常用', glyph: '◇', tone: 'indigo', submenu: '模板', submenuType: 'templates', keywords: 'template moban ben di local', group: 'common', tier: 'required' },
]
