# Feature Specification: Feishu Docs document parity

**Feature Branch**: `feat/feishu-parity-spec-20261031`

**Created**: 2026-10-31

**Status**: In progress — acceptance reconciliation

**Input**: User description: “核对当前文档需求，对比真飞书文档操作功能和官方使用说明，1:1复制一个飞书文档；飞书多维表格等三方页面留到接口和方法；先搜集、对比、制定计划，安装并使用 Spec Kit，按详细 task 计划依次执行。”

## User Scenarios & Testing

### User Story 1 - Author a document with Feishu’s contextual editing model (Priority: P1)

A document author can open a document, edit text and headings, use the `/` and `+` insertion entry points, format selected text through the bubble toolbar, and use the block handle to move, duplicate, transform and remove blocks. The document behaves like the Feishu document surface: the formatting controls are contextual and there is no fixed formatting toolbar at the top of the page.

**Why this priority**: Authoring is the primary value of a document editor and is the foundation for every other workflow.

**Independent Test**: Starting from an empty document, a tester can create headings, paragraphs, lists, tasks, quote/code/callout/table/media blocks, links, colors, alignment and indent, then reorder and undo the changes using only documented Feishu entry points.

**Acceptance Scenarios**:

1. **Given** an empty editable document, **When** the author types `/` at the start of a block and searches by a documented alias, **Then** the matching content type can be inserted and the slash query is removed from the document.
2. **Given** an empty block, **When** the author opens the `+` entry point, **Then** the same supported content types are available through the contextual insert menu.
3. **Given** selected text, **When** the author uses the bubble toolbar, **Then** heading/list/task/code/quote/callout, alignment/indent, link, bold/italic/strike/underline, text color, background color and clear-format actions produce the corresponding visible result.
4. **Given** a block handle, **When** the author drags, duplicates, transforms or deletes the block, **Then** the block and its nested content move or change as one unit and document structure remains valid.
5. **Given** any editable document state, **When** the author scrolls the page, **Then** no fixed top formatting toolbar appears; the contextual entry points remain usable.

### User Story 2 - Collaborate with modes, comments, mentions, permissions and history (Priority: P1)

A document participant can switch between edit, suggest/revision and read/comment modes, mention users or documents, comment on a selection or the whole document, reply/resolve/delete comments, share the document with role-based permissions, and inspect or restore document history when authorized.

**Why this priority**: Feishu’s document experience is defined by collaboration and permission-aware state, not just local formatting.

**Independent Test**: With a primary and restricted participant fixture, a tester can exercise each mode, a mention, inline and full comments, a permission downgrade and a history restore without exposing unauthorized actions.

**Acceptance Scenarios**:

1. **Given** an editable document, **When** the participant chooses `编辑`, `修订` or `阅读` from the mode menu, **Then** the document exposes exactly the capabilities of that mode and announces the transition.
2. **Given** a document body or comment input, **When** the participant enters `@` and selects a user, group card or document, **Then** the reference is inserted with the documented notification and permission behavior.
3. **Given** selected text or the document footer, **When** the participant submits a comment, **Then** the comment is anchored or recorded as a full-document comment and can be replied to.
4. **Given** an existing comment, **When** an authorized participant edits, translates, resolves, deletes or follows it, **Then** the visible thread state and notification contract update consistently.
5. **Given** a restricted participant, **When** they open share, comment, history or restore controls, **Then** unavailable actions are hidden or disabled and no restricted content is mutated.
6. **Given** an authorized editor, **When** they open history, inspect a version and choose restore, **Then** the selected version is previewed and restoration is confirmed through a recoverable document state.

### User Story 3 - Manage the document lifecycle (Priority: P2)

A document owner can add/edit/remove a cover, navigate headings through the outline, import supported local content, export the document to supported formats, persist drafts and recover from supported offline or provider failures.

**Why this priority**: Lifecycle features make the editor usable as a document product rather than a text area.

**Independent Test**: A tester can create a disposable document, add a cover and headings, reload it, import/export a representative document, and verify that supported structure and error states are preserved.

**Acceptance Scenarios**:

1. **Given** an editable document, **When** the owner adds or removes a cover, **Then** the title/author/time layout and document body remain intact and the action respects edit permission.
2. **Given** headings in the document, **When** the participant opens the outline and selects a heading, **Then** navigation moves to the corresponding block and collapsed containers retain their state.
3. **Given** a supported imported file or document representation, **When** the owner imports it, **Then** supported blocks are preserved and unsupported content receives an explicit fallback state.
4. **Given** a document with supported content, **When** the owner exports Word or PDF, **Then** the output contains the supported text, blocks and metadata promised by the export contract.
5. **Given** a save, load, upload or provider failure, **When** the operation fails, **Then** the user sees a stable loading/failed/no-permission/over-limit state with retry or recovery guidance and no silent data loss.

### User Story 4 - Integrate non-document products without absorbing their UI (Priority: P3)

A host application can provide Bitable/Sheets/Slides/Wiki and third-party content through explicit provider or embed contracts. The document editor renders a stable reference/fallback surface and emits actions to the host; it does not pretend to implement the sibling product’s full UI.

**Why this priority**: The user explicitly excludes sibling product pages from this project while still requiring a usable integration boundary.

**Independent Test**: A host test double can register an embed, render its loading/success/failure states, receive action events and remove the block without the editor owning third-party credentials or product navigation.

**Acceptance Scenarios**:

1. **Given** a registered external provider, **When** a supported reference is inserted, **Then** the document stores a stable reference and renders the provider’s declared state.
2. **Given** a provider failure or missing capability, **When** the block is displayed, **Then** the document shows a deterministic fallback with retry/host-action affordances.
3. **Given** an action that belongs to a sibling product, **When** the user activates it, **Then** the editor emits the host event and does not mutate sibling-product data directly.
4. **Given** an unknown block or provider version, **When** the document is loaded, **Then** content remains visible as a non-destructive unknown/fallback block and can be exported or removed safely.

### Edge Cases

- A slash alias matches several content types or matches none.
- A block is pasted into an invalid container or a nested selection is empty.
- A copy/paste operation crosses documents, tabs or external HTML/Markdown sources.
- A remote participant changes the same block while a local undo, redo, suggestion or restore is pending.
- A mention target has no access, is inactive, or is outside the workspace.
- A comment anchor is deleted, moved, or points to an unknown block.
- A user loses permission while a dialog, upload, history preview or provider action is open.
- An import contains unsupported, malformed, oversized or unsafe content.
- A provider times out, returns incomplete data, or is unavailable offline.
- A document exceeds configured text, media, block, collaborator or storage limits.
- A Safari/mobile viewport lacks hover input and must expose the same action through focus/tap.

## Requirements

### Functional Requirements

- **FR-001**: The document MUST expose the Feishu document shell: breadcrumb/title, last-modified state, share, mode, more actions, search/new-item entry, and account/host action slots.
- **FR-002**: The document MUST support the three user-facing modes `编辑`, `修订`, and `阅读`, with capability checks for edit, suggest, comment, share, history and restore.
- **FR-003**: The document MUST provide contextual editing entry points matching Feishu: `/` quick insert, `+` insertion on an empty block, a selection bubble toolbar, and a block-handle toolbar.
- **FR-004**: The document MUST NOT show a fixed formatting toolbar at the top of the page in the parity-default configuration.
- **FR-005**: The document MUST implement and browser-verify every in-scope official slash alias. Only the sibling-product and third-party pages excluded by FR-025 may use contract-only entries. An unimplemented native document operation remains an open gap; a placeholder or provider declaration does not satisfy parity.
- **FR-006**: The document MUST support paragraphs, heading levels, ordered/unordered lists, tasks, quotes, code blocks, callouts, dividers, links, tables, columns, images, files/video, formulas, reminders, calendar cards, polls, embeds, mentions, and unknown-block fallback according to the supported block matrix.
- **FR-007**: Text styling MUST include bold, italic, strike, underline, link, text color, background color, clear-format, heading/list/task/code/quote/callout/sync transforms, alignment and indent.
- **FR-008**: Blocks MUST support drag/move, duplicate, transform, insert-below, delete and nested content operations while preserving document validity and block identity rules.
- **FR-009**: Copy, cut and paste MUST support internal block-preserving data, external HTML/Markdown sanitization, multi-block selections, container boundaries and regenerated identifiers for pasted copies.
- **FR-010**: The document MUST support undo and redo for local structural, text, attribute and block operations with collaboration-safe origin and grouping behavior.
- **FR-011**: The document MUST support headings and an outline that navigates to the corresponding block and reflects supported collapsed-container state.
- **FR-012**: The document MUST support user, group-card and document @ references with explicit notification and permission outcomes.
- **FR-013**: The document MUST support anchored comments and full-document comments, replies, edit, translate, resolve, delete, follow and comment-link behavior within declared capability limits.
- **FR-014**: The document MUST expose share and permission states for reader, editor, manager and restricted/expired access, including inherited access and provider-denied actions.
- **FR-015**: The document MUST record and display document history with editor/time/detail, diff/preview and restore for authorized editors.
- **FR-016**: The document MUST support add/edit/remove cover behavior and preserve title/author/modified-time presentation.
- **FR-017**: The document MUST persist supported document state, report loading/saving failures and avoid overwriting valid content with corrupt or partial data.
- **FR-018**: The document MUST import and export the supported formats declared by the host contract, including Word/PDF export where enabled, with deterministic unsupported-content handling.
- **FR-019**: Async blocks MUST expose consistent loading, empty, failed, no-permission and over-limit states with retry or recovery semantics.
- **FR-020**: External and sibling-product content MUST use provider/embed contracts, preserve opaque references and emit host actions without holding third-party credentials in the editor core.
- **FR-021**: The document MUST preserve stable Tiptap JSON identity and migration behavior for supported content and unknown/fallback blocks.
- **FR-022**: Keyboard navigation, focus management, labels, announcements and mobile/touch alternatives MUST exist for every parity-critical contextual action.
- **FR-023**: Browser acceptance MUST cover desktop Chromium and actual macOS Safari, reduced-width/touch emulation, edit/suggest/read modes, comments, history, sharing, import/export, failure states and route teardown. WebKit automation is supplementary and does not replace Safari. Emulated touch results MUST be labeled as emulation rather than physical iOS validation.
- **FR-024**: Evidence for each parity-critical behavior MUST link to an official Feishu source, a live test-document observation, a repository implementation/test, or an explicit out-of-scope decision.
- **FR-025**: The project MUST keep Bitable, Sheets, Slides, Wiki and third-party product pages out of the parity implementation scope, while retaining the minimum provider/embed contracts required to reference them. T024 audited this boundary; contract-only insertion entries do not claim sibling-product page parity.

### Key Entities

- **Document**: A titled, permissioned content tree with metadata, cover, author/time and persisted revision state.
- **Block**: A document unit with type, attributes, stable identity, nested children and visible/async state.
- **Inline reference**: A user, group card or document mention with notification and permission metadata.
- **Comment thread**: An anchored or full-document discussion with replies, participants, state and visibility.
- **Revision**: A document history entry or suggestion change with author, timestamp, diff and restore/accept state.
- **Capability projection**: The effective edit/suggest/comment/share/history/restore permissions for a participant and block/provider.
- **Embed reference**: An opaque external or sibling-product reference with provider identity, state, fallback and host action contract.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of in-scope official slash-alias rows are implemented and browser-verified. FR-025 exclusions have a dated boundary decision and a tested provider contract. Deferred native document rows prevent a complete-parity claim.
- **SC-002**: The four user stories each have at least one independent automated or browser acceptance journey, and all P1 journeys pass on the parity test fixture.
- **SC-003**: In the parity-default configuration, a browser audit finds zero fixed formatting-toolbar controls while scrolling; all required formatting actions remain reachable through `/`, `+`, selection bubble or block handle.
- **SC-004**: A reviewer can complete create, format, insert, move, duplicate, comment, mention, share, history-restore and export journeys without consulting project-specific instructions beyond the visible UI.
- **SC-005**: Permission tests show 100% of restricted edit/suggest/comment/share/history/restore actions are hidden, disabled or rejected without document corruption.
- **SC-006**: Supported import/export round trips preserve all required text, headings, lists, tables, media references and fallback markers in the declared contract.
- **SC-007**: Every async/provider block state in the matrix has a deterministic rendering and a tested retry or recovery path; no tested failure silently discards document content.
- **SC-008**: The final verification report links every parity matrix row to evidence and records any browser or account limitation instead of claiming an unobserved behavior.
- **SC-009**: Visual acceptance records the live and local viewport, zoom, theme, font availability and matching UI state. Compare body typography/spacing, contextual menu dimensions/placement, outline and header geometry at desktop 1440×900 and emulated touch 390×844. Record measured differences explicitly; automated regression success alone does not establish visual parity.

## Assumptions

- Live mutation is authorized only in the supplied test document (the three supplied links identify one document) and explicitly identified newly created test documents. Prefer new disposable documents for role changes and history restoration. Do not modify other documents.
- The target is the current Chinese Feishu Docs web experience and its official help guidance available during this task; regional or future variants may differ.
- Existing Tiptap JSON, provider and adapter contracts remain the canonical internal representation; parity work changes behavior and evidence, not the editor kernel.
- Third-party content can be represented by a provider/embed contract and stable fallback without implementing the third-party product page.
- Node dependencies can be installed from the checked-in lockfile in the isolated worktree for focused verification.
- Safari uses the user's personal account as the second identity. Injected provider/permission fixtures supplement real cross-account checks and cannot replace them. If the service rejects document creation, sharing or external-account access, record the actual rejection and keep that journey open.
