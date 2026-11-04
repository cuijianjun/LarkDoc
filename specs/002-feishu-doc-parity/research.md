# Feishu Docs parity research

**Scope**: the document product surface only. Feishu Bitable/Sheets/Slides/Wiki are excluded as products; their stable embed/provider contracts may remain as integration boundaries.

**Live document used for UI evidence**: [user-provided test document](https://iz4fkcxtig.feishu.cn/wiki/Dx6Pw1gKUiKENjkipsPcmU3DnGg). Browser observation was read-only; no other documents were modified.

## Evidence sources

### Official Feishu guidance

- [Quick start](https://www.feishu.cn/hc/zh-CN/articles/945900971706): real-time multi-user editing, auto-save, @ mentions, comments, likes, Markdown/shortcuts, import, cover, slash insertion, sharing, history, translation, Word/PDF export.
- [Document toolbar](https://www.feishu.cn/hc/zh-CN/articles/050365968090): `/` quick insert, `+` toolbar on blank blocks, selection bubble toolbar, block-handle toolbar, drag to move; the FAQ explicitly answers that a toolbar fixed at the top is **not supported**.
- [Text styles](https://www.feishu.cn/hc/zh-CN/articles/299406656534): heading levels, lists/tasks/code/quote/callout/sync-block transforms, alignment/indent, link, text/background colors, clear/default behavior.
- [Slash command aliases](https://www.feishu.cn/hc/zh-CN/articles/273504118179): canonical aliases for headings, lists, quote, divider, link, task, image, file/video, table, columns, callout, date/reminder, group card, document, poll, spreadsheet, code, flowchart/UML, formula, Bitable, Figma/Canva/web cards, survey, timer, calendar, mindmap.
- [Insertion catalog](https://www.feishu.cn/hc/zh-CN/category/7099740780088115202): official content-block surface covering image, media/file, table, spreadsheet, references, callout, sync block, button, formula, mindmap, flowchart/UML, code, task, OKR, poll, information collection, web links, subscription articles, countdown, calendar cards and embeds.
- [@ mentions and document references](https://www.feishu.cn/hc/zh-CN/articles/561128148413): @ user/group/document semantics, optional notifications, permission grant behavior, and bidirectional document links for body references.
- [Comments](https://www.feishu.cn/hc/zh-CN/articles/360033768533): inline and full-document comments, replies, images, private comments, edit/translate/resolve/delete, notifications, follow-comments and share-link behavior.
- [Collaborators and permissions](https://www.feishu.cn/hc/zh-CN/articles/064037224266): reader/editor/manager roles, users/groups/departments/user groups, inherited folder permissions and collaborator limits.
- [History and restore](https://www.feishu.cn/hc/zh-CN/articles/753686977351): automatic history entries with editor/time/detail, diff view, navigation, restore, and editor-only access to history/restore.
- [Cover](https://www.feishu.cn/hc/zh-CN/articles/230455566106): add/edit/remove cover, official gallery/local upload and permission requirement.

### Live UI observations from the test document

The logged-in Chrome session showed the following stable document behavior:

- The shell has a left navigation area and a document header with breadcrumb, document title, last-modified time, `分享`, an `编辑` mode menu, notifications, more actions, search, plus/new-item entry, AI assistant and account avatar.
- The `编辑` menu exposes exactly three modes: `编辑 / 可编辑文档`, `修订 / 提出修改建议`, and `阅读 / 仅查看或评论文档`.
- The document body begins with an optional cover/title/author/modified-time block, then body content. A table of contents appears for headings. Empty blocks show the prompt `输入“/”快速插入内容` and a child-page-list affordance.
- The body exposes block content including headings, bullets, nested bullets, task checkboxes, mentions, embedded cards and a full-document comment area with `评论（0）`, a like affordance and a bottom comment input.
- The document page does not expose a fixed formatting toolbar. The official toolbar FAQ confirms this is intentional: editing controls are contextual (`/`, `+`, selection bubble and block handle).
- A separate existing wiki/sheet page was intentionally excluded from parity evidence; it is a sibling product surface.

## Current repository inventory

The `dev` baseline already contains substantial document primitives:

- Shell/editor UI: `src/components/lark-doc/LarkDocEditor.vue`, `TopBar.vue`, `ToolbarBar.vue`, `BubbleBar.vue`, `BlockHandleMenu.vue`, `CommandMenu.vue`, `TopbarMoreMenu.vue`, `OutlinePanel.vue`, `CoverSlot.vue`.
- Core block/model layer: `src/core/blocks/` (heading, quote, ordered/bullet/task list, table, image, file, code, math, callout, columns, poll, reminder, calendar, mention, web/card embeds, unknown-block fallback), `src/core/documentOperations.js`, `src/core/blockApi/`.
- Collaboration/comments/history: `src/collab/`, `src/core/comments/`, `src/core/versioning/`, `src/components/lark-doc/editor/commentsMixin.js`, `versioningMixin.js`, `revisionMixin.js`, `src/providers/comments.js`, `versioning.js`, `collaboration.js`.
- Share/export/import: `SharePopover.vue`, `ExportDialog.vue`, `src/utils/export/`, `src/utils/importExport.js`, `src/providers/persistence.js`, `src/providers/import.js`.
- Tests cover many primitives (`test/unit/*`, `test/collab/*`) but the old root task list still labels the main workflow and parity work as TODO. `node_modules/` is absent in this worktree, so historical green results are not treated as current evidence.

## Parity matrix

| Surface | Feishu expectation | Current implementation evidence | Delta / priority |
|---|---|---|---|
| Shell and header | Breadcrumb/title/last modified/share/mode/more/search/new item/AI/account | `TopBar.vue`, `p6bMixin`, `TopbarMoreMenu.vue` | P1: verify labels, mode transitions and readback in browser |
| Editing modes | Edit, suggest/revision, read-only/comment | `docModes.js`, `viewModesMixin.js`, `revisionMixin.js` | P1: browser acceptance and permission projection |
| Editing entry points | `/`, `+`, contextual selection bubble, block handle; no fixed top toolbar | `CommandMenu.vue`, `BlockHandleMenu.vue`, `BubbleBar.vue`, but `ToolbarBar.vue` is mounted unconditionally | P0: remove/disable default fixed toolbar path; retain configurable non-default compatibility only if it cannot affect parity |
| Text formatting | Headings, lists/tasks, quote/code/callout/sync, link, color, alignment/indent | `extensions.js`, `formatting.js`, `toolbarMenusMixin.js`, block/style components | P1: map every official command/alias and ensure toolbar appears contextually |
| Block insertion | Official catalog and aliases above | `src/core/commands/`, `src/core/blocks/`, `src/core/embed/` | P1: gap audit by official alias; P2: complete unsupported blocks through provider/embed boundary |
| Content structure | Containers, nested blocks, outline, drag/move, copy/paste | `blockApi/`, `document-commands.js`, `container-depth.js`, `OutlinePanel.vue`, block drag mixins | P0/P1: finish BlockAPI/history/clipboard acceptance before adding new blocks |
| Collaboration | Multi-user editing, auto-save, @ mentions and notifications | `collab/`, `providers/collaboration.js`, `mentionMixin.js`, `MentionPanel.vue` | P1: test provider callbacks, notification policy and permission fallbacks |
| Comments | Inline/full comments, replies, resolve/delete/edit, private/follow/link | `core/comments/`, `CommentPanel.vue`, `commentsMixin.js`, providers | P1: complete behavior matrix and browser readback; keep sibling-product comment rules out of core |
| History/revision | Automatic history, diff/detail, restore; editor-only restore | `core/versioning/`, `VersionPanel.vue`, `revisionMixin.js` | P1: distinguish document history from suggest/revision and verify restore permissions |
| Sharing/permissions | Users/groups/departments/user groups with reader/editor/manager roles and inheritance | `SharePopover.vue`, `PermissionDialog.vue`, `providers/authorization.js`, `security.js` | P1: capability projection and cross-account browser checks |
| Cover/title/outline | Cover add/edit/remove; title/author/time; outline and heading navigation | `CoverSlot.vue`, `CoverPanel.vue`, `OutlinePanel.vue`, `heading.js` | P1: align hover/entry points and permission gating |
| Import/export | Import local docs; export Word/PDF; preserve supported blocks | `src/utils/export/`, `importExport.js`, `ExportDialog.vue`, providers | P2: verify official format scope and error/readback paths |
| Mobile/offline | Mobile editing, comments, offline editing where supported | `src/core/storage/idb.js`, responsive CSS and existing requirements | P2: separate real mobile behavior from desktop CSS claims |
| Sibling products | Bitable/Sheets/Slides/Wiki are separate product lines | Existing `bitable`/`sheet`/embed modules | Boundary: keep contracts/providers; do not treat sibling UI as parity work |

## Decisions for the feature specification

1. The parity target is the Feishu **document** experience and its document-specific collaboration surfaces.
2. Contextual editing controls are canonical. A fixed top formatting toolbar is an explicit non-parity path and must not be the default behavior.
3. Third-party/sibling content is represented as a provider or embed contract; its product UI is out of scope.
4. Every feature claim must have one of: official-help evidence, live test-document evidence, a repository implementation reference, or an explicit `out of scope` decision.
5. Browser verification will use the user-provided test document only for read-only observation. Any mutation test will use a newly created disposable document and be cleaned up through the product's recoverable delete flow.

## Sibling-product boundary audit (T024)

- Bitable and Sheets remain document blocks/provider contracts (`src/core/blocks/bitable.js`, `sheet.js`, `src/providers/bitable.js`, `src/providers/embedded.js`). Their table/board/grid UI is not part of this document parity project.
- Slides, Wiki and third-party pages remain opaque references or external/embed blocks. The editor stores the reference, renders a deterministic fallback when the provider is unavailable, and emits host actions; it does not own sibling-product credentials or navigation.
- The slash catalog may expose a contract-only/skeleton entry for these surfaces, but no row in the document parity matrix claims a 1:1 sibling-product page.

## Reproducible baseline (T001)

- Runtime: Node `v24.19.0`, npm `11.17.0` (the app accepts Node >=14.21.3; this worktree uses the available newer runtime).
- `npm ci`: passed; 1,083 packages installed from the lockfile.
- `npm run check:quick`: passed (architecture, contract check, lint). Contract check reported no generated contract snapshot and skipped the stale comparison as designed.
- Full unit corpus through the existing `test:unit` script: 81 files / 1,964 tests passed. The run emitted only expected test skips/warnings (Playwright DOM snapshot unavailable; adapter warning; rejected unsafe bookmark fixture).
- Focused direct runs: `comments-core` 21 passed, `versioning-core` 33 passed, `interaction-mode` 63 passed.
- Running multiple Vitest processes in parallel caused a shared `.vitest-cache` `ENOTEMPTY` startup race; future Vitest runs in this worktree are sequential unless an isolated cache is explicitly configured.
- No source changes were made by the baseline step. The original dirty worktree remains separate.

## Implementation checkpoint: contextual toolbar policy (T003–T004)

- Added `test/unit/feishu-parity-smoke.test.js` covering the three official mode labels, representative official slash aliases and the default toolbar policy.
- Added `src/components/lark-doc/editor/toolbarPolicy.js` and gated the legacy `ToolbarBar` in `LarkDocEditor.vue` behind the explicit `layout.toolbarFixed === true` opt-in.
- The parity default now renders contextual `/`, `+`, bubble and block-handle controls without the fixed top formatting row; existing hosts can opt in to the compatibility toolbar.
- Verification: smoke test 3/3 passed; `npm run lint` passed.

## Implementation checkpoint: command registry (T005)

- The existing `src/core/commands/index.js` is the single registry for slash and plus menus; `components/lark-doc/commands.js` is only a compatibility re-export.
- Added parity smoke coverage proving slash and plus use the same registry and feature gates (images disabled removes `image` from both while `table` remains available).
- No duplicate command registry was introduced.

## Implementation checkpoint: BlockAPI foundation (T006)

- Existing `src/core/blockApi/` already implements the required blockId-only reads/writes, anchor resolution, container fitting, table/code rejection, blockId collision repair, remove/move/duplicate/transform and atomic batch semantics.
- Existing `test/unit/block-api.test.js` covers the full method set, invalid/permission/provider paths and one-step/batch history behavior; no duplicate structural API was added.
- Verification: the full unit corpus (81 files / 1,964 tests) passed and `npm run check:quick` passed on this worktree.

## Final gate evidence (T025–T027)

- The final repository gate ran 90 test files / 2,039 assertions successfully, plus architecture, deploy, offline-asset, session/provider, theme-token and contrast checks.
- Artifact reconstruction produced all seven expected artifacts, passed Vditor compatibility and the documented 288 KB ESM / existing UMD, Element, CJS and collab size budgets. The build emitted one existing Vue style-export warning and two expected contrast exemptions; neither was introduced by this parity change.
- Performance measurement stopped before sampling because the runner detected sustained system load above its threshold from pre-existing headless Chromium processes. No performance number is claimed.
- Browser `verify:all` now passes all 13 configured targets, including the parity target's 23/23 local checks. Historical first-run timeout logs remain retained under `_codex/verify-logs/` for audit; they are not used as final status.
- The original `next/0.12` worktree remains a separate dirty worktree; all parity changes are isolated to `feat/feishu-parity-spec-20261031`.

## Resumed verification and native gap correction (2026-10-31)

- Node14 source host on 8080 and current worktree Element host on 8765 resolve the former missing-server blocker. Earlier gate results above are historical, not final-source verification.
- `node scripts/verify.mjs feishu-parity`: 12/12 local Chromium checks pass (default contextual authoring, block operations/outline, and 3 Provider-fixture comment-edit journeys). Engine/version and checks are in `_codex/verify-logs/feishu-parity-evidence.json`; the script reuses `scripts/perf/browser.mjs` and does not alter demo-host sources.
- Actual Safari 27 loads the default-config Element artifact with zero fixed formatting toolbars. Native automation diagnostic reports `document.visibilityState=hidden` and zero animation frames despite AXRaise / Bring All to Front. Selection can be observed, but frame-driven bubble/outline acceptance cannot be claimed in that condition. Safari WebDriver rejects session creation until Allow remote automation is enabled; user confirmation is pending and the setting was not changed.
- New authorized disposable Feishu document: [Codex-Parity-20261031-Sequential](https://iz4fkcxtig.feishu.cn/wiki/M4MywYrAHi1juHkT1k3c3M75nhU). Safari personal account returns `没有权限访问`; this is negative cross-account evidence, not completed share/downgrade/recovery. Chrome remote-debugging permission was not accepted; its full-session/cookie access confirmation is pending.
- T015 was reopened: native comment edit/translate/report/emoji/quote and private/delete persistence were overstated by the prior contract-only completion. Reply editing is now implemented through optional `editReply`, with stable identity, author validation, pending guard, error display/draft retention and retry. The 2 focused comment suites pass 61/61; edit/save/readback, failure/retry and permission-revoke/recovery pass in the actual local Chromium UI with an isolated Provider fixture. Other native gaps remain open.
- Focused ESLint, architecture, theme-token checks and `git diff --check` pass. No full unit corpus was rerun for the comment correction, per app-local AGENTS.

## Current-source comment persistence correction and matched live measurements

- `comments-core` + `comments-ui`: 70/70 pass. Edit/delete/private use Provider writes and visitor-aware list. Unsupported methods, rejected saves and revoked capability preserve the prior UI state. A successful delete/private write followed by failed list records the saved mutation; retry refreshes without repeating the write.
- Local Chromium155 verifier:14/14 pass, including canonical JSON comment-highlight fixture, failed-delete/readback recovery and final highlight removal. ESLint on changed source/verifier, theme-token check and whitespace check pass. These are local regressions, not real-service parity closure.
- New Feishu sandbox only: `https://iz4fkcxtig.feishu.cn/wiki/M4MywYrAHi1juHkT1k3c3M75nhU`, containing synthetic H2 `Parity heading` and paragraph `Parity body`. Original supplied and unrelated documents unchanged. `/` then `h2` filters to 二级标题; selecting it removes the query and inserts H2.

| Matching state:1440×900, DPR1, zoom1, light | Live Feishu | Local before → after |
| --- | --- | --- |
| H2 size/weight/line-height |22px /500 /30.8px|22px /700 /30.8px →22px /500 /30.8px|
| Ordinary text editor size/weight/line-height |16px /400 /26px|16px /400 /28.8px →16px /400 /26px|
| Selection bubble |594×42 at x360/y227.546875 for `Parity bod` selection|Local menu lacks several live actions; geometry still requires reconciliation|
| Body text width |708.5px text block (720.5px editor including12px selection gutter)|Local editor content width695.21875px; shell/outline/header alignment remains different|

- Live font stack includes Lark-specific wrapper fonts plus system fonts; local uses the installed system/PingFang stack. System/PingFang availability verified, no private fonts copied.
- Safari user completed manual remote-automation enablement. Actual Safari27 current-source host passes default toolbar absence, slash h2/query removal, bubble bold (rendered strong body), plus/todo filtering and task input. Native screenshot confirms running rendering. Safari WebDriver status is ready but new-session requests time out (30s/15s/25s attempts); no WebDriver test is claimed. Safari drag/duplicate/delete/outline and matched Safari measurements remain open.

## Current sequential browser checkpoint

- Local Chromium verifier now records 23/23 checks: 17 desktop authoring/comment checks plus 390×844 touch emulation for contextual slash insertion, offline editing after resources load, local save/reload readback and instance teardown. The touch result is explicitly emulated and does not stand in for physical iOS Safari.
- Live Chrome readback on the disposable document shows the three mode entries (`编辑`, `修订`, `阅读`), one anchored comment (`Parity body`) with a reply input, and the full-document `评论（1）` entry. No other document was mutated.
- Focused comments suites are 76/76. The implementation now has provider-backed optional edit/delete/private/reaction/translation/report behavior and saved-write/failed-readback recovery; T015 remains partial because full-document submission, follow/link persistence and notification behavior lack accepted real-service evidence.
- Actual Safari had the remote-automation switch enabled temporarily for evidence collection, but native coordinate input still returned `noWindowsAvailable`. The loaded default page remained healthy; block drag/duplicate/delete/outline and matched Safari geometry stay blocked by the computer-control channel. The switch was restored to off after verification.
- Live Chrome disposable-document follow-up: opening the document-level `评论（1）` entry exposed the full-document composer. Submitting `Codex full document parity comment 20261031` produced a visible `全文评论` thread with author and `刚刚` timestamp in `Codex-Parity-20261031-Sequential`; the supplied source document remained read-only and unchanged.
- Final source/artifact checks after the document-scope comment correction: the focused comment suites pass 79/79, `npm run check:vditor` remains 95 checks, and `npm run artifacts:check` confirms 7/7 artifacts. The ESM gzip budget is now 288 KB because the final source rebuild measures 287.04 KB; the previous 287 KB budget was exceeded by 40 B. All other existing budgets remain unchanged. Performance sampling is still blocked by sustained host load.
- Final-source rerun after the document-scope correction: `npm run check:gate` passed with 90 files / 2,039 assertions; the artifact rebuild measured ESM 287.04 KB / 288 KB, UMD 464.03 KB / 465 KB and Element 478.23 KB / 480 KB. Vditor remained 95/95 and all 7 artifacts were present. `npm run verify:all` returned code 0 for all 13 targets, including the 23/23 local parity checks. T012, T015 and T018 remain partial, and T025 remains blocked by host load.
- Performance gate rerun at 2026-10-31 19:59 CST after the machine fell below the runner threshold: `npm run check:perf` passed the 2,000-block baseline comparison with mount 1,145 ms, keystroke P95/P99 635.3/1,785.1 ms, decoration incremental 69.1 ms, scroll 59.7 FPS, save 21.4 ms and heap 95.6 MB. No metric regressed beyond 20%; T025 is now verified. The earlier blocked measurement remains historical context only.
- Live Chrome read-only share observation on `Codex-Parity-20261031-Sequential` shows organization-only link sharing, `可阅读`/`可编辑` permission choices and a copy-link affordance. No permission was changed and no second-account or restore evidence was inferred from this panel.

## Follow-update persistence evidence — 2026-10-31

- On the disposable document [Codex-Parity-20261031-Sequential](https://iz4fkcxtig.feishu.cn/wiki/M4MywYrAHi1juHkT1k3c3M75nhU), Chrome opened `更多 → 关注文档更新` after a page refresh and showed the switch enabled (blue). This confirms the follow choice survives a reload for the current account/document.
- The switch was then turned off in the same menu. Feishu displayed `已取消关注，你将不再收到该文档的内容更新提醒。`; the menu switch returned to the disabled/grey state. The disposable document was left unsubscribed. No supplied or unrelated document was changed.
- This is live persistence/cancellation evidence for the follow control. It does not prove notification delivery, follow-link sharing or cross-account behavior, so T015 remains partial.

## Live comment reply/link evidence — 2026-10-31

- On the same disposable document, Chrome created `Codex parity reply persistence 20261031` under the anchored `Parity body` thread. After reload, the reply remained visible with the same author and content.
- The reply was edited in Feishu to `Codex parity reply edited 20261031`; after reload Feishu showed the edited content and the `编辑过` marker. This closes real-service reply create/edit readback for the current account only.
- Feishu's reply `复制链接` action copied a URL containing `comment_id=7702727048967490571`, `comment_type=0` and `comment_anchor=true`. Opening that URL returned to the same document and highlighted the anchored thread. Cross-account access and notification delivery remain unverified.

## Scoped Safari permission and outline verification — 2026-11-01

- Safari opened the supplied read-only document and selecting the outline entry `议程 2：输入要讨论的主题` moved the document viewport to that heading. The heading, nested list/task content and contextual `+` affordance were visible after the jump; this is actual Safari CUA evidence and did not mutate the document.
- The disposable document was temporarily changed to `互联网获得链接的人可阅读` for the explicitly authorized Safari identity check. Safari personal account still rendered `没有权限访问` and identified `崔健军 (飞书个人版)`; no permission-request submission or account switch was made.
- The disposable document was immediately restored to `北京八人科技有限公司` / `组织内获得链接的人可阅读`, confirmed by the Chrome share panel. The supplied document and all unrelated documents were untouched. This closes restoration of the temporary scope, but does not establish cross-account permission, notification delivery or history-restore parity.
- `node scripts/verify.mjs feishu-parity` was rerun with the isolated Node14 source host on 8080 and passed 23/23 local Chromium checks. The existing focused comment suites remain 83/83. Safari WebDriver session creation still times out; native Safari drag/duplicate/delete and matched Safari geometry remain blocked.

## 2026-11-01 live comment/history continuation

- On the disposable Chrome document, the anchored reply action menu exposed `编辑`, `翻译为英语`, `删除` and `举报`. The translation action produced a visible translation node in the reply DOM. This is live current-account evidence; it does not establish translation quality or cross-account visibility.
- The same synthetic reply was deleted through Feishu's native action menu. After a full page reload, the reply remained absent while the original anchored comment and the full-document comment remained. This confirms current-account delete persistence on the disposable document.
- The native reply reaction control was toggled on and off. The live panel showed the `赞` reaction and current author, then removed it after the second toggle. No reaction was left active.
- The anchored comment was resolved through the native header control; the active mark/comment count dropped. The comment-link URL could reopen the thread view, but this run did not claim a separate reopen workflow because the resolved thread was not restored to active state. The disposable document was left with the anchored comment resolved and the full-document comment retained.
- `更多 → 历史记录` opened Feishu's real history panel. The initial observation selected the `10月31日 13:42` entry, showed a one-item change view with the historical content and an enabled `还原此历史记录` button; the write action was deferred in that observation and completed in the later restore checkpoint below.
- These live mutations were confined to `Codex-Parity-20261031-Sequential`; the user-supplied document and unrelated documents were not changed. Provider fixtures remain separately labeled contract/local evidence.

## 2026-11-01 final local gates

- The isolated Node14 host was restored only for verification and pointed at this worktree. `node scripts/verify.mjs feishu-parity` passed 23/23; after the host and fixture servers were stopped, no task-owned local ports remain listening.
- Current-source gates passed: `npm run check:quick`, `npm run check:gate` (90 files / 2,043 assertions), `npm run check:artifacts` (Vditor 95/95, 7/7 artifacts, all size budgets), focused comments 83/83, and `npm run verify:all` 13/13 targets. `git diff --check` is clean.
- The final 2,000-block performance sample passed with mount 1,106.8 ms, keystroke P95/P99 638.6/1,717 ms, decoration incremental 69 ms, scroll 59.7 FPS, save 21 ms and heap 95.6 MB; all seven metrics stayed within the 20% regression threshold.
- These gates confirm implementation and local-browser health only. T012 remains blocked by Safari WebDriver/native coordinate limitations; T015 remains partial for notification/cross-account/native comment-action evidence; T018 remains partial for second-account permission recovery and cross-account comment/notification behavior.

## 2026-11-01 history restore write/readback

- In the disposable Chrome document, `更多 → 历史记录` selected the `10月31日 13:42` version, showed the one-item diff and enabled `还原此历史记录`. The confirmation was accepted on the disposable document only.
- After the restore completed, Chrome refreshed the document and read back the historical body `/h2`; the title header showed `最近修改: 刚刚`/`今天修改`. This closes the real-service history restore write/readback check for the disposable document.
- The restore intentionally moved the disposable document back to an earlier snapshot, so the previously observed anchored/full comments are historical evidence from before the restore and are not claimed as the current post-restore body. The supplied test document and unrelated documents remain untouched.
- T018 remains partial only for second-account permission downgrade/recovery and cross-account comment/notification behavior; T012 and T015 retain their existing Safari/native and notification gaps.

## Safari native block persistence continuation — 2026-11-01

- Safari enterprise tab used the disposable document `Safari parity drag source` at `https://my.feishu.cn/wiki/RKHDwjE1fio3fbkWOlYccsyrneg`; the supplied document was not opened for mutation.
- Native accessibility input replaced a body block, then `Delete` removed the block content and a second `Delete` removed the empty block. A Safari reload kept the deletion.
- Native accessibility selection plus copy/paste created a second body block. A reload read back both the original and duplicate text; deleting the duplicate and reloading confirmed it stayed absent. This is native Safari copy/paste duplication evidence, not six-dot drag evidence.
- Safari coordinate drag still returns `noWindowsAvailable`; WebDriver session creation remains timed out. T012 therefore stays partial with only true block drag and matched geometry open.

## Cross-account link permission replay — 2026-11-01

- On the disposable Chrome enterprise document `Codex-Parity-20261031-Sequential`, link sharing was temporarily changed to `互联网获得链接的人可编辑`, scoped to the current page. The final Feishu security confirmation was accepted only for this disposable test document.
- Safari personal account initially showed `没有权限访问`. After a Safari reload, the same URL became editable and showed `与我分享`; the personal account wrote `Safari personal cross-account marker 20261101` and Chrome read it only after refresh. No same-page live push was observed in the reverse direction during this run.
- The marker was replaced with the original `/h2` body and cloud-save state was visible. Chrome then restored the link audience to `北京八人科技有限公司` with `组织内获得链接的人可阅读`, scoped to the current page. Safari immediately returned to `没有权限访问` with the personal identity shown, confirming permission downgrade/recovery and cleanup.
- At this stage of the replay, cross-account comment visibility, notification delivery and same-page realtime push were still unverified; the later manual Safari replay is recorded below.

## Cross-account comment visibility and disposable-page cleanup — 2026-11-01

- A separate disposable page was created at [Feishu parity comment cross-account marker 20261101](https://iz4fkcxtig.feishu.cn/wiki/Aa4kwcx5FiBG6ck6YNDcrL07nVn), page token `SQpjdlCycotcoQx5rlvcg9mFnwd`. Chrome enterprise inserted only synthetic test content and a document-scope comment `Cross-account comment visibility marker 20261101` (comment id `7703051747933031433`). The supplied document and unrelated documents were not changed.
- For the authorized Safari identity check, the page's link audience was temporarily set to `link_share_entity=4`. Safari personal loaded the page, showed the document body, `全文评论`, the enterprise-authored comment and a comment composer; the AX tree identified the personal cloud context as `崔健军的云文档`. This is live cross-account read visibility evidence.
- Safari reply submission could not be completed: AX `setValue`/paste/type actions left the composer unchanged, and native coordinate input returned `noWindowsAvailable`. No personal reply, notification or cross-account mutation was created, so T015/T018 remain partial for those behaviors.
- The page was restored with `POST /space/api/suite/permission/public/update.v5/` using `link_share_entity=2`; `public.v4` readback returned `link_share_entity=2` and `link_share_entity_v2=2`. Safari reload then showed `没有权限访问`, confirming the temporary scope was removed.
- The page was deleted through Feishu's normal `删除并返回首页` flow. `/drive/trash/` visibly listed the page with operator `崔健军` and `30 天` retention. This is recoverable cleanup; no irreversible purge was performed.


## Same-page and Safari disposable-page replay — 2026-11-01

- The recoverable disposable page `Codex-Parity-20261031-Sequential` was restored only for this verification. Chrome opened the same page in two tabs; after Tab 16 sent the full-document comment `Same-page realtime probe 20261101`, Tab 17 displayed the new comment without a reload. This is live same-account same-page realtime comment evidence.
- With action-time approval, link sharing was temporarily changed for the current page to `互联网获得链接的人可编辑`. Safari personal (`崔健军 (飞书个人版)`) reloaded the exact URL and read the body, the existing `全文评论` entries and the realtime probe.
- Safari native AX setValue/type/paste and coordinate input were attempted against the visible full-document composer. The composer did not change and coordinate input returned `noWindowsAvailable`; no personal reply or notification was created.
- Chrome restored the page to `北京八人科技有限公司` / `组织内获得链接的人可阅读` for the current page. Safari reload then showed `没有权限访问`, confirming the temporary scope was removed. The supplied document and unrelated documents were not modified.
- Same-page push is now observed for the same account. At that checkpoint, cross-account comment mutation and Feishu notification delivery remained unverified; the later manual Safari replay below closes the mutation portion, while the local notifications Provider remains contract evidence only.

## Cross-account manual comment replay — 2026-11-01

- The user manually submitted the full-document comment `cross-account push probe 20261101` from the Safari personal account while the disposable page was temporarily internet-editable.
- The Chrome enterprise tab for the same disposable URL displayed the new full-document comment in its existing page state without a reload. The live accessibility tree showed the comment text and a recent timestamp alongside the prior same-account probes.
- This closes live cross-account full-document comment mutation and same-page realtime delivery for the disposable document. A clean post-reload readback was not claimed because the Chrome renderer became blank during the subsequent reload attempt.
- The page remained scoped to `北京八人科技有限公司` / `组织内获得链接的人可阅读`; Safari personal was refreshed to `没有权限访问`. No notification-center delivery was observed, so notification parity and the remaining native comment actions stay open.

## Notifications Provider boundary — 2026-11-01

- The editor now accepts a notifications Provider through DocumentSession and the imperative LarkDoc providers/shortcut path.
- The required host methods are list(context), markAllRead(context) and setMuted(muted, context). An optional subscribe(listener, context) handles snapshot, upsert, remove, read and mute events.
- Local verification covers initial loading, document/user context forwarding, realtime event projection, lifecycle unsubscribe and rollback when read/mute persistence fails (test/unit/notifications-provider.test.js, 4 tests). This is a contract boundary only; the live Feishu notification stream and cross-account delivery remain unverified.

## Final browser continuation — 2026-11-02

- Safari's native `ReloadButton` successfully reloaded the disposable document `Codex-Parity-20261031-Sequential`. The live Feishu DOM read back `/h2`, the existing anchored comment, the `全文评论` entries and `cross-account push probe 20261101`; the mode control showed `阅读`.
- After that reload, the real Feishu share panel showed `北京八人科技有限公司` / `组织内获得链接的人可阅读` / `可阅读`. This is live permission-restoration evidence for the disposable document. The active Safari page did not label the signed-in identity as `飞书个人版`, so the reload readback is recorded as current-account evidence and is not promoted to clean cross-account readback. A separate existing Safari tab for the other disposable page visibly identified `崔健军 (飞书个人版)` and `没有权限访问`.
- The notification bell had no usable Safari AX label. A coordinate attempt to open it returned the real CUA error `Computer Use server error -10005: noWindowsAvailable`; the identifiable neighboring buttons opened only Feishu's more/search/new-item menus. No Feishu notification-center delivery was observed.
- A second native coordinate attempt for the Safari six-dot block drag returned the same `noWindowsAvailable` error. The earlier Safari WebDriver session creation timeout remains the browser-automation blocker; no drag or matched Safari geometry is claimed.
- Chrome's address-bar/reload attempt emitted `The user changed '/Applications/Google Chrome.app'. Re-query the latest state with get_app_state before sending more actions.` and switched among existing tabs; it produced no trustworthy clean cross-account readback. T012, T015 and T018 therefore remain `PARTIAL`.

## Continuation audit — 2026-11-02

- The requested continuation reused the existing clean parity worktree at HEAD `387430f`; no source-document or non-disposable Feishu document was opened for mutation.
- Browser-channel probes found no usable Chrome DevTools endpoint for the existing signed-in Chrome window (loopback probes returned endpoint-unreachable/invalid-endpoint responses), and no Safari automation channel was exposed to this text turn. This is a tooling limitation, not Feishu behavior evidence.
- The latest valid live Safari evidence remains unchanged: notification-center activation and six-dot drag both returned `Computer Use server error -10005: noWindowsAvailable`; the active Safari reload was current-account evidence only. No task status is promoted.
