# Vue3：Windows（Git Bash + pnpm）完全离线接入 LarkDoc

> 内网交付说明。适用 Windows x64、Git Bash 和 pnpm；SDK 运行依赖已内置在随包 tgz 中。

用途：在你现有的 **Vue3 应用**中安装 `lark-doc@{{SDK_VERSION}}`，并显示一个可编辑的文档。开发机为 Windows x64，安装过程不访问公网或内网 npm。

本文的 Windows 命令统一在 **Git Bash** 中执行，应用依赖使用 **pnpm** 管理。断网前准备好 Git for Windows、Node 和原项目使用的 pnpm 版本，确认 Git Bash 中能使用 `node`、`pnpm`。例如 D 盘的 `work/your-vue3-app` 目录，在 Git Bash 中写成 `/d/work/your-vue3-app`；路径包含空格时保留引号。

SDK 已包含所需的运行依赖，并提供 Webpack4 兼容入口。应用原有工具链继续保留。

## 1. 压缩包中有什么

压缩包文件名：`lark-doc-vue3-{{SDK_VERSION}}-windows-x64.zip`。

将压缩包解压到 D 盘的 `larkdoc-vue3` 目录，Git Bash 中的路径为 `/d/larkdoc-vue3`。目录如下：

```text
README.md                         本说明
vendor/
  lark-doc-{{SDK_VERSION}}.tgz     内网自包含安装包，内置 SDK 所需运行依赖
demo/                             Vue3 + Vite 最小工程，按 pnpm 提供配置和锁文件
SHA256SUMS.txt                     文件校验清单
```

**你自己的应用是接入位置。** `demo/` 用于参考和排查。你的应用如果使用其他构建工具，继续沿用，不需要为了接入 SDK 改用 Vite。

本方案沿用旧内网脚本的自包含 tgz 思路：**SDK 的运行依赖直接装在 tgz 内，安装时与 SDK 一起放入 `node_modules`**。不需要另外携带缓存或设置 store 路径。pnpm 9 和 10 共用随包锁文件。

本包使用基于公开 `{{PUBLIC_VERSION}}` 单独构建的 `{{SDK_VERSION}}` 自包含 SDK，代码仍从 `lark-doc` 引入。公开版保持由宿主共享依赖，普通 `npm pack lark-doc@{{PUBLIC_VERSION}}` 不能代替内网包。SDK SHA256：`{{SDK_SHA256}}`。

本包负责 SDK 自身的运行依赖，原应用的 Vue、Vite 或其他构建工具和业务依赖继续由原项目管理。若要把整个原应用从空 `node_modules` 完全离线重装，还需另备原应用自身的依赖；只有这项完整冷安装验收需要原应用的依赖清单和锁文件。

## 2. 准备原应用

以下假设你的应用在 `/d/work/your-vue3-app`，请替换为实际目录。这里应能看到你自己的 `package.json` 和 `pnpm-lock.yaml`。

```bash
cd "/d/work/your-vue3-app"
node -v
pnpm -v
```

沿用原项目固定的 pnpm 版本；若 `package.json` 有 `packageManager` 字段，以其中的版本为准。SDK 声明的最低 Node 版本为 `14.21.3`，实际 Node 还须满足原项目的 pnpm 和构建工具要求。

随包 demo 使用 Vue `3.5.25`、Vite `7.3.6`、Node `22.13.0`，支持本机已安装的 pnpm 9.x 或 10.x，不强制自动切换版本。两版共用随包 `pnpm-lock.yaml`。原应用继续使用自身固定的 pnpm 版本和构建工具。

## 3. 完全离线安装到原应用

把内网自包含 tgz 复制到**原应用根目录**下的 `vendor/`，然后安装。在 Git Bash 执行：

```bash
cd "/d/work/your-vue3-app"
mkdir -p "./vendor"
cp "/d/larkdoc-vue3/vendor/lark-doc-{{SDK_VERSION}}.tgz" "./vendor/"
pnpm add "./vendor/lark-doc-{{SDK_VERSION}}.tgz" --save-exact --offline
```

安装后的目录示意：

```text
your-vue3-app/
  package.json
  pnpm-lock.yaml
  vendor/
    lark-doc-{{SDK_VERSION}}.tgz
  node_modules/                  SDK 和依赖由 pnpm 安装管理
  src/
```

具体依赖层级由 pnpm 管理，不需要手动复制到 `node_modules`。安装会更新原应用的 `package.json`、`pnpm-lock.yaml`；保留本地 tgz，便于后续离线重装。后续安装和运行都继续使用 pnpm，不生成 `package-lock.json`。

最后检查安装结果：

```bash
pnpm list lark-doc --depth 0
```

应能列出来自本地 tgz 的 `lark-doc`。SDK 运行依赖已在 tgz 中。若原应用还有缺失的其他依赖，需另行补齐，不删除原项目锁文件来绕过。

## 4. 添加一个最小组件

在原应用中新建 `src/components/LarkDocDemo.vue`，复制以下完整内容。使用普通 `setup()`，无需把原应用改为 `<script setup>`：

```vue
<template>
  <section>
    <button :disabled="!ready" @click="readJSON">读取文档 JSON</button>
    <div ref="host" class="larkdoc-host"></div>
    <pre v-if="output">{{ output }}</pre>
  </section>
</template>

<script>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default {
  setup() {
    const host = ref(null)
    const ready = ref(false)
    const output = ref('')
    let doc

    onMounted(() => {
      doc = new LarkDoc({
        element: host.value,
        title: '我的文档',
        content: '<p>你好，现在可以开始编辑。</p>',
        storage: 'none',
        onReady: () => { ready.value = true },
        onUpdate: ({ json }) => { console.log('文档已更新', json) },
      })
    })

    onBeforeUnmount(() => { if (doc) doc.destroy() })

    function readJSON() {
      output.value = JSON.stringify(doc.getJSON(), null, 2)
    }

    return { host, ready, output, readJSON }
  },
}
</script>

<style scoped>
.larkdoc-host { min-height: 420px; }
pre { max-height: 240px; overflow: auto; white-space: pre-wrap; }
</style>
```

在需要显示编辑器的页面中引入。例如把下面内容合并到你的 `src/App.vue`，保留原页面已有内容：

```vue
<template>
  <LarkDocDemo />
</template>

<script>
import LarkDocDemo from './components/LarkDocDemo.vue'

export default {
  components: { LarkDocDemo },
}
</script>
```

编辑器实例放在普通变量 `doc`，不要用 `ref()` 或 `reactive()` 包装实例。组件离开页面时调用 `destroy()`。本示例不使用自定义元素，不需要添加 `isCustomElement` 配置。

## 5. 初始化配置改哪里

直接修改组件中 `new LarkDoc({ ... })` 的参数：

| 参数 | 用途 |
| --- | --- |
| `element` | 编辑器挂载的位置，保留示例中的 `host.value` |
| `title` | 初始文档标题 |
| `content` | 初始正文，可传 HTML 或已保存的文档 JSON |
| `storage: 'none'` | 由业务应用保存正文；示例不会自动保存到服务器 |
| `onUpdate` | 正文变化后通知应用，示例仅打印 JSON |

默认选图会在本地读取为 Base64，不需要上传服务器。要先上传服务器、等待返回地址后再显示，在 `new LarkDoc({ ... })` 中传入 `uploader`。使用随包 `App.vue` 时，将已有 `uploader: { ... }` 整段替换成下面的 `uploader` 配置，避免保留两个同名字段。


```js
let cancelUpload
const report = (name, event) => console.log(name, event.taskId, event.source, event.mode, event.status)
const uploader = {
  action: 'http://files.intra.local/api/upload', // 换成你的内网接口
  fieldName: 'file',
  timeout: 30000,
  response: {
    success: { path: 'code', equals: 0 },
    url: 'data.url',
    attchId: 'data.id',
    message: 'message',
  },
  beforeUpload: (file, ctx) => { console.log('上传前', ctx.taskId, file.name); return true },
  onStart: event => { cancelUpload = event.cancel; report('开始', event) },
  onProgress: event => console.log('进度', event.taskId, event.percent),
  onRetry: event => report('重试', event),
  onSuccess: event => console.log('服务器返回的图片', event.result.url),
  onError: event => console.error('失败', event.error.message),
  onCancel: event => report('取消', event),
  onReject: event => report('拒绝', event),
  onSettled: event => report('结束', event),
  onCallbackError: error => console.error('应用回调异常', error.message),
}
// 在初始化中传入：new LarkDoc({ element: ..., storage: 'none', uploader })
// 取消按钮的方法中调用：if (cancelUpload) cancelUpload('用户取消')
```

上述代码放在setup() 中、onMounted() 之前。响应字段映射按后端返回格式修改，例如：

```json
{"code":0,"message":"ok","data":{"url":"http://files.intra.local/images/a.png","id":"image-1"}}
```

成功后 SDK 自动插入返回地址，应用无需再插一次。`data.url` 也可以返回合法图片 Data URL。失败或取消不会改为 Base64 插图；未设置 `action/upload` 时才是本地 Base64。选图、粘贴、拖拽、替换、裁剪共用回调，`onSettled` 每次任务只结束一次。`onRetry` 在配置了重试且真正重试时触发，`onCallbackError` 收到 Error。

后端跨域时需配置 CORS，或使用原应用已有的同域代理。完整参数见内网文档 `/blocks/uploader.html`。

## 6. 使用原应用的命令验证

先执行 `pnpm run` 查看原应用已有脚本，使用它原来的启动脚本，例如 `pnpm run dev` 或 `pnpm run serve`；打包使用原项目的构建脚本，通常是 `pnpm run build`。

确认以下结果：

1. 页面出现编辑器，输入文字后控制台有“文档已更新”。
2. 点击“读取文档 JSON”，页面能显示输入的正文。
3. 插入流程图，能看到图形；选择一张本地图片，能显示图片。
4. 原应用构建成功；部署时复制整个构建产物目录，保留图表所需的 chunks、CSS 和字体。

随包 `demo/` 保留完整最小工程的源码、pnpm 锁文件和构建配置，供对照。demo 中的 SDK 依赖指向同包根目录的 `../vendor/`，无需再复制一份 tgz。接入原应用时，直接使用上面的组件和原项目命令即可，不需要先安装 demo。

## 7. 可选：以后改从公司 npm 安装

此方式要求开发机能访问公司 npm，与前面的完全断网安装二选一。

管理员把同一个内网自包含 tgz 发布到公司的**可发布仓库**。SDK 运行依赖已经在包内，不需要再逐个发布这些依赖。以下地址替换为公司实际地址：

下面的 npm 命令用于仓库管理员登录和上传 tgz；Vue3 应用的依赖安装与运行使用 pnpm。

```bash
cd "/d/larkdoc-vue3"
npm login --registry 'http://npm.intra.example/repository/npm-hosted/'
npm publish "./vendor/lark-doc-{{SDK_VERSION}}.tgz" --registry 'http://npm.intra.example/repository/npm-hosted/' --tag intranet
```

内网仓库若已有同名同版本，应先核对内容，不能覆盖已有版本。若内容与仓库中已有版本不同，应由维护者重新出一个独立版本，再同步调整安装版本；不要手改 tgz 中的版本。

管理员确认安装仓库能访问已发布的自包含包后，开发者通过公司现有认证流程完成登录，在**原应用目录**执行：

```bash
cd "/d/work/your-vue3-app"
pnpm add lark-doc@{{SDK_VERSION}} --save-exact --registry 'http://npm.intra.example/repository/npm-group/'
```

以上安装命令以原应用锁文件中的下载地址及 `.npmrc` 的 scope 仓库配置已指向公司 npm 为前提。仅添加 `--registry` 不会迁移旧锁中的公网地址；仍有旧地址时，需按私服实际返回的 `dist.tarball` 迁移并验证，不能只替换域名。

仓库地址必须保留完整路径；发布仓库和安装仓库可能不同。企业原有依赖仍由公司仓库维护。

开发文档独立部署在 Linux，见单独文档部署目录中的 `INSTALL-内网.md`，本包不重复包含 Linux 站点。

命令参考：[pnpm 添加本地包](https://pnpm.io/cli/add)、[pnpm 离线安装](https://pnpm.io/cli/install)。

## 9. 验收范围

解压后先在包根目录执行 `sha256sum -c SHA256SUMS.txt`。该命令只检查交付文件，没有替你执行应用测试。

接入后请用原应用验证图表的六种图标及 SVG，图片服务器返回 URL/合法 Data URL、本地 Base64，以及失败、取消、拒绝、重试和应用回调异常。检查回调中的任务 ID 与最终一次 `onSettled`，确认图片实际请求成功且正文 JSON 已使用返回地址。

SDK 自包含不等于整套业务应用从空依赖冷重装。公司业务代码、真实上传接口与私有 npm 认证仍需在内网联调。历史版本的 Windows 测试和耗时不能代替本包当前版本的实际验收。
