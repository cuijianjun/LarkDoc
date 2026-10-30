# Output and Audit Contract

复制、打印、下载、截图和水印策略在 UI、命令、Provider 和导出路径一致。策略拒绝必须返回可观察错误，不得输出受保护字段。

每个受控动作产生 `AuditEvent`，至少包含 actor、document、action、result、reason、source、timestamp；不得记录第三方 token。
