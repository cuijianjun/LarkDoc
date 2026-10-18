import FeishuDocumentEditor from './components/feishu/FeishuDocumentEditor.vue'
import FeishuDocumentWorkspace from './components/feishu/FeishuDocumentWorkspace.vue'
import { createWorkspace } from './components/feishu/workspace'
import { createFeishuConfig } from './components/feishu/feishuConfig'
import { TEMPLATES } from './components/feishu/templates'
import { createEcsImageUpload } from './components/feishu/ecsImages'
import * as documentOperations from './components/feishu/documentOperations'
import * as mockAI from './components/feishu/mockAI'
import { DocumentSession, createDocumentSession } from './session/DocumentSession'
import * as documentSchema from './core/documentSchema'
import * as transactionMetadata from './core/transactionMetadata'
import * as migrations from './core/migrations'
import * as providers from './providers'

export {
  FeishuDocumentEditor,
  FeishuDocumentWorkspace,
  createWorkspace,
  createFeishuConfig,
  createEcsImageUpload,
  TEMPLATES,
  documentOperations,
  mockAI,
  DocumentSession,
  createDocumentSession,
  documentSchema,
  transactionMetadata,
  migrations,
  providers,
}

export default FeishuDocumentWorkspace
