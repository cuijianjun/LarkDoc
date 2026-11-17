/**
 * 工作区控制器的共享小工具。
 *
 * `nextPaintFrame` 有两个使用者且不能各写一份：`onReady`（恢复草稿后让大纲先落地，
 * 再由编辑器接管正文）与 `restoreSnapshot`（同一套「先画大纲、再换正文」的顺序）。
 * 两处都必须真的等到两帧之后。
 */
export const nextPaintFrame = () => (typeof requestAnimationFrame === 'function'
  ? new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  : Promise.resolve())
