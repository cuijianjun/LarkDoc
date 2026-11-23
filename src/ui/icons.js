/**
 * 工具栏 SVG 图标库：16×16、stroke 使用 currentColor（自动跟随激活态变色）、
 * 圆角线帽，风格对齐飞书扁平线性图标。由 `src/ui/icon.js` 统一渲染，禁止直接内嵌
 * 到模板字符串里拼 HTML。
 */
// 多色图标资源（唯一不用 currentColor 的地方）走色板常量表，见 palette.js（T0-04）。
import { ICON_PALETTE } from './palette'

const S = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'
export const wrap = (inner, extra = '') => `<svg ${S} ${extra}>${inner}</svg>`

export const ICONS = {
  // ---- 顶栏「更多」菜单与子面板的 27 个图标 ----
  // 取飞书 Web 包的图标 path 原文（`data-icon` 名字标在右边），24 视图、fill:currentColor，
  // 用 `<lark-doc-icon>` 容器缩到 16px 渲染。一级项逐个用 16px 截图做过墨迹重合度校验
  // （IoU ≥ 0.98）；`menu-history` / `menu-admin-setting` / `menu-report` 直接从
  // web-scripts 的 `HistoryOutlined` / `AdminSettingOutlined` / `WarnReportOutlined` 原路径抄。
  'menu-width': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Zm4.5 11v1.692a.7.7 0 0 1-1.088.582l-4.038-2.691a.7.7 0 0 1 0-1.165l4.038-2.692a.7.7 0 0 1 1.088.582V11h9V9.308a.7.7 0 0 1 1.088-.582l4.038 2.692a.7.7 0 0 1 0 1.165l-4.038 2.691a.7.7 0 0 1-1.088-.582V13h-9ZM2 21a1 1 0 0 1 1-1h18a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1Z" fill="currentColor"/></svg>',  // FullWidthOutlined
  'menu-presentation': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.359 9.75a.292.292 0 0 0 0-.5l-3.294-2.187c-.233-.154-.565-.007-.565.25v4.374c0 .258.332.404.565.25l3.294-2.187Z" fill="currentColor"/><path d="M1 3a1 1 0 0 1 1-1h20a1 1 0 1 1 0 2h-1v11a2 2 0 0 1-2 2h-6v4h4a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h4v-4H5a2 2 0 0 1-2-2V4H2a1 1 0 0 1-1-1Zm4 12h14V4H5v11Z" fill="currentColor"/></svg>',  // PresentationOutlined
  'menu-follow': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 7a1 1 0 1 1 2 0v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2H9a1 1 0 1 1 0-2h2V7Z" fill="currentColor"/><path d="m12.48 19.345 5.561 3.038c1.333.729 2.959-.236 2.959-1.755V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v17.628c0 1.519 1.626 2.484 2.959 1.755l5.562-3.038a1 1 0 0 1 .958 0ZM5 3h14v17.628l-5.562-3.038a3 3 0 0 0-2.877 0L5 20.628V3Z" fill="currentColor"/></svg>',  // SubscribeAddOutlined
  'menu-find': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 3H5v18h5v2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7h-2V3Z" fill="currentColor"/><path d="M22 17a4.978 4.978 0 0 1-1.061 3.08l1.685 1.939a1 1 0 1 1-1.51 1.312l-1.697-1.953A5 5 0 1 1 22 17Zm-2 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM7 8a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Zm1 3.5a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2H8Z" fill="currentColor"/></svg>',  // CardSearchOutlined
  'menu-shortcut': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 1a2 2 0 0 0-2 2v8h2V3h9.5v3.5a1 1 0 0 0 1 1h3.45l.05.053V21h-7v2h7a2 2 0 0 0 2-2V7.553a2 2 0 0 0-.555-1.383l-4.354-4.552A2 2 0 0 0 14.645 1H5Z" fill="currentColor"/><path d="M9.905 12.85a.7.7 0 0 1 .825.69l-.003 5.475a.7.7 0 0 1-1.148.537L8.016 18.25C6.381 19.291 5.083 24 5.083 24c-.875-1.313-1.06-5.223.613-7.687l-1.5-1.252a.7.7 0 0 1 .322-1.226l5.387-.985Z" fill="currentColor"/></svg>',  // NewShortcutOutlined
  'menu-move': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3a2 2 0 0 1 2-2h9.672a2 2 0 0 1 1.414.586l4.328 4.328A2 2 0 0 1 21 7.328V11h-2V7.5h-3.5a1 1 0 0 1-1-1V3H5v18h4v2H5a2 2 0 0 1-2-2V3Z" fill="currentColor"/><path d="M21.207 17.793a1 1 0 0 1 0 1.414l-4 4a1 1 0 0 1-1.414-1.414l2.293-2.293H12a1 1 0 1 1 0-2h6.086l-2.293-2.293a1 1 0 0 1 1.414-1.414l4 4Z" fill="currentColor"/></svg>',  // MoveToOutlined
  'menu-pin': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.32 1.5c-.625 0-1.022.478-1.022 1.03 0 .534.487.973 1.022.97l1.692.003v4.526c0 .134-.113.264-.208.36l-4.156 4.77a.508.508 0 0 0-.147.358l-.001.803a1 1 0 0 0 1.01 1.012l6.482.001.007 6.6a1 1 0 0 0 1 .998h.021a1 1 0 0 0 1-1v-6.597l6.48-.002c.55 0 1-.452.999-1.012l.001-.804a.51.51 0 0 0-.15-.36l-4.144-4.769c-.092-.092-.186-.221-.186-.356V3.505l1.69-.005c.71 0 1.024-.603 1.024-.98 0-.616-.484-1.02-1.024-1.02H6.32Zm3.737 2.002L14.06 3.5l.006 5.419 3.826 4.416-11.698-.003L10.06 8.9l-.003-5.398Z" fill="currentColor"/></svg>',  // ChatPinOutlined
  'menu-favorite': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m12 3.687 2.443 3.783a3 3 0 0 0 1.735 1.268l4.35 1.179-2.842 3.543a3 3 0 0 0-.656 2.03l.232 4.535-4.182-1.613a3 3 0 0 0-2.16 0l-4.182 1.613.232-4.534a3 3 0 0 0-.656-2.03L3.47 9.916l4.35-1.18A3 3 0 0 0 9.557 7.47L12 3.687Zm1.26-1.736a1.5 1.5 0 0 0-2.52 0L7.877 6.385a1 1 0 0 1-.579.422L2.211 8.186a1.5 1.5 0 0 0-.778 2.386l3.32 4.14a1 1 0 0 1 .22.677L4.7 20.692a1.5 1.5 0 0 0 2.038 1.476l4.901-1.89a1 1 0 0 1 .72 0l4.9 1.89a1.5 1.5 0 0 0 2.038-1.476l-.27-5.303a1 1 0 0 1 .218-.677l3.32-4.14a1.5 1.5 0 0 0-.777-2.386L16.7 6.807a1 1 0 0 1-.578-.422L13.26 1.95Z" fill="currentColor"/></svg>',  // CollectionOutlined
  'menu-template': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.482 14.763a1.99 1.99 0 0 0 .627-.998l2.07-7.727a2 2 0 0 0-1.414-2.45l-7.727-2.07a2 2 0 0 0-2.45 1.414L9.421 7.289a6.5 6.5 0 1 0-1.62 12.705C7.799 21.038 8.635 22 9.804 22h10.392c1.54 0 2.502-1.667 1.732-3l-2.446-4.237Zm.766-9.243-1.935 7.219L16.733 10c-.77-1.333-2.695-1.333-3.465 0l-.966 1.673-1.852-.496 2.07-7.728 7.728 2.071ZM8.75 17.824A4.505 4.505 0 0 1 3 13.5a4.5 4.5 0 0 1 5.903-4.277l-.385 1.436a2 2 0 0 0 1.414 2.45l1.335.357-2.516 4.358ZM15 11l5.196 9H9.804L15 11Z" fill="currentColor"/></svg>',  // TemplateOutlined
  'menu-duplicate': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V4h-9a1 1 0 0 1-1-1Z" fill="currentColor"/><path d="M5 6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5Zm0 2h10v12H5V8Z" fill="currentColor"/></svg>',  // CopyOutlined
  'menu-download': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 5a3 3 0 0 1 3-3h12a1 1 0 1 1 0 2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 1 1 0 2H5a3 3 0 0 1-3-3V5Z" fill="currentColor"/><path d="m19.086 11-2.793-2.793a1 1 0 0 1 1.414-1.414l4.5 4.5a1 1 0 0 1-.043 1.454l-4.5 4a1 1 0 0 1-1.328-1.494L18.87 13H9a1 1 0 1 1 0-2h10.086Z" fill="currentColor"/></svg>',  // ExportOutlined
  'menu-translate': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.656 9.5h1.47a8.504 8.504 0 0 0-16.252 0H1.799c1.122-4.592 5.264-8 10.201-8 4.938 0 9.079 3.408 10.2 8h1.644a.16.16 0 0 1 .156.162.166.166 0 0 1-.046.115l-2.539 2.652a.226.226 0 0 1-.33 0l-2.54-2.652a.167.167 0 0 1 0-.23.152.152 0 0 1 .11-.047Zm-13.312 5h-1.47a8.504 8.504 0 0 0 16.252 0h2.075c-1.122 4.592-5.264 8-10.201 8s-9.079-3.408-10.2-8H.155a.152.152 0 0 1-.11-.048.168.168 0 0 1 0-.23l2.539-2.65a.226.226 0 0 1 .33 0l2.54 2.65a.169.169 0 0 1 .045.116.16.16 0 0 1-.156.162Z" fill="currentColor"/><path d="M13.015 7.5H11.01l-3.51 9h2.016l1.025-2.484H13.4l1.116 2.484H16.5l-3.485-9ZM12.93 12h-1.873l.958-2.52.915 2.52Z" fill="currentColor"/></svg>',  // TranslateOutlined
  'menu-print': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.788 10.74a.97.97 0 1 1-1.94 0 .97.97 0 0 1 1.94 0Z" fill="currentColor"/><path d="M6.5 1.333h11c1.15 0 1.97.967 1.967 1.967v3.367h.29a2.91 2.91 0 0 1 2.91 2.909v5.814c0 1.11-.976 1.943-1.937 1.943h-1.942v3.394c0 1.07-.956 1.94-1.94 1.94H7.153c-1.063 0-1.94-.942-1.94-1.94v-3.394h-1.94c-.932 0-1.942-.833-1.938-1.94V9.577a2.91 2.91 0 0 1 2.909-2.91h.29V3.3c0-1.05.867-1.97 1.967-1.967Zm11.027 5.334V3.273H6.473v3.394h11.054ZM5.212 15.394v-.485c0-1.088.945-1.94 1.94-1.94h9.697c1.077 0 1.94.973 1.94 1.94v.485h1.938V9.576a.97.97 0 0 0-.97-.97H4.244a.97.97 0 0 0-.97.97v5.818h1.94Zm1.94-.485v5.818h9.697V14.91H7.152Z" fill="currentColor"/></svg>',  // PrinterOutlined
  'menu-save-version': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 3H5v18h5v2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10h-2V3Z" fill="currentColor"/><path d="M22.207 15.793a1 1 0 0 1 0 1.414l-5.5 5.5a1 1 0 0 1-1.414 0l-3-3a1 1 0 0 1 1.414-1.414L16 20.586l4.793-4.793a1 1 0 0 1 1.414 0ZM7 8a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Zm1 3.5a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2H8Z" fill="currentColor"/></svg>',  // ReadinfoOutlined
  'menu-versions': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3h14v6.5h2V3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h5v-2H5V3Z" fill="currentColor"/><path d="M7 7.5a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1ZM8 11a1 1 0 1 0 0 2h2.5a1 1 0 1 0 0-2H8Zm10 4.5a1 1 0 1 0-2 0V18a1 1 0 0 0 1 1h2.5a1 1 0 1 0 0-2H18v-1.5Z" fill="currentColor"/><path d="M17.5 24a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm0-2a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z" fill="currentColor"/></svg>',  // OperationrecordOutlined
  'menu-permission': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m4.328 19.734-.31-.34a10.91 10.91 0 0 1-2.386-4.146l-.135-.436L3.545 12 1.497 9.188l.135-.436a10.91 10.91 0 0 1 2.385-4.147l.311-.339 3.442.377 1.398-3.187.448-.101A10.843 10.843 0 0 1 12 1.09c.809 0 1.607.089 2.384.264l.448.1 1.398 3.188 3.442-.377.31.34a10.91 10.91 0 0 1 2.386 4.146l.135.436L20.455 12l2.048 2.812-.135.436a10.91 10.91 0 0 1-2.385 4.147l-.311.339-3.442-.377-1.398 3.187-.448.101a10.848 10.848 0 0 1-4.768 0l-.448-.1-1.398-3.188-3.442.377Zm3.485-2.21a1.488 1.488 0 0 1 1.525.881l1.12 2.554a9.05 9.05 0 0 0 3.084 0l1.12-2.554a1.488 1.488 0 0 1 1.524-.881l2.755.3c.665-.8 1.19-1.71 1.547-2.69l-1.644-2.258a1.488 1.488 0 0 1 0-1.752l1.644-2.258a9.091 9.091 0 0 0-1.547-2.69l-2.755.3a1.488 1.488 0 0 1-1.524-.881l-1.12-2.554a9.053 9.053 0 0 0-3.084 0l-1.12 2.554a1.488 1.488 0 0 1-1.525.881l-2.754-.3a9.09 9.09 0 0 0-1.548 2.69l1.645 2.258c.38.522.38 1.23 0 1.752l-1.644 2.258c.358.98.882 1.89 1.547 2.69l2.754-.3ZM12 16.545c-2.502 0-4.528-2.036-4.528-4.545 0-2.51 2.026-4.545 4.528-4.545S16.528 9.49 16.528 12 14.502 16.545 12 16.545Zm0-1.818c1.496 0 2.71-1.22 2.71-2.727A2.719 2.719 0 0 0 12 9.273 2.719 2.719 0 0 0 9.29 12 2.719 2.719 0 0 0 12 14.727Z" fill="currentColor"/></svg>',  // SettingOutlined
  'menu-widgets': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.526 3.85a4.355 4.355 0 0 0 0 6.158 1.013 1.013 0 1 0 1.432-1.432 2.33 2.33 0 0 1 0-3.294l.314-.314a2.363 2.363 0 0 1 3.342 0l3.014 3.015a1.013 1.013 0 1 0 1.433-1.433l-3.015-3.014a4.389 4.389 0 0 0-6.207 0l-.313.313Zm8.691 11.985a1.013 1.013 0 0 0-1.433 1.432l3.184 3.183a4.39 4.39 0 0 0 6.207 0l.29-.29a4.39 4.39 0 0 0 0-6.206l-.145-.145a1.013 1.013 0 0 0-1.433 1.432l.145.145c.923.923.923 2.42 0 3.342l-.29.29a2.363 2.363 0 0 1-3.342 0l-3.183-3.183Zm3.632-2.619a1.013 1.013 0 0 1 0-1.433L19.032 8.6a2.363 2.363 0 0 0 0-3.342l-.145-.145a2.568 2.568 0 0 0-3.632 0 1.013 1.013 0 1 1-1.432-1.433 4.594 4.594 0 0 1 6.497 0l.145.145a4.389 4.389 0 0 1 0 6.207l-3.184 3.184a1.013 1.013 0 0 1-1.432 0ZM3.863 20.474a4.356 4.356 0 0 0 6.16 0 1.013 1.013 0 0 0-1.433-1.432 2.33 2.33 0 0 1-3.294 0l-.314-.314a2.363 2.363 0 0 1 0-3.342l3.015-3.014a1.013 1.013 0 1 0-1.433-1.433L3.55 13.954a4.39 4.39 0 0 0 0 6.207l.313.313Z" fill="currentColor"/></svg>',  // PluginOutlined
  'menu-info': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 2C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Zm-1-7.5v-4a1 1 0 1 1 0-2h1.004c.55 0 .998.445.998.996.003 1.668-.002 3.336-.002 5.004h.5a1 1 0 1 1 0 2h-3a1 1 0 1 1 0-2h.5Zm1-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" fill="currentColor"/></svg>',  // InfoOutlined
  'menu-mention': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.75 16a3.622 3.622 0 0 1-2.637-1.156A5 5 0 1 1 17 12c0 1.105.784 2 1.75 2 1.512 0 1.776-2 1.776-2 .08-.548.138-.903.138-1.568C20.664 6.997 17.164 3 12 3s-8.98 3.836-8.98 9 3.816 9.01 8.98 9.01c1.807 0 3.487-.634 4.916-1.544a.823.823 0 0 1 .853-.028l.041.024.903.519a.41.41 0 0 1 .067.682A10.953 10.953 0 0 1 12 23C5.925 23 1 18.075 1 12S5.925 1 12 1s10.657 4.265 10.657 9.432c0 .256.014.522-.136 1.794C22.296 14.326 20.75 16 18.75 16ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="currentColor"/></svg>',  // AtOutlined
  'menu-history-comments': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 2c1.1 0 2 .9 2 2v13.011c0 1.1-.9 2-2 2h-4.759L13.5 22c-.45.51-1.086.707-1.5.7-.683-.069-1.018-.198-1.523-.7L7.76 19.011H3c-1.1 0-2-.99-2-2V4c0-1.1.9-2 2-2h18Zm0 2H3v13.011h5.5l3.5 3.66 3.5-3.66H21V4Zm-9 3a1 1 0 1 0-2 0v4.5a2 2 0 0 0 2 2h3.5a1 1 0 1 0 0-2H12V7Z" fill="currentColor"/></svg>',  // HistoryCommantOutlined
  'menu-more': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 11.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm8.225 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm8.275 0a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z" fill="currentColor"/></svg>',  // MoreOutlined
  // 「重命名」只在版本预览态的「···」菜单里出现（编辑态那张 23 项表没有这一项）。
  // 两条 path 逐字取自飞书真身该行的 `svg path[d]`（2026-11-23 Playwright 抓取，
  // 插件类名 `.navigation-bar__moreMenu_v3-item__icon` 下的 24×24 图标）。
  'menu-rename': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.253 2.646a1.5 1.5 0 1 1 2.121 2.122l-1.06 1.06-2.122-2.121 1.061-1.06ZM17.14 4.76l2.12 2.122-7.817 7.818a1.417 1.417 0 0 1-.77.395l-1.89.315a.17.17 0 0 1-.196-.197l.336-1.882c.05-.281.185-.54.387-.741l7.83-7.83Z" fill="currentColor"/><path d="M13.5 3H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2V10l-2 2v8H4V5h7.5l2-2Z" fill="currentColor"/></svg>',
  'menu-delete': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2h5a1 1 0 1 1 0 2h-1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6H3a1 1 0 0 1 0-2h5ZM6 6v14h12V6H6Zm4 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z" fill="currentColor"/></svg>',  // DeleteTrashOutlined
  'menu-help': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 2C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Zm-1-6a1 1 0 1 1 2 0 1 1 0 0 1-2 0ZM8.05 9.282a5.17 5.17 0 0 1 .039-.28c.195-1.085.689-1.883 1.481-2.394.62-.405 1.383-.608 2.288-.608 1.189 0 2.176.288 2.962.864.787.575 1.18 1.428 1.18 2.558 0 .693-.17 1.277-.513 1.752-.2.287-.584.655-1.152 1.103l-.56.44c-.305.24-.507.52-.607.84a2.742 2.742 0 0 0-.072.486.5.5 0 0 1-.498.457h-1.12a.5.5 0 0 1-.498-.546c.065-.696.134-1.136.207-1.321.137-.344.49-.74 1.058-1.188l.575-.455c.19-.144 1.166-.831 1.166-1.44 0-.608-.106-.832-.412-1.166-.305-.333-.993-.44-1.613-.44-.61 0-1.132.161-1.387.572-.118.19-.215.393-.284.6a2.097 2.097 0 0 0-.073.307.5.5 0 0 1-.493.415H8.547a.5.5 0 0 1-.497-.556Z" fill="currentColor"/></svg>',  // MaybeOutlined
  'menu-arrow': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.707 21.707a1 1 0 0 1 0-1.414L16 12 7.707 3.707a1 1 0 1 1 1.414-1.414l8.293 8.293a2 2 0 0 1 0 2.828l-8.293 8.293a1 1 0 0 1-1.414 0Z" fill="currentColor"/></svg>',  // RightOutlined
  'menu-history': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22.4 12c0 5.523-4.477 10-10 10a9.982 9.982 0 0 1-7.845-3.797l1.59-1.215a8 8 0 1 0-1.634-6.32H5.5a.532.532 0 0 1 .444.828L3.99 14a.533.533 0 0 1-.888 0l-2.046-2.505a.533.533 0 0 1 .444-.83h.988C3.14 5.775 7.33 2 12.4 2c5.523 0 10 4.477 10 10Z" fill="currentColor"/><path d="M13.5 11V8a1 1 0 1 0-2 0v4.467c0 .294.239.533.533.533h3.3a1 1 0 1 0 0-2H13.5Z" fill="currentColor"/></svg>',  // HistoryOutlined
  'menu-admin-setting': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.5 6.5a5 5 0 1 0-10.002.002A5 5 0 0 0 15.5 6.5Zm-5 3a3.001 3.001 0 0 1 0-6 3.001 3.001 0 0 1 0 6ZM4 19c0-.346.045-.68.125-1 .445-1.725 2.01-3 3.875-3h3.025a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5H8a6 6 0 0 0-6 6v2c0 .552.45 1 1 1h8.025a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5H4v-1Zm10.011 1.669a5.254 5.254 0 0 1-1.071-2.039l.646-.889a1.08 1.08 0 0 0 0-1.274L13 15.662a5.259 5.259 0 0 1 1.253-2.096l.928.101a1.083 1.083 0 0 0 1.11-.642l.378-.863a5.163 5.163 0 0 1 2.435-.034l.393.897a1.082 1.082 0 0 0 1.11.643l1.042-.114a5.258 5.258 0 0 1 1.226 1.989l-.672.924a1.083 1.083 0 0 0 0 1.274l.736 1.014a5.254 5.254 0 0 1-1.047 1.927l-1.285-.141a1.083 1.083 0 0 0-1.11.642l-.534 1.219c-.711.14-1.444.13-2.15-.03l-.522-1.189a1.082 1.082 0 0 0-1.11-.642l-1.17.128Zm3.928-1.319a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z" fill="currentColor"/></svg>',  // AdminSettingOutlined
  'menu-report': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 10a1 1 0 1 1 2 0v5a1 1 0 1 1-2 0v-5Zm2 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" fill="currentColor"/><path d="M10.268 3c.77-1.333 2.694-1.333 3.464 0l9.526 16.5c.77 1.333-.192 3-1.732 3H2.474c-1.54 0-2.502-1.667-1.732-3L10.268 3ZM12 4 2.474 20.5h19.052L12 4Z" fill="currentColor"/></svg>',  // WarnReportOutlined
  'block-file': wrap('<path d="m6.5 9.5 4-4a2.1 2.1 0 0 1 3 3l-6 6a3.5 3.5 0 0 1-5-5l6-6a1.4 1.4 0 0 1 2 2l-6 6a.7.7 0 0 1-1-1l5-5"/>'),
  'document-like': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v11H1.5V10ZM7 10l4-7c.5-.8 1.6-.6 1.7.4l-.2 5.1h6.3c1.2 0 2 1.1 1.7 2.2l-2.3 8.5c-.3 1-1.1 1.8-2.1 1.8H7Z"/></svg>',
  ...Object.fromEntries([
    'M11.4 9.2 13 8v5',
    'M11 9.1a1.5 1.5 0 0 1 3 0c0 .8-.8 1.4-3 3.9h3',
    'M11 8.3h2.7l-1.5 1.8c2.2-.2 2.8 2.9.7 3.1a2 2 0 0 1-2-.5',
    'M13 13V8l-2.5 3.4h3.9',
    'M14 8h-2.7l-.2 2.1h1.6c2.1 0 2.1 3 0 3H11',
    'M13.7 8.2c-2.5-.9-3.8 4.6-1.4 4.8a1.5 1.5 0 1 0 0-3c-.7 0-1.1.3-1.4.7',
  ].map((digit, index) => [`mobile-heading${index + 1}`, wrap(`<path d="M2.5 3.2v9.6M9 3.2v9.6M2.5 8H9" stroke-width="1.1"/><path d="${digit}" stroke-width="1"/>`)])),
  'mobile-ordered': wrap('<g stroke-width=".75"><path d="m2.1 2.4 1-.6v2.7"/><path d="M1.7 7.2a1 1 0 0 1 2 0c0 .5-.6.9-2 2.2h2"/><path d="M1.7 11.7h2l-1.1 1c1.6-.1 1.9 1.9.4 1.9-.5 0-.9-.1-1.2-.4"/></g><path d="M6.3 3.3H14M6.3 8H14M6.3 12.7H14" stroke-width="1.1"/>'),
  'mobile-quote': wrap('<path d="M6.8 2.5C3.5 4.2 1.7 6.9 1.7 10.5c0 2 1.1 3.1 2.7 3.1A2.5 2.5 0 0 0 6.9 11c0-1.5-.9-2.5-2.5-2.5h-.8c.5-2 1.7-3.5 3.8-5Z" fill="currentColor" stroke="none"/><path d="M14.1 2.5c-3.3 1.7-5.1 4.4-5.1 8 0 2 1.1 3.1 2.7 3.1a2.5 2.5 0 0 0 2.5-2.6c0-1.5-.9-2.5-2.5-2.5h-.8c.5-2 1.7-3.5 3.8-5Z" fill="currentColor" stroke="none"/>'),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const level = index + 4
    return [`block-h${level}`, wrap(`<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">${level}</tspan></text>`)]
  })),
  ...Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`mobile-heading${i + 7}`, wrap(`<text x="8" y="11.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9.5" font-weight="600" text-anchor="middle">H<tspan font-size="7">${i + 7}</tspan></text>`)])),
  "table-float-remove": "<svg viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2h5a1 1 0 1 1 0 2h-1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6H3a1 1 0 0 1 0-2h5ZM6 6v14h12V6H6Zm4 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z\" fill=\"currentColor\"></path></svg>",

  'table-merge': wrap('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 8h4m4 0h4M4.5 6.5 6 8 4.5 9.5m7-3L10 8l1.5 1.5"/>'),
  'cell-background': wrap('<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 6h12M6 2v12M10 2v12M2 10h12"/><path d="M6 6h4v4H6Z" fill="currentColor" stroke="none"/>'),
  'share-link': wrap('<path d="M9 2h5v5M14 2 7 9M5 4H2v10h10v-3"/>'),
  'share-globe': wrap('<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.8 3.9 2.8 6.2S9.8 12.5 8 14.2C6.2 12.5 5.2 10.3 5.2 8S6.2 3.5 8 1.8Z"/>'),
  'image-crop': wrap('<path d="M5 1v10h10M1 5h10v10M8 2h6v6"/>'),
  'insert-file': wrap('<path d="m6 10 4.6-4.6a2 2 0 0 1 2.8 2.8L7 14.6a3.5 3.5 0 0 1-5-5l6.4-6.4a2.5 2.5 0 0 1 3.6 3.6L5.6 13"/>'),
  'insert-table': wrap('<rect x="2" y="2" width="12" height="12" rx=".8"/><path d="M2 6h12M2 10h12M6 2v12"/>'),
  'insert-callout': wrap('<rect x="2" y="2.5" width="12" height="5.5" rx=".8"/><path d="M2 11h12M2 14h7"/>'),
  'insert-synced': wrap('<path d="M7 9H2V2h8v5M9 7h5v7H6V9"/>'),
  'insert-divider': wrap('<path d="M2 8h12M2 3h2m3 0h2m3 0h2M2 13h2m3 0h2m3 0h2"/>'),
  'insert-columns': wrap('<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M7 2v12M2 7h12"/>'),
  'insert-math': wrap('<text x="8" y="11.5" fill="currentColor" stroke="none" font-family="Georgia, serif" font-size="9" text-anchor="middle">T<tspan dy="1.5" font-size="6">E</tspan><tspan dy="-1.5">X</tspan></text>'),
  'insert-template': wrap('<path d="M3 1.5h7l3 3v10H3Z"/><path d="m8 5 3 3-3 3-3-3Z" fill="currentColor" stroke="none"/>'),
  'mobile-insert': wrap('<circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/>'),
  'keyboard-hide': wrap('<rect x="1.5" y="2" width="13" height="9" rx="1.5"/><path d="M4 5h1m2.5 0h1m2.5 0h1M4 8h8m-6 5 2 1.5 2-1.5"/>'),
  home: wrap('<path d="m2 7 6-5 6 5v7H9.5v-4h-3v4H2Z"/>'),
  'library-document': wrap('<rect x="3" y="1.5" width="10" height="13" rx="1.5"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/>'),
  members: wrap('<circle cx="6" cy="5" r="2.5"/><path d="M1.5 14v-1.5a4.5 4.5 0 0 1 9 0V14ZM11 3a2.5 2.5 0 0 1 0 5M12 10a3.5 3.5 0 0 1 2.5 3.5V14"/>'),
  'mobile-home': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"><path d="M2.5 8.3 10 2.7l7.5 5.6v9.2h-5v-5h-5v5h-5Z"/></svg>',
  'mobile-outline': '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="2.5" cy="2.5" r="1.5" fill="currentColor" stroke="none"/><path d="M2.5 4v3H4M4 16H2.5v-4H1M8 2.5h8M8 9h8M8 15.5h8"/></svg>',
  'mobile-members': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="8.5" cy="7" r="3.5"/><path d="M1.5 20.5v-2.6a4.4 4.4 0 0 1 4.3-4.4h5.4a4.4 4.4 0 0 1 4.3 4.4v2.6ZM18.5 15h1a3 3 0 0 1 3 3v2.5h-4"/><circle cx="17.5" cy="9.5" r="2"/></svg>',
  'mobile-menu': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6h14M5 12h14M5 18h14"/></svg>',
  'comment-history-info': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 2C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Zm-1-7.5v-4a1 1 0 1 1 0-2h1.004c.55 0 .998.445.998.996.003 1.668-.002 3.336-.002 5.004h.5a1 1 0 1 1 0 2h-3a1 1 0 1 1 0-2h.5Zm1-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" fill="currentColor"/></svg>',
  'comment-history-empty': '<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M103.587 73.962V64c5.142 1.573 10.804 3.656 12.077 6.592.176.4.262.796.262 1.184h.002v5.856c0-.388-.088-.785-.262-1.185-.108-.246-.249.29-.423.949-.241.912-.544 2.062-.908 1.707-.618-.606-1.43-1.23-2.408-1.857-1.983-1.27-5.114-2.34-8.34-3.284ZM22.423 35.486v8.518c-8.445-2.616-17.634-6.317-17.634-10.67V22.628c0 7.267 9.214 10.845 17.634 12.86Z" fill="var(--ld-text)"/><path d="M4.788 33.63c0-.075.001-.15.005-.226.288-6.747 14.759-13.693 19.854-14.66V9.836c-4.376.83-19.86 7.503-19.86 13.906v9.889Z" fill="var(--ld-text-check)"/><path d="M103.587 26.174a4 4 0 0 0-4-4H26.423a4 4 0 0 0-4 4V72.48a4 4 0 0 0 4 4h66.261l10.903 10.507V26.174Z" fill="var(--ld-text-disabled)" fill-opacity=".45"/><path d="M33.508 37.654a.5.5 0 0 1 .5-.5h46.814a.5.5 0 0 1 0 1H34.008a.5.5 0 0 1-.5-.5Zm0 10.52a.5.5 0 0 0 .5.5h27.1a.5.5 0 1 0 0-1h-27.1a.5.5 0 0 0-.5.5Z" fill="var(--ld-text-icon)"/><path d="M100.759 35.023c6.373 0 11.54-5.167 11.54-11.541 0-6.374-5.167-11.54-11.54-11.54-6.374 0-11.541 5.166-11.541 11.54 0 6.374 5.167 11.54 11.541 11.54Z" fill="var(--ld-brand-chrome)"/><path d="M11.45 67.418v28.593a.5.5 0 0 0 .845.361l5.043-4.82h31.231a2.5 2.5 0 0 0 2.5-2.5V67.418a2.5 2.5 0 0 0-2.5-2.5H13.95a2.5 2.5 0 0 0-2.5 2.5Zm2.5-1.5h34.62a1.5 1.5 0 0 1 1.5 1.5v21.633a1.5 1.5 0 0 1-1.5 1.5H17.136a.5.5 0 0 0-.345.139l-4.342 4.151V67.418a1.5 1.5 0 0 1 1.5-1.5Z" fill="var(--ld-text)"/><path d="M115.928 71.686c-.061 8.424-34.561 13.433-54.424 14.171v9.09c20.95-.576 54.424-5.725 54.424-13.466v-9.795Z" fill="var(--ld-text-check)"/><path d="M57.415 111.165v-9.088c14.542-.532 36.808-3.283 48.133-7.933v9.453c-11.09 4.389-32.867 7.156-48.133 7.568Z" fill="var(--ld-brand-chrome)"/><path d="M52.122 12.786V3.938C41.949 4.545 38.111 5.96 32.247 7.8v9.092c5.823-1.572 10.217-2.94 19.875-4.106Z" fill="var(--ld-text-check)"/></svg>',

  'comment-send': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 13.75c-.4.13-.5.49-.5.75L2.5 22a1 1 0 0 0 1.48.88l18.5-10a1 1 0 0 0 0-1.76l-18.5-10A1 1 0 0 0 2.5 2L3 9.5c0 .27.06.66.5.76l7.13 1.25a.5.5 0 0 1 0 .98L3.5 13.75Z" fill="currentColor"/></svg>',
  'diagram-flowchart': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="1.5" width="6" height="3.5" rx="1"/><path d="m10 7 3 3-3 3-3-3Z"/><rect x="1.5" y="14.5" width="6" height="3.5" rx="1"/><rect x="12.5" y="14.5" width="6" height="3.5" rx="1"/><path d="M10 5v2M10 13v1.5M7.8 10H4.5v4.5M12.2 10h3.3v4.5"/></svg>',
  'diagram-sequence': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v16M16 2v16"/><rect x="2" y="2" width="4" height="3" rx=".8"/><rect x="14" y="2" width="4" height="3" rx=".8"/><path d="M6 7h8l-2-2M14 11H6l2 2M6 15h8l-2-2"/></svg>',
  'diagram-gantt': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5v14M2 17.5h16M2 7.5h16M2 11.5h16"/><rect x="4" y="4.5" width="5" height="2" rx=".7"/><rect x="7" y="8.5" width="8" height="2" rx=".7"/><rect x="5" y="12.5" width="4" height="2" rx=".7"/></svg>',
  'diagram-pie': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2a8 8 0 1 0 8 8h-8Z" fill="currentColor" stroke="none"/><path d="M11 2a7 7 0 0 1 7 7h-7Z"/><path d="M10 2v8h8"/></svg>',
  'diagram-state': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.5" cy="10" r="2.2"/><rect x="13" y="7" width="5" height="6" rx="3"/><path d="M5.7 10h6.1l-2-2M11.8 10l-2 2"/></svg>',
  'diagram-class': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="8" height="7" rx=".7"/><path d="M1.5 4h8M1.5 6h8M3 3h5M3 5h2"/><rect x="11" y="11.5" width="7.5" height="7" rx=".7"/><path d="M11 14h7.5M11 16h7.5M12.5 13h4M12.5 15h2M9.5 6h2.5v9h-1.5"/></svg>',
  undo: wrap('<path d="M6.5 3.5 3 7l3.5 3.5"/><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H7"/>'),
  redo: wrap('<path d="M9.5 3.5 13 7l-3.5 3.5"/><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H9"/>'),
  inlineCode: wrap('<path d="M5.5 4 2 8l3.5 4"/><path d="M10.5 4 14 8l-3.5 4"/><path d="M9 3 7 13"/>'),
  link: wrap('<path d="M6.5 9.5l3-3"/><path d="M4.8 7.7 3.2 9.3a2.6 2.6 0 0 0 3.7 3.7l1.6-1.6"/><path d="M11.2 8.3l1.6-1.6a2.6 2.6 0 0 0-3.7-3.7L7.5 4.6"/>'),
  'link-view-link': wrap('<path d="M6 10l4-4M5 7l-2 2a3 3 0 0 0 4 4l2-2M7 5l2-2a3 3 0 0 1 4 4l-2 2"/>'),
  'link-view-title': wrap('<path d="M3 3h10M8 3v10M5 13h6"/>'),
  'link-view-card': wrap('<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4 6h8M4 9h5"/>'),
  'link-view-preview': wrap('<rect x="1.5" y="2" width="13" height="12" rx="1.5"/><path d="M2 5h12M4 3.5h.1M6 3.5h.1"/>'),
  'link-view-caret': wrap('<path d="m4 6 4 4 4-4"/>'),
  'link-unset': wrap('<path d="m2 2 12 12M6 6l-3 3a3 3 0 0 0 4 4l2-2M7 5l2-2a3 3 0 0 1 4 4l-2 2"/>'),
  'link-view-more': wrap('<circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/>'),
  'open-external': wrap('<path d="M9 2h5v5M14 2 7 9M6 3H3v10h10v-3"/>'),
  // 版本预览态顶栏「回到源文档」：飞书这枚是**闭合方框 + 右向箭头穿出右边**，
  // 与上面 open-external（↗ 斜箭头）、share-link（同为 ↗）都不同，别互相顶替。
  'version-preview-exit': wrap('<path d="M10.6 5.4V4a1.4 1.4 0 0 0-1.4-1.4H3.6A1.4 1.4 0 0 0 2.2 4v8a1.4 1.4 0 0 0 1.4 1.4h5.6A1.4 1.4 0 0 0 10.6 12v-1.4"/><path d="M6.4 8h6.6"/><path d="m10.6 5.4 2.6 2.6-2.6 2.6"/>'),
  // 版本预览态顶栏「复制版本链接」：真身是标准链条（两个互扣的挂钩），非 ↗。
  'version-preview-link': wrap('<path d="M6.7 9.3a2.9 2.9 0 0 1 0-4.1l1.9-1.9a2.9 2.9 0 0 1 4.1 4.1L11.6 8.5"/><path d="M9.3 6.7a2.9 2.9 0 0 1 0 4.1l-1.9 1.9a2.9 2.9 0 0 1-4.1-4.1L4.4 7.5"/>'),
  refresh: wrap('<path d="M13 6a5 5 0 1 0 0 4M13 2v4H9"/>'),
  'align-left': wrap('<path d="M2.5 4h11"/><path d="M2.5 8h7"/><path d="M2.5 12h9"/>'),
  'align-center': wrap('<path d="M2.5 4h11"/><path d="M4.5 8h7"/><path d="M3.5 12h9"/>'),
  'align-right': wrap('<path d="M2.5 4h11"/><path d="M6.5 8h7"/><path d="M4.5 12h9"/>'),
  'align-justify': wrap('<path d="M2.5 4h11"/><path d="M2.5 8h11"/><path d="M2.5 12h11"/>'),
  'indent-dec': wrap('<path d="M3 4h10"/><path d="M3 12h10"/><path d="M13 8H6.5"/><path d="m9 5.5-2.5 2.5L9 10.5"/>'),
  'indent-inc': wrap('<path d="M3 4h10"/><path d="M3 12h10"/><path d="M6.5 8H13"/><path d="m10.5 5.5 2.5 2.5-2.5 2.5"/>'),
  clear: wrap('<path d="M3 13.5h10"/><path d="M5.5 13.5 3.2 11.2a1.6 1.6 0 0 1 0-2.3l5.4-5.4a1.6 1.6 0 0 1 2.3 0l2.1 2.1a1.6 1.6 0 0 1 0 2.3l-5.6 5.6"/><path d="M6.5 5.5l4 4"/>'),
  plus: wrap('<path d="M8 3v10"/><path d="M3 8h10"/>'),
  table: wrap('<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4"/><path d="M2.8 8h10.4"/><path d="M8 2.8v10.4"/>'),
  chart: wrap('<rect x="2.8" y="2.8" width="10.4" height="4" rx="1.2"/><rect x="2.8" y="9.2" width="10.4" height="4" rx="1.2"/><path d="M5.5 4.8h.01M5.5 11.2h.01" stroke-width="1.8"/>'),
  sparkle: wrap('<path d="M8 2l1.4 4.1L13.5 7.5 9.4 8.9 8 13 6.6 8.9 2.5 7.5 6.6 6.1z" fill="currentColor" stroke="none"/><path d="M12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" fill="currentColor" stroke="none"/>'),
  search: wrap('<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3.4 3.4"/>'),
  outline: wrap('<path d="M3 4h10"/><path d="M3 8h10"/><path d="M3 12h6"/>'),
  'outline-expand': wrap('<path d="M2.5 4h11"/><path d="M2.5 8h11"/><path d="M2.5 12h11"/>'),
  reading: wrap('<path d="M8 5.2A2.2 2.2 0 0 0 5.8 3H2.8v9.5h3.4A1.8 1.8 0 0 1 8 13.7"/><path d="M8 5.2A2.2 2.2 0 0 1 10.2 3h3v9.5h-3.4A1.8 1.8 0 0 0 8 13.7"/>'),
  fullscreen: wrap('<path d="M2.5 6V3.9a1.4 1.4 0 0 1 1.4-1.4H6"/><path d="M10 2.5h2.1a1.4 1.4 0 0 1 1.4 1.4V6"/><path d="M13.5 10v2.1a1.4 1.4 0 0 1-1.4 1.4H10"/><path d="M6 13.5H3.9a1.4 1.4 0 0 1-1.4-1.4V10"/>'),
  slides: wrap('<rect x="2.5" y="3" width="11" height="7.6" rx="1.3"/><path d="M7 5.6 9.6 6.8 7 8z" fill="currentColor" stroke="none"/><path d="M8 10.6v2"/><path d="M5.6 13h4.8"/>'),
  chevronDown: wrap('<path d="m4.2 6.2 3.8 3.8 3.8-3.8"/>'),
  // 右栏标题旁的说明入口（飞书 `.docx-history-info-icon` 的「ⓘ」），点开是自动保存口径。
  info: wrap('<circle cx="8" cy="8" r="6"/><path d="M8 7.4v4"/><circle cx="8" cy="5.1" r=".75" fill="currentColor" stroke="none"/>'),
  // 实心小三角：下拉触发器尾部的「▾」（飞书菜单用实心，比 chevron 更紧凑）
  caretSolid: wrap('<path d="M4.6 6.2h6.8L8 10.7z" fill="currentColor" stroke="none"/>'),
  // 分享面板范围/权限下拉那颗更宽的 ▼：飞书实测 ink 宽 9 CSS（截图 487..504 device @2x）。
  // caretSolid 的三角只占 6.8/16，等比放到 12px 时仅 5 CSS，不够宽，所以单画一颗。
  caretWide: wrap('<path d="M3.4 6h9.2l-4.6 5.6z" fill="currentColor" stroke="none"/>'),
  // 分享面板「邀请协作者」右侧那颗右向实心三角（飞书 ink 5×8 CSS，取三级文字灰），
  // 不是 chevron 线条。
  caretRight: wrap('<path d="M2 4 7 8l-5 4z" fill="currentColor" stroke="none"/>'),
  // 历史记录时间线「父子折叠」那颗实心三角（`▶`，展开时 CSS 转 90° 成 `▼`）。
  // 逐字取飞书真身 `.history-timeline-open-icon svg` 原文：12 视图、evenodd 填充、
  // 无描边。不用 wrap() 是因为它的 16 视图 + stroke 会把这颗实心三角画变形。
  // fill 走 currentColor（容器 CSS 定成 `rgb(100, 106, 115)`，与真身数值同源）。
  'version-group-arrow': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.166 6.243l-4.69 3.41A.3.3 0 014 9.412V2.589a.3.3 0 01.476-.242l4.69 3.41a.3.3 0 010 .486z" fill="currentColor"/></svg>',
  chevronUp: wrap('<path d="m4.2 9.8 3.8-3.8 3.8 3.8"/>'),
  close: wrap('<path d="m4.6 4.6 6.8 6.8"/><path d="m11.4 4.6-6.8 6.8"/>'),
  // 编号菜单三项：对齐飞书（编号类图标都是「1.」+ 动作符号的组合，不是抽象线条）。
  // 左半是数字「1.」（text 用 currentColor 填充、去掉描边），右半是动作符号，两半互不重叠：
  // 继续=右向箭头、重新开始=逆时针回环、设置值=输入框+光标。
  'numbered-continue': wrap('<text x="4" y="10.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="600" text-anchor="middle">1.</text><path d="M9.2 8h5"/><path d="m12.2 5.9 2.1 2.1-2.1 2.1"/>'),
  'numbered-restart': wrap('<text x="4" y="10.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="600" text-anchor="middle">1.</text><path d="M9.2 8a2.6 2.6 0 1 0 2.6-2.6"/><path d="m12.9 4.2-1.1 1.2 1.2 1.1"/>'),
  'numbered-value': wrap('<text x="4" y="10.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="600" text-anchor="middle">1.</text><rect x="9" y="4.8" width="5.8" height="6.4" rx="1.3"/><path d="M11.2 6.7v2.6"/>'),
  // —— 块菜单类型网格（对齐飞书：正文/标题是文字字形，列表/代码/引用是线性符号）——
  'block-text': '<svg viewBox="0 0 24 24" fill="none"><path d="M2 3a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V4h-7v16h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3V4H4v3a1 1 0 1 1-2 0V3Z" fill="currentColor"/></svg>',
  'block-h1': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">1</tspan></text>'),
  'block-h2': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">2</tspan></text>'),
  'block-h3': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="11.5" font-weight="650" text-anchor="middle">H<tspan font-size="8.5">3</tspan></text>'),
  'block-ordered': wrap('<text x="3.4" y="6.6" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="6" font-weight="600" text-anchor="middle">1</text><text x="3.4" y="13" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="6" font-weight="600" text-anchor="middle">2</text><path d="M7.4 5.2h6"/><path d="M7.4 8h6"/><path d="M7.4 11.6h6"/>'),
  'block-bullet': wrap('<circle cx="3.6" cy="4.9" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3.6" cy="11.1" r="1" fill="currentColor" stroke="none"/><path d="M7.4 4.9h6"/><path d="M7.4 8h6"/><path d="M7.4 11.1h6"/>'),
  'block-task': wrap('<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.2"/><path d="m5.6 8.2 1.9 1.9 3.6-3.9"/>'),
  'block-code': wrap('<path d="M5.8 4c-1.3 0-1.6.7-1.6 1.7v1.1c0 .8-.4 1.2-1.4 1.2v.1c1 0 1.4.4 1.4 1.2v1.1c0 1 .3 1.7 1.6 1.7"/><path d="M10.2 4c1.3 0 1.6.7 1.6 1.7v1.1c0 .8.4 1.2 1.4 1.2v.1c-1 0-1.4.4-1.4 1.2v1.1c0 1-.3 1.7-1.6 1.7"/>'),
  'block-quote': wrap('<path d="M7 5.2c-1.9.4-3 1.6-3 3.6v2h3.2V7.6H5.6c.1-.9.7-1.5 1.4-1.8z" fill="currentColor" stroke="none"/><path d="M12.6 5.2c-1.9.4-3 1.6-3 3.6v2h3.2V7.6h-1.6c.1-.9.7-1.5 1.4-1.8z" fill="currentColor" stroke="none"/>'),
  // —— 块菜单操作行（剪切/复制/翻译/移动/删除）——
  copy: wrap('<rect x="5.6" y="5.6" width="7.6" height="7.6" rx="1.4"/><path d="M10.4 2.8H4.2a1.4 1.4 0 0 0-1.4 1.4v6.2"/>'),
  cut: wrap('<circle cx="4.4" cy="11.6" r="1.8"/><circle cx="11.6" cy="11.6" r="1.8"/><path d="M5.7 10.3 11.6 2.8"/><path d="m10.3 10.3-5.9-7.5"/>'),
  translate: wrap('<path d="M2.6 4.6h5"/><path d="M5 2.8v1.8"/><path d="M7 4.6c-.4 2.6-2 4.4-4.4 5.4"/><path d="M3.2 6.6c1 1.6 2.3 2.7 4 3.2"/><path d="M8.6 13.2 11 7.4l2.4 5.8"/><path d="M9.4 11.4h3.3"/>'),
  trash: wrap('<path d="M3 4.6h10"/><path d="M6.4 4.6V3.4c0-.6.4-1 1-1h1.2c.6 0 1 .4 1 1v1.2"/><path d="M4.4 4.6l.6 8c0 .6.5 1 1 1h4c.5 0 1-.4 1-1l.6-8"/><path d="M6.7 7.4v3.6"/><path d="M9.3 7.4v3.6"/>'),
  'move-up': wrap('<path d="M8 13V3.6"/><path d="M4.4 7.2 8 3.6l3.6 3.6"/>'),
  'move-down': wrap('<path d="M8 3v9.4"/><path d="M4.4 8.8 8 12.4l3.6-3.6"/>'),
  // —— 表格句柄菜单（对齐飞书：标题行/标题列 = 网格 + 深色首行/首列，均分列宽 = 双向箭头）——
  'table-header-row': wrap('<rect x="2.8" y="2.8" width="10.4" height="3.2" rx="1.4" fill="currentColor" stroke="none"/><rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4"/><path d="M2.8 9.6h10.4"/><path d="M8 6v7.2"/>'),
  'table-header-col': wrap('<rect x="2.8" y="2.8" width="3.2" height="10.4" rx="1.4" fill="currentColor" stroke="none"/><rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.4"/><path d="M6 6.4h7.2"/><path d="M6 9.8h7.2"/><path d="M6 2.8v10.4"/>'),
  'distribute-cols': wrap('<path d="M4.2 4v8"/><path d="M11.8 4v8"/><path d="M5 8h6"/><path d="m6.4 6.6-1.4 1.4 1.4 1.4"/><path d="m9.6 6.6 1.4 1.4-1.4 1.4"/>'),
  // —— 气泡条格式按钮（对齐飞书：文字字形 + 装饰线，hover 跟随 currentColor）——
  'mark-bold': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Georgia, \'Times New Roman\', serif" font-size="11.5" font-weight="800" text-anchor="middle">B</text>'),
  'mark-strike': wrap('<text x="8" y="11.8" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="10.5" text-anchor="middle">S</text><path d="M3.4 8.4h9.2"/>'),
  'mark-italic': wrap('<text x="8" y="12" fill="currentColor" stroke="none" font-family="Georgia, \'Times New Roman\', serif" font-size="11.5" font-style="italic" text-anchor="middle">I</text>'),
  'mark-underline': wrap('<text x="8" y="11" fill="currentColor" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="10.5" text-anchor="middle">U</text><path d="M4.6 13.2h6.8"/>'),
  // 高亮按钮：黄色小色块打底（飞书的高亮 icon 自带黄色），A 随 currentColor。
  'mark-highlight': wrap(`<rect x="3" y="3" width="10" height="10" rx="2" fill="${ICON_PALETTE.highlightSwatch}" stroke="none"/><text x="8" y="11.4" fill="${ICON_PALETTE.highlightGlyph}" stroke="none" font-family="Helvetica, Arial, sans-serif" font-size="9" font-weight="600" text-anchor="middle">A</text>`),
  // 块菜单「颜色」行的调色盘（飞书同款语义：调色盘 + 一笔）。
  palette: wrap('<path d="M8 2.6a5.4 5.4 0 1 0 0 10.8c1 0 1.4-.5 1.4-1.1 0-.9-.7-1.2-.7-2 0-.7.5-1.2 1.3-1.2h1.2c1.6 0 2.4-1 2.4-2.3C13.6 4.5 11.1 2.6 8 2.6z"/><circle cx="5.4" cy="6.4" r=".9" fill="currentColor" stroke="none"/><circle cx="8.2" cy="5" r=".9" fill="currentColor" stroke="none"/><circle cx="10.9" cy="6.6" r=".9" fill="currentColor" stroke="none"/>'),
  // —— P4-06 顶栏模式切换按钮（03 §顶栏右侧按钮组 #2：图标位 16×22）——
  // 三态字形按飞书前台截图：编辑=铅笔、修订=方框带笔、阅读=眼睛。
  // mode-comment（气泡）/ reading（书本）仍保留给评论入口和工具栏阅读模式复用。
  'mode-edit': wrap('<path d="M11.3 2.7a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3l-8 8L3 14.3l.7-3.2z"/><path d="m10.2 3.8 2.3 2.3"/>'),
  'mode-comment': wrap('<path d="M13.4 9.4a1.8 1.8 0 0 1-1.8 1.8H4.8L2.6 13.4V4.4a1.8 1.8 0 0 1 1.8-1.8h7.2a1.8 1.8 0 0 1 1.8 1.8z"/><path d="M5.4 6.4h5.2"/><path d="M5.4 9h3.2"/>'),
  'mode-suggest': wrap('<path d="M12.8 9.4v2.8a1.4 1.4 0 0 1-1.4 1.4H3.6a1.4 1.4 0 0 1-1.4-1.4V4.4a1.4 1.4 0 0 1 1.4-1.4h5.2"/><path d="m9.4 10.6 4.2-4.2a1.4 1.4 0 0 0-2-2L7.4 8.6l-.6 2.6z"/>'),
  'mode-read': wrap('<path d="M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8z"/><circle cx="8" cy="8" r="1.7"/>'),
  // —— P4-06 右下角帮助菜单 5 项（04 §3.5；图标区实测 16×16）——
  // 上传日志：纸面 + 向上箭头（对齐「导出/上报」语义）
  'help-log': wrap('<path d="M9.2 2.8H4.6a1.6 1.6 0 0 0-1.6 1.6v6.4a1.6 1.6 0 0 0 1.6 1.6h6.8a1.6 1.6 0 0 0 1.6-1.6V6.4z"/><path d="M9 2.8v3.6h3.4"/><path d="M8 12.4V8.4"/><path d="m6.4 9.9 1.6-1.6 1.6 1.6"/>'),
  // 联系客服：耳机 + 麦克风臂
  'help-support': wrap('<path d="M3.4 9.2V7.6a4.6 4.6 0 0 1 9.2 0v1.6"/><rect x="2.2" y="8.8" width="2.4" height="3.6" rx="1.2"/><rect x="11.4" y="8.8" width="2.4" height="3.6" rx="1.2"/><path d="M12.6 12.4v.4a1.8 1.8 0 0 1-1.8 1.8H9"/>'),
  // 功能更新：礼盒（飞书「功能更新」用礼盒/喇叭语义，取礼盒更好认）
  'help-whatsnew': wrap('<rect x="2.6" y="6" width="10.8" height="7.2" rx="1.4"/><path d="M2.6 9.2h10.8"/><path d="M8 6v7.2"/><path d="M8 6C7.2 4 5.9 3 4.9 3.6c-.9.6-.4 1.8 1.1 2.4"/><path d="M8 6c.8-2 2.1-3 3.1-2.4.9.6.4 1.8-1.1 2.4"/>'),
  // 帮助中心：问号圆环
  'help-center': wrap('<circle cx="8" cy="8" r="5.4"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.7-.8 1.3v.3"/><path d="M8 11.6h.01" stroke-width="1.9"/>'),
  // 快捷键：键盘外形 + 三粒按键
  'help-keyboard': wrap('<rect x="2.2" y="4.4" width="11.6" height="7.2" rx="1.6"/><path d="M4.8 7h.01M7 7h.01M9.2 7h.01M11.4 7h.01" stroke-width="1.9"/><path d="M5.4 9.6h5.2"/>'),
  // —— P4-06 修订建议面板（07 §12.4：热区统一 16×16，图标本体 12/14 两档）——
  // 上下箭头 = 下一条 / 上一条建议；勾 = 接受修订。叉与链条直接复用 close / link，
  // 不重画（飞书那两颗的路径与通用叉/链一致，没必要为了「一物一图」多存两份）。
  // 字形未采集（07 只给了尺寸与色值）→ 取最通用的线性箭头/勾，与工具栏风格一致。
  'rev-next': wrap('<path d="M8 3.6v8.8"/><path d="m4.4 9 3.6 3.6L11.6 9"/>'),
  'rev-prev': wrap('<path d="M8 12.4V3.6"/><path d="m4.4 7 3.6-3.6L11.6 7"/>'),
  'rev-accept': wrap('<path d="m3.4 8.4 3.2 3.2 6-7.2"/>'),
  // 输入区右侧配图按钮（实测 16×16 占位，字形未采集）：取相框 + 山形，和飞书的图片语义一致。
  'rev-image': wrap('<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6"/><circle cx="6" cy="6.6" r="1"/><path d="m3.4 11 3.2-3.2 2.4 2.4 1.8-1.8 1.8 1.8"/>'),
  // 回复卡头像兜底（07 §12.3：灰底人形 SVG）。用半身剪影，别做成「两个圆」——
  // 32px 圆内头肩要留白，否则缩到 18px 就看不出是人。
  'rev-avatar': wrap('<circle cx="8" cy="5.5" r="2.7"/><path d="M3.1 13.7c0-2.6 2.2-4.4 4.9-4.4s4.9 1.8 4.9 4.4"/>'),
  // —— 链接悬浮卡 / 封面面板（04 §1.6 / §1.4）——
  // 这三颗规格里只有热区尺寸（链接卡 24×24 / 封面项图标到文字 20px），字形未采集，
  // 所以一律取语义最贴的线性符号与前两条线保持同一支线宽。
  // 编辑链接：铅笔（与「修订插入」区分开 —— 修订是勾/叉，编辑必须是笔）
  edit: wrap('<path d="M11.3 2.7a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3l-8 8L3 14.3l.7-3.2z"/><path d="m10.2 3.8 2.3 2.3"/>'),
  // 权限设置密码行的实心斜铅笔：flybook 真身是填充字形，描边 edit 在 16px 下几乎不可见（B22）。
  'pencil-solid': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M11.9 1.4a1.5 1.5 0 0 1 2.1 0l.6.6a1.5 1.5 0 0 1 0 2.1l-.4.4-2.7-2.7.4-.4ZM10.7 2.6 3.2 10.1l-.6 2.5 2.5-.6L12.6 4.5 10.7 2.6ZM2.3 12.9a.6.6 0 0 0-.2.5v.5h.5a.6.6 0 0 0 .5-.2l-.8-.8Z"/></svg>',
  // 更多：横向三点（飞书 24×24 更多按钮的标准字形）
  more: wrap('<circle cx="3.6" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8" r="1.15" fill="currentColor" stroke="none"/>'),
  // 勾（04 §1.6.1：path 13×9）：不复用 rev-accept —— 那条虽然路径相同，
  // 但语义绑在「接受修订」上，改口径会让勾的确切用途失真。
  // 描边色不写死：用方由 currentColor 决定（当前主要挂在 --ld-brand-content 上）。
  check: wrap('<path d="m3.1 8.2 3.1 3.1 6.7-6.6"/>'),
  // 封面面板「选择图片」：与 rev-image 同款相框（同一件事不画两种图）
  image: wrap('<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.6"/><circle cx="6" cy="6.6" r="1"/><path d="m3.4 11 3.2-3.2 2.4 2.4 1.8-1.8 1.8 1.8"/>'),
  // 封面面板「调整图片位置」：左右夹住图的两侧并双向拖动
  'cover-position': wrap('<path d="M2.6 3.4h10.8v9.2H2.6z" opacity=".35"/><path d="M8 5.2v5.6"/><path d="m6.2 6.9 1.8-1.8 1.8 1.8"/><path d="m6.2 9.1 1.8 1.8 1.8-1.8"/>'),
  // —— 顶栏「新建」菜单与「通知」popover 专用（04 §4.6.3 / §4.6.4）——
  // 11 项里前 6 项与「知识库」是单色 `--ld-text-menu` 线框图标，后 4 项（画板/思维导图/流程图/
  // 上传及导入）是彩色图形 —— 颜色由项的 `iconColor` 走 `style.color` 覆盖，图标本身仍用
  // currentColor，这样彩色/单色两态共用同一份路径，不用画两套。
  'chevron-right': wrap('<path d="m6.2 4.2 3.8 3.8-3.8 3.8"/>'),
  // 钟身竖直两侧收到一条平底，裙边另画一条更宽的横线（飞书铃铛是「细横线裙边」，
  // 不是把梯形描边加粗 —— 后者在 16px 下会糊成一块）。
  bell: wrap('<path d="M4.4 10.2V5.9a3.6 3.6 0 0 1 7.2 0v4.3z"/><path d="M3.1 10.2h9.8"/><path d="M6.6 13a1.5 1.5 0 0 0 2.8 0"/>'),
  // 通知面板「关闭/开启通知」与「关注文档更新」：飞书真源分别是铃铛斜杠、圆勾、书签加号。
  'bell-off': wrap('<path d="M4.4 10.2V5.9a3.6 3.6 0 0 1 7.2 0v4.3z"/><path d="M3.1 10.2h9.8"/><path d="M6.6 13a1.5 1.5 0 0 0 2.8 0"/><path d="m2.2 2.2 11.6 11.6"/>'),
  'check-circle': wrap('<circle cx="8" cy="8" r="6"/><path d="m5.4 8.1 1.8 1.8 3.4-3.6"/>'),
  subscribe: wrap('<path d="M3.6 2.4h8.8v11.2L8 11l-4.4 2.6z"/><path d="M8 4.8v3.6"/><path d="M6.2 6.6h3.6"/>'),
  doc: wrap('<path d="M4.2 2.4h4.6l3 3v8.2H4.2z"/><path d="M8.6 2.4v3.2h3.2"/><path d="M6.2 8.6h3.6"/><path d="M6.2 11h3.6"/>'),
  'doc-grid': wrap('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6"/><path d="M2.6 6.4h10.8"/><path d="M2.6 10.2h10.8"/><path d="M6.4 2.6v10.8"/>'),
  form: wrap('<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6"/><path d="M5.4 6.2h5.2"/><path d="M5.4 8.6h5.2"/><path d="M5.4 11h2.6"/>'),
  board: wrap('<rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6"/><path d="M5.6 6.2v3.8" stroke-width="1.8"/><path d="m8.6 4.8 2.6 2.2-2.6 2.2z"/>'),
  mindmap: wrap('<circle cx="3.4" cy="8" r="1.5"/><circle cx="12.2" cy="4.4" r="1.3"/><circle cx="12.2" cy="11.6" r="1.3"/><path d="M4.9 8h3.2c1 0 1.4-.6 1.9-1.4"/><path d="M4.9 8h3.2c1 0 1.4.6 1.9 1.4"/>'),
  flow: wrap('<rect x="2.4" y="2.4" width="5" height="4" rx="1"/><rect x="8.6" y="9.6" width="5" height="4" rx="1"/><path d="M4.9 6.4v3.2h6.2"/>'),
  upload: wrap('<path d="M8 10.4V3.2"/><path d="m5.4 5.8 2.6-2.6 2.6 2.6"/><path d="M3 11.2v1.6h10v-1.6"/>'),
  'text-color': wrap('<path d="m4 12.6 3.1-8.8h1.8l3.1 8.8M5.2 9.3h5.6"/><path d="M2.8 14h10.4"/>'),
  'block-image': wrap('<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.7"/><circle cx="5.7" cy="5.8" r="1.1"/><path d="m3.6 12 3.1-3.1 2.2 2.2 1.9-1.9 1.7 1.7"/>'),
  'block-table': '<svg viewBox="0 0 24 24" fill="none"><path d="M19.5 4.25v15.5H4V4.25h15.5ZM4 2.25a2 2 0 0 0-2 2v15.5a2 2 0 0 0 2 2h15.5a2 2 0 0 0 2-2V4.25a2 2 0 0 0-2-2H4Z" fill="currentColor"/><path d="M9.997 4.25v3.835H19.5v2H9.997v3.83H19.5v2H9.997v3.835h-2v-3.835H4v-2h3.997v-3.83H4v-2h3.997V4.25h2Z" fill="currentColor"/></svg>',
  'block-columns': wrap('<path d="M5 2.8v10.4M11 2.8v10.4" stroke-width="2.2"/>'),
  'block-details': wrap('<path d="m4.5 6.2 3.5 3.5 3.5-3.5"/>'),
  'block-template': wrap('<path d="m8 2.4 5.6 5.6L8 13.6 2.4 8 8 2.4Z"/><path d="M6.1 8h3.8"/>'),
  'block-diagram': wrap('<rect x="2.2" y="2.2" width="4.1" height="3.4" rx=".7"/><rect x="9.7" y="10.4" width="4.1" height="3.4" rx=".7"/><path d="M6.3 3.9h3.1v8.2M9.4 12.1H8"/>'),
  'mark-subscript': wrap('<path d="M2.8 4.3 7.2 8.7M7.2 4.3 2.8 8.7"/><path d="M9.6 10.2h3.7l-3.7 3.1h3.7"/>'),
  'mark-superscript': wrap('<path d="M2.8 7.7 7.2 12.1M7.2 7.7 2.8 12.1"/><path d="M9.6 5.8h3.7l-3.7-3.1h3.7"/>'),
  'block-callout': wrap('<rect x="2.4" y="2" width="11.2" height="6.4" rx=".8"/><path d="M2.4 11h11.2M2.4 14h7.2"/>'),
  'drag-handle': '<svg viewBox="0 0 24 24" fill="none"><path d="M8.25 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm0 7.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm1.75 5.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0ZM14.753 6.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM16.5 12a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm-1.747 9a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z" fill="currentColor"/></svg>',
}

export default ICONS
