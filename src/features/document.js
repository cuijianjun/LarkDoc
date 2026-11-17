/** Pure document tools and optional provider namespaces, loaded on demand by classic Element. */
import { registerFeature } from '../core/features/registry'
import * as segmentedDocument from '../editor/segmentedDocumentModel'
import { createPagedDocumentViewRuntime } from '../editor/pagedDocumentViewRuntime'
import { createPagedDocumentImportRuntime } from '../editor/pagedDocumentImportRuntime'
import * as shareLinks from '../providers/share-links'
import * as shareLinkAccess from '../providers/share-link-access'

// Keep the original synchronous exports and module-local lifecycle. No PM
// classes or mutable editor/session identity enter the shared feature registry.
registerFeature('document.segmented', () => segmentedDocument)

// Publish the factory only: each caller supplies its own original PM/core dependencies.
registerFeature('document.pagedView', () => createPagedDocumentViewRuntime)
registerFeature('document.pagedView.ready', () => createPagedDocumentViewRuntime)

// Import state belongs to the original wrapper; the feature publishes only its factory.
registerFeature('document.pagedImport', () => createPagedDocumentImportRuntime)
registerFeature('document.pagedImport.ready', () => createPagedDocumentImportRuntime)

// Preserve each original namespace and synchronous factory; registration creates no client.
registerFeature('document.shareLinks', () => shareLinks)
registerFeature('document.shareLinkAccess', () => shareLinkAccess)
