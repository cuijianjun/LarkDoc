/**
 * UTF-8 字节数（全仓库唯一实现）。
 *
 * 谁需要「这份数据占多少字节」都从这里取：卡片 8 KB 闸门、电子表格 32 KB 闸门、
 * 投票选项、多维表格单元格、以及协同的离线快照 512 KB 闸门。**不要另写一份** ——
 * 差一个字节判断就会让"刚好 8192"的卡片一边写进去、一边读不出来。
 *
 * 为什么单独一个文件而不是留在 `core/embed/card.js` 里：
 *   · `card.js` 会顺着 `documentOperations` 拖进大半个 core（schema、mention、emoji…）；
 *   · 协同子入口 `lark-doc/collab` 只需要字节数，不该为了一个函数把 core 打进产物。
 *     一个叶子模块 = 一条干净的依赖边。（这条是 P6a 打子入口产物时踩出来的。）
 *
 * 不用 `TextEncoder`：Node 14 与老浏览器上它不总是全局可用（本包构建目标 Node 14）。
 */
export function utf8Bytes(text) {
  if (typeof text !== 'string' || !text) return 0
  let bytes = 0
  // 按码点迭代而不是码元：代理对（emoji）算 4 字节，不是两个 3 字节。
  for (const char of text) {
    const code = char.codePointAt(0)
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}
