// TestExample/error_frames/generate.js
//
// Issue #21 端到端样例日志生成器：产出 error_frames.asc，覆盖 R12 统计面板
// 需要识别的全部 Vector 写法：
//   1. 普通数据帧（10 ms 周期，0x100 / 0x101）
//   2. ErrorFrame + Flags/CodeExt/Code 编码位（stuff/form/crc/ack/ack-del/bit/other）
//   3. 文本式 ErrorFrame（"ErrorFrame  Stuff Error"）
//   4. OverloadFrame（过载帧）
//   5. chip status 状态迁移：error active → warning level → error passive → busoff
//   6. 经典 "CAN 1 Bus Off" 事件行
//   7. Statistic 统计行（D/R/XD/XR/E/O/BusLoad），末尾行为累计总量
//
// 生成是确定性的：重复运行产出完全一致（便于对拍与回归）。
// 用法：node TestExample/error_frames/generate.js

const fs = require('fs');
const path = require('path');

const CHANNEL = 1;

/** 确定性伪随机数据字节（无随机数，保证可重复生成）。 */
function dataBytes(seed, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(((seed * 37 + i * 91 + 0x5a) & 0xff).toString(16).toUpperCase().padStart(2, '0'));
  }
  return out.join(' ');
}

function frameLine(timestamp, id, dlc, seed) {
  return `   ${timestamp.toFixed(6)} ${CHANNEL} ${id} Rx d ${dlc} ${dataBytes(seed, dlc)}`;
}

const lines = [];
lines.push('date Tue Sep 19 10:00:00 2026');
lines.push('base hex  timestamps absolute');
lines.push('internal events logged');
lines.push('// version 11.0.0');
lines.push('// R12/#21 sample: ErrorFrame (Flags/Code), OverloadFrame, chip status, Statistic rows');
lines.push('Begin Triggerblock Tue Sep 19 10:00:00 2026');
lines.push('   0.000000 Start of measurement');
lines.push(`   0.000000 CAN ${CHANNEL} Status:chip status error active`);

// ---- 1. 数据帧：10 ms 周期，共 100 帧（0.010s ~ 1.000s）----
let seed = 1;
for (let i = 1; i <= 100; i++) {
  const t = i * 0.01;
  if (i % 10 === 0) {
    lines.push(frameLine(t, '101', 4, seed++));
  } else {
    lines.push(frameLine(t, '100', 8, seed++));
  }
}

// ---- 2. ErrorFrame（Vector Flags/Code 编码位）----
// Code（bits 0-5，数值编码）：0 Bit / 1 Form / 2 Stuff / 3 Other / 4 CRC / 5 Ack-Del / 7 Ack
const errorRows = [
  { t: 0.305, code: 0x0002 },
  { t: 0.315, code: 0x0001 },
  { t: 0.325, code: 0x0004 },
  { t: 0.335, code: 0x0005 },
  { t: 0.345, code: 0x0007 },
  { t: 0.355, code: 0x0000 },
  { t: 0.365, code: 0x0003 }
];
// 注意：真实 Vector 行尾不带文本描述，分类必须由 Flags/Code 编码位推出，
// 因此这里不写任何注释尾巴（否则会走文本分支，掩盖解析缺陷）。
for (const r of errorRows) {
  lines.push(
    `   ${r.t.toFixed(6)} ${CHANNEL} ErrorFrame Flags = 0x0001 CodeExt = 0x0000 Code = 0x${r.code.toString(16).toUpperCase().padStart(4, '0')} ID = 0x00000000 DLC = 0 Position = 0 Length = 0`
  );
}

// ---- 3. 文本式 ErrorFrame / 4. 过载帧 ----
lines.push('   0.420000 1 ErrorFrame  Stuff Error');
lines.push('   0.430000 1 OverloadFrame');

// ---- 5/6. chip status 迁移 + Bus Off 事件行 ----
lines.push(`   0.500000 CAN ${CHANNEL} Status:chip status warning level`);
lines.push(`   0.550000 CAN ${CHANNEL} Status:chip status error passive`);
lines.push(`   0.600000 CAN ${CHANNEL} Status:chip status busoff`);
lines.push(`   0.620000 CAN ${CHANNEL} Bus Off`);
lines.push(`   0.800000 CAN ${CHANNEL} Status:chip status error active`);

// ---- 7. Statistic 统计行（Vector 累计计数；末行为会话总量）----
lines.push('   0.500000 1  Statistic: D 50 R 0 XD 0 XR 0 E 6 O 1 BusLoad 6.4 %');
lines.push('   1.000000 1  Statistic: D 100 R 0 XD 0 XR 0 E 12 O 1 BusLoad 8.2 %');
lines.push('End Triggerblock Wed Sep 19 10:00:01 2026');

const outFile = path.join(__dirname, 'error_frames.asc');
fs.writeFileSync(outFile, `${lines.join('\r\n')}\r\n`, 'utf8');
console.log(`wrote ${outFile} (${lines.length} lines)`);
