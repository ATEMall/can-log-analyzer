// R11 / Issue #16: 全局搜索索引（消息名 / 信号名 / CAN ID 十进制+十六进制 / DID）。
// 纯模块单测：不依赖 Electron，只验证索引与查询语义。
import { describe, it, expect } from 'vitest';
import { parseIdQuery, buildFrameIndex, buildDbcIndex, searchFrames } from '../searchIndex.js';

const dbcMessages = [
  {
    id: 0x123,
    name: 'VCU_Status',
    signals: [{ name: 'VehicleSpeed' }, { name: 'DID_F190' }]
  },
  {
    id: 0x204,
    name: 'BMS_Info',
    signals: [{ name: 'PackVoltage' }]
  }
];

function makeFrames() {
  return [
    { id: 0x123, timestamp: 0.001 },
    { id: 0x204, timestamp: 0.002 },
    { id: 0x123, timestamp: 0.003 },
    { id: 0x123, timestamp: 0.004 },
    { id: 0x999, timestamp: 0.005 }
  ];
}

describe('searchIndex.parseIdQuery', () => {
  it('parses 0x-prefixed hex', () => {
    expect(parseIdQuery('0x123')).toEqual([0x123]);
    expect(parseIdQuery('0X1A2')).toEqual([0x1a2]);
  });

  it('parses decimal and also offers the hex interpretation', () => {
    expect(parseIdQuery('291')).toContain(291); // 291 === 0x123
    expect(parseIdQuery('16')).toContain(16);
    expect(parseIdQuery('16')).toContain(0x16);
  });

  it('parses bare hex containing a-f', () => {
    expect(parseIdQuery('F190')).toEqual([0xf190]);
  });

  it('returns an empty list for plain text', () => {
    expect(parseIdQuery('VCU_Status')).toEqual([]);
    expect(parseIdQuery('')).toEqual([]);
  });
});

describe('searchIndex.buildFrameIndex', () => {
  it('aggregates count / firstIndex / firstTimestamp in a single pass', () => {
    const idx = buildFrameIndex(makeFrames());
    expect(idx.total).toBe(5);
    expect(idx.byId.get(0x123)).toEqual({ id: 0x123, count: 3, firstIndex: 0, firstTimestamp: 0.001 });
    expect(idx.byId.get(0x204)).toEqual({ id: 0x204, count: 1, firstIndex: 1, firstTimestamp: 0.002 });
    expect(idx.byId.get(0x999).firstIndex).toBe(4);
  });

  it('tolerates an empty corpus', () => {
    expect(buildFrameIndex([]).byId.size).toBe(0);
    expect(buildFrameIndex(null).total).toBe(0);
  });
});

describe('searchIndex.buildDbcIndex', () => {
  it('collects message + signal names', () => {
    const { entries } = buildDbcIndex(dbcMessages);
    expect(entries).toHaveLength(2);
    expect(entries[0].signals).toEqual(['VehicleSpeed', 'DID_F190']);
  });
});

describe('searchIndex.searchFrames', () => {
  const idx = buildFrameIndex(makeFrames());

  it('matches a CAN ID by decimal or hex and reports hit count + first frame', () => {
    for (const q of ['0x123', '291']) {
      const r = searchFrames(idx, dbcMessages, q);
      expect(r.kind === 'id' || r.kind === 'mixed').toBe(true);
      expect(r.matchCount).toBe(3);
      expect(r.firstIndex).toBe(0);
      expect(r.firstTimestamp).toBe(0.001);
    }
  });

  it('matches a message name (case-insensitive) and resolves its frames', () => {
    const r = searchFrames(idx, dbcMessages, 'vcu_status');
    expect(r.kind).toBe('name');
    expect(r.matchedIds).toEqual([0x123]);
    expect(r.matchCount).toBe(3);
    expect(r.nameMatches[0].msgName).toBe('VCU_Status');
  });

  it('matches a signal name and a DID-style name', () => {
    const bySignal = searchFrames(idx, dbcMessages, 'PackVoltage');
    expect(bySignal.nameMatches[0].msgId).toBe(0x204);
    expect(bySignal.nameMatches[0].signals).toEqual(['PackVoltage']);

    const byDid = searchFrames(idx, dbcMessages, 'F190');
    expect(byDid.nameMatches).toHaveLength(1);
    expect(byDid.nameMatches[0].msgId).toBe(0x123);
    expect(byDid.nameMatches[0].signals).toEqual(['DID_F190']);
  });

  it('returns DBC hits with zero frames when the log has no such ID', () => {
    const r = searchFrames(idx, dbcMessages, 'BMS_Info');
    // BMS_Info is 0x204 which IS present -> 1 frame; use a name absent from the log.
    expect(r.matchCount).toBe(1);

    const onlyDbc = searchFrames(buildFrameIndex([]), dbcMessages, 'BMS_Info');
    expect(onlyDbc.matchCount).toBe(0);
    expect(onlyDbc.nameMatches).toHaveLength(1);
    expect(onlyDbc.firstIndex).toBeNull();
  });

  it('reports kind=none when nothing matches', () => {
    const r = searchFrames(idx, dbcMessages, 'zzz-not-there');
    expect(r.kind).toBe('none');
    expect(r.matchCount).toBe(0);
    expect(r.firstIndex).toBeNull();
  });

  it('returns kind=empty for a blank query', () => {
    expect(searchFrames(idx, dbcMessages, '   ').kind).toBe('empty');
  });

  it('is DBC-only when scope is "dbc" (当前视图)', () => {
    const r = searchFrames(idx, dbcMessages, '0x123', { scope: 'dbc' });
    expect(r.matchCount).toBe(0);
    expect(r.kind).toBe('none');
    expect(r.firstIndex).toBeNull();

    const r2 = searchFrames(idx, dbcMessages, 'VCU_Status', { scope: 'dbc' });
    expect(r2.matchCount).toBe(1);
    expect(r2.nameMatches).toHaveLength(1);
    expect(r2.firstIndex).toBeNull();
  });

  it('does not scan frames when no index is supplied', () => {
    const r = searchFrames(null, dbcMessages, '0x123');
    expect(r.matchCount).toBe(0);
    expect(r.firstIndex).toBeNull();
  });
});
