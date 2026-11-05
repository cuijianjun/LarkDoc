# lark-doc 本地开发

第一次运行项目，请按 [本地开发与验证](./docs/guide/development.md) 操作。
它包含安装、库构建、在线 demo 本地预览、测试和发布的完整顺序。

日常修改时按 [开发导航](./dev/00-INDEX.md) 找对应规则，只读相关章节。
面向应用开发者的安装与框架示例见 [各环境接入](./docs/guide/environments.md)，
服务器上传与回调见 [上传器](./docs/blocks/uploader.md)。

- 库构建使用 Rollup，包中不携带 Vue 或 Webpack；应用保持原有工具链。
- Node 14.21.3 验证兼容构建；完整测试用 Node 22.12+ 或 Node 24。
- 按改动范围运行 [检查命令](./dev/01-环境与校验链.md)，发布流程见 [发布](./dev/07-发布.md)。
- 数据结构与块定义以 `src/core/blocks/` 和 `src/registry/blocks.js` 为准。
  依赖方向为 `components/ → registry/ → core/`，不要反向依赖。

当前版本以 `package.json` 为准。在线 demo 的依赖由部署流程从同一提交构建，不手工提交 vendor 生成文件。
