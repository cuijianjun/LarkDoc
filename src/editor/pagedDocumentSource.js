import { isImportEnabled, resolveImportFormatId } from '../components/lark-doc/larkDocConfig'
import { loadFeature } from '../core/features/registry'
import { logger } from '../utils/logger'
import { DOMParser as ProseMirrorDOMParser, Fragment } from '@tiptap/pm/model'
import { Selection, EditorState } from '@tiptap/pm/state'
import { fixTables } from '@tiptap/pm/tables'
import { closeHistory } from '@tiptap/pm/history'
import { sanitizeHTML, validateDocument, createBlockId } from '../core/documentOperations'
import { normalizeImportedBlockAttributes, DEFER_BLOCK_ID_META } from '../core/blocks/block-fixes'
import { createNetworkPolicy } from '../networkPolicy'
import { setTransactionMetadata, TRANSACTION_ORIGINS, PAGED_IMPORT_META } from '../core/transactionMetadata'
import { migrateRecordContent } from '../core/migrations'
import { skipTrailingNodeMeta } from '@tiptap/extensions'
import { normalizeVditorHtml } from '../legacy/vditorHtml'
import { createPagedDocumentImportRuntime } from './pagedDocumentImportRuntime'

// Keep module namespaces, errors and import timing in the original host module.
const loadPagedDocumentViewModule = () => import('./pagedDocumentView')
const loadMammothModule = () => import(/* webpackChunkName: "office" */ 'mammoth/mammoth.browser')
const loadImportExportModule = () => import(/* webpackChunkName: "import-export" */ '../utils/importExport').then(({ markdownToHtml }) => ({ __proto__: null, markdownToHtml }))

// Source/ESM/CJS retain the complete synchronous interface and one shared runtime.
const runtime = /*#__PURE__*/ createPagedDocumentImportRuntime({
  isImportEnabled, resolveImportFormatId,
  loadFeature,
  logger,
  ProseMirrorDOMParser, Fragment,
  Selection, EditorState,
  fixTables,
  closeHistory,
  sanitizeHTML, validateDocument, createBlockId,
  normalizeImportedBlockAttributes, DEFER_BLOCK_ID_META,
  createNetworkPolicy,
  setTransactionMetadata, TRANSACTION_ORIGINS, PAGED_IMPORT_META,
  migrateRecordContent,
  skipTrailingNodeMeta,
  normalizeVditorHtml,
  loadPagedDocumentViewModule, loadMammothModule, loadImportExportModule,
})

export const yieldDocumentTask = runtime.yieldDocumentTask
export const createPagedDocumentSource = runtime.createPagedDocumentSource
export const startPagedImport = runtime.startPagedImport
export const importPagedContent = runtime.importPagedContent
export const importWorkspaceFile = runtime.importWorkspaceFile
