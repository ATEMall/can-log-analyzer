"""UDS 独立复核脚本（v4.0 / B1 验收③ 对拍基线）。

对 TestExample/roadmap_v3x/uds_xcp/*.cap（candump 文本）做：
  1) 独立（不复用 JS 实现）的 candump 解析 + ISO-TP 重组
  2) UDS 服务语义识别 —— 服务名取自第三方库 udsoncan 的服务注册表 /
     Response.from_payload（不手写 SID 表）
  3) DID / DTC / NRC / 子功能抽取

输出 JSON：[{canId, time, payload, sid, baseSid, responseType, serviceName,
            subfunction, dids, dtcs, nrc}]

用法：python uds_crosscheck.py <cap 文件> ...
"""
import json
import re
import sys

CAP_RE = re.compile(r'^(\d+\.?\d*)\s+0x([0-9A-Fa-f]+)(?:\s+([0-9A-Fa-f ]+))?$')


def parse_cap(path):
    frames = []
    t0 = None
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            m = CAP_RE.match(line)
            if not m:
                continue
            t = float(m.group(1))
            cid = int(m.group(2), 16)
            d = (m.group(3) or '').replace(' ', '')
            data = bytes.fromhex(d) if d else b''
            if t0 is None:
                t0 = t
            frames.append((round(t - t0, 6), cid, data))
    return frames


def isotp(frames, timeout=1.0):
    """独立实现的 ISO 15765-2 重组（与 electron/isotp.js 无共享代码）。"""
    msgs = []
    state = {}
    for t, cid, data in frames:
        if not data:
            continue
        pci = data[0]
        typ = pci & 0xF0
        if typ == 0x00:                      # 单帧
            ln = pci & 0x0F
            msgs.append({'canId': cid, 'time': t, 'payload': data[1:1 + ln].hex()})
            state.pop(cid, None)
        elif typ == 0x10:                    # 首帧
            total = ((pci & 0x0F) << 8) | data[1]
            state[cid] = {'total': total, 'buf': bytearray(data[2:]), 'next': 1, 'last': t}
        elif typ == 0x20:                    # 连续帧
            st = state.get(cid)
            seq = pci & 0x0F
            if st is None:
                continue
            if t - st['last'] > timeout:     # >1s 判中断
                state.pop(cid, None)
                continue
            if seq != (st['next'] & 0x0F):   # 序号不匹配
                state.pop(cid, None)
                continue
            st['buf'].extend(data[1:])
            st['next'] += 1
            st['last'] = t
            if len(st['buf']) >= st['total']:
                msgs.append({'canId': cid, 'time': t,
                             'payload': bytes(st['buf'][:st['total']]).hex()})
                state.pop(cid, None)
        # 0x30 流控帧与未识别 PCI：跳过
    return msgs


def build_service_table():
    """服务名取自 udsoncan（第三方库），不手写 SID 表。"""
    from udsoncan import services
    table = {}
    for n in dir(services):
        if not n[0].isupper():
            continue
        cls = getattr(services, n, None)
        if cls is None:
            continue
        for getter in ('request_id', 'response_id'):
            fn = getattr(cls, getter, None)
            if fn is None:
                continue
            try:
                sid = int(fn())
            except Exception:
                continue
            table[sid] = n
    return table


def parse_dtc(buf, with_status):
    out = []
    i = 0
    while i + 3 <= len(buf):
        b0, b1, b2 = buf[i], buf[i + 1], buf[i + 2]
        dtc = {
            'dtcId': (b0 << 16) | (b1 << 8) | b2,
            'hex': '0x%06X' % ((b0 << 16) | (b1 << 8) | b2),
            'faultType': (b0 >> 4) & 0x0F
        }
        i += 3
        if with_status and i < len(buf):
            dtc['status'] = buf[i]
            i += 1
        out.append(dtc)
    return out


def parse_uds(payload_hex, table):
    p = bytes.fromhex(payload_hex)
    if not p:
        return None
    sid = p[0]
    out = {'sid': sid, 'subfunction': None, 'dids': [], 'dtcs': [], 'nrc': None}

    if sid == 0x7F:
        out.update({'baseSid': None, 'responseType': 'negative',
                    'serviceName': 'NegativeResponse', 'requestSid': p[1], 'nrc': p[2]})
        return out

    # 服务名取自 udsoncan 的服务注册表（request_id / response_id），不手写 SID 表。
    service_name = table.get(sid)
    if service_name is None and (sid & 0x40):
        service_name = table.get(sid - 0x40)
    if service_name is None:
        # 兜底：让 udsoncan 解析响应，再回表按 SID 取规范名
        try:
            from udsoncan import Response
            resp = Response.from_payload(p)
            if resp is not None:
                service_name = table.get(sid)
        except Exception:
            service_name = None

    base_sid = sid
    response_type = 'unknown' if service_name is None else 'request'
    if service_name is not None and (sid & 0x40):
        # 由 udsoncan 的服务表反查请求 SID
        for k, v in table.items():
            if v == service_name and not (k & 0x40):
                base_sid = k
                break
        if base_sid != sid:
            response_type = 'positive'

    out.update({'baseSid': base_sid, 'responseType': response_type,
                'serviceName': service_name})

    if base_sid == 0x10 or base_sid == 0x11 or base_sid == 0x27:
        if len(p) >= 2:
            out['subfunction'] = p[1]
    elif base_sid == 0x22:
        out['dids'] = [(p[i] << 8) | p[i + 1] for i in range(1, len(p) - 1, 2)]
    elif base_sid == 0x2E:
        if len(p) >= 3:
            out['dids'] = [(p[1] << 8) | p[2]]
    elif base_sid == 0x19:
        sub = p[1] if len(p) >= 2 else None
        out['subfunction'] = sub
        # 与 electron/uds.js 的 DTC_SUB_WITH_STATUS 保持一致（带 status 的子功能）
        with_status = sub in (0x01, 0x02, 0x06, 0x07, 0x09, 0x0B, 0x0E, 0x0F,
                              0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A,
                              0x1B, 0x1C, 0x1D, 0x1E, 0x1F)
        out['dtcs'] = parse_dtc(p[2:], with_status)
    return out


def main():
    if len(sys.argv) < 2:
        print('usage: uds_crosscheck.py <cap> ...')
        sys.exit(2)
    table = build_service_table()
    result = []
    for path in sys.argv[1:]:
        msgs = isotp(parse_cap(path))
        for m in msgs:
            parsed = parse_uds(m['payload'], table)
            if parsed is None:
                continue
            result.append({**m, **parsed})
    print(json.dumps(result))


if __name__ == '__main__':
    main()
