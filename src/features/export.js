/**
 * 特性包：导出 / 导入编排与远程转换（UMD：lark-doc-element.umd.min.export.js）。
 *
 * 这些模块在源码里本来就是 `await import()` 的懒边界 —— 点「导出」或「导入」才走，
 * 内核实为单文件 UMD，`inlineDynamicImports` 把它们压成了首屏同步代码。搬进特性包
 * 后首屏不再背这一份，真正点开导出时才按需拉这个包。
 *
 * 注册的名字与 element.js 的 groups.export 一一对应：
 *   export.api              → utils/export/index.js 命名空间
 *                             （exportMarkdown / exportDocx / exportPdf / collectImages）
 *   export.remoteConversion → utils/remoteConversion.js 命名空间（remoteConversionMethods）
 *
 * 包内不打包 docx / marked / turndown：exportDocx 走 loadFeature('office.buildDocx')，
 * serializeMarkdown 走 loadFeature('markdown.serialize')，都由调用方原有特性包提供。
 *
 * 为什么 utils/importExport.js 不在这个包里（实测过，别再搬一次）：它自己的
 * `loadFeature('office.docx', () => import('./export/docx'))` 兜底没法 stub 化 ——
 * 包内会真的打进 docx，包体从 28 KB 涨到 444 KB，而首屏只省 434 B gzip。
 */
import { registerFeature } from '../core/features/registry'
import * as exportApi from '../utils/export/index.js'
import * as remoteConversion from '../utils/remoteConversion'

registerFeature('export.api', () => exportApi)
registerFeature('export.remoteConversion', () => remoteConversion)
