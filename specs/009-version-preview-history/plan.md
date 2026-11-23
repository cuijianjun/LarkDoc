# Implementation Plan: 版本预览模式与历史记录面板按飞书 1:1 实现

**Branch**: `009-version-preview-history` | **Spec**: [spec.md](./spec.md)

## 取证来源（本次新增）

`/tmp` 下的飞书真身截图，逐张读图取证（DPR 待浏览器实测校准）：

| 截图 | 内容 | 结论 |
|---|---|---|
| `preview_mode.png` | 已存版本预览态 | 顶栏左 `当前版本：测试版本 自动化 ⌄`；右 `⧉ 回到源文档` `🔗 复制版本链接`(描边胶囊) `···` `🔍` `+` 头像 |
| `pv4_dropdown.png` | 版本下拉展开 | 左对齐触发器；首行灰字元信息 `崔健军 保存于 今天 02:07`；4 个版本项；**无分隔线、无勾选、无底部按钮** |
| `pv2_copy.png` | 复制版本链接后 | toast `✓ 复制成功`（浅绿底绿勾，无按钮）；按钮下方深色 tooltip `有文档阅读权限的用户可通过链接阅读此版本` |
| `fs_hist_full.png` | 历史记录面板 | 头部只有 `历史记录` + ⓘ；**无回收站按钮、无 chevronDown**；底栏只有 `显示更改` + 蓝色开关 |
| `hist_r2_confirm.png` | 还原确认框 | 标题 `还原此记录？`；正文 `将当前文档还原至 10月25日 17:05 的状态`；按钮 `取消` / `还原` |
| `hist_r2_confirm.png` 顶栏 | 历史记录预览态 | 左 `← 返回文档`；中 `还原此历史记录`；右 `编辑记录 1/2` `上一页`(禁用) `下一页`(蓝实心) |
| `saved_versions.png` | 已存版本子菜单 | 版本列表 + 分隔线 + `版本回收站`（已在 `documentMenuView.js:180` 实现 ✓） |
| `sv7_dialog.png` | 另存为版本命名框 | 标题 `保存 今天 07:22 的文档版本` + ×；`版本名称` 输入框 + `23/1000` 字数；`取消` / `确定` |

## 关键推翻结论

上一轮留下的两条待办**取证后不成立**，本计划据此修正：

1. ~~删 `versionPanel.js:99-117` 翻页器~~ → **飞书有**，位置是顶栏右侧 `编辑记录 1/2 + 上一页 + 下一页`（历史记录预览态）。dev 现有实现（`leftHeader` 内 `pager`）位置正确，**保留**。
2. ~~面板内回收站按钮只是「本地独有」~~ → 飞书确实有「版本回收站」，但入口在**已存版本子菜单**（已实现）。面板头部的 `trashToggle` 与 `chevronDown` 才是多余项，**删除**。

## 技术方案

- **不改架构**：全部落在既有 `src/ui/versionPanel.js` + `src/components/lark-doc/editor/panelPresentation.js` + `src/styles/deferred-ui.css`。
- **预览态承载**：已有 `restorePreview` / `previewRecord` / `mountedPolicy` 一套只读预览机制（`versionPanel.js:46` `clearDocument` 已有 `releasePreview`），已存版本预览复用同一套，只换顶栏。
- **两种预览态顶栏**：`state.mode = 'history' | 'saved'` 决定左区（`返回文档 + 还原此历史记录 + pager` vs `当前版本：X ⌄`）与右区（空 vs `回到源文档 / 复制版本链接 / ···`）。
- **URL 契约**：`?edition_id=<id>` 由 `panelPresentation.js` 的 `versionOperationScope()` 一带统一读写。
- **主题**：一律 `--ld-*` token，不新增字面 hex。

## 执行顺序

见 [tasks.md](./tasks.md)。按 T1 → T6 顺序，每步先落码再跑定向测试。
