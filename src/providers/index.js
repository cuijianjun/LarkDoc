/**
 * Provider 统一出口。
 *
 * 每类 Provider 各有必需方法契约（见各文件头部注释），宿主按需实现并传给
 * createDocumentSession({ providers })；缺失方法会在 Session 构造时校验报错，
 * 而不是运行到保存/评论动作才失败。
 */
export * from './authorization'
export * from './ai'
export * from './bitable'
export * from './import'
export * from './reference'
export * from './jira'
export * from './okr'
export * from './security'
export * from './survey'
export * from './collaboration'
export * from './comments'
export * from './persistence'
export * from './upload'
// P3-05：网页元数据抓取（09 §265）。**第 6 个可选 provider**，不进上面 5 类必选契约 ——
// 没接它时网页卡片降级成「URL + 域名标题」，其余能力照常。
export * from './unfurl'
export * from './versioning'

export * from './embedded'
