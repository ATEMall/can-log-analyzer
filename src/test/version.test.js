// =====================================================================
// #23 — 版本号一致性：package.json 是唯一来源，产物与断言都不漂移
//
// 背景（PM #23）：`package.json` 仍为 2.1.1，而 R14 单测里「应用版本: v2.2.0」
// 来自 mock 注入的硬编码字面量 —— 断言恒绿、真实值可漂移。本文件把
// 「版本从哪来」钉死在源码层面：
//   1. package.json 版本号合法且 ≥ 2.2.0（发版基线）
//   2. 主进程 APP_VERSION 只能来自 app.getVersion()
//   3. 诊断日志 / About 对话框都复用该常量（不再各写一份）
//   4. 渲染进程不硬编码版本号（诊断文案用 IPC 回传值）
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';

function readRepoFile(rel) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

function versionTuple(v) {
  return String(v).split('.').map(n => parseInt(n, 10));
}

describe('#23 版本号一致性', () => {
  it('package.json 版本号是合法 semver 且已达 2.2.0 发版基线', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = versionTuple(pkg.version);
    const [baseMajor, baseMinor] = versionTuple('2.2.0');
    const reached = major > baseMajor || (major === baseMajor && minor >= baseMinor);
    expect(reached, `package.json version ${pkg.version} < 2.2.0`).toBe(true);
    expect(Number.isInteger(patch)).toBe(true);
  });

  it('主进程 APP_VERSION 唯一来源是 app.getVersion()（无硬编码字面量）', () => {
    const main = readRepoFile('electron/main.js');
    expect(main).toMatch(/const\s+APP_VERSION\s*=\s*app\.getVersion\(\)/);
    // 任何形如 APP_VERSION = '2.2.0' / = "2.1.1" 的赋值都应立即失败。
    expect(main).not.toMatch(/APP_VERSION\s*=\s*['"]\d/);
  });

  it('诊断日志与 About 对话框复用同一常量', () => {
    const main = readRepoFile('electron/main.js');
    // diagLog 初始化与 About 文案都取 APP_VERSION，而不是各自写字面量。
    expect(main).toMatch(/version:\s*APP_VERSION/);
    expect(main).toMatch(/Version:\s*v\$\{APP_VERSION\}/);
  });

  it('渲染进程不硬编码版本号（诊断文案取自 IPC 回传）', () => {
    const app = readRepoFile('src/App.jsx');
    expect(app).not.toMatch(/应用版本:\s*v?\d+\.\d+/);
    expect(app).toMatch(/应用版本:\s*\$\{/);
  });

  it('诊断信息单测断言引用 package.json，而非字面量', () => {
    const test = readRepoFile('src/components/__tests__/App.test.jsx');
    expect(test).toMatch(/应用版本: v\$\{pkg\.version\}/);
    expect(test).not.toMatch(/应用版本: v\d+\.\d+/);
  });
});
