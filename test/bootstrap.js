'use strict'

/**
 * 单测启动文件：每个测试文件执行前跑一次。
 *
 * 这里只做两件与"结果可复现"有关的事，其余一律不放进来：
 *  1. 固定时区 —— 快照里一旦出现本地时间戳，不同机器会得出不同结果；
 *  2. 固定 NODE_ENV —— 让依赖它的分支（如 devtools 警告）在单测里始终同一条。
 */
process.env.TZ = 'UTC'
process.env.NODE_ENV = 'test'
