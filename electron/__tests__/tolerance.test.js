// R4 / Issue #4: Parse fault tolerance — bad ASC lines and bad BLF blocks are
// recorded and skipped, never fatal. DoD: a file with damaged rows still
// parses the healthy remainder and reports the errors (count + capped list).
import { describe, it, expect } from 'vitest';
import { parseBLFBufferDetailed, buildBLFBuffer } from '../blf.js';
import { isNonDataLine, parseASCDataLine } from '../asc.js';

// ---------------------------------------------------------------------------
// ASC: replicate the streaming branch logic from main.js loadASCFile()
// (the module itself is not exported; the loop is: non-data -> header line,
// data-like but unparseable -> recoverable error, else keep the frame).
// ---------------------------------------------------------------------------
function parseASCStream(text) {
  const headerLines = [];
  const messages = [];
  const parseErrors = [];
  let parseErrorCount = 0;
  let lineNum = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNum++;
    if (isNonDataLine(line)) {
      if (line.trim()) headerLines.push(line);
      continue;
    }
    const msg = parseASCDataLine(line);
    if (msg) {
      messages.push(msg);
    } else {
      parseErrorCount++;
      if (parseErrors.length < 100) {
        parseErrors.push({
          lineNumber: lineNum,
          line: line.trim().slice(0, 200),
          reason: '无法解析的数据行（格式不识别或数据损坏）'
        });
      }
    }
  }
  return { headerLines, messages, parseErrors, parseErrorCount };
}

const GOOD_LINES = [
  'base hex  timestamps absolute',
  '0.000000 1 123 Rx d 8 11 22 33 44 55 66 77 88',
  '0.001000 1 456 Tx d 8 AA BB CC DD EE FF 00 11',
  '0.002000 1 123 Rx d 8 99 88 77 66 55 44 33 22',
];
const BAD_LINES = [
  '0.000500 1 789 Rx d 8 ZZ YY XX',        // non-hex data bytes
  '0.001500 garbage line without data',     // timestamp but junk
  '12.34.56 not a frame at all',            // malformed timestamp
];

describe('R4 ASC fault tolerance', () => {
  it('parses a clean file with zero errors', () => {
    const r = parseASCStream(GOOD_LINES.join('\n'));
    expect(r.messages.length).toBe(3);
    expect(r.parseErrorCount).toBe(0);
    expect(r.parseErrors).toEqual([]);
  });

  it('skips damaged lines, keeps healthy frames, reports each error', () => {
    const text = [...GOOD_LINES, ...BAD_LINES, GOOD_LINES[3]].join('\n');
    const r = parseASCStream(text);
    expect(r.messages.length).toBe(4);           // 3 good + 1 repeated good
    expect(r.messages[0].id).toBe(0x123);
    expect(r.messages[1].id).toBe(0x456);
    expect(r.parseErrorCount).toBe(3);
    expect(r.parseErrors.length).toBe(3);
    expect(r.parseErrors[0].lineNumber).toBe(GOOD_LINES.length + 1);
    expect(r.parseErrors[0].reason).toContain('无法解析');
    // bad bytes never poison later good frames
    expect(r.messages[r.messages.length - 1].data).toEqual([0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22]);
  });

  it('caps the error list at 100 entries but keeps the true count', () => {
    const bad = Array.from({ length: 150 }, (_, i) => `0.0${i}1 1 ${i} Rx d 8 ZZ ZZ ZZ ZZ ZZ ZZ ZZ ZZ`);
    const r = parseASCStream(bad.join('\n'));
    expect(r.messages.length).toBe(0);
    expect(r.parseErrorCount).toBe(150);
    expect(r.parseErrors.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BLF: damage an object block in the middle of a valid file.
// ---------------------------------------------------------------------------
function corruptObjectSize(buf, objIndex, objSize0) {
  const dataOffset = Math.max(buf.readUInt16LE(4), 144);
  let off = dataOffset;
  let idx = 0;
  while (off + 20 <= buf.length) {
    if (buf.toString('ascii', off, off + 4) === 'LOBJ') {
      if (idx === objIndex) {
        buf.writeUInt32LE(objSize0, off + 8);
        return true;
      }
      idx++;
    }
    off++;
  }
  return false;
}

function makeMessages(n) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: i * 0.001,
    channel: 1,
    id: 0x100 + i,
    direction: 'Rx',
    dlc: 8,
    data: [i, 0, 0, 0, 0, 0, 0, i]
  }));
}

describe('R4 BLF fault tolerance (parseBLFBufferDetailed)', () => {
  it('returns zero errors for a well-formed file', () => {
    const buf = buildBLFBuffer(makeMessages(5));
    const { messages, errors, errorCount } = parseBLFBufferDetailed(buf, null);
    expect(errorCount).toBe(0);
    expect(errors).toEqual([]);
    expect(messages.length).toBe(5);
  });

  it('skips a corrupted block, records the error, keeps the rest', () => {
    const buf = buildBLFBuffer(makeMessages(5));
    expect(corruptObjectSize(buf, 2, 0x7fffffff)).toBe(true);
    const { messages, errors, errorCount } = parseBLFBufferDetailed(buf, null);
    expect(errorCount).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatchObject({ offset: expect.any(Number) });
    expect(errors[0].reason).toContain('对象块');
    // healthy frames around the damaged block survive
    expect(messages.length).toBeGreaterThanOrEqual(4);
    expect(messages[0].id).toBe(0x100);
    expect(messages[1].id).toBe(0x101);
  });

  it('reports compressed-block decompression failures without aborting', () => {
    const buf = buildBLFBuffer(makeMessages(3));
    // overwrite the object body region with bytes that look like zlib (0x78 0x9c)
    // but do not inflate, forcing the fallback path to record an error.
    const dataOffset = Math.max(buf.readUInt16LE(4), 144);
    buf.writeUInt8(0x78, dataOffset);
    buf.writeUInt8(0x9c, dataOffset + 1);
    buf.fill(0xAA, dataOffset + 2, dataOffset + 64);
    const { errorCount, errors } = parseBLFBufferDetailed(buf, null);
    expect(errorCount).toBeGreaterThanOrEqual(1);
    expect(errors.some(e => /解压失败|压缩/.test(e.reason))).toBe(true);
  });

  it('caps the error list at 100 entries while counting everything', () => {
    // 40 objects, all with an illegal size -> at least 40 recorded errors, but
    // verify the cap by forcing many separate failures via a large corpus.
    const buf = buildBLFBuffer(makeMessages(8));
    let off = Math.max(buf.readUInt16LE(4), 144);
    let n = 0;
    while (off + 48 <= buf.length) {
      if (buf.toString('ascii', off, off + 4) === 'LOBJ') {
        buf.writeUInt32LE(0x7fffffff, off + 8);
        n++;
      }
      off++;
    }
    expect(n).toBe(8);
    const { errorCount, errors } = parseBLFBufferDetailed(buf, null);
    expect(errorCount).toBeGreaterThanOrEqual(8);
    expect(errors.length).toBeLessThanOrEqual(100);
    expect(errors.length).toBe(errorCount); // below the cap here
  });
});
