---
layout: home

hero:
  name: lark-doc
  text: LarkDoc 风格 Tiptap 文档编辑器
  tagline: Vue 2.7 + Tiptap 3，支持 `new LarkDoc()` 一行接入；静态资源全本地化，媒体默认直连（含旧系统 http 图床）。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 功能配置
      link: /blocks/heading
    - theme: alt
      text: 实例与事件
      link: /guide/instance
    - theme: alt
      text: 在线演示
      link: /demo/
      target: _blank

features:
  - icon: 📝
    title: LarkDoc 风格交互
    details: 块句柄、斜杠命令、气泡菜单、折叠块、目录、查找替换，开箱即得。
  - icon: 🔌
    title: 命令式接入
    details: new LarkDoc({ element, content }) 即可驱动完整工作台，destroy() 无残留。
  - icon: 📴
    title: 资源全本地化
    details: 样式与 KaTeX 字体随包发布；正文媒体默认直连（含 http），可按需切 offline / allowlist。
  - icon: 🤖
    title: AI 可插拔
    details: 内置 11 种 AI 动作；填一个接口地址即可接真实模型，也可直连 OpenAI 协议或自管传输。
  - icon: 🧩
    title: Provider 契约
    details: 持久化 / 协作 / 版本 / 评论 / 授权五大扩展点，全部显式注入。
  - icon: 🏗
    title: Node 14 兼容
    details: 存量 Vue2/webpack4 宿主可直接使用，带完整 Node14 校验与 ES2023 polyfill。
---

::: warning 声明
本项目为**个人学习用途**的开源练习项目，界面与交互模仿飞书文档（Lark Docs），
**与飞书 / 字节跳动无任何关联、非官方产物、禁止商用**，侵权等后果由使用者自负。
详见 [背景与免责声明](/guide/about)。
:::

