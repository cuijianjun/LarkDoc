/**
 * 按钮组命令：打开超链接 / 创建副本 / 关注文档更新（需求 03 §3.4 ③「按钮 3 项」）。
 *
 * 三条共用同一个 `isv` 节点（`kind: 'button'`），差异只在 `action` 字段——
 * 真飞书的 ISV 小组件里「按钮」就是一种 third-party app 块，宿主 DOM 是
 * `span.docx-button-component.light-blue`（02 §22 ⑤-3），不是 iframe。
 *
 * `plus: false`：`+` 菜单承诺「点一下就地插一个块」，而这三条点了**先弹配置面板**
 * （02 §22 ⑤-1 / ⑤-2：270×386，定判是「先弹窗后落块」），取消或 Esc 连块都不建。
 * 同一个理由也得让它们进 `commandMenuMixin` 的 `focusAfter` 排除名单
 * （同 `calendar_event`），否则点完命令先 `focus()` 会把刚开的面板顶掉。
 *
 * 定语五是**顺序**：03 §3.4 ④-4 里「按钮」分类在「团队协作」之前，所以这三条必须插在
 * `mentionUser` 之前，不能图省事贴到 COMMAND_ORDER 尾巴——那会把「按钮」组顶到
 * 「内嵌网页」后面。
 *
 * CommandDef 契约见 requirements/09 §3.2。
 */
export const buttonCommands = [
  { id: 'open_link', label: '打开超链接', category: '按钮', plus: false, glyph: '↗', tone: 'blue', keywords: 'open_link link chaolianjie dakai url href button anniu', group: 'button', tier: 'required' },
  { id: 'duplicate_page', label: '创建副本', category: '按钮', plus: false, glyph: '⧉', tone: 'indigo', keywords: 'duplicate_page duplicate copy chuangjian fuben clone button anniu', group: 'button', tier: 'required' },
  { id: 'follow_page', label: '关注文档更新', category: '按钮', plus: false, glyph: '◉', tone: 'green', keywords: 'follow_page follow watch guanzhu gengxin update subscribe button anniu', group: 'button', tier: 'required' },
]
