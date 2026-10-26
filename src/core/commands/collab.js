/**
 * 团队协作组命令（需求 03 §3.4 ⑦「团队协作 10 项」中本轮落位的 3 条 mention 入口）。
 *
 * P4-01 只做「人员」：群名片 / 云文档跟人员共用同一个 `mention` 节点、同一套面板，
 * 差异只在候选源（05 §5.7 的 `mention.search` / `mention.resolve` 要按 kind 分流到
 * 群组与云空间接口）。对端实现还没到位时，宁可 `tier: 'skip'` 置灰可见 ——
 * 这样 03 §3.4 的 72 项口径对得上，也不会假装「点了就能用」。
 *
 * `plus: false`：`+` 菜单是**块级**插入入口（`CommandMenu` 的 plus 分支按
 * `plusCategory` 出组标题），而 mention 是行内 atom；塞进去等于承诺一个
 * 「点 + 号插一个行内 chip」的动线，实际做不到。`ai` 同样是斜杠独有。
 *
 * CommandDef 契约见 requirements/09 §3.2。
 */
export const collabCommands = [
  { id: 'mentionUser', label: '人员', category: '团队协作', plus: false, glyph: '@', tone: 'blue', keywords: 'mention at renyuan user tiji atuser', group: 'collab', tier: 'required' },
  { id: 'mentionChat', label: '群名片', category: '团队协作', plus: false, glyph: '#', tone: 'teal', keywords: 'mention qunmingpian chat group qun', group: 'collab', tier: 'skip' },
  { id: 'mentionPage', label: '云文档', category: '团队协作', plus: false, glyph: '▤', tone: 'indigo', keywords: 'mention yunwendang page doc docs wenjian', group: 'collab', tier: 'skip' },
  // P5-03 投票（03 §3.4 ⑦ 团队协作组第 4 位，y 1676：`1644 + 32` 步进正好落在
  // `mentionPage` 之后、`reminder` 之前；`data-name="poll block"`，**没有** `slash ` 前缀）。
  // 与上面几条的区别：它是**块级卡片**且插入后不弹任何面板 → `plus` 保持 true
  // （03 §4.2 的 `+` 列表里确实有「投票」这一项），归到「常用」组。
  // 插入后光标落在标题输入框（02 §23 ⑤），所以要进 `commandMenuMixin` 的 `focusAfter`
  // 排除名单，由 NodeView 自己 `focus()` 到 textarea。
  { id: 'poll', label: '投票', category: '团队协作', plus: true, plusCategory: '常用', glyph: '☑', tone: 'blue', keywords: 'poll toupiao vote piao voting', group: 'collab', tier: 'required' },
  // P4-02a 日期提醒：真飞书斜杠项文案正是「日期提醒」（`data-name="slash reminder"`，
  // 不能猜 `reminder` / `date reminder`）。与 mention 同为**行内**物件 → `plus: false`。
  // 插完 chip 会自动弹日历浮层（02 §19.4 ⑤「插入 → 立即弹浮层」），所以它还必须在
  // `commandMenuMixin` 的 `focusAfter` 排除名单里，否则点完命令先 `focus()` 把浮层顶掉。
  { id: 'reminder', label: '日期提醒', category: '团队协作', plus: false, glyph: '◷', tone: 'orange', keywords: 'reminder riqi tixing date alarm notify tixing', group: 'collab', tier: 'required' },
  // P4-02b 日程：真飞书斜杠项 label 是「日程」（`data-name="slash calendar_event"`，
  // **带 `slash ` 前缀**），03 §3.4 ⑦ 里排在 `reminder` 之后 —— 位置别挪。
  // 它是**块级**卡片，但 `plus: false`：`+` 菜单承诺的是「点一下就地插一个块」，而这条
  // 命令会先弹**搜索面板**再去选一条已有日程，塞进 `+` 菜单等于承诺一个做不到的动线
  // （同 reminder / mention 的理由）。也因为弹面板，它必须在 `commandMenuMixin` 的
  // `focusAfter` 排除名单里，否则点完命令先 `focus()` 会把刚开的面板顶掉。
  { id: 'calendar_event', label: '日程', category: '团队协作', plus: false, glyph: '▦', tone: 'blue', keywords: 'calendar_event richeng calendar schedule rili date event', group: 'collab', tier: 'required' },
]
