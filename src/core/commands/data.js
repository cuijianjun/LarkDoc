/**
 * 数据组命令：电子表格（P5-02，只读渲染，不做公式引擎也不需要单元格编辑）。
 *
 * 真飞书的「数据」是**独组一项** —— 03 §3.4 ④ `数据（1 项）`：`slash sheet` 电子表格
 * （`+` 菜单那 55 项里同名的 `sheet block` 也在，所以 `plus` 不能关）。分类名照真值写
 * 「数据」，**不要**并进「插入」：`CommandMenu.categories` 按首次出现顺序出组标题，
 * 并进去就等于把真飞书那个独组吃掉，斜杠菜单看起来少了一档。
 *
 * `plus: true` 的依据是「插入无对话框」（02 §25 ① 实测）—— `+` 菜单只承诺「点一下
 * 就地插一个块」；表格族里唯一需要二次取参的是 `table`（先选行列数），电子表格直接
 * 落默认空表（`SHEET_DEFAULT`，20 × 8）。
 *
 * 关键词按 03 §3.5 的实测命中表补：中文「表格」由 label「电子表格」自带（子串命中，
 * 实测 `表格` 命中 14 项里就有它）；拼音必须显式给 `biaoge`（实测 `biaoge` 命中 12 项），
 * 否则打拼音的用户搜不到。
 */
export const dataCommands = [
  {
    id: 'sheet', label: '电子表格', category: '数据', plusCategory: '常用', glyph: '▩', tone: 'teal',
    keywords: 'sheet biaoge gezi excel spreadsheet csv 电子表格 表格 数据表',
    group: 'data', tier: 'required',
  },
]
