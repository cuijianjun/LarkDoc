/**
 * 特性包：公式渲染（阶段 4）。
 *
 * 由 scripts/build-features.js 打成自包含的 dist/features/math.js：
 * 宿主 `<script>` 引入后即完成 'math' 注册，lite 主产物的 loadKatex
 * 从此拿到宿主提供的 katex 实例。katex 样式随本包构建抽成同目录
 * math.css（css-loader 解析字体为相对路径，整目录托管即离线可用），
 * 引入时请与 math.js 一起带上 `<link>`。
 *
 * 注意：这里只 import 源码内的 registry 副本（打包自带），**不** import
 * 'lark-doc' —— 主产物与特性包各自持有 registry.js 副本，靠 globalThis
 * 上的共享 Map 互通，避免引入第二个 lark-doc 运行时实例。
 */
import { registerFeature } from '../core/features/registry'
import katex from 'katex'
import 'lark-doc/katex.css'

registerFeature('math', () => Promise.resolve(katex))
