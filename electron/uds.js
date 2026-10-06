// UDS（ISO 14229-1）服务解析（v4.0 / B1-T2，PLAN-v4.0 §三 T2）
//
// 输入为 ISO-TP 重组后的 payload（Buffer / 字节数组）。
// 覆盖：0x10 会话控制、0x11 ECU 复位、0x19 DTC、0x22 读 DID、0x27 安全访问、
//       0x2E 写 DID、0x3E TesterPresent、0x85 控制 DTC 设置，及 0x7f 负响应（NRC）。
// KWP2000（0x6f1/0x612）帧不在此解析：isUDSService 返回 false，由上层计入容错统计
// （PLAN §三 T2 约束：不解析但不得报错丢弃）。

'use strict';

const UDS_SIDS = {
  0x10: 'DiagnosticSessionControl',
  0x11: 'ECUReset',
  0x14: 'ClearDiagnosticInformation',
  0x19: 'ReadDTCInformation',
  0x22: 'ReadDataByIdentifier',
  0x27: 'SecurityAccess',
  0x2E: 'WriteDataByIdentifier',
  0x3E: 'TesterPresent',
  0x85: 'ControlDTCSetting'
};

const SESSION_NAMES = {
  0x01: 'defaultSession',
  0x02: 'programmingSession',
  0x03: 'extendedDiagnosticSession',
  0x04: 'safetySystemDiagnosticSession',
  0x40: 'defaultSession(0x40)',
  0x41: 'programmingSession(0x41)',
  0x42: 'extendedDiagnosticSession(0x42)',
  0x50: 'defaultSession(0x50)',
  0x51: 'programmingSession(0x51)',
  0x52: 'extendedDiagnosticSession(0x52)'
};

const RESET_NAMES = {
  0x01: 'hardReset',
  0x02: 'keyOffOnReset',
  0x03: 'softReset',
  0x04: 'enableRapidPowerShutdown',
  0x05: 'disableRapidPowerShutdown'
};

// DTC 子功能：哪些带 status 字节（DTC(3) + status(1)）。
const DTC_SUB_WITH_STATUS = new Set([0x01, 0x02, 0x06, 0x07, 0x09, 0x0b, 0x0e, 0x0f, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f]);

const DTC_FAULT_TYPES = {
  0x0: 'noFaultTypeAvailable(ISO15031)',
  0x1: 'ISO14229-1',
  0x2: 'SAEJ2012-DA',
  0x3: 'endOfList'
};

const NRC_NAMES = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLengthOrInvalidFormat',
  0x14: 'responseTooLong',
  0x21: 'busyRepeatRequest',
  0x22: 'conditionsNotCorrect',
  0x24: 'requestSequenceError',
  0x25: 'noResponseFromSubNetComponent',
  0x26: 'failurePreventsExecutionOfRequestedAction',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x36: 'exceedNumberOfAttempts',
  0x37: 'requiredTimeDelayNotExpired',
  0x70: 'uploadDownloadNotAccepted',
  0x71: 'transferDataSuspended',
  0x72: 'generalProgrammingFailure',
  0x73: 'wrongBlockSequenceCounter',
  0x78: 'requestCorrectlyReceivedResponsePending',
  0x7e: 'subFunctionNotSupportedInActiveSession',
  0x7f: 'serviceNotSupportedInActiveSession'
};

const DTC_REPORT_SUB = {
  0x01: 'reportNumberOfDTCByStatusMask',
  0x02: 'reportDTCByStatusMask',
  0x06: 'reportDTCBySeverityMaskRecord',
  0x07: 'reportNumberOfDTCBySeverityMaskRecord',
  0x0a: 'reportSupportedDTC',
  0x09: 'reportSeverityRecordByDTCNumber',
  0x0e: 'reportMostRecentConfirmedDTC',
  0x0f: 'reportFirstConfirmedDTC',
  0x13: 'reportDTCWithPermanentStatus',
  0x14: 'reportDTCWithExtendedDataRecordByDTCNumber'
};

function toBuf(arr) {
  return Buffer.isBuffer(arr) ? arr : Buffer.from(arr || []);
}

function isUDSService(sid) {
  const s = typeof sid === 'number' ? sid : (Array.isArray(sid) || Buffer.isBuffer(sid) ? sid[0] : undefined);
  if (s === undefined) return false;
  if (s === 0x7f) return true;
  if (Object.prototype.hasOwnProperty.call(UDS_SIDS, s)) return true;
  // 正响应：请求 SID + 0x40（如 0x10 → 0x50）
  if ((s & 0x40) && Object.prototype.hasOwnProperty.call(UDS_SIDS, s - 0x40)) return true;
  return false;
}

// 解析 DTC 列表：每组 3 字节（DTC）+ 可选 1 字节 status。
function parseDTCs(buf, withStatus) {
  const out = [];
  let i = 0;
  while (i + 3 <= buf.length) {
    const b0 = buf[i];
    const b1 = buf[i + 1];
    const b2 = buf[i + 2];
    const faultType = (b0 >> 4) & 0x0f;
    const dtcId = (b0 << 16) | (b1 << 8) | b2;
    const hex = '0x' + ((b0 << 16) | (b1 << 8) | b2).toString(16).padStart(6, '0').toUpperCase();
    const dtc = {
      dtcId,
      hex,
      faultType,
      faultTypeName: DTC_FAULT_TYPES[faultType] || 'unknown'
    };
    i += 3;
    if (withStatus && i < buf.length) {
      dtc.status = buf[i];
      i += 1;
    }
    out.push(dtc);
  }
  return out;
}

// 从 buffer 抽取按 2 字节对齐的 DID 列表。
function extractDIDs(buf) {
  const out = [];
  for (let i = 0; i + 2 <= buf.length; i += 2) {
    out.push((buf[i] << 8) | buf[i + 1]);
  }
  return out;
}

/**
 * 解析一个 UDS 报文（重组后的 payload）。
 * @param {Buffer|number[]} payload
 * @returns {object|null} 解析结果；非 UDS 报文返回 null
 */
function parseUDSService(payload) {
  const buf = toBuf(payload);
  if (buf.length === 0) return null;
  const sid = buf[0];

  if (sid === 0x7f) {
    const requestSid = buf[1];
    const nrc = buf[2];
    return {
      sid,
      name: 'NegativeResponse',
      isNegative: true,
      responseType: 'negative',
      requestSid,
      requestSidName: UDS_SIDS[requestSid] || null,
      nrc,
      nrcName: NRC_NAMES[nrc] || null
    };
  }

  // 正响应：请求 SID + 0x40（如 0x10 会话控制请求 → 0x50 正响应）。
  let baseSid = sid;
  let responseType = 'request';
  if ((sid & 0x40) && Object.prototype.hasOwnProperty.call(UDS_SIDS, sid - 0x40)) {
    baseSid = sid - 0x40;
    responseType = 'positive';
  }

  const name = UDS_SIDS[baseSid];
  if (!name) return null;

  const out = { sid, baseSid, name, isNegative: false, responseType };

  switch (baseSid) {
    case 0x10:
      out.subfunction = buf[1];
      out.subfunctionName = SESSION_NAMES[buf[1]] || null;
      break;
    case 0x11:
      out.subfunction = buf[1];
      out.subfunctionName = RESET_NAMES[buf[1]] || null;
      break;
    case 0x27:
      out.subfunction = buf[1];
      out.isSeedRequest = (buf[1] & 0x01) === 1; // 奇数=请求种子
      out.isKey = (buf[1] & 0x01) === 0; // 偶数=发送密钥
      out.seedLength = buf.length - 2;
      break;
    case 0x19:
      out.subfunction = buf[1];
      out.subfunctionName = DTC_REPORT_SUB[buf[1]] || null;
      out.dtcs = parseDTCs(buf.slice(2), DTC_SUB_WITH_STATUS.has(buf[1]));
      break;
    case 0x22:
      out.dids = extractDIDs(buf.slice(1));
      break;
    case 0x2e:
      if (buf.length >= 3) {
        out.did = (buf[1] << 8) | buf[2];
        out.data = buf.slice(3);
      }
      break;
    default:
      break;
  }

  return out;
}

/**
 * 对一组 ISO-TP 重组消息批量解析 UDS 服务。
 * @param {Array<{canId:number,time:number,payload:Buffer}>} reassembled
 * @returns {Array<object>} 含 canId/time 的解析结果
 */
function classifyUDSServices(reassembled) {
  const out = [];
  for (const m of reassembled || []) {
    const parsed = parseUDSService(m.payload);
    if (!parsed) continue;
    out.push({ canId: m.canId, time: m.time, ...parsed });
  }
  return out;
}

module.exports = {
  parseUDSService,
  isUDSService,
  classifyUDSServices,
  parseDTCs,
  extractDIDs,
  UDS_SIDS,
  NRC_NAMES,
  SESSION_NAMES
};
