---

description: "Sequential implementation tasks for Feishu Docs document parity"
---

# Tasks: Feishu Docs document parity

**Input**: Design documents from `/specs/002-feishu-doc-parity/`

**Prerequisites**: `spec.md`, `research.md`, `plan.md`, `data-model.md`, `contracts/parity-evidence.md`

**Execution rule**: complete tasks in numeric order. A task is complete only when its focused verification passes and the parity evidence/status is updated. Parallel markers identify read-only or independent work only; the primary implementation order remains sequential.

## 当前交付检查点 — 2026-11-06

以下为 master 0.14.5 合并和移动端修复后的最新结果；下方任务原有路径及数值保留为历史记录，不应将旧 Vue 文件路径或旧轮次的 final 当作当前验收。

- 代码已推送 dev：合并 `6117851`，窄屏版本面板修复及验收脚本适配 `55a3ca8`；Rollup/原生 DOM 为主，未放宽预算。
- T004：默认不显示工具栏，显式 `toolbarVisible` 优先、否则兼容 `toolbarFixed`；375px 显式展开、更多菜单完整性及滚动可达通过。
- T017/T022：版本面板窄屏 CSS 优先级已修复并增加 7 项回归断言；Chromium 手机/平板 12/12、工具栏 53/53、通知窄屏专项 36/36 通过，源码产物匹配通过。模拟不代表真机或实际账号。
- T025：seed42/2000 块/30 次击键，首屏392.9ms、P95/P99 270.1/279.4ms、装饰2ms、60.3FPS、序列化代理3.6ms、heap15.8MiB；20增量/0全量回退。相对10月30日基线，原20%门禁全通过，未改基线；采样环境存在其他headless进程，细节见 research。
- T026：最终全量122文件2703单测通过；架构、46块契约、lint通过；27/27产物就绪及五类体积预算通过，Element 473106/475000 B gzip。没有声称本轮重新执行全部历史浏览器矩阵或协同集成测试。
- T027：最新证据见 `research.md` 的2026-11-06记录及 `docs/guide/performance.md`。
- T012/T015/T018 **保持 PARTIAL**：Safari最小会话创建15秒超时（驱动ready不等于通过）；移动真机、真实跨账号刷新回读及真实通知送达未验收。

## Phase 1: Setup and baseline

- [X] T001 Install the locked dependencies in the isolated worktree with `npm ci`; run `npm run check:quick`, focused unit suites for `block-api`, `comments-core`, `versioning-core`, and `interaction-mode`; record the first failure and environment versions in `specs/002-feishu-doc-parity/research.md`.
- [X] T002 [P] Build the initial parity evidence index in `specs/002-feishu-doc-parity/contracts/parity-evidence.md` from the official URLs, live test-document observation and current source/test paths; mark each row `partial` until verified.
- [X] T003 [P] Add a focused parity smoke fixture under `test/unit/feishu-parity-smoke.test.js` that asserts the canonical mode labels, official slash aliases and the default contextual-toolbar policy without importing Vue SFCs.

## Phase 2: Foundational authoring contracts

- [X] T004 Change the parity-default toolbar policy in `src/components/lark-doc/LarkDocEditor.vue`, `src/components/lark-doc/larkDocConfig.js` and `src/components/lark-doc/lark-doc.css` so a fixed top formatting toolbar is absent by default while an explicit compatibility opt-in remains possible; update `test/unit/feishu-parity-smoke.test.js` and relevant docs.
- [X] T005 Unify `/`, `+`, bubble and block-handle command sources and alias filtering in `src/components/lark-doc/editor/commandMenuMixin.js`, `src/components/lark-doc/editor/toolbarMenusMixin.js`, `src/components/lark-doc/editor/blockMenuMixin.js`, `src/components/lark-doc/CommandMenu.vue` and `src/core/commands/`; add focused alias/permission tests.
- [X] T006 Complete the shared structural contract in `src/core/blockApi/index.js`, `src/core/blockApi/nodes.js`, `src/core/blockApi/tree.js`, `src/core/blocks/block-id.js` and `src/session/DocumentSession.js`; cover insert/update/remove/move/duplicate/transform/get/children/batch, invalid containers and blockId regeneration in `test/unit/block-api.test.js`, `test/unit/insert-atomicity.test.js` and `test/unit/heading-container.test.js`.
- [X] T007 Implement the documented local undo/redo grouping and collaboration origin rules in `src/components/lark-doc/extensions.js`, `src/components/lark-doc/editor/shortcutGroups.js`, `src/core/transactionMetadata.js`, `src/collab/index.js` and `src/collab/policies.js`; extend `test/unit/versioning-core.test.js`, `test/unit/revision.test.js`, `test/unit/collab-editor.test.js` and `test/collab/converge.test.js`.
- [X] T008 Implement block clipboard and multi-block selection semantics in `src/core/blocks/document-commands.js`, `src/core/blocks/document-helpers.js`, `src/core/blocks/image-paste.js`, `src/components/lark-doc/editor/selectionPacingMixin.js`, `src/components/lark-doc/editor/blockHandleMixin.js` and `src/utils/importExport.js`; add `test/unit/block-clipboard.test.js` plus focused external HTML/Markdown and image-paste cases.

## Phase 3: User Story 1 — contextual authoring (P1) 🎯 MVP

**Independent test**: an empty editable document can be authored entirely through `/`, `+`, selection bubble and block handle, without a fixed toolbar.

- [X] T009 [P] [US1] Add focused tests for heading/list/task/quote/code/callout/table/image/file/link/color/alignment/indent journeys in `test/unit/feishu-parity-authoring.test.js` using the existing pure command/core helpers.
- [X] T010 [US1] Align heading, outline and nested-container behavior in `src/core/blocks/heading.js`, `src/core/blocks/container-depth.js`, `src/components/lark-doc/editor/headingNumberMixin.js`, `src/components/lark-doc/editor/blockIndentMixin.js`, `src/components/lark-doc/editor/foldPersistMixin.js` and `src/components/lark-doc/editor/OutlinePanel.vue`; run `test/unit/heading-container.test.js`, `test/unit/container-depth.test.js`, `test/unit/derived-index.test.js`.
- [X] T011 [US1] Close the supported official content-block matrix in `src/core/blocks/`, `src/core/commands/`, `src/components/lark-doc/editor/dialogs/` and `src/core/embed/`; every unsupported official row must render a deterministic fallback and update `research.md` with `verified` or `out-of-scope`.
- [ ] T012 [US1] **PARTIAL** Verify slash alias search (including removal of the query), `+`, bubble formatting, block drag/duplicate/delete, outline navigation and fixed-toolbar absence in the default configuration before/after scrolling. Chromium default authoring passes locally; actual Safari CUA passes fixed-toolbar absence, slash h2/query removal, selection bubble bold, the plus menu, outline navigation, native block-content deletion with reload persistence, and native copy/paste duplication with reload persistence on the disposable document. True six-dot drag and matched Safari geometry remain unverified because WebDriver session creation times out and both Safari coordinate drag attempts return `noWindowsAvailable`.

## Phase 4: User Story 2 — collaboration and governance (P1)

**Independent test**: edit/suggest/read, mention, comment, share/permission and history journeys work with capability-aware fallbacks.

- [X] T013 [P] [US2] Add focused capability/mode tests for `src/components/lark-doc/editor/docModes.js`, `src/components/lark-doc/editor/viewModesMixin.js`, `src/components/lark-doc/editor/revisionMixin.js` and `src/providers/authorization.js` in `test/unit/interaction-mode.test.js` and a new `test/unit/capability-projection.test.js`.
- [X] T014 [US2] Close @ user/group/document reference behavior in `src/core/mention/`, `src/core/blocks/mention.js`, `src/components/lark-doc/editor/mentionMixin.js`, `src/components/lark-doc/editor/MentionPanel.vue` and `src/providers/comments.js`; verify notification/permission outcomes in `test/unit/mention.test.js` and focused provider tests.
- [ ] T015 [US2] **PARTIAL** Close inline/full comments, replies, resolve/delete/edit/translate/follow/link behavior in `src/core/comments/`, `src/components/lark-doc/CommentPanel.vue`, `src/components/lark-doc/editor/commentsMixin.js` and `src/providers/comments.js`. Provider-backed edit/delete/private/reaction/translation/report/quote paths, comment-link restoration, local UI recovery and the notifications Provider boundary pass (88 focused assertions; 23 Chromium comment checks). The parity default now has a document-scope Provider path and footer composer. Before the later history restore, live Feishu showed an anchored comment, a full-document comment labeled `全文评论`, a reply that survived reload, an edited reply with `编辑过`, native translation output, reaction toggle readback, and native delete persistence after reload; `复制链接` returned a stable `comment_id` URL that reopened the thread. Follow persistence/cancellation and native resolve are also observed. Safari personal identity read the restored disposable document while it was temporarily internet-editable, and the user manually submitted the full-document comment `cross-account push probe 20261101`; Chrome read it in the existing tab without reload. The later Safari reload read back the same comment set under a page whose identity was not labeled personal, so it remains current-account evidence only. Notification delivery, report/quote/private persistence and a clean post-reload cross-account readback remain open; Provider wiring is not live Feishu evidence.
- [X] T016 [US2] Close share and permission projections in `src/components/lark-doc/SharePopover.vue`, `src/components/lark-doc/PermissionDialog.vue`, `src/components/lark-doc/editor/shareMixin.js`, `src/providers/authorization.js` and `src/providers/security.js`; cover restricted reader/editor/manager paths in `test/unit/share-ui.test.js`, `test/unit/security-provider.test.js` and injected second-account fixtures.
- [X] T017 [US2] Close document history/diff/restore and saved-version entry points in `src/core/versioning/`, `src/components/lark-doc/VersionPanel.vue`, `src/components/lark-doc/SaveVersionDialog.vue`, `src/components/lark-doc/editor/versioningMixin.js` and `src/providers/versioning.js`; run `test/unit/versioning-core.test.js`, `test/unit/versioning-ui.test.js` and the browser history journey.
- [ ] T018 [US2] **PARTIAL** Verify modes/comments/mentions/share/history in Chromium and actual Safari. Disposable document `Codex-Parity-20261031-Sequential` is confirmed at `https://iz4fkcxtig.feishu.cn/wiki/M4MywYrAHi1juHkT1k3c3M75nhU`; live Chrome readback shows `编辑/修订/阅读`, one anchored comment, the full-document comment entry, an organization-only share panel with `可阅读/可编辑` choices, and a real history panel whose selected version showed a one-item diff. The scoped Safari personal replay temporarily opened only the current page to `互联网获得链接的人可编辑`; Safari changed from `没有权限访问` to editable, wrote a marker that Chrome read after refresh, and returned to `没有权限访问` after restoration to `北京八人科技有限公司` / `组织内获得链接的人可阅读`. A second disposable page (`https://iz4fkcxtig.feishu.cn/wiki/Aa4kwcx5FiBG6ck6YNDcrL07nVn`) proved read-only cross-account comment visibility while temporarily shared, then was restored to `link_share_entity=2`, Safari refreshed to `没有权限访问`, and the page was moved to recoverable trash. History restore was executed on the disposable document for `10月31日 13:42`; refresh readback showed the restored `/h2` body. The latest Safari reload of the main disposable page read back `/h2` and all visible comments, and its live share panel showed `北京八人科技有限公司` / `组织内获得链接的人可阅读` / `可阅读`; the page identity was not labeled personal, so this does not close clean cross-account readback. The notifications Provider contract and optional subscription are covered locally; cross-account comment mutation is now observed in the existing Chrome tab, while Feishu notification delivery and clean post-reload cross-account readback still need real-service evidence. Record Provider fixtures separately.

## Phase 5: User Story 3 — document lifecycle (P2)

**Independent test**: a disposable document can be covered, outlined, persisted, imported/exported and recovered from supported failures.

- [X] T019 [P] [US3] Add lifecycle tests for cover/title/author/time/outline in `test/unit/cover-ui.test.js`, `test/unit/heading-container.test.js` and the relevant `src/components/lark-doc/editor/CoverSlot.vue`, `CoverPanel.vue`, `OutlinePanel.vue` paths.
- [X] T020 [US3] Close persistence, import and export contracts in `src/providers/persistence.js`, `src/providers/import.js`, `src/core/storage/idb.js`, `src/utils/importExport.js`, `src/utils/export/`, `src/components/lark-doc/ExportDialog.vue` and `src/components/lark-doc/LarkDocWorkspace.vue`; run focused `export-roundtrip`, `storage-idb`, `import-provider` and provider tests.
- [X] T021 [US3] Normalize async loading/empty/failure/no-permission/over-limit states in `src/core/blocks/shared.js`, `src/core/blocks/unknown-block.js`, media/embed blocks, `src/providers/security.js` and overlay components; add `test/unit/async-state-matrix.test.js` and update the parity matrix.
- [X] T022 [US3] Verify 390×844 touch-emulated contextual entry points, offline editing, reload readback and route/provider teardown using isolated local state. The verifier records touch emulation explicitly; local persistence and teardown pass. This is emulation evidence and does not claim physical iOS Safari.

## Phase 6: User Story 4 — integration boundaries (P3)

**Independent test**: provider/embed references render stable states and emit host actions without implementing sibling-product pages.

- [X] T023 [P] [US4] Add provider/embed contract cases for loading/success/failure/no-permission/unknown-reference in `src/core/embed/`, `src/providers/embedded.js`, `src/providers/reference.js`, `src/core/blocks/web-embed.js`, `card-embed.js` and `unknown-block.js`; run `test/unit/embed-bridge.test.js`, `test/unit/embedded-provider.test.js`, `test/unit/unknown-block.test.js`.
- [X] T024 [US4] Audit Bitable/Sheets/Slides/Wiki and third-party references in `src/core/blocks/bitable.js`, `sheet.js`, embed presets and provider registries; update `research.md`, `spec.md` and `contracts/parity-evidence.md` with explicit `out-of-scope`/contract-only decisions and remove any accidental sibling-page UI claims.

## Phase 7: Polish and final verification

- [X] T025 Run the performance/storage gates relevant to the changed paths with the existing P0-10 baseline. The final `npm run check:perf` 2,000-block run passed all seven regression checks: mount 1,106.8 ms, keystroke P95/P99 638.6/1,717 ms, decoration incremental 69 ms, scroll 59.7 FPS, save 21 ms, heap 95.6 MB. Every metric stayed within the 20% regression threshold.
- [X] T026 Run the repository/artifact gates, focused unit/collab tests and browser matrix against the final source. `npm run check:gate` passed (90 files / 2,043 tests), `npm run check:artifacts` passed (Vditor 95/95 and 7/7 artifacts within size budgets), focused comment suites passed 83/83, and `npm run verify:all` returned code 0 for all 13 targets; the parity target reports 23/23 local checks. Evidence remains labeled local/contract where it cannot prove real Feishu behavior.
- [X] T027 Reconcile `spec.md`, `plan.md`, `tasks.md`, `quickstart.md`, `contracts/parity-evidence.md` and `_codex/sessions/feishu-parity-20261031.md` after final verification. The documents distinguish implementation/contract verification, local browser regression, live read-only observation and unresolved real-Safari/cross-account gaps; the original worktree's existing edits remain preserved.

## Dependencies & Execution Order

- T001–T003 are setup/evidence tasks.
- T004–T008 are blocking foundations and must complete before user stories.
- T009–T012 are the P1 MVP authoring slice.
- T013–T018 depend on T006–T008 and close governance/collaboration.
- T019–T022 depend on the provider/capability contracts from the earlier phases.
- T023–T024 are the explicit sibling-product boundary.
- T025–T027 are final gates and documentation/handoff.

## Parallel Opportunities

- T002/T003 can run in parallel after T001’s environment check.
- T009 and T013 are read/test preparation tasks that can be drafted independently, but implementation remains sequential.
- T019 and T023 touch disjoint test/provider surfaces and can be prepared in parallel after Phase 4.

## MVP Scope

MVP is T001–T012: a verified Feishu-style contextual authoring loop with the fixed toolbar removed from the parity default, shared structural operations, history/clipboard foundations and browser evidence.

Continuation audit (2026-11-02): no new live Feishu evidence was obtained because the text-turn browser channel exposed neither a usable Chrome CDP endpoint nor Safari CUA. T012, T015 and T018 remain PARTIAL.
