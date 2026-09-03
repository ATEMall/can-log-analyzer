# 更新记录（Changelog）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.1.1] - 2026-09-03

> v2.1 验收（2026-09-01，commit `013c7cd`）通过的 4 项交付：R3 返工缺陷修复（#7）、R5/R6、R7/R8、R2 Phase 2 补缺。详见 `docs/ACCEPTANCE-2026-09-01.md`。

### 修复

- **样例 DBC cantools 直载（#7 返工）**：`TestExample/dbc_full/dbc_full.dbc` 补 `BA_DEF_DEF_ "VFrameFormat" 0;` 默认值，扩展帧报文改为 DBC 规范标志位写法 `BO_ 2147485696`（= `0x80000000 | 2048`），cantools 43.0.2 可零补丁直载
- **引擎识别规范扩展帧标志位（#7 返工）**：`parseDBC` 识别 `BO_` id 的 `0x80000000` 标志位 → `isExtended = true` + id 归一化 `& 0x1FFFFFFF`（与 cantools `frame_id` 一致）；`VAL_` / `BA_` / `SIG_VALTYPE_` 关联 id 同步归一化，避免扩展帧 id 匹配错位；`VFrameFormat` 属性保留为补充兼容路径（标志位优先）
- **`compare.js` 对拍脚本收紧**：仅当 `import cantools` 失败才跳过（exit 0）；cantools 存在但 DBC 加载失败 → `CANTOOLS_DBC_LOAD_FAILED` 显式 exit 1，杜绝虚假绿色

### 新增

- **工程保存/恢复（R5 / FR-PJ-001）**：`.claproj` 工程文件保存 / 打开——格式标记 `#CANA_LOG_ANALYZER_PROJECT` 校验 + 非法文件明确报错；保存日志源 + DBC 路径 + 勾选信号/参数，重启后 100% 现场恢复
- **最近文件（R5 / FR-PJ-002）**：log / dbc / project 三类最近文件记录，上限 10 条、去重置顶；主菜单一键打开
- **偏好持久化（R6 / FR-SET-001）**：`settings:get` / `settings:set` 落盘 `%APPDATA%/can-log-analyzer/settings.json`（userData），启动自动恢复；单实例 + `.claproj` 文件关联打开（双击 / 命令行）
- **报文日志 CSV 导出（R7 / FR-EX-001）**：`file:exportLogCSV`，表头 `time,id,name,dir,dlc,data` + DBC 消息名映射；过滤结果导出，默认命名 `<源>_filtered_<时间戳>.csv`；5000 行/块流式写盘 + drain 背压
- **信号 CSV 导出（R7 / FR-EX-002）**：`signal:exportCSV`，时间戳 + 勾选信号列；枚举值导出 label、空值留空、字符串加引号
- **BLF 导出（R7 / FR-EX-003）**：`file:convertASCtoBLF` 扩展支持写盘导出，默认命名 `<源>_filtered_<时间戳>.blf`
- **UI 增量（R8）**：导出进度事件（`export:progress`）+ 前端进度提示、加载/解析空态提示、解析错误徽章（`parse-error-badge`）、文件菜单快捷键（`file:open-asc` / `file:export-asc` / `tool:convert-asc-blf` 等）
- **R2 Phase 2：流式彻底化**：`signal:decodeChunked` 多 chunk 时 `signalData` 不再累积回传——行数据仅经 `decode:chunk-result` 事件流式下发（返回 `signalData: undefined, streaming: true`），主进程内存与 1M 帧场景解耦；单 chunk 保持内联返回兼容
  - 前端增量累积（`chunkBufRef`）+ 轮询等待事件收齐（2s 安全超时）后渲染
- **R2 Phase 2：1M 帧基准报告**：`TestExample/bench/r2-bench.cjs`（确定性 PRNG）实跑 1M 帧 × 3 DBC（dbc_full / powertrain / body_chassis），一次性 vs 500k 分块双路径收敛 3/3，吞吐 0.39–0.50M 帧/s（PM 本机 0.24–0.33M）→ `docs/BENCHMARK-R2.md`
- **测试**：`dbcParse.test.js` 新增标志位格式扩展帧用例（31/31）、`signalDecode.test.js` 新增随机 20000 帧 × chunk 1/7/512/4096 双路径收敛对拍（5/5）、App.test.jsx 增 R5（工程/最近文件）与 CSV 导出用例；全量 **162/162** 通过（12 文件）

## [2.1.0] - 2026-08-31

### 修复

- **Motorola（大端）信号解码错误（P0 遗留缺陷）**：按 DBC（Vector）规范重做位号语义——字节 n 的 MSB = 位号 `8n+7`、LSB = `8n`，字节对齐信号 startBit=7/15/23/31/…（非 0）；遍历采用经典**锯齿序**（字节内 MSB→LSB，字节边界 `+15` 跳转），字节内取位 `bitIdx = bitPos % 8`。同步修复 `electron/dbc.js` 解码引擎（含浮点信号）、`electron/main.js` `decodeSignal()` / `writeSignalToBytes()`（CSV→ASC 反向编码）、`SignalLayoutView.jsx` 位布局视图。与 cantools 43.0.2 对拍 **286/286 一致**（PM Issue #1 验收）

### 新增

- **DBC 属性解析（R3 / FR-DB-001）**：`BA_DEF_` / `BA_DEF_DEF_` / `BA_` 解析，支持 `GenMsgCycleTime`（消息周期徽标如 `10ms`）、`GenMsgSendType`、`VFrameFormat`（扩展帧建模）、`GenSigStartValue`（信号初始值）
- **扩展帧建模（R3 / FR-DB-002）**：`BA_ "VFrameFormat" BO_ <id> 1` → 29-bit 扩展帧；报文表显示完整 29 位 ID + 蓝色 `Ext` 徽标；日志扩展标志与 DBC 模型不一致的帧标灰「未匹配」且不参与解码
- **多路复用信号（R3 / FR-DB-003）**：`SG_ mux M` 选择器 + `SG_ sig m<n>` 分支信号；先解码选择器值再仅解码匹配分支（其余显示 `-`）；UI 徽标 `M`（紫）/`m=n`（灰）；CSV→ASC 反向打包由 mux 列值驱动
- **信号值类型（R3 / FR-DB-004）**：`SIG_VALTYPE_ <id> <sig> : 1|2` → float32/float64 IEEE754 解码（Intel/Motorola），显示 6 位有效数字；浮点信号不附加 VAL_ 枚举标签
- **Motorola 解码回归矩阵重做**：`TestExample/motorola_matrix/` 全部 Motorola 信号 startBit 改为 Vector 规范编号，`motorola.test.js` 参考解码器改锯齿语义并新增 **start≡7（mod 8）字节对齐专项用例**（21 例，PM Issue #1 盲区）；`compare.js` 对拍脚本收紧——仅当 `import cantools` 失败才跳过，cantools 存在但 DBC 加载失败必须显式报错退出
- **R3 综合样例**：`TestExample/dbc_full/`（3 消息：扩展 mux / CAN FD 12B 浮点 / 属性+VAL_），`generate.js` 自校验（解码期望值 → ASC/BLF 写入 → 往返回读 → 格式不匹配跳过）
- **解析容错（R4）**：ASC 坏行 / BLF 坏块（损坏块、解压失败、非法对象大小）记录错误并跳过，不再中断整个文件加载；错误列表上限 100 条
  - 新增 `file:exportText` IPC 通道，可将错误报告导出为 txt
  - UI：加载完成后黄色警示徽章 → 抽屉式错误报告（行号/原因/原文）→ 导出按钮
- **分块解码引擎（R2 第一阶段）**：解码引擎提取为纯模块 `electron/signalDecode.js`；日志解析后消息驻留主进程 `messageStore`，解码不再由渲染进程全量回传
  - 新增 IPC：`signal:decodeChunked`（默认 50 万帧/块）、`signal:decodeCancel`（块边界生效）、`decode:progress`、`decode:chunk-result` 增量回传
  - 前端解码增量累加渲染 + 进度条 + 取消按钮；分块与一次性解码结果 bit 级一致
- **测试**：`electron/__tests__/motorola.test.js`（52 用例：固定期望 + start≡7 专项 + 种子 PRNG 矩阵交叉验证）、`electron/__tests__/dbcParse.test.js`（26 用例：属性/扩展帧/mux/值类型）、`electron/__tests__/tolerance.test.js`（7 用例）、`electron/__tests__/signalDecode.test.js`（4 用例）、MessageTable/SignalTable/DBCPanel 徽标 UI 测试；全量 **153/153** 通过

## [2.0.0] - 2026-08-22

### 新增

- 内置「使用手册」弹窗（应用右上角按钮随时查阅）
- 原生应用菜单（View / Tool / Window / Help / About），移除 Header 帮助与清空按钮，新增「关于」弹窗（含官网与 GitHub 链接）
- 白色 Header + 新 Logo，DBC 工具栏下方新增信号搜索框
- 完整单元测试套件（`electron/__tests__` 后端 + `src/components/__tests__` 组件）
- MIT 许可证

### 修复

- 修复工具栏按钮附近残留 "A"/"Pro" 字符：根因是 `index.css` 中 `.ant-layout { display: block !important }` 覆盖了 Header 的 flex 布局，导致标题区溢出到工具栏
- 移除工具栏按钮图标，避免小尺寸下 'a' 字形渲染异常
- 关闭 antd 按钮自动插入空格（`autoInsertSpace: false`），消除误判的图标占位

### 变更

- README 全面重写（功能特性 / 快速开始 / 使用手册摘要 / 示例数据 / 项目结构 / 测试 / 许可证）
- 文档增补徽章、FAQ 与官方链接

## [1.1.0] - 2026-05-26

### 新增

- 完整 DBC 信号解析：`BO_` / `SG_` / `VAL_` / `CM_`，支持 factor/offset、Intel/Motorola 字节序、枚举值
- 物理量 CSV 导入：首行为表头，`t` 列为时间戳，其余列名与 DBC 信号名对应（大小写不敏感）
- 物理量 CSV → ASC 转换：按 DBC factor/offset 反算原始字节并打包 CAN 帧（时间戳/通道/方向）
- CRC8 / CRC16 系列校验算法自动填充（或选择 NONE 保留 CSV 原始校验值）

## [1.0.0] - 2026-05-18

### 新增

- 初始版本：CAN Log Analyzer Pro
- ASC / BLF 日志解析（普通 CAN 与 CAN FD）
- DBC 数据库加载与信号级解码（数值表格 + 曲线图 + 位布局视图）
- CAN 报文日志（时间 / ID / 名称 / DLC / HEX），支持过滤与导出 ASC
- ASC → BLF 格式转换
