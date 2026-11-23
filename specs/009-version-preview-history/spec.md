# Feature Specification: 版本预览模式与历史记录面板按飞书 1:1 实现

**Feature Branch**: `009-version-preview-history`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "历史记录和另存为版本 里面的全链路交互 也需要完成 也要按照飞书的样式 UI 交互 icon 来实现…我需要 1:1 完成功能 如果有一个小功能点不确认需求 那就一直到确认为止 不要捏造需求 或者臆想需求"

## 现状基线（取证结论）

| 能力 | 现状 | 取证 |
|---|---|---|
| 版本预览模式 | **完全未落地** | `grep -rl "回到源文档\|复制版本链接\|还原此记录" src` = 0 命中 |
| 「立即查看」落点 | 只打开「已存版本」面板并选中条目，**不进预览态** | `src/components/lark-doc/editor/panelPresentation.js:624-637` |
| 历史记录面板 | 存在，但多挂飞书没有的「回收站」按钮（`:265`）与「上一页/下一页」翻页器（`:108`/`:113`） | `src/ui/versionPanel.js` 632 行 |
| 还原确认框 | 存在，文案「还原此历史版本？」，尺寸与飞书不符 | `src/ui/versionPanel.js:189-198` |
| 「显示更改」开关 | 存在，几何未按飞书校准 | `src/ui/versionPanel.js:277-290` |
| 顶栏版本指示 | 存在「当前版本」，但下拉与「回到源文档」入口缺失 | `src/` 内「回到源文档」0 命中 |
| 主题 token | 面板内主题项在列表最末，三档主题视觉未收口 | 上一轮裁定：保留最末位置 |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 版本预览模式（Priority: P1）

作为文档作者，在「历史记录 / 已存版本」面板里点击某条记录后，我需要进入一个**只读的版本预览态**：顶栏出现「当前版本：X」指示与「回到源文档」出口，正文渲染该版本的内容快照，且我能从预览态复制版本链接或还原该记录。

**Why this priority**: 这是「立即查看」按钮的真正落点。当前实现只跳到面板选中，等于功能断链，是整条链路里唯一缺失的主干。

**Independent Test**: 打开版本面板 → 点任一条目 → 断言进入预览态（顶栏出现版本指示、正文只读、URL 带 `?edition_id=`）→ 点「回到源文档」→ 断言回到正文编辑态且 `?edition_id=` 消失。

**Acceptance Scenarios**:

1. **Given** 版本面板已打开且列表非空，**When** 点击某条历史记录，**Then** 进入只读预览态，顶栏显示 `当前版本：<版本名> ⌄`，正文不可编辑。
2. **Given** 处于预览态，**When** 点击顶栏「回到源文档」，**Then** 退出预览态回到当前正文，`?edition_id=` 从 URL 移除。
3. **Given** 处于预览态，**When** 点击「复制版本链接」，**Then** 剪贴板写入带 `?edition_id=` 的绝对 URL，并弹出复制成功 toast。
4. **Given** 处于预览态，**When** 打开顶栏「更多」，**Then** 菜单精简为预览态专属项（项数由 FR-011 裁定），不出现编辑态专属动作。
5. **Given** 版本保存成功 toast 出现，**When** 点击「立即查看」，**Then** 进入该版本的预览态（不再只打开面板）。

---

### User Story 2 - 历史记录面板重排（Priority: P2）

作为文档作者，我打开「历史记录」面板时应看到与飞书一致的布局：**没有**回收站按钮、**没有**上一页/下一页翻页器，条目 hover/选中态与飞书同色，底栏只有「显示更改 + 开关」。

**Why this priority**: 面板是进入预览态的入口，多余的本地控件会让入口看起来不像飞书。

**Independent Test**: 打开面板 → 断言 `.lark-doc-version-trash-toggle` 与翻页器按钮在 DOM 中不存在 → 断言底栏只剩开关。

**Acceptance Scenarios**:

1. **Given** 打开历史记录面板，**When** 检查左栏，**Then** 不存在「回收站」按钮。
2. **Given** 打开历史记录面板，**When** 检查列表底部，**Then** 不存在「上一页 / 下一页」按钮。
3. **Given** 打开历史记录面板，**When** hover 某条目，**Then** 背景为飞书实测 hover 色；选中条目为飞书实测选中色。
4. **Given** 打开历史记录面板，**When** 查看底栏，**Then** 只有「显示更改」文字 + 36×22 圆角 11 的开关。

---

### User Story 3 - 还原确认框 1:1（Priority: P3）

作为文档作者，点击「还原此历史记录」后弹出的确认框应为飞书真身形态：420×178、标题「还原此记录？」、双按钮「取消 / 还原」。

**Why this priority**: 是还原动作的最后一道确认，文案与尺寸偏差最容易被用户识别为「不像飞书」。

**Independent Test**: 点击还原按钮 → 断言 `.lark-doc-version-restore-confirm` 量得 420×178、标题文本为「还原此记录？」。

**Acceptance Scenarios**:

1. **Given** 版本面板已选中某条记录，**When** 点击「还原此历史记录」，**Then** 弹出确认框，标题为「还原此记录？」。
2. **Given** 确认框已弹出，**When** 量取外框，**Then** 尺寸为 420×178（±1px）。
3. **Given** 确认框已弹出，**When** 点击「取消」，**Then** 关闭且不发还原请求。

---

### User Story 4 - 主题一致（Priority: P4）

作为文档作者，版本面板内的所有新增元素（预览态顶栏、确认框、开关、toast）必须走 `--ld-*` token，不出现字面色值，且在深色主题下可读。

**Why this priority**: 收口项，非功能性但有门禁（`check:theme-tokens`）硬约束。

**Independent Test**: `npm run check:theme-tokens` 零新增违规；深色主题下预览态顶栏与确认框文字对比度可读。

**Acceptance Scenarios**:

1. **Given** 新增任意样式，**When** 运行 `npm run check:theme-tokens`，**Then** `src/` 下零新增字面 hex。
2. **Given** 切到深色主题，**When** 进入预览态，**Then** 顶栏、正文、确认框文字均为浅色且可读。

---

### Edge Cases

- 预览态下正文为只读快照，但用户按快捷键（如 Cmd+Z）时**不能**改写当前正文。
- 预览态下 URL 带 `?edition_id=`，刷新页面应仍停留在该版本预览（或明确降级到当前版本并提示）。
- 目标版本已被回收站彻底删除时，点「立即查看」应给出提示而非白屏。
- 剪贴板 API 不可用（非 HTTPS / 权限拒绝）时，「复制版本链接」应有降级提示。
- 版本列表为空时，预览态入口不应出现（「立即查看」按钮隐藏）。
- 预览态下打开「更多」应只含预览态项，不能出现「另存为版本」等编辑动作。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 支持「版本预览态」：以只读快照渲染指定历史版本正文，禁止任何写入。
- **FR-002**: 预览态顶栏 MUST 显示版本指示 `当前版本：<版本名>`，并带下拉箭头，点击可切换版本。
- **FR-003**: 预览态顶栏 MUST 提供「回到源文档」入口，点击退出预览并移除 `?edition_id=` 查询参数。
- **FR-004**: 预览态 MUST 提供「复制版本链接」，写入带 `?edition_id=` 的绝对 URL 并弹出复制成功 toast。
- **FR-005**: 预览态 MUST 提供「还原此记录」入口，复用 FR-007 的确认框。
- **FR-006**: 「立即查看」（版本保存成功 toast 与面板条目）MUST 进入版本预览态，而非仅打开面板。
- **FR-007**: 还原确认框标题 MUST 为「还原此记录？」，外框 MUST 为 420×178（±1px），按钮为「取消 / 还原」。
- **FR-008**: 历史记录面板 MUST NOT 包含「回收站」按钮与「上一页 / 下一页」翻页器（飞书无此元素）。
- **FR-009**: 历史记录面板条目 MUST 具备飞书实测的 hover 态与选中态背景色。
- **FR-010**: 「显示更改」开关 MUST 为 36×22、圆角 11，滑块与轨道几何按飞书实测。
- **FR-011**: 预览态「更多」菜单项名单 NEEDS CLARIFICATION —— 需从飞书真身取证，确认精简后的具体项与顺序。
- **FR-012**: 版本指示下拉的几何（宽高、圆角、项高、分隔线）NEEDS CLARIFICATION —— 需从飞书真身量取。
- **FR-013**: 底部渐隐遮罩不做 —— 已由用户裁定（上一轮 AskUserQuestion）。

### Key Entities

- **VersionRecord**: 历史版本记录，字段含 `id`、`name`（版本名，用于「当前版本：X」）、`createdAt`、`editor`、`snapshot`（正文快照）。
- **PreviewState**: 预览态运行时状态，含 `active`（布尔）、`editionId`（当前预览版本）、`sourceUrl`（回到源文档时恢复的 URL）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 从「点条目」到「预览态渲染完成」≤ 300ms（本地快照，无网络）。
- **SC-002**: 预览态下任意编辑入口（正文输入、快捷键、悬浮工具栏）100% 不可触发写入。
- **SC-003**: 「回到源文档」后 `location.search` 中不含 `edition_id`，且正文恢复为进入预览前的内容。
- **SC-004**: `grep -rl "回到源文档\|复制版本链接\|还原此记录" src` 由 0 命中变为各 ≥ 1 命中。
- **SC-005**: 面板 DOM 中 `.lark-doc-version-trash-toggle` 与翻页器按钮命中数为 0。
- **SC-006**: `npm run check:theme-tokens` 对 `src/` 零新增违规。

## Assumptions

- 版本内容快照已在 `versionList` / `versionRecords` 中可用，无需新增后端接口。
- `?edition_id=` 作为版本预览的 URL 契约（与飞书一致），由本地路由/参数解析承担，不依赖服务端。
- 「更多」菜单的精简项与顶栏版本下拉几何尚缺飞书直接证据（bundle 内 `045-13645.2231a977.js` 命中「当前版本」但不含中文 UI 文案，说明文案走 i18n 表），因此 FR-011/FR-012 保持 NEEDS CLARIFICATION，落码前必须先取证。
