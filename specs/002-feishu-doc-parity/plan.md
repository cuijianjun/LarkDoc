# Implementation Plan: Feishu Docs document parity

**Branch**: `feat/feishu-parity-spec-20261031` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: [Feature specification](./spec.md) and [research evidence](./research.md)

## Summary

Align the `lark-doc` document surface with the current Feishu Docs web experience and official help guidance. The first correction is the interaction model: contextual `/`, `+`, selection-bubble and block-handle tools become the parity default, while the current fixed formatting toolbar becomes opt-in compatibility behavior. The remaining work closes the document workflow in dependency order: baseline and shared block contracts, editing/history/clipboard, collaboration/permissions/comments, lifecycle/import-export, then provider/embed boundaries and browser evidence. Bitable, Sheets, Slides, Wiki and third-party product pages remain integration contracts rather than parity pages.

## Technical Context

**Language/Version**: JavaScript/Vue 2.7, Tiptap 3.32, Node >=14.21.3, npm >=8.19.4

**Primary Dependencies**: Vue 2.7, `@tiptap/*` 3.32, ProseMirror, Yjs/Hocuspocus providers, Vitest, Vue CLI/Webpack

**Storage**: Tiptap JSON as canonical document state; optional host persistence, IndexedDB draft layer and explicit collaboration/version/comment providers

**Testing**: focused Vitest unit/contract tests, existing collaboration tests, repository gates, and browser verification through the running demo and the user-provided Feishu test document for read-only comparison

**Target Platform**: desktop Chromium and actual macOS Safari, explicitly labeled responsive/touch emulation, embeddable Vue 2 library with Vue 3/React/Web Component adapters

**Project Type**: reusable web editor/library with a demo/workspace UI and provider contracts

**Performance Goals**: preserve existing P0-10 scheduling/performance gates; contextual menus must not add synchronous work to every keystroke; first editable document should remain responsive at the current perf fixture size

**Constraints**: no Feishu private code/API/design assets; no credentials in core; no sibling-product UI; no fixed top formatting toolbar in parity default; no changes to the user’s original dirty worktree

**Scale/Scope**: one document product surface, the official alias/content-block matrix, current core/provider/adapter files, existing unit/collab coverage plus focused browser journeys

## Constitution Check

- **Project/workbench rules**: PASS. Work is isolated in `/Users/cjjxw/codex/.wt-larkdoc/feishu-parity-20261031`; the original dirty `next/0.12` worktree is untouched.
- **Dependency direction**: PASS. Core remains Vue-free; UI and adapters call core/provider contracts.
- **Canonical data model**: PASS. Tiptap JSON remains canonical; imports/exports are adapters.
- **Provider boundary**: PASS. External and sibling products remain provider/embed contracts.
- **Evidence requirement**: PASS. Every parity claim is tied to official help, live test-document observation, repository evidence, or an explicit out-of-scope decision.
- **Quality gate**: PASS with a re-check after Phase 1. No constitution file exists in the repo; app-local AGENTS and existing architecture gates are the governing constraints.

## Project Structure

### Documentation (this feature)

```text
specs/002-feishu-doc-parity/
├── research.md
├── spec.md
├── plan.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── parity-evidence.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── components/lark-doc/
│   ├── LarkDocEditor.vue
│   ├── editor/TopBar.vue
│   ├── editor/ToolbarBar.vue
│   ├── editor/BubbleBar.vue
│   ├── editor/BlockHandleMenu.vue
│   ├── editor/CommandMenu.vue
│   ├── editor/topbarMoreMixin.js
│   ├── editor/viewModesMixin.js
│   ├── editor/commentsMixin.js
│   ├── editor/versioningMixin.js
│   └── editor/shareMixin.js
├── core/
│   ├── blockApi/
│   ├── blocks/
│   ├── comments/
│   ├── versioning/
│   ├── storage/
│   └── embed/
├── providers/
│   ├── comments.js
│   ├── authorization.js
│   ├── collaboration.js
│   ├── persistence.js
│   ├── import.js
│   ├── versioning.js
│   └── embedded.js
└── utils/
    ├── importExport.js
    └── export/

test/
├── unit/
├── collab/
└── browser/              # add only when the existing verifier cannot cover a journey

scripts/
├── verify*.js
├── perf/
└── check-*.js
```

**Structure Decision**: keep the existing single library/workspace structure. Add only focused tests and parity evidence; do not create a second frontend or backend.

## Delivery Phases

### Phase 0 — Evidence and baseline

1. Keep the official/live evidence in `research.md` and freeze the parity matrix.
2. Install dependencies from the checked-in lockfile in the isolated worktree.
3. Run the smallest reproducible baseline (`check:quick`, focused unit suites, then broader gates as time permits) and record the first failure rather than reusing historical green claims.
4. Confirm current `ToolbarBar` rendering, mode menu, topbar-more actions, comments/version/share providers and block registry against the matrix.

### Phase 1 — Contextual authoring foundation

1. Make the Feishu contextual interaction model the default: no fixed top formatting toolbar; preserve an explicit opt-in compatibility flag only if existing hosts require it.
2. Ensure `/`, `+`, selection bubble and block handle expose the same command source, aliases and capability checks.
3. Freeze BlockAPI structural operations and block identity semantics before implementing more blocks.
4. Finish undo/redo grouping/origins and block clipboard/multi-select so every subsequent block uses one structural path.
5. Verify headings/outline, lists/tasks, quote/code/callout, table, image/file, link, color and alignment journeys.

### Phase 2 — Collaboration and document governance

1. Verify edit/suggest/read mode projections and the topbar mode menu against the live document.
2. Close comments/mentions/notification behavior and the permission matrix, including no-access and inactive targets.
3. Close document history/diff/restore and stored-version entry points with provider-backed tests.
4. Add cross-account fixtures and Safari/touch-safe interaction coverage where the environment permits; record unavailable surfaces explicitly.

### Phase 3 — Lifecycle and integration boundaries

1. Align cover/title/author/time/outline and document information behavior.
2. Verify persistence, import/export, print/copy/watermark/audit policy surfaces that are part of the current package contract.
3. Normalize async states (loading/empty/failure/no-permission/over-limit) for media and provider-backed blocks.
4. Keep Bitable/Sheets/Slides/Wiki/third-party content behind provider/embed contracts; add skeleton/fallback tests only.

### Phase 4 — Final verification and handoff

1. Run focused unit/collab tests for each completed phase.
2. Run `npm run check:gate`, `npm run check:artifacts`, `npm run verify:all` and the browser matrix that is available.
3. Update `research.md`, `spec.md`, `tasks.md`, the parity evidence contract and the session handoff with completed/blocked decisions.
4. Do not claim a parity row complete without a test, browser observation or explicit limitation.

## Execution Order and Exit Gates

- T001–T004 are sequential foundation tasks.
- T005–T008 depend on T001–T004 and can be verified independently by user story.
- T009–T012 depend on provider/capability contracts; do not start lifecycle work while those contracts are undefined.
- T013–T017 cover governance/collaboration contracts; T018 is their real-browser acceptance gate. T019–T021 cover lifecycle contracts; T022 is their touch/offline/teardown gate.
- Resume unresolved work in numeric order: T012 → T015 (reopened native comment gaps) → T018 → T022 → T025 → T026 → T027. Existing later contract tests remain evidence, not permission to mark an earlier browser gate complete. A blocked journey stays open while independent preparation and corrections can continue.
- T026 is the final verification gate; T027 reconciles the final evidence and handoff after that gate. Neither may claim complete product parity while an in-scope browser journey is open.
- Each task must name the exact affected files, a focused command, and the evidence update it requires.

## Complexity Tracking

No constitution violation is required. The scope is large because Feishu Docs is a multi-surface product, but the plan keeps sibling products behind provider contracts and sequences work from shared structural primitives to user-visible parity.

## Execution outcome (2026-10-31)

- Implementation and contract verification exist through T024, but T012, T018 and T022 remain open browser gates, and T015 is reopened because several native comment actions are not connected. Earlier wording that all tasks through T024 were complete in order was inaccurate.
- T025 is partially verified: artifact build and size budgets pass; performance measurement is blocked by sustained host load from existing headless Chromium processes.
- T026 is partially verified: prior repository/artifact gates passed; the resumed localhost host resolves the former missing-server blocker. Twelve browser targets have successful logs after a separate Element retry, but skipped subchecks and missing parity-specific journeys still require reconciliation. Do not describe the original combined invocation as clean.
- User authorized local Vue2 host use, Safari's personal second account, touch emulation, scoped stale-browser cleanup and live mutations limited to the supplied/new test documents. Cross-account and touch/offline completion still require observable readback.

## Final execution outcome (2026-10-31)

- T022 is verified as local touch emulation only: 390×844 contextual entry, offline edit, local save/reload and teardown all pass in the existing parity verifier.
- T026/T027 are complete: the final repository gate, artifact/size checks, focused comment/storage/collab suites and all 13 browser targets pass. The parity verifier has 23/23 checks and writes source/artifact identity to the existing evidence log.
- T012 remains partial for Safari pointer gestures and matched Safari geometry because WebDriver session creation times out and the native coordinate channel is unavailable. Safari CUA also provides outline-navigation, deletion and copy/paste persistence readback; Safari remote automation was enabled temporarily for evidence collection and is restored to off after verification.
- T015 and T018 remain partial because live Chrome confirms reply create/edit readback, comment-link reopening, follow-toggle persistence/cancellation, same-account same-page realtime push, cross-account full-document comment mutation and history restore on disposable documents. The latest scoped page temporarily allowed Safari personal read/edit access; the user manually submitted `cross-account push probe 20261101`, which appeared in the existing Chrome tab without reload. The page is restored to organization-only reading and Safari shows `没有权限访问`. The notifications Provider now gives the host an explicit list/read/mute/optional-subscription boundary with rollback tests. Feishu notification delivery, remaining native comment actions and clean post-reload cross-account readback remain unverified. Provider fixtures and read-only observations are labeled separately.
- T025 is now verified: artifact and size budgets pass after a documented 1 KB ESM gzip allowance for the provider-backed comment recovery code, and the 2,000-block performance comparison passed all seven metrics once load dropped below the runner threshold. Safari gestures and cross-account evidence remain separate partial rows.

## Final continuation outcome (2026-11-02)

- T012 remains partial: Safari's native reload path is healthy, but the renewed six-dot drag attempt returned `noWindowsAvailable`; matched Safari geometry and WebDriver session creation remain unverified.
- T015 remains partial: Safari reloaded the disposable page and read back `/h2`, the full-document comment list and `cross-account push probe 20261101`, but the active page identity was not labeled personal. The notification bell had no usable AX target; coordinate activation returned `noWindowsAvailable`, and no Feishu notification-center delivery was observed.
- T018 remains partial: the live Safari share panel confirmed `北京八人科技有限公司 / 组织内获得链接的人可阅读 / 可阅读` after reload, while a separate existing Safari personal tab showed `崔健军 (飞书个人版) / 没有权限访问` for the other disposable page. This verifies restored scope and current-account readback, not clean cross-account readback.

## Continuation audit (2026-11-02)

- Reused the existing parity worktree and evidence; no product code or Feishu source document was changed.
- The available text-turn browser probes did not expose the signed-in Chrome tab or Safari CUA, so no new service evidence can close T012, T015 or T018. Preserve their PARTIAL states and the recorded `noWindowsAvailable`/WebDriver timeout blockers.
