/** Optional feature registry entry. Import a concrete feature subpath to load its dependency. */
export { registerFeature, hasFeature, loadFeature } from '../core/features/registry'

/**
 * Full bundle convenience entry.
 *
 * `lark-doc/full` imports this module for its side effects, while this public
 * barrel keeps the feature names discoverable for applications that want to
 * inspect the registry helpers from one place.
 */
export const FEATURE_NAMES = Object.freeze(['math', 'mermaid', 'office', 'markdown', 'highlight'])
