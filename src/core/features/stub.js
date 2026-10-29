/**
 * lite 构建的「求值即抛错」占位模块（阶段 4）。
 *
 * build-lite.js 把 katex / docx / marked / turndown / highlight.js / mammoth
 * 这些重依赖 alias 到本文件：模块一被求值就抛错，动态 import 随即 reject，
 * 调用方沿既有的 catch 走降级路径（公式留纯文本、代码块不高亮、导入导出
 * 给出可读提示）。宿主想要回这些能力时，加载 lark-doc/features/* 特性包
 * 即可，主产物无需更换。
 */
throw new Error('[lark-doc] lite 构建不含该可选依赖；请先加载对应特性包（lark-doc/features/*）')
