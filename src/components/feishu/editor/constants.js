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
  { id: 'cut', label: '剪切' }, { id: 'copy', label: '复制' }, { id: 'translate', label: '翻译' },
  { id: 'duplicate', label: '创建副本' }, { id: 'moveUp', label: '上移区块' }, { id: 'moveDown', label: '下移区块' }, { id: 'delete', label: '删除区块' },
]
export const blockTypeActions = [
  { id: 'paragraph', label: '转为正文', glyph: 'T' }, { id: 'heading1', label: '转为一级标题', glyph: 'H1' }, { id: 'heading2', label: '转为二级标题', glyph: 'H2' }, { id: 'heading3', label: '转为三级标题', glyph: 'H3' },
  { id: 'orderedList', label: '转为有序列表', glyph: '1≡' }, { id: 'bulletList', label: '转为无序列表', glyph: '☷' }, { id: 'taskList', label: '转为任务列表', glyph: '☑' }, { id: 'codeBlock', label: '转为代码块', glyph: '{}' }, { id: 'blockquote', label: '转为引用', glyph: '❝' },
]

/** 工具栏「图表」下拉的图表类型清单：id 对应 insertDiagramType 的插入分支。 */
export const diagramTypes = [  { id: 'flowchart', label: '流程图', source: 'graph TD\n  A[开始] --> B{条件判断}\n  B -->|是| C[流程一]\n  B -->|否| D[流程二]\n  C --> E[结束]\n  D --> E' },
  { id: 'sequence', label: '时序图', source: 'sequenceDiagram\n  participant U as 用户\n  participant S as 服务端\n  U->>S: 发起请求\n  S-->>U: 返回响应' },
  { id: 'gantt', label: '甘特图', source: 'gantt\n  title 项目计划\n  section 阶段一\n  需求评审 :a1, 2026-01-01, 3d\n  开发实现 :a2, after a1, 5d\n  section 阶段二\n  测试验收 :a3, after a2, 4d' },
  { id: 'pie', label: '饼图', source: 'pie title 数据占比\n  "类别 A" : 40\n  "类别 B" : 35\n  "类别 C" : 25' },
  { id: 'state', label: '状态图', source: 'stateDiagram-v2\n  [*] --> 空闲\n  空闲 --> 运行中: 启动\n  运行中 --> 已暂停: 暂停\n  已暂停 --> 运行中: 恢复\n  运行中 --> [*]: 停止' },
  { id: 'class', label: '类图', source: 'classDiagram\n  class 动物 {\n    +String 名称\n    +吃()\n  }\n  class 狗\n  动物 <|-- 狗' },
]

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
