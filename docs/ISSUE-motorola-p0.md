# GitHub Issue 草稿 — 待提交到 ATEMall/can-log-analyzer

> 提交方式：打开 https://github.com/ATEMall/can-log-analyzer/issues/new ，粘贴以下标题与正文。
> （本沙箱环境无 GitHub 凭据与网络出口，无法自动提交。）

---

**Title:**

```
[P0][Bug] Motorola (big-endian) signal decoding is completely wrong — 10/10 mismatch vs cantools
```

**Labels:** `bug`, `P0`, `decoding`

**Body:**

````markdown
### Summary

In v2.0.0 (commit a2f325d), **all Motorola (big-endian, `@0`) signals decode incorrectly**.
Verified against the reference implementation **cantools 43.0.2** on a purpose-built DBC
containing 13 signals (10 Motorola + 3 Intel): **10/10 Motorola signals mismatch, 3/3 Intel
signals correct**.

Full acceptance report: `docs/ACCEPTANCE-2026-08-29.md`.

### Environment

- Version: v2.0.0 (a2f325d, main)
- OS: Windows 11
- Reference: cantools 43.0.2 (Python 3.13)

### Evidence (excerpt)

Data payload `12 34 56 78 9A BC DE F0`:

| Signal | Layout | Expected (cantools) | Actual |
|---|---|---|---|
| M_MotA | `0\|16@0+` | 0x1234 | 0x1635 (wrong) |
| M_MotC | `7\|8@0+` | byte1 value | byte0 value (wrong) |
| M_MotI | `0\|1@0+` on `80 00 ...` | 1 | 0 (wrong) |
| M_IntelA | `0\|16@1+` | 13330 | 13330 (correct) |

### Root cause

`electron/dbc.js` → `decodeSignalFrame()` → Motorola branch uses a broken sawtooth
traversal:

```js
// wrong: jumps a full extra byte at byte boundaries
if ((bitPos % 8) === 0) {
  bitPos += 15;   // should be +7 (or, equivalently, iterate bitPos = startBit + i monotonically)
} else {
  bitPos--;
}
```

The correct DBC/cantools bit numbering iterates Motorola signal bits monotonically
(`startBit, startBit+1, …, startBit+length-1`), where each byte's MSB has the lower bit
number. The current code skips an entire byte whenever it reaches a byte boundary,
reading wrong bytes with reversed bit order.

### Why tests missed it

All sample DBCs in `TestExample/` use Intel byte order only — zero Motorola coverage.

### Impact

Motorola is extremely common in real vehicle DBCs (J1939, most ECU vendors).
All such signals produce wrong physical values. **Do not trust decoded values for
Motorola signals in v2.0.0.**

### Acceptance criteria (for the fix)

- [ ] Motorola decoding matches cantools 0-mismatch across a matrix of ≥60 signal layouts
      (Intel/Motorola × signed/unsigned × 1/8/16/32/64-bit × aligned/unaligned × multi-byte)
- [ ] Add `TestExample/motorola_matrix/` sample with ≥10 Motorola signals + reproducible
      compare script (`compare.js`) runnable via `npm test`
- [ ] Bit layout view renders Motorola signals correctly with an endianness legend
- [ ] CHANGELOG entry + README note

Tracked in roadmap: v2.1 (docs/SRS-v2.1.md, requirement R1 / FR-PARSE-001).
```
