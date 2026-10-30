# Quickstart: 全量需求实现验收

## 前置

```bash
cd /Users/cjjxw/codex/.wt-larkdoc/spec-kit-audit
npm install
```

不得在原 `next/0.12` 工作区执行写操作。真实宿主、第二账号、Safari 或移动端不可用时，执行对应 deterministic provider/browser 替代测试并记录 `BLOCKED`。

## MVP：Core 与编辑主环

```bash
npm run test:unit -- test/unit/block-api.test.js test/unit/insert-atomicity.test.js test/unit/heading-container.test.js
npm run test:unit -- test/unit/versioning-core.test.js test/unit/revision.test.js test/unit/collab-editor.test.js
npm run test:unit -- test/unit/table-clip.test.js test/unit/image-insert.test.js test/unit/export-roundtrip.test.js
```

预期：BlockAPI 原子性、历史栈、blockId、协同 origin、剪贴板清洗和容器结构测试通过。

## 异步块、权限和 Provider

```bash
npm run test:unit -- test/unit/file-block.test.js test/unit/sheet.test.js test/unit/web-embed.test.js test/unit/unknown-block.test.js test/unit/security-provider.test.js
npm run test:unit -- test/unit/survey-provider.test.js test/unit/import-provider.test.js test/unit/ai-provider.test.js test/unit/embedded-provider.test.js
```

预期：五态矩阵、拒绝/重试、幂等 task、部分成功、回滚和刷新回读可验证；真实宿主缺口单独标记 BLOCKED。

## 协同、跨端和输出

```bash
npm run test:unit -- test/unit/comments-core.test.js test/unit/comments-ui.test.js test/unit/mention.test.js test/unit/versioning-ui.test.js test/unit/storage-idb.test.js
npm run test:unit -- test/collab/converge.test.js test/collab/hocuspocus-wire.test.js
```

预期：权限投影、评论/版本、离线快照和协同收敛不产生重复提交或远端覆盖。

## 全量门禁

```bash
npm run check:gate
npm run check:artifacts
npm run verify:all
npm run check:perf
```

若命令因缺少浏览器、宿主账号、依赖或资源而失败，记录首个失败点、环境原因和替代证据，不把环境阻塞误判为源码通过。
