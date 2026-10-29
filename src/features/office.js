/**
 * 特性包：Office 导入导出（阶段 4）。
 *
 * dist/features/office.js：docx 依赖 + 包内 rich Word 转换器
 * （src/utils/export/docx.js）+ mammoth（docx 导入）一起出包，引入即完成
 * 三个名字的注册：
 *   office.buildDocx → { buildDocx }  rich Word 导出（标题/表格/图片/代码块）
 *   office.docx      → docx 命名空间   纯文本 Word 导出
 *   office.mammoth   → mammoth 实例    docx 导入
 * lite 主产物这三条路径（rich Word 导出 / 纯文本 Word 导出 / docx 导入）
 * 在 stub 下降级为可读报错，加载本包后全部恢复。
 */
import { registerFeature } from '../core/features/registry'
import * as docx from 'docx'
import mammothBrowser from 'mammoth/mammoth.browser'
import { buildDocx } from '../utils/export/docx.js'

const mammoth = (mammothBrowser && mammothBrowser.default) || mammothBrowser

registerFeature('office.buildDocx', () => Promise.resolve({ buildDocx }))
registerFeature('office.docx', () => Promise.resolve(docx))
registerFeature('office.mammoth', () => Promise.resolve(mammoth))
