# 视图模式

视图模式组件提供阅读模式、演示（幻灯）模式、全屏与文档宽度切换，均归属工具栏 `viewModes` 分组。只读预览可配合 `readonly` 实现纯展示页。

## 配置示例

```ts
new LarkDoc({
  element: '#editor',
  features: { viewModes: true },
  toolbarKeys: ['viewModes'],     // 别名 fullscreen / read / preview / slides / theme
})
```

## 配置与用法

| 模式 | 说明 |
| --- | --- |
| 阅读模式 | 隐藏编辑交互（块句柄、气泡菜单），保留目录与滚动。 |
| 演示模式 | 按章节分页展示，适合评审走查。 |
| 全屏 | 编辑区铺满视口。 |
| 宽度切换 | 标准 / 宽幅两种版心宽度。 |

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features.viewModes` | `boolean` | `true` | 关闭后视图切换入口隐藏。 |
| `readonly` | `boolean` | `false` | 从构造参数或 `doc.setReadonly()` 传入。 |
| `layout.titleBarFixed` | `boolean` | `false` | 标题栏是否吸附顶端（配合长文阅读）。 |
| `layout.toolbarFixed` | `boolean` | `false` | 格式工具栏是否吸附顶端；与 `titleBarFixed` 同开时固定在标题栏下方。 |
| `layout.headerVisible` | `boolean` | `true` | 是否显示顶部标题栏。置 `false` 时整行隐藏，原 `header-actions` 插槽内容（保存 / 模板 / 导入导出等）自动移入格式工具栏右侧「⋯」下拉弹窗。 |

::: tip 纯只读预览页
```ts
new LarkDoc({ element: '#preview', readonly: true, features: { ai: false, search: false } })
```
推荐同时关掉与编辑态绑定的入口，让预览页更干净。
:::
