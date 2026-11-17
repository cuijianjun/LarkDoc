#!/usr/bin/env node
/**
 * 增量单测入口：只跑与「当前改动」相关的测试，全局守卫始终追加。
 *
 *   npm run test:affected -- src/core/comments/thread.js   # 显式指定本任务文件
 *   npm run test:affected -- --since HEAD~3                # 按提交范围
 *   npm run test:affected                                 # 工作区未提交改动
 *   npm run test:affected -- --dry-run                    # 只看范围，不执行
 *
 * 依赖 Vitest 5 的 `related`：它按模块依赖图反查受影响测试文件，
 * 不需要维护「模块 → 测试」映射表。全量只在发布前跑 `npm run check:unit`。
 */
import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// diff 反查不到的全局守卫：任何源码改动都必须跑（见 DEVELOPMENT.md 分层门禁）
const GUARDS = [
  'test/unit/no-dead-code.test.js',
  'test/unit/core-no-vue.test.js',
  'test/unit/editor-dom-snapshot.test.js',
  'test/unit/production-evidence.test.js',
  'test/unit/perf-gate.test.js',
];

const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx|vue)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|coverage|\.git)(\/|$)/;

const argv = process.argv.slice(2);
const sinceIndex = argv.indexOf('--since');
const since = sinceIndex >= 0 ? argv[sinceIndex + 1] : null;
const dryRun = argv.includes('--dry-run');
const explicit = argv.filter((arg, i) =>
  !arg.startsWith('--') && (sinceIndex < 0 || (i !== sinceIndex && i !== sinceIndex + 1)));

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function collect() {
  if (explicit.length) return { files: explicit, source: '显式指定' };
  if (since) {
    return { files: git(['diff', '--name-only', '--diff-filter=ACMR', since, 'HEAD']), source: `git diff ${since} HEAD` };
  }
  // git diff HEAD 已包含 staged + unstaged；未跟踪文件要单独取
  return {
    files: [...new Set([
      ...git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ])],
    source: '工作区未提交改动',
  };
}

const { files, source } = collect();
const changed = [...new Set(files)]
  .filter((file) => !SKIP_DIR.test(file) && SOURCE_EXT.test(file) && existsSync(resolve(ROOT, file)));
const guards = GUARDS.filter((file) => existsSync(resolve(ROOT, file)));
const targets = [...new Set([...changed, ...guards])];

console.log(`[test:affected] 来源：${source}`);
console.log(`[test:affected] 改动源码 ${changed.length} 个 + 全局守卫 ${guards.length} 个 → related 输入 ${targets.length} 个`);
if (files.length !== changed.length) {
  console.log(`[test:affected] 忽略 ${files.length - changed.length} 个非源码 / 不存在文件`);
}
if (changed.length > 20) {
  console.warn('[test:affected] 改动面偏大，增量会退化成接近全量；建议显式传本任务文件，或按任务切片提交。');
}
if (!changed.length) {
  console.log('[test:affected] 没有源码改动，跳过（全量请用 npm run check:unit）。');
  process.exit(0);
}
if (dryRun) {
  targets.forEach((file) => console.log('  ' + file));
  process.exit(0);
}

const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// 只走 `unit` 项目：改到 commentsMixin / DocumentSession 这类枢纽时，构建契约用例
// 会被依赖图反查出来，而它要真跑 rollup（build-contract 单支 69s）。增量门禁宁可
// 快，构建契约交给 `npm run test:build` 或全量 `check:unit`（见 vitest.config.js）。
const args = ['vitest', 'related', ...targets, '--run', '--reporter=dot', '--project=unit'];
const result = spawnSync(bin, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CI: 'true' },
});
if (result.error) {
  console.error(`[test:affected] 启动失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
