/**
 * P0-04 兼容 shim：nodeviews 注册表实现已迁至 src/core/nodeviews/registry.js。
 * 旧导入路径（`../../registry/nodeviews`）继续可用，新代码请直接从 core 引入。
 */
export { setNodeView, getNodeView } from '../core/nodeviews/registry';
