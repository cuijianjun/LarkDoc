# Capability and Async State Contract

异步块状态统一为 `empty`、`loading`、`failed`、`unauthorized`、`over_limit`；能力投影独立表达 `visible`、`read`、`edit`、`delete`、`comment`、`restore`。

失败、无权限和超限默认保留已有有效内容；重试必须幂等；UI、命令和 BlockAPI 使用同一 capability 判定。
