/**
 * Full bundle entry.
 *
 * Use `lark-doc/full` when an application prefers one synchronous import over
 * per-feature imports. The base editor remains the default entry; this module
 * only adds every optional runtime feature and low-frequency public entry.
 * Collab remains a separate peer-dependent entry; see the note below.
 */
export * from './index'
export { default } from './index'
export * from './templates'
export * from './comments'
export * from './versioning'
export * from './providers'
export * from './migrations'

// Collab intentionally stays at `lark-doc/collab`: its Yjs/Tiptap/Hocuspocus
// packages follow collabDependencies versions and remain host singleton instances.
// Applications using the full bundle add `import 'lark-doc/collab'` separately.

// Feature modules register their implementations as a side effect. Keeping
// these imports static gives bundlers one explicit, predictable full bundle.
import './features/math'
import './features/mermaid'
import './features/office'
import './features/markdown'
import './features/highlight'

export { FEATURE_NAMES } from './features/index'
