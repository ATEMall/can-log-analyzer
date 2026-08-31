// R2: chunked signal decode engine — pure-module tests.
// Verifies that the chunked protocol produces bit-identical results to the
// one-shot path, and that mux / enum / Motorola / Intel semantics are intact.
import { describe, it, expect } from 'vitest';
import { buildDecodeContext, decodeFramesChunk, decodeAll } from '../signalDecode.js';
import { parseDBC } from '../dbc.js';

const DBC = `
VERSION ""
NS_ :
BS_:
BU_: ECU
BO_ 256 MsgA: 8 ECU
 SG_ SigI : 0|16@1+ (0.1,0) [-3276.8|3276.7] "" ECU
 SG_ SigM : 23|8@0+ (1,0) [0|255] "" ECU
BO_ 512 MsgB: 8 ECU
 SG_ MuxSel M : 0|8@1+ (1,0) [0|255] "" ECU
 SG_ SigX m0 : 8|16@1+ (1,0) [0|65535] "" ECU
 SG_ SigY m1 : 8|16@1+ (1,0) [0|65535] "" ECU
VAL_ 512 MuxSel 0 "Zero" 1 "One" ;
`;

function makeFrames(n, id, dataFn) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: i * 0.001,
    channel: 1,
    id,
    direction: 'Rx',
    dlc: 8,
    data: dataFn(i)
  }));
}

describe('R2 signal decode engine', () => {
  const dbcMessages = parseDBC(DBC);

  it('builds a decode context with mux metadata', () => {
    const ctx = buildDecodeContext(dbcMessages, [
      { msgId: 256, signalName: 'SigI' },
      { msgId: 512, signalName: 'MuxSel' },
      { msgId: 512, signalName: 'SigX' },
      { msgId: 512, signalName: 'SigY' }
    ]);
    expect(ctx.signalKeys.length).toBe(4);
    expect(ctx.signalLookup['512::MuxSel'].muxSwitch.type).toBe('switch');
    expect(ctx.signalLookup['512::SigX'].muxSwitch).toMatchObject({ type: 'dependent', value: 0 });
    expect(ctx.signalLookup['512::SigY'].muxSwitch).toMatchObject({ type: 'dependent', value: 1 });
    expect(ctx.encodedCount).toBe(1); // MuxSel has VAL_
  });

  it('decodes Intel / Motorola / enum / mux in one shot', () => {
    const frames = [
      { timestamp: 0, id: 256, data: [0x12, 0x34, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00] },
      { timestamp: 1, id: 512, data: [0x00, 0x78, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00] }, // mux=0 -> SigX
      { timestamp: 2, id: 512, data: [0x01, 0x78, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00] }  // mux=1 -> SigY
    ];
    const { signalData, stats } = decodeAll(frames, [
      { msgId: 256, signalName: 'SigI' },
      { msgId: 256, signalName: 'SigM' },
      { msgId: 512, signalName: 'MuxSel' },
      { msgId: 512, signalName: 'SigX' },
      { msgId: 512, signalName: 'SigY' }
    ], dbcMessages);

    expect(stats.totalFrames).toBe(3);
    expect(stats.decodedFrames).toBe(3);

    // SigI: Intel 0|16 -> 0x3412 = 13330, physical = 13330 * 0.1 = 1333.0
    expect(signalData[0].signals['256::SigI']).toBeCloseTo(1333.0, 5);
    // SigM: Motorola 16|8 -> byte 2 = 0x56
    expect(signalData[0].signals['256::SigM']).toBe(0x56);

    // mux=0 frame: MuxSel label "Zero", SigX present, SigY absent
    const m0 = signalData[1];
    expect(m0.signals['512::MuxSel']).toBe(0);
    expect(m0.signals['512::MuxSel::label']).toBe('Zero');
    expect(m0.signals['512::SigX']).toBe(0x5678);
    expect(m0.signals['512::SigY']).toBeUndefined();

    // mux=1 frame: SigY present, SigX absent
    const m1 = signalData[2];
    expect(m1.signals['512::MuxSel']).toBe(1);
    expect(m1.signals['512::MuxSel::label']).toBe('One');
    expect(m1.signals['512::SigY']).toBe(0x5678);
    expect(m1.signals['512::SigX']).toBeUndefined();
  });

  it('chunked decoding equals one-shot decoding (bit-identical)', () => {
    const frames = [
      ...makeFrames(7, 256, i => [i, i + 1, 0xAB, 0, 0, 0, 0, 0]),
      ...makeFrames(5, 512, i => [i % 2, i + 3, i, 0, 0, 0, 0, 0])
    ];
    const selection = [
      { msgId: 256, signalName: 'SigI' },
      { msgId: 256, signalName: 'SigM' },
      { msgId: 512, signalName: 'MuxSel' },
      { msgId: 512, signalName: 'SigX' },
      { msgId: 512, signalName: 'SigY' }
    ];
    const ctx = buildDecodeContext(dbcMessages, selection);

    // one-shot
    const all = decodeAll(frames, selection, dbcMessages);

    // chunked with size 3
    const chunkRows = [];
    let decoded = 0;
    for (let i = 0; i < frames.length; i += 3) {
      const block = frames.slice(i, i + 3);
      const { rows, decodedCount } = decodeFramesChunk(block, ctx);
      chunkRows.push(...rows);
      decoded += decodedCount;
    }

    expect(decoded).toBe(all.stats.decodedFrames);
    expect(chunkRows.length).toBe(all.signalData.length);
    expect(chunkRows).toEqual(all.signalData);
  });

  it('yields no rows for unknown message IDs', () => {
    const ctx = buildDecodeContext(dbcMessages, [{ msgId: 256, signalName: 'SigI' }]);
    const { rows, decodedCount } = decodeFramesChunk(
      [{ timestamp: 0, id: 999, data: [0, 0, 0, 0, 0, 0, 0, 0] }], ctx
    );
    expect(rows).toEqual([]);
    expect(decodedCount).toBe(0);
  });
});
