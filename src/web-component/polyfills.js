/**
 * Element 产物的可选 polyfill 包（`lark-doc-element.polyfills.umd.min.js`）。
 *
 * 为什么单独成文件：这 6 个 API 只有旧环境缺（`Array.at` 要 Chrome 92、
 * `findLast` 97、`Object.hasOwn` 93、`replaceAll` 85、`structuredClone` 98），
 * 而 core-js 为了填这 6 个洞要拖进 170+ 个内部模块。把它们留在内核里，等于
 * 让所有现代浏览器为 Chrome 64 付费。
 *
 * 现在由引导体（loader.js）做特性检测：缺哪个才在注入内核**之前**拉这个文件，
 * 所以旧环境行为完全不变，新环境少下这部分字节。
 *
 * 靶向 API 与 `src/web-component/index.js` 曾内联的 import 一一对应，
 * 两处必须同步增删。
 */
import 'core-js/features/array/find-last'
import 'core-js/features/array/find-last-index'
import 'core-js/features/array/at'
import 'core-js/features/structured-clone'
import 'core-js/features/object/has-own'
import 'core-js/features/string/replace-all'
