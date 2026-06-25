# Examples & verification data — signal decode

Matched **DBC + CAN log** test data and runnable checks for the `feature/signal-decode` feature
(load a DBC → pick signals → decode raw frames to physical time-series → table/chart/CSV).

## Files
```
examples/
├── dbc/
│   ├── motohawk.dbc      # cantools canonical example (Motorola signals + VAL_ enum)
│   ├── vehicle.dbc       # large real DBC: 217 messages / 708 signals (Intel+Motorola, signed, enum, mux)
│   └── foobar.dbc        # small DBC incl. 32/64-bit signals
├── log/
│   └── motohawk_sample.asc   # ASC log MATCHED to motohawk.dbc (message 0x1F0 = 496)
├── motohawk_decoded.csv      # expected decode of the sample log
├── crosscheck.js             # validates the engine vs an independent reference + cantools known-answer
└── README.md
```
> `motohawk_sample.asc` and `motohawk.dbc` are the **same project** (same DBC) — load them together.

## How to run

### 1) GUI (the actual feature)
```bash
npm install
npm run electron:dev      # or: npm run dev  then  electron .
```
Then in the app:
1. **打开文件** → load `examples/log/motohawk_sample.asc`
2. DBC 面板 **加载 DBC** → `examples/dbc/motohawk.dbc`
3. 切到 **「信号解析」** Tab → 勾选 `Temperature` / `AverageRadius` / `Enable` → **解码所选信号**
4. 看 **表格 + 曲线**，点 **导出 CSV**
Expected first row: `Temperature=250.55`, `AverageRadius=3.2`, `Enable=Enabled`.

> Try `vehicle.dbc` with your own ASC/BLF log for a realistic, signal-rich test.

### 2) Unit tests
```bash
npm test
```
12 assertions incl. the cantools motohawk canonical values, Intel/Motorola, signed, >32-bit, enum, multiplex.

### 3) Cross-check vs independent reference (fuzz over real DBCs)
```bash
node examples/crosscheck.js
```
Decodes 23,650 random frames across the 3 real DBCs with both the engine and an independently
implemented reference decoder (different algorithm) and asserts they agree — plus the motohawk
known-answer. Expected: `TOTAL 23650 comparisons, 0 mismatches -> PASS`.

## Note on the fix
The originally delivered Motorola (big-endian) read used `7-(bitPos%8)`, which read bits LSB-first and
produced wrong values (e.g. motohawk `Enable` decoded as `0` instead of `1`). Corrected to `bitPos%8`
(standard cantools sawtooth). Intel decoding was already correct. The pre-existing CSV→ASC
encode/decode path keeps its older (self-consistent, non-standard) Motorola convention and was left
untouched — flagged for a separate follow-up.
