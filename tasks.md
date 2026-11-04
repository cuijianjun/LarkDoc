# lark-doc 0.12 实施任务清单

> 只记录当前仍需实施或验收的任务。完成任务后同步 `spec.md`、对应 `requirements/` 状态和本文件。
> 每次新会话只注入：`spec.md` + 当前任务 + 任务列出的受影响文件。

## 最新验收修订（2026-11-01）

用户明确 T032 经过浏览器模拟器通过即为通过，不用真机。`scripts/verify-browser-mobile.js` 在当前匹配产物上完成 Chromium 手机/平板 **12/12**：触摸/DPR/视口、无横向溢出、横竖屏文档身份、只读、评论回读/撤权、版本展示与拒绝恢复。T032、T07、T08 按新口径完成，历史 Safari/真机 BLOCKED 描述不再构成阻塞。账号/版本使用可注入 Provider，不代表真实宿主写入验收。lint 与 diff 检查通过。T019、T023、T028 已完成；T050 继续开放，仅保留 ESM 余量、性能采样稳定性和真实宿主写入证据缺口。

## 状态定义

- `TODO`：未开始。
- `DOING`：正在实施。
- `BLOCKED`：依赖外部账号、浏览器或宿主能力；必须先完成替代测试或取得证据。
- `DONE`：源码、测试和验收命令均通过。
- `WONT`：经审计明确不做，不得重新派活。

## 任务总览

| ID | 优先级 | 状态 | 主题 | 依赖 |
| --- | --- | --- | --- | --- |
| T00 | P0 | DONE | 建立可复现基线和审计索引 | 无 |
| T01 | P0 | DONE | BlockAPI 复制映射、权限前置、稳定错误、事务/事件和容器边界已完成并有回归证据 | T00 |
| T02 | P0 | DONE | T016/T017/T020/T021 真实历史验收完成，定向113项及完整门禁2166项通过 | T00 |
| T03 | P0 | DONE | core 块边界事件、递归安全校验、出网过滤、身份重建、正式 MIME 和 HTML/plain 回退已完成；24 项菜单/事件回归、Chromium 双标签页剪贴板10/10、独立宿主烟测和完整 Chromium 矩阵已通过；同步 copy-event 确认正式 MIME 后才删除并可 undo，异步路径 fail-closed | T01、T02 |
| T04 | P1 | DONE | 引用/标题容器调用链与结构边界已完成；编号/派生索引已有回归 | T01、T03 |
| T05 | P1 | BLOCKED | A4 按钮块宿主真实动作与刷新回读仍缺真实租户证据 | T00 |
| T06 | P1 | DONE | 五态与 policy 核心已完成；统一 capability 输出 visible/disabled/readOnly/rejected，评论、导出、版本、分享权限和顶栏子菜单控件均已声明 data-capability/aria-disabled，并通过权限/接线回归 | T01 |
| T07 | P1 | DONE | 跨账号确定性测试与 Chromium 手机/平板模拟器12/12通过；用户不要求真机 | T06 |
| T08 | P2 | DONE | viewport runtime、离线快照和幂等恢复已有回归；手机/平板模拟器12/12通过，按用户口径完成T032 | T06、T07 |
| T09 | P2 | BLOCKED | survey/import/AI/provider 契约和模拟宿主写入已完成；真实宿主租户写入证据仍缺 | T01、T06 |
| T10 | P2 | BLOCKED | 输出策略、版本回收站、导入任务/UI 已完成；真实浏览器和部分宿主回读仍缺证据 | T06、T09 |
| T11 | P2 | DONE | 性能基线、DerivedIndex、脏区更新和 IndexedDB 分层已收口 | T00、T01 |
| T12 | P3 | DONE | 白板/画板 0.12 版本化延期；保留 webEmbed/host-owned 骨架边界，不在 core 自研 Canvas | T01、T06 |
| T13 | P3 | DOING | 全量 Vitest 97文件/2192项、lint、架构、宿主契约、git diff --check通过；T023/T028已完成，T032手机/平板模拟器12/12通过；独立宿主烟测及 Chromium 完整矩阵14/14通过（splitting 13/13、mobile 12/12、clipboard 10/10、element 14/14）。仍开放：ESM gzip 287.09kB 超预算2.09kB、最新稳定采样 heap 18.1MB 相对14.7MB基线退化约23%、真实宿主租户写入证据缺失；未放宽预算或性能基线 | T02–T12 |
| T14 | P0 | WONT | 顶部固定格式工具栏 | 需求已证明不存在 |
| T15 | P0 | WONT | 自定义右键菜单 | 需求已证明不存在 |
| T16 | P0 | WONT | 折叠块 slash 项和兄弟产品线 | 明确不在当前范围 |
| T051 | P2 | DONE | 在线 Demo 交付与隔离验收：已补齐 `/demo/wc/`、`/demo/vanilla/`、vendor 同步脚本和 UMD 异步分块；无 broker 环境重建 UMD 成功，vendor 版本同步至 0.12.1。Chromium 桌面/390×844 窄屏三页均加载成功，编辑器与 Web Component 均挂载，响应宽度无溢出，控制台无错误且资源无 404；Playground 配置重建后正文保全、storage 隔离通过，窄屏预览/代码 Tab 切换通过。 | T13 |

---

## T00 · 建立可复现基线和审计索引

- **优先级**：P0
- **状态**：DONE
- **需求来源**：`spec.md §2`、`requirements/09 §2.3/§2.4`、`requirements/15 §7`
- **目标**：在本 worktree 记录当前代码、测试、产物、性能和门禁基线；确认历史“全绿”结论可复现或明确差异。
- **受影响文件**：
  - `package.json`
  - `src/core/blockApi/index.js`
  - `src/session/DocumentSession.js`
  - `src/providers/`
  - `test/unit/block-api.test.js`
  - `test/unit/versioning-core.test.js`
  - `test/unit/survey-provider.test.js`
  - `scripts/`
- **验收命令**：
  - `npm run check:gate`
  - `npm run check:artifacts`
  - `npm run test:unit`
  - `npm run verify:all`
  - `git status --short`
- **完成定义**：输出可复现的通过/失败清单；若环境导致失败，记录具体命令、首个失败点和不影响代码结论的原因。不得修改原工作区。

## T01 · 冻结共享 BlockAPI 契约

- **优先级**：P0
- **状态**：DONE（US1 本轮定向 7 文件/123 用例通过；格式保真及副本实体隔离已补测）
- **需求来源**：`requirements/05 §5.12`、`requirements/15 §3.3`、`requirements/17 §17.2–§17.5`
- **目标**：让所有块共用 insert/update/remove/move/duplicate/transform/get/children/batch，并定义容器、权限、非法 blockId、事务失败和事件语义。
- **受影响源码**：
  - `src/core/blockApi/index.js`
  - `src/core/blockApi/nodes.js`
  - `src/core/blockApi/tree.js`
  - `src/core/blocks/document.js`
  - `src/core/blocks/document-commands.js`
  - `src/core/blocks/block-id.js`
  - `src/session/DocumentSession.js`
- **受影响测试**：
  - `test/unit/block-api.test.js`
  - `test/unit/heading-container.test.js`
  - `test/unit/container-depth.test.js`
  - `test/unit/insert-atomicity.test.js`
  - `test/collab/anchors.test.js`
- **验收命令**：`npm run test:unit -- test/unit/block-api.test.js test/unit/insert-atomicity.test.js test/unit/heading-container.test.js`；`npm run check:architecture`
- **完成定义**：每个方法有成功、空值、非法父节点、权限拒绝、事务回滚测试；复制生成新 blockId；移动不破坏锚点；容器 children 顺序稳定。

## T02 · 落地撤销/重做历史栈

- **优先级**：P0
- **状态**：DONE（T016/T017/T020/T021 已通过真实 Editor 验收：800ms、严格100组及redo、blockId恢复、协同远端隔离、决策不入栈、撤销保存/刷新；定向6文件113项，完整门禁97文件2166项通过）
- **需求来源**：`requirements/07 §13`、`requirements/15 §3.1`
- **目标**：按已定 V1 契约实现 800ms 分组、100 步上限、blockId 复原、本地 `local` origin、远端更新不清本地栈、accept/reject 不进栈。
- **受影响源码**：
  - `src/components/lark-doc/extensions.js`
  - `src/components/lark-doc/editor/shortcutGroups.js`
  - `src/components/lark-doc/editor/revisionMixin.js`
  - `src/core/transactionMetadata.js`
  - `src/collab/index.js`
  - `src/collab/policies.js`
  - `src/core/blocks/block-id.js`
- **受影响测试**：
  - `test/unit/versioning-core.test.js`
  - `test/unit/revision.test.js`
  - `test/unit/collab-editor.test.js`
  - `test/collab/converge.test.js`
  - `test/collab/anchors.test.js`
- **验收命令**：`npm run test:unit -- test/unit/versioning-core.test.js test/unit/revision.test.js test/unit/collab-editor.test.js`；`npm run test:unit -- test/collab/converge.test.js`
- **完成定义**：新增/删除/移动/属性修改均可撤销重做；blockId 在链路中保持；协同下不能撤掉远端编辑；刷新不会丢撤销后的持久化结果。

## T03 · 落地块级剪贴板与多块多选

- **优先级**：P0
- **状态**：DOING（仅私有 MIME 载荷与 ID 映射工具已有；真实 copy/cut/paste 事件接线及跨 tab 验收未完成）
- **需求来源**：`requirements/07 §14`、`requirements/15 §3.2`、`requirements/05 §5.12`
- **目标**：支持单块、多块、容器内复制/剪切/粘贴；内部 MIME 保真；外部 HTML/Markdown 清洗；粘贴副本重新生成 blockId；图片粘贴失败有明确状态。
- **受影响源码**：
  - `src/core/blocks/document-commands.js`
  - `src/core/blocks/document-helpers.js`
  - `src/core/blocks/block-id.js`
  - `src/components/lark-doc/LarkDocEditor.vue`
  - `src/components/lark-doc/editor/selectionPacingMixin.js`
  - `src/components/lark-doc/editor/blockHandleMixin.js`
  - `src/core/blocks/image-paste.js`
  - `src/utils/importExport.js`
- **受影响测试**：
  - `test/unit/table-clip.test.js`
  - `test/unit/insert-atomicity.test.js`
  - `test/unit/image-insert.test.js`
  - `test/unit/export-roundtrip.test.js`
  - 新增 `test/unit/block-clipboard.test.js`
- **验收命令**：`npm run test:unit -- test/unit/table-clip.test.js test/unit/image-insert.test.js test/unit/export-roundtrip.test.js test/unit/block-clipboard.test.js`
- **完成定义**：内部复制跨 tab 保留 attrs/子树且不重复 blockId；剪切可撤销；外部内容通过白名单清洗；多选边界和空选区均有测试。

## T04 · 收口引用/标题容器调用链

- **优先级**：P1
- **状态**：DONE（容器/深度/循环边界定向回归通过）
- **需求来源**：`requirements/02 §2/§8`、`requirements/10 A14/A15`、`requirements/15 §3.6`
- **目标**：将引用和标题按容器语义接入统一 API，支持嵌套块、折叠范围、粘贴多块、编号/大纲局部更新。
- **受影响源码**：
  - `src/core/blocks/quote.js`
  - `src/core/blocks/heading.js`
  - `src/core/blocks/container-depth.js`
  - `src/components/lark-doc/editor/blockIndentMixin.js`
  - `src/components/lark-doc/editor/foldPersistMixin.js`
  - `src/core/derive/`
- **受影响测试**：
  - `test/unit/quote.test.js`
  - `test/unit/heading-container.test.js`
  - `test/unit/container-depth.test.js`
  - `test/unit/derived-index.test.js`
- **验收命令**：`npm run test:unit -- test/unit/quote.test.js test/unit/heading-container.test.js test/unit/container-depth.test.js`
- **完成定义**：引用可含任意受支持块；标题折叠只隐藏子树；大纲、编号和剪贴板均不破坏容器结构。

## T05 · 完成 A4 按钮块两 action 与刷新回读

- **优先级**：P1
- **状态**：BLOCKED（缺真实宿主租户动作和刷新回读证据）
- **需求来源**：`requirements/02 §22`、`requirements/10 §1.5/A4`
- **目标**：完成创建副本、关注文档更新、删除后重新加载并回读状态；保持第三方动作由宿主/事件处理。
- **受影响源码**：
  - `src/core/blocks/isv.js`
  - `src/core/nodeviews/isv.js`
  - `src/components/lark-doc/editor/IsvButtonPanel.vue`
  - `src/components/lark-doc/editor/isvMixin.js`
  - `src/providers/embedded.js`
  - `src/providers/persistence.js`
- **受影响测试**：
  - `test/unit/isv.test.js`
  - `test/unit/embedded-provider.test.js`
  - 新增 `test/unit/button-actions.test.js`
- **验收命令**：`npm run test:unit -- test/unit/isv.test.js test/unit/embedded-provider.test.js test/unit/button-actions.test.js`
- **完成定义**：三动作均有成功、宿主拒绝、网络失败、刷新回读测试；删除后文档重新加载不残留旧块。

## T06 · 建立异步块异常与权限矩阵

- **优先级**：P1
- **状态**：DOING（五态与策略核心已实现；T028 浮层逐项视觉投影未全部完成）
- **需求来源**：`requirements/15 §3.4/§5`、`requirements/04 §8.3`、`requirements/05 §5.3.1`
- **目标**：统一空/加载/失败/无权限/超限五态；统一降级卡；将 capability 映射到块级可见、置灰、只读和拒绝行为。
- **受影响源码**：
  - `src/core/blocks/shared.js`
  - `src/core/blocks/unknown-block.js`
  - `src/core/blocks/file-block.js`
  - `src/core/blocks/image.js`
  - `src/core/blocks/sheet.js`
  - `src/core/blocks/web-embed.js`
  - `src/core/blocks/bookmark.js`
  - `src/core/policy/`
  - `src/providers/security.js`
  - `src/components/lark-doc/editor/LarkDocOverlays.vue`
- **受影响测试**：
  - `test/unit/file-block.test.js`
  - `test/unit/image-nodeview.test.js`
  - `test/unit/sheet.test.js`
  - `test/unit/web-embed.test.js`
  - `test/unit/unknown-block.test.js`
  - `test/unit/security-provider.test.js`
  - 新增 `test/unit/async-state-matrix.test.js`
- **验收命令**：`npm run test:unit -- test/unit/file-block.test.js test/unit/sheet.test.js test/unit/web-embed.test.js test/unit/unknown-block.test.js test/unit/security-provider.test.js test/unit/async-state-matrix.test.js`
- **完成定义**：矩阵覆盖所有异步块；失败有重试/拒绝语义；权限与超限不会误删数据；降级卡视觉和键盘行为统一。

## T07 · 完成跨账号、Safari 和无权限验收

- **优先级**：P1
- **状态**：DONE（2026-11-01 用户修订为模拟器验收；Chromium 手机/平板矩阵12/12通过，账号为可注入 Provider，不宣称真实 Safari/租户通过）
- **需求来源**：`requirements/10 §9.4–§9.6`、`requirements/16 §5.5`、`requirements/17 §17.6.3`
- **目标**：验证第二账号权限降级、离职/无权限 mention、评论回读和 Safari 行为。
- **受影响源码**：
  - `src/providers/comments.js`
  - `src/providers/permissions.js`
  - `src/core/mention/directory.js`
  - `src/components/lark-doc/CommentPanel.vue`
  - `src/components/lark-doc/editor/mentionMixin.js`
  - `src/components/lark-doc/editor/commentsMixin.js`
- **受影响测试**：
  - `test/unit/comments-core.test.js`
  - `test/unit/comments-ui.test.js`
  - `test/unit/mention.test.js`
  - `test/unit/security-provider.test.js`
  - 新增 `test/browser/safari-comments.test.js`（若浏览器 runner 可用）
- **验收命令**：`npm run test:unit -- test/unit/comments-core.test.js test/unit/comments-ui.test.js test/unit/mention.test.js`; Safari/第二账号使用浏览器矩阵命令并记录环境。
- **完成定义**：真实账号不可用时必须用可注入 provider 完成确定性测试，并将真实环境缺口标记 BLOCKED，不得伪报 DONE。

## T08 · 完成移动端 runtime 与离线同步

- **优先级**：P2
- **状态**：DONE（2026-11-01 Chromium 手机/平板模拟器12/12通过；横竖屏保持文档、只读、评论和版本权限流程均有浏览器证据。用户不要求真机）
- **需求来源**：`requirements/16 §5.5`、`requirements/17 §17.6.3`、`requirements/15 §9.15`
- **目标**：提供移动端评论/通知/锚点/版本只读、横屏布局、离线快照和同步恢复。
- **受影响源码**：
  - `src/components/lark-doc/LarkDocEditor.vue`
  - `src/components/lark-doc/LarkDocWorkspace.vue`
  - `src/components/lark-doc/CommentPanel.vue`
  - `src/components/lark-doc/VersionPanel.vue`
  - `src/components/lark-doc/editor/viewModesMixin.js`
  - `src/components/lark-doc/editor/commentsMixin.js`
  - `src/components/lark-doc/editor/versioningMixin.js`
  - `src/core/storage/`
  - `src/collab/`
- **受影响测试**：
  - `test/unit/mode-switch.test.js`
  - `test/unit/comments-ui.test.js`
  - `test/unit/versioning-ui.test.js`
  - `test/unit/storage-idb.test.js`
  - `test/collab/converge.test.js`
- **验收命令**：`npm run test:unit -- test/unit/mode-switch.test.js test/unit/versioning-ui.test.js test/unit/storage-idb.test.js`; 移动端浏览器验证。
- **完成定义**：窄屏/横屏不丢编辑状态；离线快照遵守 512KB 单份限制；恢复后协同不重复提交或覆盖远端内容。

## T09 · 完成 survey/import/provider 写入闭环

- **优先级**：P2
- **状态**：BLOCKED（契约和模拟 Provider 已实现；真实宿主租户写入证据缺失）
- **需求来源**：`requirements/05 §5.17`、`requirements/17 DocumentImportAPI/SurveyProvider`、`requirements/10 §9.4`
- **目标**：将已有 provider 契约接到真实宿主写入；支持问卷、docx/markdown/web 导入的任务、进度、部分成功、重试、提交和回滚。
- **受影响源码**：
  - `src/providers/survey.js`
  - `src/providers/import.js`
  - `src/providers/ai.js`
  - `src/providers/embedded.js`
  - `src/providers/persistence.js`
  - `src/utils/importExport.js`
  - `src/components/lark-doc/ExportDialog.vue`
- **受影响测试**：
  - `test/unit/survey-provider.test.js`
  - `test/unit/import-provider.test.js`
  - `test/unit/ai-provider.test.js`
  - `test/unit/embedded-provider.test.js`
  - `test/unit/export-roundtrip.test.js`
- **验收命令**：`npm run test:unit -- test/unit/survey-provider.test.js test/unit/import-provider.test.js test/unit/ai-provider.test.js test/unit/export-roundtrip.test.js`
- **完成定义**：每个 provider 都有真实/模拟宿主写入、失败重试、幂等和刷新回读；第三方 token 不进入 editor/core。

## T10 · 完成回收站、复制/打印/水印/审计

- **优先级**：P2
- **状态**：BLOCKED（本地输出/回收站回归已有；真实宿主回读证据不足）
- **需求来源**：`requirements/05 §5.17`、`requirements/10 §9.4`、`requirements/15 §9.15`
- **目标**：补齐版本回收站 UI、复制/打印/下载/截图策略、水印和审计日志字段。
- **受影响源码**：
  - `src/core/versioning/`
  - `src/components/lark-doc/VersionPanel.vue`
  - `src/components/lark-doc/TopBar.vue`
  - `src/components/lark-doc/ExportDialog.vue`
  - `src/providers/security.js`
  - `src/utils/download.js`
  - `src/styles/print.css`
- **受影响测试**：
  - `test/unit/versioning-core.test.js`
  - `test/unit/versioning-ui.test.js`
  - `test/unit/security-provider.test.js`
  - 新增 `test/unit/output-policy.test.js`
- **验收命令**：`npm run test:unit -- test/unit/versioning-core.test.js test/unit/versioning-ui.test.js test/unit/security-provider.test.js test/unit/output-policy.test.js`
- **完成定义**：策略在 UI、命令、Provider 和导出路径一致；拒绝动作有可观察错误；水印不破坏打印和下载格式；审计事件字段稳定。

## T11 · 执行性能基线与存储/派生索引收口

- **优先级**：P2
- **状态**：DONE（T046–T048 基线与存储/索引契约已建立；当前性能退化归入 T13，T050 未完成）
- **T050 门禁收口**：2026-10-31 使用 Vitest 双 worker、独立缓存复核 `test/unit`，70 个文件 / 1681 项断言通过、0 failed（DOM 快照因 playwright-core 不可解析而 skip）；完整 lint、架构检查和 `git diff --check` 通过。`check:artifacts` 重试仍在 VersionPanel.vue 模板编译阶段因 Thread Loader broker timeout 失败；`verify:all` 仍受浏览器导航/目标超时阻塞。
- **需求来源**：`requirements/09 §2.4/§3.7/§5.9`
- **目标**：先测真实基线，再按预算决定实现 DerivedIndex、脏区更新、IndexedDB 分层和条件性虚拟化。
- **受影响源码**：
  - `src/core/derive/`
  - `src/core/storage/`
  - `src/components/lark-doc/extensions.js`
  - `src/components/lark-doc/workspace.js`
  - `scripts/perf/`
  - `scripts/check-architecture.js`
- **受影响测试**：
  - `test/unit/derived-index.test.js`
  - `test/unit/derived-hydration.test.js`
  - `test/unit/derived-snapshot.test.js`
  - `test/unit/perf-gate.test.js`
  - `test/unit/perf-preflight.test.js`
  - `test/unit/storage-idb.test.js`
- **验收命令**：`npm run check:perf`; `npm run test:unit -- test/unit/derived-index.test.js test/unit/perf-gate.test.js test/unit/storage-idb.test.js`; `npm run check:architecture`
- **完成定义**：基线包含首屏、击键帧、decorations、滚动 FPS、保存耗时、堆内存和包体；2,000 块预算可复现；优化前后有数据，未超标项不做无证据重构。

## T12 · 白板/画板范围决策与 webEmbed 骨架

- **优先级**：P3
- **状态**：DONE（T049 已明确 0.12 版本化延期，保留 webEmbed 边界）
- **需求来源**：`requirements/10 C1/C3/C4`、`requirements/09 §3.4`
- **目标**：明确 0.12 交付是骨架卡、webEmbed 参考实现还是显式延后；禁止在 core 内自研 Canvas。
- **受影响源码**：
  - `src/core/blocks/web-embed.js`
  - `src/core/embed/`
  - `src/core/nodeviews/web-embed.js`
  - `src/components/lark-doc/editor/dialogs/EmbedLinkDialog.vue`
  - `src/providers/embedded.js`
- **受影响测试**：
  - `test/unit/web-embed.test.js`
  - `test/unit/embed-bridge.test.js`
  - `test/unit/embed-presets.test.js`
  - `test/unit/network-policy.test.js`
- **验收命令**：`npm run test:unit -- test/unit/web-embed.test.js test/unit/embed-bridge.test.js test/unit/embed-presets.test.js test/unit/network-policy.test.js`
- **完成定义**：范围决策写入需求；若做骨架，空/加载/失败/超时四态可验；桥协议版本、origin、事件冒泡和降级卡均有测试。

## T13 · 全量门禁、浏览器矩阵和文档收口

- **优先级**：P3
- **状态**：DOING（代码门禁、完整产物门禁及全部包体预算已通过；性能仍有装饰增量/堆内存两项超过 20% 阈值；完整浏览器矩阵未收口，真实 Safari/移动端仍 BLOCKED）
- **最新验证（2026-10-31，本轮优先于下方历史记录）**：`check:gate` 97 文件 / 2138 用例通过；单元测试 94 文件 / 2110 用例通过；`check:artifacts` 完整重建与 Vditor 95 项通过。gzip：ESM 283.04kB/285kB、UMD 459.91kB/465kB、Element 474.17kB/480kB，CJS/协同也通过，预算未改。桌面 Element 浏览器 14/14 通过。正式 30 次击键采样：P95 166ms、P99 292.4ms；装饰增量 3.8ms、堆内存 18.1MB，原基线比较两项失败，基线未修改。修复 Editor 深观察和 CodeNode 循环深遍历；低频 UI 与 Markdown/Word 导出按需加载并覆盖首次挂载/关闭竞态。产物检查仍输出 jsdom SVG getBBox 与销毁后 view.dom 警告，检查虽通过，需后续消除。
- **需求来源**：本文件 §4、`requirements/09 §6/§11`、`requirements/15 §7`
- **目标**：汇总所有任务结果，更新需求状态，完成产物、适配器、浏览器、协同和文档一致性检查。
- **受影响文件**：
  - `spec.md`
  - `tasks.md`
  - `requirements/00-README.md`
  - `requirements/10-缺口与待补清单.md`
  - `requirements/15-闭环审计与端到端流程.md`
  - `.codebuddy/commands/`
  - `.specify/`
- **验收命令**：
  - `npm run check:gate`
  - `npm run check:artifacts`
  - `npm run verify:all`
  - `npm run build:adapters`
  - `npm run build:element`
  - `git diff --check`
- **完成定义**：任务状态与源码/测试一致；没有过期任务重新出现在当前清单；最终报告区分代码完成、规格完成、环境 BLOCKED 和明确 WONT。
- **2026-10-31 干净环境复核**：90 个单元测试文件 / 2028 项断言通过；lint、架构、部署、快速契约和 `git diff --check` 通过；适配器、Element、ESM、collab 产物构建成功。`check:artifacts` 的构建、离线资源和 Vditor 检查通过，但 `size-limit` 超限：ESM 289.67KB > 285KB、UMD 466.78KB > 465KB、Element 480.78KB > 480KB。`verify:all` 仍受浏览器页面导航/DOM 空节点和进程 SIGTERM 阻塞；`check:perf` 因浏览器残留进程造成高负载阻塞，未伪报通过。该结果不改变 T032/T13 的 BLOCKED 性质。

## WONT 记录

### T14：顶部固定格式工具栏

`requirements/10 A13` 已通过实测确认 `.bear-web-toolbar` 不存在。格式入口由选区气泡条和块工具条承载，不实现独立顶部格式工具栏。

### T15：自定义右键菜单

`requirements/10 A19` 已通过文本、代码、图片三类目标的 `contextmenu` 事件确认浏览器原生菜单未被阻止。不实现自定义右键菜单。

### T16：折叠块 slash 项和兄弟产品线

飞书 slash 菜单没有独立折叠块；Sheet、Slides、Wiki 和表格函数等兄弟产品线不属于当前 lark-doc 0.12 范围。若用户重新要求，必须先改 `spec.md` 的范围和验收口径。
