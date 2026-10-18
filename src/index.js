import FeishuDocumentEditor from './components/feishu/FeishuDocumentEditor.vue'
import FeishuDocumentWorkspace from './components/feishu/FeishuDocumentWorkspace.vue'
import { createWorkspace } from './components/feishu/workspace'
import { createFeishuConfig } from './components/feishu/feishuConfig'
import { TEMPLATES } from './components/feishu/templates'
import { createEcsImageUpload } from './components/feishu/ecsImages'
import * as documentOperations from './components/feishu/documentOperations'
import * as mockAI from './components/feishu/mockAI'

export {
  FeishuDocumentEditor,
  FeishuDocumentWorkspace,
  createWorkspace,
  createFeishuConfig,
  createEcsImageUpload,
  TEMPLATES,
  documentOperations,
  mockAI,
}

export default FeishuDocumentWorkspace
