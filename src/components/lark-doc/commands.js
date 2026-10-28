/**
 * P0-05 兼容 shim：命令表已拆入 core/commands/{basic,common,data,media,embed,collab,widget,
 * button,pim,advanced,docmanage,inline}.js；COMMANDS 顺序由 core/commands/index.js 的显式
 * COMMAND_ORDER 保证与拆分前逐项一致。本文件仅保留旧路径转发，新代码请直接引用 core/commands。
 */
export { COMMANDS, filterCommands, commandFeatureOf } from '../../core/commands'
