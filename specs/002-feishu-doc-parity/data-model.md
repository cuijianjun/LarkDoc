# Data model and parity contracts

## Document

- `id`: opaque host/document identity.
- `title`, `author`, `modifiedAt`, `cover`: document metadata shown in the shell.
- `content`: canonical Tiptap JSON tree.
- `mode`: edit, suggest or read for the current participant.
- `capabilities`: effective edit/suggest/comment/share/history/restore permissions.
- `revision`: local/remote revision metadata used for persistence, collaboration and restore.

## Block

- `blockId`: stable identity used by comments, anchors, history and structural operations.
- `type`: paragraph, heading, list/task, quote, code, callout, table, media/file, embed, etc.
- `attrs`: validated type-specific fields.
- `children`: nested content where the block is a container.
- `asyncState`: idle/loading/empty/failed/no-permission/over-limit.
- `providerRef`: opaque external/sibling-product reference when applicable.

## Inline reference

- `kind`: user, group-card or document.
- `targetId`: opaque directory/document id.
- `label`: display text.
- `notify`: whether the user selected a notification.
- `permissionOutcome`: unchanged, granted-reader, granted-editor or rejected.

## Comment thread

- `id`, `anchor`, `author`, `participants`, `body`, `replies`.
- `scope`: inline anchor or full-document.
- `visibility`: public/private.
- `state`: open, resolved or deleted.
- `notificationState`: pending/sent/none.

## Revision/history entry

- `id`, `author`, `createdAt`, `summary`, `diff`, `restoreAllowed`.
- Suggestion entries additionally track accept/reject state.

## Embed reference

- `providerId`, `kind`, `opaqueRef`, `displayState`, `fallbackState`, `hostActions`.
- Core stores no third-party token; providers own external requests and action handling.
