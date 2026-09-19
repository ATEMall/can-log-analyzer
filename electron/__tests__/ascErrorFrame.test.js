import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseASCErrorLine,
  classifyErrorCategory,
  classifyErrorFields,
  parseErrorFields,
  parseStatisticBody,
  isErrorEventCandidate
} from '../asc';

describe('R12 parseASCErrorLine — error frames', () => {
  it('parses the Vector classic form "<ts> <channel> ErrorFrame"', () => {
    const ev = parseASCErrorLine('1.234567 1 ErrorFrame');
    expect(ev).toBeTruthy();
    expect(ev.timestamp).toBeCloseTo(1.234567, 6);
    expect(ev.channel).toBe(1);
    expect(ev.kind).toBe('error-frame');
    expect(ev.category).toBe('other');
  });

  it('parses "CAN ErrorFrame" and "Error Frame" spellings', () => {
    expect(parseASCErrorLine('0.500000 CAN ErrorFrame')?.kind).toBe('error-frame');
    expect(parseASCErrorLine('0.500000 Error Frame')?.kind).toBe('error-frame');
  });

  it('classifies the trailing error text (stuff / form / ack / crc / bit)', () => {
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Stuff Error').category).toBe('stuff');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Form Error').category).toBe('form');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  ACK Error').category).toBe('ack');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  CRC Error').category).toBe('crc');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Bit1 Error').category).toBe('bit1');
    expect(parseASCErrorLine('0.1 1 ErrorFrame  Bit0 Error').category).toBe('bit0');
  });

  it('treats overload frames as their own category', () => {
    expect(parseASCErrorLine('0.2 1 OverloadFrame').category).toBe('overload');
  });
});

describe('R12 parseASCErrorLine — bus state events', () => {
  it('recognises Bus Off / Error Passive / Error Active', () => {
    expect(parseASCErrorLine('2.000000 CAN Bus Off').state).toBe('bus-off');
    expect(parseASCErrorLine('2.000000 1 BusOff').state).toBe('bus-off');
    expect(parseASCErrorLine('2.000000 Error Passive').state).toBe('error-passive');
    expect(parseASCErrorLine('2.000000 Error Active').state).toBe('error-active');
  });

  it('recognises the "Chip State:" spelling', () => {
    const ev = parseASCErrorLine('3.500000 Chip State: busoff');
    expect(ev).toBeTruthy();
    expect(ev.kind).toBe('bus-state');
    expect(ev.state).toBe('bus-off');
  });

  it('returns null for normal data lines', () => {
    expect(parseASCErrorLine('0.001000 1 123 Rx d 8 11 22 33 44 55 66 77 88')).toBeNull();
    expect(parseASCErrorLine('base hex  timestamps absolute')).toBeNull();
    expect(parseASCErrorLine('')).toBeNull();
    expect(parseASCErrorLine(null)).toBeNull();
  });
});

describe('R12 classifyErrorCategory', () => {
  it('defaults to "other" for unknown text', () => {
    expect(classifyErrorCategory('', false)).toBe('other');
    expect(classifyErrorCategory(undefined, false)).toBe('other');
  });
});

// =====================================================================
// #21 — Vector Statistic 行 + ErrorFrame Flags/Code 编码位 + chip status
// =====================================================================
describe('#21 parseASCErrorLine — Vector Statistic 统计行', () => {
  const row = '   1.000000 1  Statistic: D 12 R 0 XD 1 XR 0 E 5 O 0 BusLoad 8.2 %';

  it('不再返回 null，识别为 statistic 事件', () => {
    const ev = parseASCErrorLine(row);
    expect(ev).toBeTruthy();
    expect(ev.kind).toBe('statistic');
    expect(ev.timestamp).toBeCloseTo(1.0, 6);
    expect(ev.channel).toBe(1);
  });

  it('解析 E / O 错误与过载计数以及 BusLoad', () => {
    const ev = parseASCErrorLine(row);
    expect(ev.errorCount).toBe(5);
    expect(ev.overloadCount).toBe(0);
    expect(ev.busLoad).toBeCloseTo(8.2, 6);
  });

  it('解析 D / R / XD / XR 计数（不把 XD/XR 误判成 D/R）', () => {
    const ev = parseASCErrorLine(row);
    expect(ev.counts).toEqual({ d: 12, r: 0, xd: 1, xr: 0, errorCount: 5, overloadCount: 0 });
  });

  it('兼容 "CAN 1 Statistic:" 写法与缺失字段', () => {
    const a = parseASCErrorLine('0.500000 CAN 1 Statistic: D 3 E 1 BusLoad 1.5 %');
    expect(a.kind).toBe('statistic');
    expect(a.channel).toBe(1);
    expect(a.errorCount).toBe(1);
    expect(a.busLoad).toBeCloseTo(1.5, 6);

    const b = parseASCErrorLine('0.500000 2  Statistic: D 0 R 0 XD 0 XR 0 E 0 O 0 BusLoad 0 %');
    expect(b.busLoad).toBe(0);
    expect(b.errorCount).toBe(0);
  });

  it('parseStatisticBody 对空/异常输入保持安全', () => {
    expect(parseStatisticBody('').busLoad).toBeNull();
    expect(parseStatisticBody('D abc E 1').counts.errorCount).toBe(1);
  });
});

describe('#21 parseASCErrorLine — ErrorFrame Flags/Code 编码位', () => {
  // Code bits 0-5：0 Bit / 1 Form / 2 Stuff / 3 Other / 4 CRC / 5 Ack-Del / 7 Ack
  const cases = [
    ['0x0000', 'bit'],
    ['0x0001', 'form'],
    ['0x0002', 'stuff'],
    ['0x0003', 'other'],
    ['0x0004', 'crc'],
    ['0x0005', 'ack'],
    ['0x0007', 'ack']
  ];

  it('PM 复现用例：仅带 Flags 的行不再一律 other', () => {
    const ev = parseASCErrorLine('   0.123456 CAN 1 ErrorFrame Flags = 0x0001');
    expect(ev).toBeTruthy();
    expect(ev.kind).toBe('error-frame');
    expect(ev.flags).toBe(1);
  });

  it('按 Code 编码位映射到 stuff/form/ack/crc/bit/other', () => {
    for (const [code, category] of cases) {
      const ev = parseASCErrorLine(`0.3 1 ErrorFrame Flags = 0x0001 Code = ${code}`);
      expect(ev.category, `Code ${code}`).toBe(category);
    }
  });

  it('无 Code 时回落到 CodeExt（bits 6-11）', () => {
    const stuff = parseASCErrorLine('0.3 1 ErrorFrame Flags = 0x0001 CodeExt = 0x0080');
    expect(stuff.codeExt).toBe(0x80);
    expect(stuff.category).toBe('stuff'); // 0x80 >> 6 = 2
  });

  it('文本描述优先于编码位（保持既有行为不回退）', () => {
    const ev = parseASCErrorLine('0.3 1 ErrorFrame Flags = 0x0001 Code = 0x0002  Stuff Error');
    expect(ev.category).toBe('stuff');
  });

  it('解析出 Flags/Code/CodeExt/ID/DLC/Position/Length 明细', () => {
    const fields = parseErrorFields(
      'Flags = 0x0001 CodeExt = 0x0000 Code = 0x0002 ID = 0x00000123 DLC = 8 Position = 12 Length = 1'
    );
    expect(fields).toMatchObject({
      flags: 1, codeExt: 0, code: 2, id: 0x123, dlc: 8, position: 12, length: 1
    });
    expect(parseErrorFields('')).toEqual({});
  });

  it('classifyErrorFields 无字段时返回 null', () => {
    expect(classifyErrorFields(null)).toBeNull();
    expect(classifyErrorFields({})).toBeNull();
  });
});

describe('#21 parseASCErrorLine — CANoe chip status 事件', () => {
  it('识别 "CAN 1 Status:chip status <state>" 四种状态', () => {
    expect(parseASCErrorLine('0.1 CAN 1 Status:chip status error active').state).toBe('error-active');
    expect(parseASCErrorLine('0.2 CAN 1 Status:chip status warning level').state).toBe('warning');
    expect(parseASCErrorLine('0.3 CAN 1 Status:chip status error passive').state).toBe('error-passive');
    expect(parseASCErrorLine('0.4 CAN 1 Status:chip status busoff').state).toBe('bus-off');
  });

  it('既有 "CAN 1 Bus Off" / "Chip State:" 写法不回退', () => {
    expect(parseASCErrorLine('0.5 CAN 1 Bus Off').state).toBe('bus-off');
    expect(parseASCErrorLine('0.6 Chip State: busoff').state).toBe('bus-off');
  });
});

describe('#21 isErrorEventCandidate', () => {
  it('统计行 / chip status 行进入事件解析通道', () => {
    expect(isErrorEventCandidate('1.000000 1  Statistic: D 1 E 5 BusLoad 8.2 %')).toBe(true);
    expect(isErrorEventCandidate('0.500000 CAN 1 Status:chip status warning level')).toBe(true);
    expect(isErrorEventCandidate('0.300000 1 ErrorFrame Flags = 0x0001')).toBe(true);
  });

  it('普通数据行不进入事件通道', () => {
    expect(isErrorEventCandidate('0.001000 1 123 Rx d 8 11 22 33 44 55 66 77 88')).toBe(false);
    expect(isErrorEventCandidate('base hex  timestamps absolute')).toBe(false);
  });
});

describe('#21 端到端样例日志 TestExample/error_frames/error_frames.asc', () => {
  const file = path.join(__dirname, '..', '..', 'TestExample', 'error_frames', 'error_frames.asc');
  const events = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(isErrorEventCandidate)
    .map(parseASCErrorLine)
    .filter(Boolean);

  it('样例存在且可解析出事件', () => {
    expect(events.length).toBeGreaterThan(0);
  });

  it('错误帧 / 过载帧 / 状态 / 统计行分类齐全', () => {
    const frames = events.filter(e => e.kind === 'error-frame');
    const states = events.filter(e => e.kind === 'bus-state');
    const stats = events.filter(e => e.kind === 'statistic');

    expect(frames.length).toBe(9);            // 7 × Code 编码 + 1 × 文本 + 1 × 过载帧
    expect(frames.filter(f => f.category === 'overload').length).toBe(1);
    expect(new Set(frames.map(f => f.category)))
      .toEqual(new Set(['stuff', 'form', 'crc', 'ack', 'bit', 'other', 'overload']));
    expect(states.filter(s => s.state === 'bus-off').length).toBe(2);
    expect(states.filter(s => s.state === 'warning').length).toBe(1);
    expect(stats.length).toBe(2);
  });

  it('统计行声明的累计计数高于逐行解析数（用于「以日志声明为准」提示）', () => {
    const stats = events.filter(e => e.kind === 'statistic');
    const declared = Math.max(...stats.map(s => s.errorCount));
    expect(declared).toBe(12);
    expect(declared).toBeGreaterThan(events.filter(e => e.kind === 'error-frame').length);
  });
});
