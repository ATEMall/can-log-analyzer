// XCP（ASAM MCD-1 XCP）帧解码（v4.0 / B3-T5）
//
// XCP on CAN 用两条（或多条）CAN ID：
//   - CTO（主→从）：命令帧，第 0 字节 = 命令码
//   - 响应（从→主）：第 0 字节 = RES(0xFF) / ERR(0xFE) / EV(0xFD) / SERV(0xFC)
//   - DTO（从→主，DAQ）：第 0 字节 = PID（ODT 编号），其后为该 ODT 的数据
//
// DAQ 的 ODT 布局由主机在运行时配置（ALLOC_DAQ / ALLOC_ODT / ALLOC_ODT_ENTRY /
// SET_DAQ_PTR / WRITE_DAQ / START_STOP_DAQ_LIST），故本模块先从 CTO 流重建配置，
// 再据此把 DTO 的 PID 解成 (DAQ list, ODT) 并拆出各 ODT entry 的原始值。

'use strict';

const CTO_COMMANDS = {
  0xFF: 'CONNECT', 0xFE: 'DISCONNECT', 0xFD: 'GET_STATUS', 0xFC: 'SYNCH',
  0xFB: 'GET_COMM_MODE_INFO', 0xFA: 'GET_ID', 0xF9: 'SET_REQUEST',
  0xF8: 'GET_SEED', 0xF7: 'UNLOCK', 0xF6: 'SET_MTA', 0xF5: 'UPLOAD',
  0xF4: 'SHORT_UPLOAD', 0xF3: 'BUILD_CHECKSUM', 0xF2: 'TRANSPORT_LAYER_CMD',
  0xF1: 'USER_CMD', 0xF0: 'DOWNLOAD', 0xEF: 'DOWNLOAD_NEXT', 0xEE: 'DOWNLOAD_MAX',
  0xED: 'SHORT_DOWNLOAD', 0xEC: 'MODIFY_BITS',
  0xE7: 'SET_CAL_PAGE', 0xE6: 'GET_CAL_PAGE', 0xE5: 'GET_PAG_PROCESSOR_INFO',
  0xE4: 'GET_SEGMENT_INFO', 0xE3: 'GET_PAGE_INFO',
  0xE2: 'SET_DAQ_PTR', 0xE1: 'WRITE_DAQ', 0xE0: 'SET_DAQ_LIST_MODE',
  0xDF: 'GET_DAQ_LIST_MODE', 0xDE: 'START_STOP_DAQ_LIST', 0xDD: 'START_STOP_SYNCH',
  0xDC: 'GET_DAQ_CLOCK', 0xDB: 'READ_DAQ', 0xDA: 'GET_DAQ_EVENT_INFO',
  0xD9: 'CLEAR_DAQ_LIST', 0xD8: 'GET_DAQ_LIST_INFO', 0xD7: 'FREE_DAQ',
  0xD6: 'ALLOC_DAQ', 0xD5: 'ALLOC_ODT', 0xD4: 'ALLOC_ODT_ENTRY',
  0xD3: 'GET_DAQ_PROCESSOR_INFO', 0xD2: 'GET_DAQ_RESOLUTION_INFO',
  0xD1: 'GET_DAQ_LIST_CONFIGURATION'
};

// 响应包（从→主）PID
const RESPONSE_PIDS = { 0xFF: 'RES', 0xFE: 'ERR', 0xFD: 'EV', 0xFC: 'SERV' };

/**
 * 解码一条 CTO 命令帧。
 * @param {number[]|Buffer} data
 * @returns {{cmd:number,name:string,params:number[]}}
 */
function decodeCTO(data) {
  const d = Array.isArray(data) ? data : Array.from(data || []);
  const cmd = d.length ? d[0] : null;
  return { cmd, name: cmd == null ? null : (CTO_COMMANDS[cmd] || `UNKNOWN_0x${cmd.toString(16).toUpperCase()}`), params: d.slice(1) };
}

/**
 * 解码一条响应帧（从→主）。
 */
function decodeResponse(data) {
  const d = Array.isArray(data) ? data : Array.from(data || []);
  const pid = d.length ? d[0] : null;
  return { pid, kind: pid == null ? null : (RESPONSE_PIDS[pid] || null), payload: d.slice(1) };
}

/**
 * 从 CTO 流重建 DAQ 配置（ODT entry 布局）。
 * @param {Array<{time:number,data:number[]}>} ctoFrames
 * @returns {{daqLists:object[],odtEntries:object[],started:object[],odtCounts:number[],firstPid:number|null}}
 */
function buildDaqConfig(ctoFrames) {
  let daqCount = 0;
  const odtCounts = [];          // 每个 DAQ list 的 ODT 数
  const odtEntries = [];         // {daqList, odt, idx, address, ext, size}
  const started = [];            // {daqList, time, mode}
  let ptr = { daqList: 0, odt: 0, idx: 0 };
  let firstPid = null;

  for (const f of ctoFrames || []) {
    const d = f.data || [];
    if (!d.length) continue;
    const cmd = d[0];
    switch (cmd) {
      case 0xD6: daqCount = Math.max(daqCount, (d[2] << 8) | d[1] || d[1]); break;
      case 0xD5: { // ALLOC_ODT: daqList(2), odtCount(1)
        const dl = (d[2] << 8) | d[1];
        odtCounts[dl] = d[3];
        break;
      }
      case 0xD4: { // ALLOC_ODT_ENTRY: daqList(2), odt(1), count(1)
        const dl = (d[2] << 8) | d[1];
        const odt = d[3];
        const n = d[4];
        for (let k = 0; k < (n || 0); k++) {
          odtEntries.push({ daqList: dl, odt, idx: k, address: null, ext: 0, size: null });
        }
        break;
      }
      case 0xE2: { // SET_DAQ_PTR: daqList(2), odt(1), idx(1)
        ptr = { daqList: (d[2] << 8) | d[1], odt: d[3], idx: d[4] };
        break;
      }
      case 0xE1: { // WRITE_DAQ: bitOffset(1), size(1), addrExt(1), address(4)
        const size = d[2];
        const ext = d[3];
        const addr = (d[7] << 24) | (d[6] << 16) | (d[5] << 8) | d[4];
        const key = `${ptr.daqList}:${ptr.odt}:${ptr.idx}`;
        const hit = odtEntries.find((e) => `${e.daqList}:${e.odt}:${e.idx}` === key);
        if (hit) { hit.address = addr; hit.ext = ext; hit.size = size; }
        else odtEntries.push({ daqList: ptr.daqList, odt: ptr.odt, idx: ptr.idx, address: addr, ext, size });
        break;
      }
      case 0xDE: { // START_STOP_DAQ_LIST: mode(1), daqList(2)
        started.push({ mode: d[1], daqList: (d[3] << 8) | d[2], time: f.time });
        break;
      }
      case 0xD3: // GET_DAQ_PROCESSOR_INFO 的响应里带 FIRST_PID/DaqCount（需要响应帧）
      default: break;
    }
  }

  // DAQ list 汇总
  const daqLists = [];
  for (let i = 0; i < Math.max(daqCount, odtCounts.length); i++) {
    daqLists.push({ daqList: i, odtCount: odtCounts[i] || 0 });
  }
  return { daqLists, odtEntries, started, odtCounts, firstPid };
}

/**
 * 把 PID 解析成 (daqList, odt)。
 * XCP 允许 PID 为「绝对 ODT 编号」：从 firstPid 起按 DAQ list 顺序累加 ODT 数。
 * @param {number} pid
 * @param {{odtCounts:number[],firstPid:number|null}} config
 */
function resolvePid(pid, config) {
  const counts = (config && config.odtCounts) || [];
  const base = (config && config.firstPid != null) ? config.firstPid : 0;
  let rel = pid - base;
  if (rel < 0) return { daqList: null, odt: null };
  for (let dl = 0; dl < counts.length; dl++) {
    const n = counts[dl] || 0;
    if (rel < n) return { daqList: dl, odt: rel };
    rel -= n;
  }
  return { daqList: null, odt: rel + (counts.length ? 0 : 0) };
}

/**
 * 解码 DAQ DTO 流。
 * @param {Array<{time:number,id:number,data:number[]}>} dtoFrames
 * @param {object} config buildDaqConfig 的输出
 * @returns {{samples:object[],unknownPids:object[]}}
 */
function decodeDaq(dtoFrames, config) {
  const samples = [];
  const unknownPids = new Map();
  for (const f of dtoFrames || []) {
    const d = f.data || [];
    if (!d.length) continue;
    const pid = d[0];
    const { daqList, odt } = resolvePid(pid, config);
    const entries = (config && config.odtEntries) || [];
    const odtEntryList = entries.filter((e) => e.daqList === daqList && e.odt === odt);
    const values = [];
    let off = 1; // 第 0 字节是 PID
    for (const e of odtEntryList) {
      const size = e.size || 0;
      if (!size || off + size > d.length) { values.push(null); continue; }
      let raw = 0;
      for (let k = size - 1; k >= 0; k--) raw = (raw << 8) | d[off + k];
      values.push({ address: e.address, ext: e.ext, size, raw });
      off += size;
    }
    if (daqList == null) {
      unknownPids.set(pid, (unknownPids.get(pid) || 0) + 1);
      continue;
    }
    samples.push({ time: f.time, canId: f.id, pid, daqList, odt, values });
  }
  return {
    samples,
    unknownPids: [...unknownPids.entries()].map(([pid, count]) => ({ pid, count }))
  };
}

module.exports = {
  decodeCTO, decodeResponse, buildDaqConfig, decodeDaq, resolvePid,
  CTO_COMMANDS, RESPONSE_PIDS
};
