/**
 * P0-04 兼容 shim：networkPolicy 实现已迁至 src/core/policy/network.js。
 * 旧导入路径（`../networkPolicy`）继续可用，新代码请直接从 core 引入。
 */
export * from './core/policy/network';
