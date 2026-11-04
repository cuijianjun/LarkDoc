# Parity verification quickstart

1. Use the isolated worktree:

   ```bash
   cd /Users/cjjxw/codex/.wt-larkdoc/feishu-parity-20261031
   npm ci
   ```

2. Run focused baseline checks before changing behavior:

   ```bash
   npm run check:quick
   npm run test:unit -- test/unit/block-api.test.js test/unit/comments-core.test.js test/unit/versioning-core.test.js test/unit/interaction-mode.test.js
   ```

3. Start the local demo using the repository's existing app runner and verify the `/tiptap`/document route. Live mutations are authorized only in the supplied test document and identified newly created test documents. Prefer disposable documents for permission/history changes; do not touch other documents. Record their URLs before mutations.

4. Browser journeys to record:

   - edit/suggest/read mode menu;
   - `/` alias search and `+` insertion;
   - bubble formatting and block-handle drag/duplicate/delete;
   - heading outline and nested blocks;
   - @ user/document references;
   - inline/full comments and reply/resolve;
   - share/permission downgrade;
   - history preview/restore;
   - cover, import/export and provider failure fallback.

5. Before claiming completion:

   ```bash
   npm run check:gate
   npm run check:artifacts
   npm run verify:all
   git status --short
   ```

Record unavailable Safari/second-account surfaces instead of treating them as passed.

For a host-backed notification surface, pass notifications in providers with
list(context), markAllRead(context), and setMuted(muted, context). An optional
subscribe(listener, context) may emit snapshot, upsert, remove, read, or mute
events; this is a host contract and does not itself prove Feishu delivery.

## Current run result

- Chrome and Safari both observed the original authorized Feishu document. A new disposable document was created: https://iz4fkcxtig.feishu.cn/wiki/M4MywYrAHi1juHkT1k3c3M75nhU (Codex-Parity-20261031-Sequential); Safari personal identity currently receives 没有权限访问. Other documents were not changed.
- `npm run check:gate` and `npm run check:artifacts` passed. Artifact build emitted the existing Vue style-export warning; Vditor and size checks passed.
- `npm run check:perf` built the Element artifact successfully, then stopped at the measurement wait because host load remained above the runner threshold.
- The resumed Node14 host serves this worktree at `http://localhost:8080/lark-doc`; the WC server serves it at localhost:8765. The parity verifier passes 23/23 local Chromium checks, including 390×844 touch emulation, offline editing, local save/reload and teardown. Actual Safari block gestures, cross-account governance and matched Safari geometry remain open or blocked and must stay labeled that way; the P0-10 performance comparison is verified.

- Current-source correction: `npx vitest run test/unit/comments-core.test.js test/unit/comments-ui.test.js` passes 83/83; `node scripts/verify.mjs feishu-parity` passes 23/23 local Chromium checks, including comment-link copy/reload restoration. The parity default also exposes a document-scope full-comment composer. Live Chrome evidence confirms the disposable document's reply survived reload, edited reply readback carries `编辑过`, the `comment_id` link reopens the anchored thread, and the follow switch survives reload before cancellation. T015 remains partial for notification delivery, cross-account access and remaining native reply actions. Chrome debugging and Safari remote automation were authorized temporarily for evidence collection; Safari remote automation is now restored to off. Actual Safari source-host checks pass toolbar absence, slash h2/query removal, bubble bold, plus/todo insertion and task input; WebDriver session creation times out, and the remaining Safari gestures/cross-account acceptance stay open. Final-source `check:gate` and `check:artifacts` have since been rerun successfully (90 files / 2,039 tests, Vditor 95/95, 7/7 artifacts and size budgets); performance has since passed the P0-10 comparison.
- A later `npm run check:perf` rerun passed the 2,000-block baseline comparison after the runner observed load 7.42 ≤ 8.0. The seven collected metrics were mount 1,145 ms, keystroke P95/P99 635.3/1,785.1 ms, decoration incremental 69.1 ms, scroll 59.7 FPS, save 21.4 ms and heap 95.6 MB.
- On 2026-11-01 Safari CUA navigated the supplied document's outline to `议程 2：输入要讨论的主题`. The disposable document was temporarily opened to internet link visitors for the authorized account check and immediately restored to organization-only reading; Safari personal identity still showed `没有权限访问`.
- On 2026-11-01 the restored `Codex-Parity-20261031-Sequential` page was opened in two Chrome tabs. A new full-document comment appeared in the second tab without reload, proving same-account same-page realtime push. The page was temporarily opened to internet editing for Safari personal readback; Safari saw the body, full-document comments and the new probe, but native comment input still returned `noWindowsAvailable`. The page was restored to organization-only reading and Safari again showed `没有权限访问`.
- On 2026-11-01 the user manually submitted `cross-account push probe 20261101` from Safari personal while the disposable page was temporarily editable. The existing Chrome enterprise tab displayed the new full-document comment without reload. This verifies live cross-account comment mutation and same-page delivery; notification-center delivery and a clean post-reload readback remain open.
- On 2026-11-01 a second disposable page (`https://iz4fkcxtig.feishu.cn/wiki/Aa4kwcx5FiBG6ck6YNDcrL07nVn`) was used only for cross-account comment visibility. Safari personal read the document and `全文评论`; native reply input could not submit because CUA returned `noWindowsAvailable`. The page was restored from `link_share_entity=4` to `link_share_entity=2`, Safari then showed `没有权限访问`, and the page was moved to recoverable trash (30-day retention).

- On 2026-11-02 Safari's native reload of `Codex-Parity-20261031-Sequential` read back `/h2`, the anchored comment, the visible `全文评论` entries and `cross-account push probe 20261101`. The live share panel showed `北京八人科技有限公司 / 组织内获得链接的人可阅读 / 可阅读`. Because the active page did not identify the personal account, this is current-account reload evidence only; a separate existing Safari tab identified `崔健军 (飞书个人版)` and `没有权限访问`.
- On 2026-11-02 the Feishu notification bell had no usable AX label. Safari coordinate activation and a renewed six-dot drag both returned `Computer Use server error -10005: noWindowsAvailable`; no notification-center delivery or Safari drag/geometry pass was claimed. A Chrome address-bar/reload attempt also emitted the app-change warning and was discarded as evidence.

- Continuation audit on 2026-11-02 reused the clean parity worktree. Loopback Chrome CDP probes returned endpoint-unreachable/invalid-endpoint responses and Safari CUA was unavailable in this text turn; no additional live claim was made. T012/T015/T018 remain PARTIAL and the disposable page remains organization-only read.
