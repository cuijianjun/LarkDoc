/**
 * 文档操作 —— 出口文件。
 *
 * 这一族原本是 1,374 行的一个文件、61 个导出（校验、文本改写、标题编号、列表编号、
 * 缩进、章节折叠挤在一起）。现在按域拆开，本文件只做转出，原来的
 * `import { … } from '../core/documentOperations'` 一行都不用改：
 *
 *   documentValidation.js   JSON 校验、schema 白名单、HTML 清洗
 *   documentTextEdits.js    slash / mention 匹配、查找替换、块移动、目录
 *   headingNumbering.js     标题复合编号
 *   listNumbering.js        有序 / 无序列表的层级编号
 *   blockIndent.js          缩进步长、上限与按位置夹取
 *   documentSections.js     章节切分、折叠范围、blockId 维护
 *
 * 依赖方向是单向的：validation → {heading, sections}、sections → {text, heading, indent}、
 * list → indent，没有回边，因此拆开后不会产生循环依赖。
 */
export { safeUrl } from './policy/url'
export { aggregateHeadingContainers, restoreUnknownBlocks } from './documentJSON'
export * from './documentValidation'
export * from './documentTextEdits'
export * from './headingNumbering'
export * from './listNumbering'
export * from './blockIndent'
export * from './documentSections'
