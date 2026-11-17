/**
 * 特性包：点了才出现的小面板（UMD：lark-doc-element.umd.min.uiExtra.js）。
 *
 *   ui.documentInformation → ui/documentInformation.js 命名空间（顶栏「文档信息」）
 *   ui.headingNumberMenu   → ui/headingNumberMenu.js   命名空间（标题编号菜单）
 *
 * 这两个模块在源码里本来就是 `await import()` 的懒边界；内核实为单文件 UMD，
 * `inlineDynamicImports` 把它们压成了首屏同步代码，搬出来首屏就不再背。
 *
 * 本包在 SHARED_HOST_TARGETS 里：包内的 ui/dom、ui/icon、ui/icons 只剩转发 shim，
 * 实现读内核发布在 `__LARK_DOC_SHARED__` 上的那一份 —— 否则光 ui/icons 就要在包里
 * 再打一份 25 KB。shim 需要内核已发布同名模块，版本不一致时直接报错而不是静默降级。
 *
 * 边界（为什么到此为止）：幻灯片（ui/stage）、模板保存对话框（editor/templateSave +
 * ui/dialogs）各自经 documentOperations 静态拉住 @tiptap/pm/model。搬进包就会再打一份
 * prosemirror-model（gzip 约 25 KB）——首屏省 10 KB、点开时多下 25 KB，还多一个
 * Fragment 类。所以那几支留在内核，判定写进 docs/guide/performance.md。
 */
import { registerFeature } from '../core/features/registry'
import * as documentInformation from '../ui/documentInformation'
import * as headingNumberMenu from '../ui/headingNumberMenu'

registerFeature('ui.documentInformation', () => documentInformation)
registerFeature('ui.headingNumberMenu', () => headingNumberMenu)
