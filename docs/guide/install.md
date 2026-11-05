# 安装与引用总表（外网 · 内网 · 全环境）

先安装，再选择引入方式；只有静态托管才需要手动复制 dist。应用的框架与打包器保持原样。

## 在线安装 {#do-install-online}

Vue2、Vue3、React 和无框架应用使用相同命令：

```bash
npm install lark-doc@0.14.4 --save-exact
npm ls lark-doc
```

锁定版本并提交应用锁文件，保证本地和 CI 安装一致。普通编辑不声明 Vue 或协同 optional peer，不需要 `--legacy-peer-deps`；应用本身的依赖冲突应按实际报错处理。

Node14.21.3 的契约是库构建与普通 CJS 消费，应用仍遵守自身 Vite、Webpack 或 Vue CLI 的 Node 要求。源码开发工具与显式协同的要求见[开发说明](https://github.com/cuijianjun/LarkDoc/blob/master/DEVELOPMENT.md)。

## 内网安装 {#do-install-intranet}

`npm pack lark-doc@0.14.4` 得到的普通 tgz **不包含 node_modules 运行时依赖**。联网机器可以安装它；完全离线不能只带这一份包。

已有内网 npm 镜像时，将该版本及依赖同步到镜像，再用正常 npm 安装。仓库保留了历史离线出包辅助脚本：

```bash
# 在已经安装开发依赖的 LarkDoc 仓库根目录执行
bash scripts/pack-intranet.sh --version 0.14.4
```

该辅助脚本的打包依赖闭包尚未按本轮新增的外部依赖重新验收，不能把生成 tgz 当成本轮离线安装通过的证明。需要 npm 接入时优先同步完整依赖到内网镜像；无打包器的静态页面可使用下面的完整 dist 方案。历史搬运步骤见[内网迁移实战](/guide/intranet-migration)。

## 选择 import {#do-import}

| 目标 | 引入 | 样式 |
| --- | --- | --- |
| 常规编辑 | `import { LarkDoc } from 'lark-doc'` | `import 'lark-doc/style.css'` |
| 全部本地特性 | `import { LarkDoc } from 'lark-doc/full'` | 同上 |
| 按需实现 | `import { LarkDoc } from 'lark-doc/lite'` + features | 同上；math 增加特性 CSS |
| 自定义标签 | `import 'lark-doc/element'` | JS 注入，无需另引 |
| Vue2 兼容组件 | `import { LarkDocEditor } from 'lark-doc/vue2'` | 公共 CSS |
| Webpack4 | 根 `lark-doc`；深入口用实际 dist 文件 | `lark-doc/dist/lark-doc.css` |
| 纯 HTML | script 引 `lark-doc-element.umd.min.js` | JS 注入 |

默认入口即可满足初次接入；想精简某项实现再选 lite。五个特性是 math、mermaid、highlight、markdown、office，见[打包产物与按需加载](/guide/build-artifacts)。协同从 `lark-doc/collab` 显式接入，应用需提供匹配的单例与模块格式；不属于 UMD 普通编辑范围。

## 配置宿主 {#do-config}

| 宿主 | 安装后的配置 |
| --- | --- |
| Vue2/Vue3/React 命令式 | 提供容器；挂载后创建、卸载时销毁；不增加专属 alias |
| Webpack4 | 主入口已兼容，深子路径仍写实际文件；不使用新 Element ESM |
| Vue3 标签 | isCustomElement 放行 lark-doc；options 用 property |
| React 薄壳 | 先引 element；回调和对象由 effect 写 property |
| SSR | 仅客户端动态导入并创建 |

CSS/字体沿用宿主已经存在的 loader 或资源规则。没有打包器时使用 UMD。可直接复制的[各环境示例](/guide/environments)包含同一份上传配置及清理代码。

## 静态托管：复制完整 dist {#do-copy}

npm/bundler 接入通常无需此步。普通 HTML、CDN 或内网静态服务器需要：

```bash
mkdir -p public/vendor/lark-doc
cp -R node_modules/lark-doc/dist/. public/vendor/lark-doc/
```

```html
<script src="./vendor/lark-doc/lark-doc-element.umd.min.js"></script>
<lark-doc title="我的文档" storage="none"></lark-doc>
```

完整保留特性 JS、共享区块、CSS、fonts 和其它子目录；不要只复制主文件。UMD 相对主脚本定位资源，支持网站子路径。现代 bundler 使用 Element ESM 时由宿主接管动态 import，不要把静态 UMD 再次打进应用。

## 安装后验收 {#do-verify}

1. `npm ls lark-doc` 显示预期版本，确认不是旧源码 alias 或未更新的本地包。
2. 编辑器能显示、输入并触发正文更新；页面离开后能正常销毁。
3. 插入图表和公式，确认实际 SVG、公式及字体显示，Network 无资源 404。
4. 无上传接口时先测 base64；配置接口后，确认 multipart 请求、返回地址、图片加载与回调都正常。

[在线 demo](/demo/)可先演示 base64 和图表；服务器模式需要你提供接口。GitHub Pages 不提供上传后端。常见错误见[排错对照](/guide/environments#env-troubleshoot)。
