# v2.1 交付验收记录 — 2026-09-01

- 基线：commit `013c7cd`（本地 = 远程 `bda9cad`，工作区干净）
- 验收人：PM（产品经理）
- 结论：**R2 / R3 / R5 / R6 / R7 / R8 全部验收通过**，v2.1 剩余「PM 终验 + 发版」一项

---

## 验收总览

| 需求 | Issue | 结论 | 核心证据 |
|---|---|---|---|
| R1 Motorola 解码修复 | #1 | ✅ 已验收（08-31） | cantools 对拍 23/23 + 286/286 |
| R4 解析容错 | #4 | ✅ 已验收（08-30） | 119/119 回归 + tolerance 专项 |
| R2 分块解码引擎 Phase 2 | #2 | ✅ 通过（本次） | 纯流式 + 收敛测试 + 基准可复现 |
| R3 DBC 解析补全（含 #7 返工） | #3 / #7 | ✅ 通过（本次） | cantools 直载零补丁 + 12/12 对拍 |
| R5/R6 工程保存恢复 + 偏好持久化 | #5 | ✅ 通过（本次） | 代码复核 + 专项测试 |
| R7/R8 导出补全 + UI 增量 | #6 | ✅ 通过（本次） | 代码复核 + 专项测试 |

全量回归：**162/162**（12 个测试文件，`npm test`）。

---

## R3（#7 返工）验收详情

### 验收标准核对
- [x] cantools 43.0.2 **直载交付 `dbc_full.dbc` 零补丁无报错**
  （此前缺陷：缺 `BA_DEF_DEF_ "VFrameFormat" 0;` 默认值 + 扩展帧 `BO_ 2048` 缺 `0x80000000` 标志位；现已修复为 `BO_ 2147485696`）
- [x] 标志位 DBC 与属性 DBC 两种格式扩展帧均正确解析
  （`electron/dbc.js` 行 58-73：`rawId >= 0x80000000` → `isExtended=true` + `id & 0x1FFFFFFF`；VAL_/BA_/SIG_VALTYPE_ 关联 id 同步归一化，行 109/151/156/171；VFrameFormat 作补充兼容且标志位优先，行 188-197）
- [x] 端到端对拍 **12/12 信号 0 不一致**（≥10 达标）
  （引擎解析交付 `dbc_full.asc` 4 帧 → 引擎解码 vs cantools 解码，逐帧逐信号：mux 分支切换无泄漏 / F32a=3.141593 / F64a=-2.5 / 属性 / VAL_ 枚举）
- [x] 全量回归通过（162/162）
- [x] 新增单测：`electron/__tests__/dbcParse.test.js` 31/31（含标志位格式 + BA_DEF_DEF_ 默认值）
- [x] 样例自校验 `generate.js` 全绿（ASC/BLF 往返、扩展帧匹配）

## R2 Phase 2 验收详情

- [x] **纯流式**：`signal:decodeChunked` 多 chunk 时 rows 仅经 `decode:chunk-result` 事件流式返回，主进程 `signalData` 不累积、返回 `undefined`（main.js 行 1570-1609）
- [x] **前端收齐**：`chunkBufRef` 增量累积 + 2s 安全超时（SignalParsePanel.jsx 行 33/107-118）
- [x] **收敛测试**：20000 帧随机语料 × chunk 1/7/512/4096，decodeAll vs decodeFramesChunk 位级一致（signalDecode.test.js 5/5）
- [x] **基准可复现**：`node TestExample/bench/r2-bench.cjs` 实跑 1M 帧 × 3 DBC，双路径收敛 OK 3/3（1000000 == 1000000）；本机吞吐 0.24–0.33M 帧/s（与 docs/BENCHMARK-R2.md 同量级，硬件相关）

> 说明：复验基准脚本会自动重写 `docs/BENCHMARK-R2.md`（脚本设计如此）；PM 已将该交付文件恢复原状，未改动交付内容。

## R5/R6 验收详情

- [x] `project:save` / `project:open`：.claproj 格式标记校验 + 非法文件明确报错（main.js 行 1156-1181）
- [x] 最近文件：`addRecent` 三类（log/dbc/project）× 上限 10 条、去重置顶（行 80-86）
- [x] `settings:get` / `settings:set`：落盘 `%APPDATA%/can-log-analyzer/settings.json`（userData）+ 启动恢复（行 42-78）
- [x] 单实例 + `.claproj` 文件关联打开（双击/命令行，行 173-197）
- [x] 前端集成：保存/打开/最近文件入口（App.jsx）+ 专项测试（App.test.jsx R5 用例）

## R7/R8 验收详情

- [x] 报文日志 CSV 导出 `file:exportLogCSV`：表头 time,id,name,dir,dlc,data；nameMap 消息名映射；5000 行/块流式 + drain 背压（行 1441-1471）
- [x] 默认命名 `<源>_filtered_<时间戳>.csv/.blf`（App.jsx 行 324/355）
- [x] 信号 CSV 导出 `signal:exportCSV`：timestamp + 信号列；枚举导出 label；空值留空；字符串加引号（行 1635-1677）
- [x] BLF 导出 `file:convertASCtoBLF`：`buildBLFBuffer` 写盘（行 1365-1376）
- [x] UI 增量：导出进度事件（export:progress）、空态提示、解析错误徽章（parse-error-badge）、菜单快捷键（file:open-asc / file:export-asc / tool:convert-asc-blf 等）

---

## 遗留与后续

1. **GitHub Issue 关闭**：本记录对应的 #2/#3/#5/#6/#7 验收通过，待 PM 环境恢复 GitHub 连接后逐一关闭（验收正文已随本记录固化，关闭时直接引用）。
2. **v2.1 终验**：待本轮 4 项关闭后执行「PM 终验 + 发版」（SRS §4 DoD），产出 v2.1.0 release。
3. **v2.1.1 候选**：R2 双路径代码收敛（decodeAll 仅保留用于小语料/测试）、BLF 解析超时参数化、1M 帧 UI 实测（大文件端到端真机验证）。
