import { Fragment, DOMSerializer, NodeRange, Slice } from '@tiptap/pm/model'
import { EditorState, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration } from '@tiptap/pm/view'
import { joinBackward, joinForward } from '@tiptap/pm/commands'
import { getTextBetween, getTextSerializersFromSchema } from '@tiptap/core'
import { createBlockId, collectFoldRanges, computeHeadingNumbers, computeOrderedListNumbers, computeBulletItems, findTextMatches } from '../core/documentOperations'
import { isTextOnlyChange } from '../core/derive/index'
import { PAGED_IMPORT_META } from '../core/transactionMetadata'
import { createLogicalScrollCoordinates } from './segmentedDocumentModel'
import { createPagedDocumentViewRuntime } from './pagedDocumentViewRuntime'

// Source consumers keep the original synchronous module interface and PM identity.
const runtime = /*#__PURE__*/ createPagedDocumentViewRuntime({
  Fragment, DOMSerializer, NodeRange, Slice,
  EditorState, Selection, TextSelection,
  Decoration, joinBackward, joinForward,
  getTextBetween, getTextSerializersFromSchema,
  createBlockId, collectFoldRanges, computeHeadingNumbers, computeOrderedListNumbers, computeBulletItems, findTextMatches,
  isTextOnlyChange, PAGED_IMPORT_META, createLogicalScrollCoordinates,
})

export const scrollDocumentSelection = runtime.scrollDocumentSelection
export const preparePagedDocumentView = runtime.preparePagedDocumentView
