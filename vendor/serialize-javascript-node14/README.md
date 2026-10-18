# serialize-javascript 7.0.5 Node 14 backport

这是构建期依赖 `serialize-javascript` 的本地兼容补丁，不是 Yahoo 发布的原始 npm 包。源码基于公开 npm Registry 的上游 `serialize-javascript@7.0.5`（tarball SHA-1 `c798cc0552ffbb08981914a42a8756e339d0d5b1`），保留 BSD-3-Clause `LICENSE`。

唯一运行时代码差异是 UID 随机源：上游使用要求 Node 20 的全局 `crypto.getRandomValues`，本补丁改为 Node 14.21.3 支持的 `require('crypto').randomBytes(16).toString('hex')`。包版本使用构建元数据 `7.0.5+node14.1`，并把 engine 准确声明为 `>=14.21.3`，避免冒充未经修改的官方包。

根项目通过 npm `file:` dependency 与 override 强制旧 Vue CLI 构建链使用此修复版，从而保留上游对伪造 Date、RegExp flags、`</script>` 和稀疏数组输入的安全修复。`npm run check:contracts` 会在精确 Node 14 下直接加载包并回归普通序列化、HTML 结束标签、伪造 Date、RegExp 与稀疏数组。

升级策略：目标项目升级到 Node 20+ 且脱离 Vue CLI 5 后，删除整个目录、移除 `file:` dependency/override，改用官方受支持版本并重新执行完整 `npm audit`、冷安装和构建。除 Node 14 crypto 兼容改动外，不在此 fork 增加功能。
