import { describe, it, expect, vi } from 'vitest';
import {
  isStrictMode,
  skipNotice,
  strictFailure,
  handleMissingEnv,
  EXIT_CODES
} from '../compareEnv';

describe('#22 compareEnv — 严格模式判定', () => {
  it('默认非严格（开发机普通运行）', () => {
    expect(isStrictMode([], {})).toBe(false);
    expect(isStrictMode(['node', 'compare.js'], {})).toBe(false);
    expect(isStrictMode([], { CI: '0' })).toBe(false);
  });

  it('--strict / CI=1 / CANTOOLS_STRICT=1 触发严格模式', () => {
    expect(isStrictMode(['--strict'], {})).toBe(true);
    expect(isStrictMode([], { CI: '1' })).toBe(true);
    expect(isStrictMode([], { CI: 'true' })).toBe(true);
    expect(isStrictMode([], { CANTOOLS_STRICT: '1' })).toBe(true);
  });

  it('参数/环境异常输入不抛错', () => {
    expect(isStrictMode(undefined, undefined)).toBe(false);
    expect(isStrictMode(null, null)).toBe(false);
  });
});

describe('#22 compareEnv — 缺失 cantools 环境的处置', () => {
  it('普通模式：打印显著提示并 exit 0（保留跳过行为）', () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handleMissingEnv('python not found', { strict: false, log, error, exit });
    expect(exit).toHaveBeenCalledWith(EXIT_CODES.OK);
    const msg = log.mock.calls[0][0];
    expect(msg).toContain('NOT executed');
    expect(msg).toContain('pip install -r requirements.txt');
    expect(msg).toContain('python not found');
    expect(error).not.toHaveBeenCalled();
  });

  it('严格模式：打印 FATAL 并非零退出（禁止无环境静默 skip）', () => {
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handleMissingEnv('python not found', { strict: true, log, error, exit });
    expect(exit).toHaveBeenCalledWith(EXIT_CODES.ENV_MISSING);
    expect(EXIT_CODES.ENV_MISSING).not.toBe(0);
    const msg = error.mock.calls[0][0];
    expect(msg).toContain('FATAL');
    expect(msg).toContain('cantools==43.0.2');
    expect(log).not.toHaveBeenCalled();
  });

  it('未显式传 strict 时按 argv/env 推断', () => {
    const exit = vi.fn();
    handleMissingEnv('x', { argv: ['--strict'], env: {}, log: vi.fn(), error: vi.fn(), exit });
    expect(exit).toHaveBeenCalledWith(EXIT_CODES.ENV_MISSING);
  });
});

describe('#22 compareEnv — 文案', () => {
  it('skipNotice 明确声明「本次无证据」', () => {
    const notice = skipNotice();
    expect(notice).toContain('NO evidence');
    expect(notice).toContain('--strict');
  });

  it('strictFailure 指向锁定版本的环境准备方式', () => {
    expect(strictFailure('missing')).toContain('requirements.txt');
  });

  it('退出码区分「环境缺失」与「真的不一致」', () => {
    expect(EXIT_CODES.ENV_MISSING).not.toBe(EXIT_CODES.MISMATCH);
    expect(EXIT_CODES.DBC_LOAD_FAILED).not.toBe(EXIT_CODES.MISMATCH);
  });
});
