// R3: DBC parsing completion — BA_ attributes, extended frames, multiplex,
// SIG_VALTYPE_ float signals. Each capability has >=5 cases incl. boundaries.
import { describe, it, expect } from 'vitest';
import { parseDBC, decodeSignalFrame, getEnumLabel } from '../dbc.js';
import { buildDecodeContext, decodeFramesChunk, frameIsExtended } from '../signalDecode.js';

// ---------------------------------------------------------------------------
// BA_ / BA_DEF_ / BA_DEF_DEF_ attribute parsing (FR-DB-001)
// ---------------------------------------------------------------------------
describe('R3 BA_ attribute parsing', () => {
  const ATTR_DBC = `
BA_DEF_ BO_ "GenMsgCycleTime" INT 0 65535;
BA_DEF_ BO_ "GenMsgSendType" STRING ;
BA_DEF_ BO_ "VFrameFormat" INT 0 1;
BA_DEF_ SG_ "GenSigStartValue" FLOAT 0 100;
BA_DEF_DEF_ "GenMsgCycleTime" 10;
BA_ "GenMsgCycleTime" BO_ 256 50;
BA_ "GenMsgSendType" BO_ 256 "Cyclic";
BA_ "GenSigStartValue" SG_ 256 Speed 3.5;
BO_ 256 MsgA: 8 ECU
 SG_ Speed : 0|16@1+ (1,0) [0|65535] "" ECU
BO_ 512 MsgB: 8 ECU
 SG_ Temp : 0|8@1+ (1,0) [0|255] "" ECU
`;

  const msgs = parseDBC(ATTR_DBC);
  const msgA = msgs.find(m => m.id === 256);
  const msgB = msgs.find(m => m.id === 512);

  it('parses GenMsgCycleTime into message.cycleTime', () => {
    expect(msgA.cycleTime).toBe(50);
  });

  it('parses GenMsgSendType into message.sendType', () => {
    expect(msgA.sendType).toBe('Cyclic');
  });

  it('parses GenSigStartValue into signal.genSigStartValue', () => {
    expect(msgA.signals[0].genSigStartValue).toBe(3.5);
  });

  it('applies BA_DEF_DEF_ defaults when no explicit BA_ assignment exists (#7)', () => {
    // BA_DEF_DEF_ "GenMsgCycleTime" 10 exists -> default applies
    expect(msgB.cycleTime).toBe(10);
    // no BA_DEF_DEF_ "GenMsgSendType" / "GenSigStartValue" -> stay undefined
    expect(msgB.sendType).toBeUndefined();
    expect(msgB.signals[0].genSigStartValue).toBeUndefined();
  });

  it('tolerates unknown attribute names without throwing (boundary)', () => {
    const dbc = `
BA_ "SomeUnknownAttr" BO_ 256 99;
BO_ 256 MsgA: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const parsed = parseDBC(dbc);
    expect(parsed[0].id).toBe(256);
    expect(parsed[0].cycleTime).toBeUndefined();
    expect(parsed[0].sendType).toBeUndefined();
    expect(parsed[0].frameFormat).toBeUndefined();
  });

  it('parses numeric attributes with decimal values', () => {
    const dbc = `
BA_ "GenMsgCycleTime" BO_ 300 0.5;
BO_ 300 MsgC: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const parsed = parseDBC(dbc);
    expect(parsed[0].cycleTime).toBe(0.5);
  });

  it('keeps BA_DEF_/BA_DEF_DEF_ lines harmless in the message stream', () => {
    expect(msgs.length).toBe(2);
    expect(msgA.signals.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Extended-frame modeling (FR-DB-002)
// ---------------------------------------------------------------------------
describe('R3 extended-frame modeling', () => {
  it('marks a message isExtended when VFrameFormat = 1', () => {
    const dbc = `
BA_ "VFrameFormat" BO_ 2048 1;
BO_ 2048 ExtMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.isExtended).toBe(true);
    expect(msg.frameFormat).toBe(1);
  });

  it('marks a message standard when VFrameFormat = 0', () => {
    const dbc = `
BA_ "VFrameFormat" BO_ 128 0;
BO_ 128 StdMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.isExtended).toBe(false);
  });

  it('leaves isExtended undefined when VFrameFormat is absent', () => {
    const dbc = `
BO_ 128 StdMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.isExtended).toBeUndefined();
  });

  it('decodes a frame only when the extended flag matches the DBC model', () => {
    const dbc = `
BA_ "VFrameFormat" BO_ 2048 1;
BO_ 2048 ExtMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const ctx = buildDecodeContext(parseDBC(dbc), [{ msgId: 2048, signalName: 'S1' }]);
    const extFrame = { timestamp: 0, id: 2048, isExtended: true, data: [0x2A, 0, 0, 0, 0, 0, 0, 0] };
    const stdFrame = { timestamp: 1, id: 2048, isExtended: false, data: [0x2A, 0, 0, 0, 0, 0, 0, 0] };

    const ext = decodeFramesChunk([extFrame], ctx);
    expect(ext.rows).toHaveLength(1);
    expect(ext.rows[0].signals['2048::S1']).toBe(0x2A);

    // format mismatch -> frame is skipped (shows as "未匹配")
    const std = decodeFramesChunk([stdFrame], ctx);
    expect(std.rows).toHaveLength(0);
    expect(std.decodedCount).toBe(0);
  });

  it('treats unmarked frames with id > 0x7FF as extended (heuristic)', () => {
    expect(frameIsExtended({ id: 0x1000, isExtended: undefined })).toBe(true);
    expect(frameIsExtended({ id: 0x1000 })).toBe(true);
    expect(frameIsExtended({ id: 0x123 })).toBe(false);
    expect(frameIsExtended({ id: 0x123, isExtended: false })).toBe(false);
  });

  it('matches a standard DBC message against classic frames', () => {
    const dbc = `
BO_ 128 StdMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const ctx = buildDecodeContext(parseDBC(dbc), [{ msgId: 128, signalName: 'S1' }]);
    const { rows } = decodeFramesChunk([{ timestamp: 0, id: 128, data: [0x11, 0, 0, 0, 0, 0, 0, 0] }], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].signals['128::S1']).toBe(0x11);
  });

  // #7: canonical extended-frame encoding — BO_ raw id carries 0x80000000.
  it('recognizes the canonical 0x80000000 BO_ id flag (#7)', () => {
    // 2147485696 = 0x80000000 | 0x800 (2048)
    const dbc = `
BO_ 2147485696 ExtMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.id).toBe(2048); // normalized & 0x1FFFFFFF
    expect(msg.isExtended).toBe(true);
  });

  it('the 0x80000000 flag takes precedence over the VFrameFormat attribute (#7)', () => {
    const dbc = `
BA_ "VFrameFormat" BO_ 2048 0;
BO_ 2147485696 ExtMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.id).toBe(2048);
    expect(msg.frameFormat).toBe(0); // attribute still recorded
    expect(msg.isExtended).toBe(true); // flag wins
  });

  it('applies BA_DEF_DEF_ "VFrameFormat" 0 as the standard-frame default (#7)', () => {
    const dbc = `
BA_DEF_ BO_ "VFrameFormat" INT 0 1;
BA_DEF_DEF_ "VFrameFormat" 0;
BO_ 128 StdMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.isExtended).toBe(false);
    expect(msg.frameFormat).toBe(0);
  });

  it('normalizes the flag bit on BA_/VAL_/SIG_VALTYPE_ message ids (#7)', () => {
    const dbc = `
BA_ "VFrameFormat" BO_ 2147485696 1;
VAL_ 2147485696 S1 0 "Zero" 1 "One" ;
SIG_VALTYPE_ 2147485696 F2 : 1;
BO_ 2147485696 ExtMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
 SG_ F2 : 8|32@1+ (1,0) [0|0] "" ECU
`;
    const [msg] = parseDBC(dbc);
    expect(msg.id).toBe(2048);
    expect(msg.isExtended).toBe(true); // BA_ with flagged id resolved
    expect(msg.signals[0].valueDefs).toMatchObject({ 0: 'Zero', 1: 'One' });
    expect(msg.signals[1].valueType).toBe('float32');
  });

  it('decodes a canonical-flag extended message against flagged log frames (#7)', () => {
    const dbc = `
BO_ 2147485696 ExtMsg: 8 ECU
 SG_ S1 : 0|8@1+ (1,0) [0|255] "" ECU
`;
    const ctx = buildDecodeContext(parseDBC(dbc), [{ msgId: 2048, signalName: 'S1' }]);
    const ext = decodeFramesChunk([
      { timestamp: 0, id: 2048, isExtended: true, data: [0x2A, 0, 0, 0, 0, 0, 0, 0] }
    ], ctx);
    expect(ext.rows).toHaveLength(1);
    expect(ext.rows[0].signals['2048::S1']).toBe(0x2A);
    const std = decodeFramesChunk([
      { timestamp: 1, id: 2048, isExtended: false, data: [0x2A, 0, 0, 0, 0, 0, 0, 0] }
    ], ctx);
    expect(std.rows).toHaveLength(0); // format mismatch skipped
  });
});

// ---------------------------------------------------------------------------
// Multiplex (FR-DB-003)
// ---------------------------------------------------------------------------
describe('R3 multiplex modeling & decode', () => {
  const MUX_DBC = `
BO_ 512 MuxMsg: 8 ECU
 SG_ MuxSel M : 0|8@1+ (1,0) [0|255] "" ECU
 SG_ SigA m0 : 8|16@1+ (1,0) [0|65535] "" ECU
 SG_ SigB m1 : 8|16@1+ (1,0) [0|65535] "" ECU
 SG_ SigC m2M : 24|8@1+ (1,0) [0|255] "" ECU
VAL_ 512 MuxSel 0 "Zero" 1 "One" ;
`;
  const ctx = buildDecodeContext(parseDBC(MUX_DBC), [
    { msgId: 512, signalName: 'MuxSel' },
    { msgId: 512, signalName: 'SigA' },
    { msgId: 512, signalName: 'SigB' },
    { msgId: 512, signalName: 'SigC' }
  ]);

  it('models switch / dependent mux metadata (incl. m<n>M composite)', () => {
    expect(ctx.signalLookup['512::MuxSel'].muxSwitch.type).toBe('switch');
    expect(ctx.signalLookup['512::SigA'].muxSwitch).toMatchObject({ type: 'dependent', value: 0 });
    expect(ctx.signalLookup['512::SigB'].muxSwitch).toMatchObject({ type: 'dependent', value: 1 });
    expect(ctx.signalLookup['512::SigC'].muxSwitch).toMatchObject({ type: 'dependent', value: 2 });
    expect(parseDBC(MUX_DBC)[0].signals[3].muxIndicator).toBe('m2M');
  });

  it('decodes only the branch matching the mux value', () => {
    const { rows } = decodeFramesChunk([
      { timestamp: 0, id: 512, data: [0x00, 0x78, 0x56, 0, 0, 0, 0, 0] }, // mux=0 -> SigA
      { timestamp: 1, id: 512, data: [0x01, 0x34, 0x12, 0, 0, 0, 0, 0] }  // mux=1 -> SigB
    ], ctx);
    expect(rows[0].signals['512::SigA']).toBe(0x5678);
    expect(rows[0].signals['512::SigB']).toBeUndefined();
    expect(rows[1].signals['512::SigB']).toBe(0x1234);
    expect(rows[1].signals['512::SigA']).toBeUndefined();
  });

  it('keeps only the selector when the mux value has no matching branch (boundary)', () => {
    const { rows } = decodeFramesChunk([
      { timestamp: 0, id: 512, data: [0x05, 0x78, 0x56, 0, 0, 0, 0, 0] } // mux=5, no branch
    ], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].signals['512::MuxSel']).toBe(5);
    expect(rows[0].signals['512::SigA']).toBeUndefined();
    expect(rows[0].signals['512::SigB']).toBeUndefined();
    expect(rows[0].signals['512::SigC']).toBeUndefined();
  });

  it('attaches enum labels to the mux selector', () => {
    const { rows } = decodeFramesChunk([
      { timestamp: 0, id: 512, data: [0x00, 0, 0, 0, 0, 0, 0, 0] }
    ], ctx);
    expect(rows[0].signals['512::MuxSel']).toBe(0);
    expect(rows[0].signals['512::MuxSel::label']).toBe('Zero');
  });

  it('decodes the second-level mux signal (m2M) on its own branch', () => {
    const { rows } = decodeFramesChunk([
      { timestamp: 0, id: 512, data: [0x02, 0, 0, 0xAB, 0, 0, 0, 0] } // mux=2 -> SigC
    ], ctx);
    expect(rows[0].signals['512::SigC']).toBe(0xAB);
    expect(rows[0].signals['512::SigA']).toBeUndefined();
  });

  it('skips non-matching frames when no selected signal applies', () => {
    const ctxA = buildDecodeContext(parseDBC(MUX_DBC), [{ msgId: 512, signalName: 'SigA' }]);
    const { rows } = decodeFramesChunk([
      { timestamp: 0, id: 512, data: [0x01, 0x78, 0x56, 0, 0, 0, 0, 0] } // mux=1, SigA absent
    ], ctxA);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SIG_VALTYPE_ float signals (FR-DB-004)
// ---------------------------------------------------------------------------
describe('R3 SIG_VALTYPE_ float decoding', () => {
  const FLOAT_DBC = `
SIG_VALTYPE_ 256 F32i : 1;
SIG_VALTYPE_ 256 F64i : 2;
SIG_VALTYPE_ 512 F32m : 1;
SIG_VALTYPE_ 512 F64m : 2;
SIG_VALTYPE_ 768 ScaledF : 1;
BO_ 256 FloatMsg: 8 ECU
 SG_ F32i : 0|32@1+ (1,0) [0|0] "" ECU
 SG_ F64i : 32|64@1+ (1,0) [0|0] "" ECU
BO_ 512 FloatMot: 8 ECU
 SG_ F32m : 7|32@0+ (1,0) [0|0] "" ECU
 SG_ F64m : 39|64@0+ (1,0) [0|0] "" ECU
BO_ 768 Scaled: 8 ECU
 SG_ ScaledF : 0|32@1+ (2,-5) [0|0] "" ECU
`;
  const msgs = parseDBC(FLOAT_DBC);

  function sig(id, name) {
    const m = msgs.find(x => x.id === id);
    return m.signals.find(s => s.name === name);
  }

  it('parses SIG_VALTYPE_ 1/2 into float32/float64 valueType', () => {
    expect(sig(256, 'F32i').valueType).toBe('float32');
    expect(sig(256, 'F64i').valueType).toBe('float64');
    expect(sig(512, 'F32m').valueType).toBe('float32');
    expect(sig(512, 'F64m').valueType).toBe('float64');
  });

  it('decodes float32 Intel (little-endian bit pattern)', () => {
    // 1.0 = 0x3F800000, little-endian bytes DB 0F 49 40 style: 00 00 80 3F
    expect(decodeSignalFrame([0x00, 0x00, 0x80, 0x3F, 0, 0, 0, 0], sig(256, 'F32i'))).toBeCloseTo(1.0, 6);
    // pi = 0x40490FDB -> DB 0F 49 40
    expect(decodeSignalFrame([0xDB, 0x0F, 0x49, 0x40, 0, 0, 0, 0], sig(256, 'F32i'))).toBeCloseTo(3.1415927, 6);
  });

  it('decodes float32 Motorola (big-endian bit pattern)', () => {
    expect(decodeSignalFrame([0x3F, 0x80, 0x00, 0x00, 0, 0, 0, 0], sig(512, 'F32m'))).toBeCloseTo(1.0, 6);
    expect(decodeSignalFrame([0x40, 0x49, 0x0F, 0xDB, 0, 0, 0, 0], sig(512, 'F32m'))).toBeCloseTo(3.1415927, 6);
  });

  it('decodes float64 Intel / Motorola', () => {
    // F64i starts at bit 32 -> bytes [4..11]; pi = 0x400921FB54442D18, little: 18 2D 44 54 FB 21 09 40
    const intel64 = [0, 0, 0, 0, 0x18, 0x2D, 0x44, 0x54, 0xFB, 0x21, 0x09, 0x40];
    expect(decodeSignalFrame(intel64, sig(256, 'F64i'))).toBeCloseTo(Math.PI, 12);
    // big-endian: 40 09 21 FB 54 44 2D 18
    const mot64 = [0, 0, 0, 0, 0x40, 0x09, 0x21, 0xFB, 0x54, 0x44, 0x2D, 0x18];
    expect(decodeSignalFrame(mot64, sig(512, 'F64m'))).toBeCloseTo(Math.PI, 12);
  });

  it('returns NaN for the float all-ones bit pattern (boundary)', () => {
    expect(Number.isNaN(decodeSignalFrame([0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0], sig(256, 'F32i')))).toBe(true);
    expect(Number.isNaN(decodeSignalFrame([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], sig(256, 'F64i')))).toBe(true);
    expect(Number.isNaN(decodeSignalFrame([0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0], sig(512, 'F32m')))).toBe(true);
  });

  it('applies scale/offset after the float reinterpretation', () => {
    // raw 1.0, scale=2 offset=-5 -> 2*1.0-5 = -3
    expect(decodeSignalFrame([0x00, 0x00, 0x80, 0x3F, 0, 0, 0, 0], sig(768, 'ScaledF'))).toBeCloseTo(-3.0, 6);
  });

  it('never attaches enum labels to float signals even with VAL_ present (boundary)', () => {
    const dbc = `
SIG_VALTYPE_ 100 F1 : 1;
BO_ 100 M: 8 ECU
 SG_ F1 : 0|32@1+ (1,0) [0|0] "" ECU
VAL_ 100 F1 0 "Zero" 1 "One" ;
`;
    const s = parseDBC(dbc)[0].signals[0];
    expect(s.valueType).toBe('float32');
    expect(s.valueDefs).toBeDefined(); // VAL_ still parsed, but...
    expect(getEnumLabel(s, 1.0)).toBeUndefined(); // ...float signals have no label
  });
});
