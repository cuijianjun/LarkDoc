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
]
