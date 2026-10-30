---
layout: home

hero:
  name: lark-doc
  text: 飞书风格的文档编辑器
  tagline: Vue 2.7 + Tiptap 3，一行 new LarkDoc() 接入，自动保存开箱即用。
  actions:
    - theme: brand
      text: 三分钟上手
      link: /guide/getting-started
    - theme: alt
      text: 在线演示
      link: /demo/
      target: _blank
    - theme: alt
      text: 配置总览
      link: /guide/configuration

features:
  - icon: ⚡
    title: 一行接入
    details: new LarkDoc({ element }) 拿到完整工作台，destroy() 无残留。
  - icon: 💾
    title: 自动保存默认开
    details: 草稿写浏览器 IndexedDB，刷新还在；要关掉只改一个字段。
  - icon: 📦
    title: 资源全本地化
    details: 样式、字体、图表与公式区块随包发布，内网直接可用。
  - icon: 🧩
    title: 该有的都有
    details: 块句柄、斜杠命令、折叠、目录、查找替换、导入导出、图表与公式。
---

## 三步上手

1. **选入口**：Vue 2.7 用 `lark-doc`；Vue 3 / React / 纯 HTML 用 `lark-doc/element`。
2. **装包**：`npm i lark-doc`。
3. **贴代码**：`new LarkDoc({ element: '#editor' })`。

```js
import 'lark-doc/style.css'
import { LarkDoc } from 'lark-doc'

new LarkDoc({ element: '#editor', content: '<p>hello lark-doc</p>' })
```

细节看[快速开始](/guide/getting-started)，或者直接开[在线演示](/demo/)改着玩。

::: warning 声明
本项目为**个人学习用途**的开源练习项目，界面与交互模仿飞书文档（Lark Docs），
**与飞书 / 字节跳动无任何关联、非官方产物、禁止商用**，侵权等后果由使用者自负。
详见 [背景与免责声明](/guide/about)。
:::
