/**
 * Provider 统一出口。
 *
 * 每类 Provider 各有必需方法契约（见各文件头部注释），宿主按需实现并传给
 * createDocumentSession({ providers })；缺失方法会在 Session 构造时校验报错，
 * 而不是运行到保存/评论动作才失败。
 */
export * from './authorization'
export * from './collaboration'
export * from './comments'
export * from './persistence'
export * from './versioning'
