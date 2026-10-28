/**
 * 媒体组命令（P2-04）：视频与文件共用一个入口，因为它们在文档里是**同一个块**。
 *
 * 02 §19.5 ①：飞书斜杠菜单里这一项叫「视频或文件」，落块后 `data-block-type` 恒为
 * `file`，视频 / PDF / 其它附件靠 `mimeType` 分流渲染——所以命令也只有一条。
 * 本地图片仍在常用组（common.js），那是独立块类型，别混进来。
 */
export const mediaCommands = [
  { id: 'file', label: '视频或文件', category: '插入', plusCategory: '常用', glyph: '▥', tone: 'blue', keywords: 'file wenjian shipin video attachment fujian pdf', group: 'media', tier: 'required' },
]
