# CAN Log Analyzer Pro — v2.1 开发需求说明书（SRS）

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1（勘误：修正 R1 算法规格，见变更记录） |
| 编写日期 | 2026-08-29（v1.1：2026-08-30） |
| 编写人 | 产品经理（翟枢） |
| 上游文档 | `docs/PRD.md` v1.0（需求基准）、`docs/ACCEPTANCE-2026-08-29.md`（v2.0.0 验收） |
| 适用版本 | **v2.1「正确性与地基」** |
| 文档状态 | 正式发布，开发依据本文档执行 |

---

## 1. 版本目标与范围

### 1.1 版本主题

**正确性与地基**。v2.0.0 验收发现 Motorola 解码 P0 缺陷；v2.1 以「修复正确性 + 夯实架构地基」为核心，不新增协议，不做深色模式等体验增强。

### 1.2 版本目标（可量化）

| 目标 | 度量 |
|---|---|
| 解码正确性 | 与 cantools 43.0.2 对拍：Motorola / Intel / 有符号 / 枚举 / 多路复用 **0 不一致** |
| 大文件稳定性 | 100 万帧日志加载 + 解码全程无崩溃、UI 不冻结，加载 ≤ 5 秒 |
| DBC 兼容性 | 含 `BA_` 属性、扩展帧、多路复用、`SIG_VALTYPE_` 的真实 DBC 全部正确解析 |
| 会话效率 | 工程保存/恢复一键完成，重开应用 ≤ 5 秒回到上次工作现场 |
| 质量 | 全部单测通过；新增功能均有对应用例；CHANGELOG/版本号合规 |

### 1.3 范围外（明确不做，防蔓延）

- LIN / UDS / XCP / 以太网（v3.0+）
- 深色模式、可折叠布局、时间轴总览、总线统计（v2.2）
- 曲线图多 Y 轴、PNG/SVG 导出（v2.2）
- macOS / Linux 打包

### 1.4 里程碑（3 周，周报检查点）

| 周次 | 交付 | 检查点 |
|---|---|---|
| W1（~09-05） | R1 Motorola 修复 + 对拍测试矩阵；R4 解析容错 | 周报：对拍 0 不一致证明 |
| W2（~09-12） | R2 分块解码引擎；R3 DBC 解析补全 | 周报：100 万帧性能基准数据 |
| W3（~09-19） | R5 工程/最近文件/偏好持久化；R7 导出补全；R8 UI 调整 | 周报：PM 验收 + 发版 |

---

## 2. 功能需求详述

### R1 [P0] Motorola 字节序解码修复（FR-PARSE-001 / FR-VIS-006）

**背景**：v2.0.0 对拍 10/10 Motorola 信号全部错误（见验收报告 §4）。

**缺陷根因**（`electron/dbc.js` `decodeSignalFrame()` Motorola 分支）：原实现在字节内的位提取方向写反（`7 - (bitPos % 8)` 应为 `bitPos % 8`）。

**正确算法规格**（DBC / Vector 位编号约定，**v1.1 勘误版，以 286/286 对拍验证为准**）：

- DBC 位编号（Vector 约定）：byte k 的 **MSB = 位号 `8k+7`，LSB = 位号 `8k`**。因此字节对齐的 16 位 Motorola 信号 startBit = 7（不是 0）。
- Motorola 信号从 `startBit`（信号 MSB 所在位）开始，**字节内位号递减**（MSB→LSB），到达字节 LSB（位号 `8k`）后**跳到下一字节的 MSB（位号 `8(k+1)+7`，即 `+15`）**——即"锯齿"遍历。
- 字节内提取位：`bitIdx = bitPos % 8`（位号 7 是 MSB，右移 7 位取到）。

```js
// 正确实现（v1.1，已对拍 286/286 一致）
let bitPos = startBit;
for (let i = 0; i < length; i++) {
  const byteIdx = Math.floor(bitPos / 8);
  const bitIdx = bitPos % 8;            // ← 原缺陷点：曾被误写为 7 - (bitPos % 8)
  if (byteIdx < data.length) {
    rawValue |= BigInt((data[byteIdx] >> bitIdx) & 1) << BigInt(length - 1 - i);
  }
  if ((bitPos % 8) === 0) bitPos += 15; else bitPos--;   // 锯齿遍历保持不变
}
```

> **v1.0 勘误说明**：v1.0 曾写"位号单调递增 +1、不存在锯齿"，**该描述是错误的**，已在本版删除。正确实现保留锯齿遍历，仅修正字节内提取方向。规格以 cantools 43.0.2 对拍结果为最终权威。

**验收标准（DoD）**：

1. 使用下列**最小测试向量**（8 字节数据 `12 34 56 78 9A BC DE F0`，v1.1 已按 Vector 位编号勘误）全部通过：

| 信号 | 布局 | 期望值（cantools 基准） |
|---|---|---|
| M_MotA | `7\|16@0+`（字节对齐，注意 startBit=7 而非 0） | 0x1234 = 4660 |
| M_MotC | `15\|8@0+`（byte1 整字节） | 0x34 = 52 |
| M_MotI | `7\|1@0+`，数据 `80 00 ...` | 1（MSB of byte0） |
| 跨 3 字节 Motorola 信号（`7\|24@0+`） | — | 0x123456 = 1193046 |
| Motorola 有符号（`7\|16@0-`，负值用例） | — | 与 cantools 一致 |

2. 对拍矩阵（以 cantools 为权威，逐帧逐信号比对，**0 不一致**）：
   - Intel / Motorola × 有符号 / 无符号 × 1/8/16/32/64 位 × 起始位对齐 / 非对齐 × 单字节内 / 跨字节 / 跨 3+ 字节；
   - factor ≠ 1、offset ≠ 0、枚举 VAL_；
   - 多路复用（配合 R3 完成后）；
   - 用例数 ≥ 60 个信号布局。
3. `TestExample/` 新增 `motorola_matrix/` 样例：含 ≥ 10 个 Motorola 信号的 DBC + 对应 ASC/BLF + generate.js，杜绝测试盲区。
4. 位布局视图（`SignalLayoutView.jsx`）同步核验：Motorola 信号色块覆盖的字节/位与 cantools 语义一致，并增加 Intel/Motorola 图例说明（图例文案：「Intel(小端)/Motorola(大端)」）。

**测试方法**：Node 脚本调用 `dbc.js` 解码 → 与 `cantools decode` 输出 JSON diff。对拍脚本入库 `TestExample/motorola_matrix/compare.js`，CI/本地 `npm test` 可重复执行。

---

### R2 [P0] 分块解码引擎重构（FR-PARSE-002 / FR-PARSE-003）

**背景**：现状为渲染进程全量序列化报文 → IPC → 主进程解码 → 全量回传。百万级帧存在内存峰值与阻塞风险（TD-1）。

**需求规格**：

1. **解码数据驻留主进程**：日志解析完成后，报文数组只保存在主进程内存（`Map` 结构，按 ID 索引），渲染进程不再持有全量原始报文。
2. **分块解码协议**（新 IPC 通道）：
   - `decode:chunked`（render → main）：参数 `{ messageIds, signalSelection, chunkSize }`；
   - 主进程按块（默认 **500,000 帧**）解码，每块完成发送 `decode:progress`（progress 0–1、当前块号、预估剩余）；
   - 每块结果通过 `decode:chunk-result` 增量回传，渲染进程累加渲染（表格增量 append、曲线数据合并）；
   - `decode:cancel`（render → main）：中断解码，主进程在块边界检查取消标志，≤ 1 块时间内停止。
3. **加载进度**：大文件（>100MB）解析阶段 `parse:progress` 事件（按已读字节 / 总字节），UI 显示进度条 + 取消按钮。
4. **内存保护**：解码结果仅保留勾选信号的物理值（Float64Array 按列存储，替代对象数组）；估算峰值内存并在超过 1.5GB 时提示用户减少勾选信号。

**验收标准**：

1. 100 万帧合成日志（generate.js 可生成）：
   - 加载 ≤ 5 秒；解码期间 UI 可交互（点击 Tab、拖动窗口不冻结）；
   - 全程 RSS 增量 ≤ 800MB；
   - 取消操作 ≤ 2 秒生效。
2. 20 万帧场景性能不劣化（基线：解析 309ms / 解码 664ms）。
3. 现有功能回归：三视图、过滤、导出不受重构影响，结果 bit 级一致。

---

### R3 [P1] DBC 解析补全（FR-DB-001 ~ FR-DB-004）

**3.1 属性解析（`BA_DEF_` / `BA_DEF_` / `BA_DEF_DEF_`）**

- 解析属性定义与每消息/每信号赋值，至少支持：`GenMsgCycleTime`（ms，消息周期）、`GenMsgSendType`、`VFrameFormat`、`GenSigStartValue`。
- 消息节点数据结构新增：`cycleTime`、`sendType`、`frameFormat`。
- UI：消息行显示周期（如 `10ms` 徽标）；无属性时不显示。

**3.2 扩展帧建模（FR-DB-002）**

- `BA_ "VFrameFormat" <BU_> BO_ <id> 1` → 29-bit 扩展帧；
- 报文列表 ID 列区分显示：标准帧 `0x123`，扩展帧 `0x18FF0100 (Ext)`（附加 Ext 徽标）；
- ASC/BLF 解析的 extended 标志与 DBC 建模匹配时才做信号解码；不匹配时该 ID 报文标记「未匹配」灰色。

**3.3 多路复用（FR-DB-003）**

- `SG_ muxName M`（选择器）与 `SG_ sig m<n>`（分支信号）完整建模；
- 解码：先解码 mux 值 → 仅解码匹配 `m<n>` 的信号集 → 其余信号显示 `-`；
- UI：信号树中 mux 选择器显示 `M` 徽标，分支信号显示 `m=n`；
- CSV → ASC 反向生成：mux 值列驱动选择信号集打包。

**3.4 值类型（FR-DB-004）**

- `SIG_VALTYPE_ <id> <sig> : 1`（float32）/ `: 2`（double64）；
- 此类信号解码结果为 IEEE754 浮点（按 32/64 位组装），显示精度 6 位有效数字；
- 表格/曲线显示不带枚举标签。

**验收标准**：

1. 每项能力配 ≥ 5 个单测，含边界（属性缺省、未知属性名、mux 值无匹配分支、float 全位图）。
2. 多路复用解码与 cantools 对拍 0 不一致。
3. 新增样例 `TestExample/dbc_full/`：含上述全部特性的 DBC + 日志 + generate.js。

---

### R4 [P1] 解析容错与错误报告（FR-PARSE-007）

- ASC 逐行解析：损坏行记录 `{ line, reason }` 到 `parseErrors`，继续解析后续行；
- BLF：坏块跳过（记录对象块偏移），不中断；
- 解析完成后若错误行数 > 0：状态栏黄色警示 `解析完成：N 行错误`，点击弹出错误列表（前 100 条 + 总数），支持导出 txt；
- 空文件 / 全损坏文件：明确错误提示，不崩溃。

**验收**：构造含 10 处损坏行的 ASC 样例，正确解析其余行且错误报告准确。

---

### R5 [P0] 工程保存 / 恢复（FR-PROJ-001 / 002）

**`.claproj` 文件规格**（JSON，UTF-8）：

```json
{
  "format": "claproj",
  "version": 1,
  "created": "2026-09-12T10:00:00Z",
  "logs": [
    { "path": "D:/data/run01.asc", "type": "asc", "alias": "run01" }
  ],
  "databases": [
    { "path": "D:/dbc/powertrain.dbc", "type": "dbc" }
  ],
  "selection": { "0x100": ["Speed", "RPM"], "0x101": ["*"] },
  "filters": { "messageTab": { "id": "", "direction": "all" } },
  "activeTab": "signal",
  "sampleStep": 1
}
```

- 保存：`Ctrl+S` / 菜单 File → Save Project / 另存为；未保存关闭时提示（有变更时）。
- 恢复：双击 `.claproj` 关联打开（Windows 文件关联，安装版注册）或 File → Open Project；按 path 重新加载日志与 DBC，恢复信号勾选、过滤、Tab；文件缺失时列出缺失项并允许手动替换路径。
- 工程文件本身 ≤ 100KB（只存路径与配置，不嵌数据）。

**验收**：保存 → 关闭应用 → 重开工程，5 秒内恢复到相同工作现场（含勾选与过滤）。

---

### R6 [P1] 最近文件与偏好持久化（FR-PROJ-003 / 004）

- 最近列表：日志 / DBC / 工程各记 10 条，`File → Recent Files ▾` 菜单展示，路径失效项置灰；`清除列表` 入口。
- 偏好（electron-store 或等价本地 JSON，存 `%APPDATA%/can-log-analyzer/settings.json`）：
  - `defaultSampleStep`（表格抽样步长）、`defaultExportDir`、`windowBounds`（窗口大小/位置）、`lastTab`。
- 启动恢复窗口尺寸与位置。

**验收**：修改偏好 → 重启应用生效；最近列表顺序正确（最近优先）。

---

### R7 [P1] 导出补全（FR-EXP-002）

- 报文日志页签导出：
  - **CSV**：列 `time,id,name,dir,dlc,data(hex 空格分隔)`，含当前过滤结果；
  - **BLF**：复用现有 ASC→BLF 转换器，导出当前过滤后的报文；
  - 导出对话框统一（格式下拉 + 目录选择 + 进度）。
- 导出文件名默认：`<源文件名>_filtered_<时间戳>.<ext>`。

**验收**：导出的 ASC/BLF 可被本工具与 python-can 重新读回，帧数与内容一致。

---

### R8 UI 需求（v2.1 范围内）

| 编号 | 需求 | 规格 |
|---|---|---|
| UI-2.1-01 | 加载/解码进度条 | 顶部细进度条（antd Progress line，高度 3px）+ 状态栏文字 `解析中 42% (84MB/200MB)`；取消按钮出现在进度条右端 |
| UI-2.1-02 | 空状态引导 | 未加载日志时主区显示三步引导卡：「① 加载日志 ② 加载 DBC ③ 勾选信号」，每步带按钮直达对应操作 |
| UI-2.1-03 | 错误报告入口 | 状态栏黄色警示胶囊，点击弹出 Drawer（错误列表 + 导出） |
| UI-2.1-04 | 消息周期徽标 | DBC 面板消息行右侧 `10ms` 灰色 Tag（读自 GenMsgCycleTime） |
| UI-2.1-05 | 扩展帧标识 | 报文表 ID 列 `0x18FF0100` + 蓝色 `Ext` Tag；DBC 面板同步 |
| UI-2.1-06 | mux 标识 | 信号行 `M`（紫）/ `m=1`（灰）徽标 |
| UI-2.1-07 | 快捷键 | Ctrl+O 打开日志、Ctrl+S 保存工程、Ctrl+F 聚焦搜索（菜单内标注快捷键） |
| UI-2.1-08 | 左侧面板宽度记忆 | 记住用户拖动后的宽度（纳入偏好持久化） |

**布局变更**：v2.1 不做整体布局重构（留 v2.2），仅上述增量；保证不破坏现有三视图布局。

---

## 3. 接口与数据结构（开发契约）

### 3.1 新增 IPC 通道（preload 白名单同步更新）

| 通道 | 方向 | 载荷 | 说明 |
|---|---|---|---|
| `parse:progress` | main→render | `{ loaded, total, percent }` | 大文件解析进度 |
| `parse:cancel` | render→main | — | 取消解析 |
| `decode:chunked` | render→main | `{ msgIds, signals, chunkSize }` | 启动分块解码 |
| `decode:progress` | main→render | `{ chunk, totalChunks, percent }` | 解码进度 |
| `decode:chunk-result` | main→render | `{ chunkIndex, columns }` | 增量结果 |
| `decode:cancel` | render→main | — | 取消解码 |
| `project:save` / `project:open` | 双向 | `.claproj` 路径与内容 | 工程管理 |
| `settings:get` / `settings:set` | 双向 | 偏好 KV | 持久化 |

### 3.2 主进程内存模型

- `messageStore: Map<id, { frames: {t, dir, data}[], meta }>` — 解析产物唯一驻留地；
- `decodeResult: Map<signalKey, Float64Array>` — 列式物理值；
- 渲染进程仅持有：勾选信号的（抽样后）数值数组 + 视图状态。

---

## 4. 测试计划与验收门槛

### 4.1 测试矩阵

| 类别 | 用例来源 | 通过标准 |
|---|---|---|
| Motorola 对拍（R1） | `TestExample/motorola_matrix/` ≥ 60 布局 × cantools | 0 不一致 |
| mux / 属性对拍（R3） | `TestExample/dbc_full/` × cantools | 0 不一致 |
| 单元测试 | 每个 R 项 ≥ 5 用例，覆盖边界 | 全绿 |
| 性能基准（R2） | 20 万 / 100 万帧合成日志 | 见 §2 R2 DoD |
| 容错（R4） | 损坏行样例 | 不中断 + 报告准确 |
| 工程/偏好（R5/R6） | 保存→重启→恢复走查 | 现场 100% 恢复 |
| 导出往返（R7） | 导出→重新导入 diff | 帧数/内容一致 |
| 回归 | 现有 49 用例 + 三视图手工走查 | 无回归 |

### 4.2 版本 DoD（继承 PRD §7.3，逐条执行）

1. 单测全过 + 新功能有对应用例；2. 对拍 0 不一致；3. 性能基准记录进验收报告且不劣化；4. CHANGELOG + semver；5. NSIS + Portable 产物可启动；6. PM 实测通过。

---

## 5. 交付物清单

| 交付物 | 说明 |
|---|---|
| 代码 | main 分支，含 R1–R8 全部实现 |
| 测试 | 上述矩阵全部用例 + 对拍脚本可重复执行 |
| 样例 | `TestExample/motorola_matrix/`、`TestExample/dbc_full/` |
| 文档 | README 更新（新能力 + Motorola 修复公告）、CHANGELOG v2.1.0 |
| 产物 | `release/` 下 Setup + Portable |

---

*本 SRS 与 PRD 冲突时以本文档为准（v2.1 范围内）。变更须 PM 书面确认后更新本文档。*

---

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-08-29 | 首次发布 |
| v1.1 | 2026-08-30 | **R1 勘误**：v1.0 的"单调 +1 遍历"算法规格描述错误。正确规格为锯齿遍历（字节内位号递减，字节末 `+15` 跳下一字节 MSB）+ 字节内提取 `bitIdx = bitPos % 8`。已用 286 用例矩阵对拍 cantools 43.0.2 验证 286/286 一致。教训：规格描述必须经对拍实证后再发布。 |
