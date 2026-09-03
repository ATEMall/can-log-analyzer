# v2.1.1 候选需求计划（草案）

- 编制：PM　日期：2026-09-01
- 状态：草案，待 GitHub 连接器恢复后转正式 Issue（连接器断开期间的遗留跟踪）
- 来源：v2.1 验收（2026-09-01，commit 013c7cd）中识别的非阻塞遗留项 + 风险项

---

## 候选需求清单

### P1-R2C1：R2 双路径代码收敛（decodeAll 归一化）

- **背景**：`electron/signalDecode.js` 中 `decodeAll`（一次性）与 `decodeFramesChunk`（分块）双路径并存。v2.1 已用收敛测试（20000 帧 × 4 chunk 尺寸）保证位级一致，但长期双路径存在漂移风险。
- **目标**：`decodeAll` 收敛为 `decodeFramesChunk` 的薄封装（内部以单 chunk 调用分块实现），删除重复解码逻辑；保留 `decodeAll` 导出（小语料/测试入口兼容）。
- **验收**：收敛后 162/162 回归全绿；20000 帧收敛矩阵继续通过；代码行数净减少且有单测断言 `decodeAll === decodeFramesChunk(整批)`。

### P1-R2C2：1M 帧端到端真机 UI 实测

- **背景**：R2 基准（`BENCHMARK-R2.md`）在纯 Node 下验证了引擎吞吐（0.24–0.5M 帧/s），但 **Electron UI 端到端**（IPC 事件流 + 前端增量渲染 + 表格/图表渲染）尚无 1M 帧实测证据。
- **目标**：在打包产物（2.1.0）中加载 1M 帧 ASC + 3 DBC，验证：UI 不冻结（主线程响应间隔 < 200ms）、进度条平滑、取消即时生效、内存峰值 < 2GB。
- **交付**：`docs/BENCHMARK-R2-UI.md` 实测报告（含环境、时间线、内存、结论）。
- **验收**：PM 真机复测通过 + 数据可复现。

### P2-BLFC1：BLF 解析超时参数化

- **背景**：`electron/main.js` 中 BLF 解析（python-can 子进程路径）存在硬编码超时（`BLF parsing timeout (file may be very large)`）；超大文件或慢机环境可能误杀。
- **目标**：超时值按文件大小自适应（如 1MB 基准 + 线性增量），并在 settings.json 暴露可调项。
- **验收**：超大 BLF（≥500MB）解析不误杀；settings 可调后立即生效。

### P2-UIC1：大文件加载体验（100MB+ ASC 自动压缩的 UI 反馈）

- **背景**：`file:loadASC` 对 >100MB 文件自动生成压缩副本（`saveCompressed`），但当前无 UI 提示用户正在生成压缩缓存（首次加载可能卡顿数秒）。
- **目标**：加载/压缩过程显示进度提示（"正在生成压缩缓存…"），避免用户误以为卡死。
- **验收**：100MB+ 文件首次加载有明确进度反馈；压缩缓存二次加载直接命中。

---

## 路线图（v3.0+，来自 PRD，非 v2.1.1 范围）

| 版本 | 内容 | 优先级 |
|---|---|---|
| v3.0 | LIN 协议支持（LDF 解析 + 调度表视图） | P1 |
| v3.1 | 车载以太网（SOME/IP / DoIP 报文解码，pcap 导入） | P1 |
| v3.2 | UDS 诊断（ISO 14229 会话/服务解析、DTC 视图） | P2 |
| v3.3 | XCP 测量标定（A2L 解析、DAQ 列表） | P2 |

> 详细需求见 `docs/PRD.md`（Roadmap v3.0+ 章节）。v2.1.1 交付后启动 v3.0 需求拆解（另立计划文档）。

---

## 连接器恢复后的 Issue 映射（草案）

| 需求 | Issue | 优先级 | 标签 | 状态 |
|---|---|---|---|---|
| R2C1 | [#8](https://github.com/ATEMall/can-log-analyzer/issues/8) 双路径收敛：decodeAll 归一化 | P1 | refactor | Open |
| R2C2 | [#10](https://github.com/ATEMall/can-log-analyzer/issues/10) 1M 帧端到端 UI 实测 + BENCHMARK-R2-UI.md | P1 | perf | Open |
| BLFC1 | [#9](https://github.com/ATEMall/can-log-analyzer/issues/9) BLF 解析超时参数化 | P2 | enhancement | Open |
| UIC1 | [#11](https://github.com/ATEMall/can-log-analyzer/issues/11) 大文件加载压缩缓存进度提示 | P2 | ux | Open |
