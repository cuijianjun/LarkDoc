/**
 * 编辑器纯展示常量：工具栏格式按钮、表格操作、区块操作与区块类型菜单的静态配置数组。
 * 主 SFC 与各 mixin 各自按需 import，并在各自 data 中注册原名（marks/tableActions/
 * blockActions/blockTypeActions），保证模板绑定与合并后的 data 键完全不变。
 */
export const marks = [
  { id: 'bold', label: '加粗', glyph: 'B' }, { id: 'italic', label: '斜体', glyph: 'I' },
  { id: 'underline', label: '下划线', glyph: 'U' }, { id: 'strike', label: '删除线', glyph: 'S' },
  { id: 'code', label: '行内代码', glyph: '</>' }, { id: 'subscript', label: '下标', glyph: 'X₂' },
  { id: 'superscript', label: '上标', glyph: 'X²' }, { id: 'highlight', label: '高亮', glyph: '▣' },
]
export const tableActions = [
  { id: 'addRowBefore', label: '上方加行' }, { id: 'addRowAfter', label: '下方加行' }, { id: 'deleteRow', label: '删行' },
  { id: 'addColumnBefore', label: '左侧加列' }, { id: 'addColumnAfter', label: '右侧加列' }, { id: 'deleteColumn', label: '删列' },
  { id: 'mergeCells', label: '合并单元格' }, { id: 'splitCell', label: '拆分单元格' }, { id: 'toggleHeaderRow', label: '表头行' },
  { id: 'toggleHeaderColumn', label: '表头列' }, { id: 'clearCellContent', label: '清空单元格' }, { id: 'distributeColumns', label: '均分列宽' }, { id: 'deleteTable', label: '删除表格' },
]
export const blockActions = [
  { id: 'cut', label: '剪切', icon: 'cut' }, { id: 'copy', label: '复制', icon: 'copy' }, { id: 'translate', label: '翻译', icon: 'translate' },
  { id: 'duplicate', label: '创建副本', icon: 'copy' }, { id: 'moveUp', label: '上移区块', icon: 'move-up' }, { id: 'moveDown', label: '下移区块', icon: 'move-down' }, { id: 'delete', label: '删除', icon: 'trash' },
]
export const blockTypeActions = [
  { id: 'paragraph', label: '正文', icon: 'block-text', glyph: 'T' },
  ...Array.from({ length: 9 }, (_, index) => { const n = index + 1; return { id: `heading${n}`, label: `${'一二三四五六七八九'[index]}级标题`, icon: `block-h${n}`, glyph: `H${n}` } }),
  { id: 'orderedList', label: '有序列表', icon: 'block-ordered', glyph: '1≡' }, { id: 'bulletList', label: '无序列表', icon: 'block-bullet', glyph: '☷' }, { id: 'taskList', label: '任务列表', icon: 'block-task', glyph: '☑' }, { id: 'codeBlock', label: '代码块', icon: 'block-code', glyph: '{}' }, { id: 'blockquote', label: '引用', icon: 'block-quote', glyph: '❝' },
  { id: 'callout', label: '高亮块', icon: 'block-callout', glyph: '▤' },
]

/** 工具栏「图表」下拉的图表类型清单：id 对应 insertDiagramType 的插入分支。 */
export const diagramTypes = [{"id":"flowchart","label":"流程图"},{"id":"sequence","label":"时序图"},{"id":"gantt","label":"甘特图"},{"id":"pie","label":"饼图"},{"id":"state","label":"状态图"},{"id":"class","label":"类图"}]

/** 工具栏字体下拉：value 为 '' 时表示清空字体（恢复默认）。 */
export const fontFamilyOptions = [
  { value: '', label: '字体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimSun', label: '宋体' },
  { value: 'Georgia', label: 'Georgia' },
]
/** 工具栏字号下拉：value 为 '' 时表示清空字号。 */
export const fontSizeOptions = [{ value: '', label: '字号' }].concat(
  [12, 14, 16, 18, 20, 24, 28, 32, 40].map((size) => ({ value: `${size}px`, label: String(size) })),
)
/** 工具栏行高下拉：value 为 '' 时表示清空行高。 */
export const lineHeightOptions = [{ value: '', label: '行高' }].concat(
  ['1', '1.25', '1.5', '1.75', '2', '2.5', '3'].map((height) => ({ value: height, label: height })),
)
/** 页面宽度下拉（viewModes）。 */
export const widthModeOptions = [
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽版' },
  { value: 'full', label: '通栏' },
]
/** 表格单元格对齐下拉。 */
export const cellTextAlignOptions = [
  { value: '', label: '水平对齐' },
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
]
export const cellVerticalAlignOptions = [
  { value: '', label: '垂直对齐' },
  { value: 'top', label: '上' },
  { value: 'middle', label: '中' },
  { value: 'bottom', label: '下' },
]
