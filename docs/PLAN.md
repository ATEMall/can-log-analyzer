# CAN Log Analyzer Pro — 开发计划（Roadmap & Execution Plan）

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 编写日期 | 2026-08-29 |
| 编写人 | 产品经理（翟枢） |
| 配套文档 | 产品定义 `docs/PRD.md` · 开发需求 `docs/SRS-v2.1.md` · 验收报告 `docs/ACCEPTANCE-2026-08-29.md` |
| 跟踪方式 | GitHub Issues #1–#6 + 项目看板（7 张卡片） |

---

## 1. 产品定义速览

> 完整定义见 `docs/PRD.md`。

- **一句话定位**：完全离线、本地运行的智能汽车通信日志分析桌面工具，覆盖 CAN / CAN FD / LIN / 车载以太网，并支持 UDS / XCP 高层协议解析。
- **核心闭环**：加载日志 → 关联数据库（DBC/LDF/A2L）→ 一键解码 → 可视化与导出。
- **价值主张**：零门槛（便携单文件、无授权、无联网）· 可信赖（与 cantools 对拍一致）· 多协议 · 可回放（物理量 ↔ 报文双向转换）。
- **目标用户**：汽车电子测试工程师、标定工程师、诊断工程师、嵌入式开发、学生。

## 2. 版本路线图（总览）

| 版本 | 主题 | 关键交付 | 周期 | 状态 |
|---|---|---|---|---|
| v2.0.0 | 基础版 | ASC/BLF + DBC 解码三视图、CSV→ASC | 已发布 2026-08-22 | ✅ 已交付（验收有条件通过） |
| **v2.1** | **正确性与地基** | Motorola P0 修复、分块解码引擎、DBC 补全、工程保存、持久化、导出补全 | **3 周（~09-19）** | 🔄 进行中 |
| v2.2 | 体验与健壮 | 深色模式、可折叠布局、全局搜索、时间轴总览、总线负载统计、错误上报 | 2 周 | 计划 |
| v3.0 | LIN 支持 | LDF 解析、LIN 帧解析、调度表可视化 | 4 周 | 计划 |
| v4.0 | 高层协议 | UDS（ISO-TP + 服务解析）、XCP（A2L）、DoIP 基础 | 5 周 | 计划 |
| v5.0 | 车载以太网 | PCAP/PCAPNG、SOME/IP、DoIP、跨总线时间对齐 | 5 周 | 计划 |

> v3.0（LIN）与 v4.0（UDS/XCP）可并行推进。

## 3. v2.1 执行计划（当前迭代）

### 3.1 需求 → Issue → 看板映射

| 需求（SRS） | 优先级 | GitHub Issue | 看板卡片 | 周次 | 交付物 |
|---|---|---|---|---|---|
| R1 Motorola 解码修复 | P0 | [#1](https://github.com/ATEMall/can-log-analyzer/issues/1) | v2.1-R1 | W1（~09-05） | 修复 + 对拍矩阵 + motorola_matrix 样例 |
| R2 分块解码引擎 | P0 | [#2](https://github.com/ATEMall/can-log-analyzer/issues/2) | v2.1-R2 | W2（~09-12） | IPC 契约 + 100 万帧达标 |
| R3 DBC 解析补全 | P1 | [#3](https://github.com/ATEMall/can-log-analyzer/issues/3) | v2.1-R3 | W2（~09-12） | 属性/扩展帧/mux/值类型 + dbc_full 样例 |
| R4 解析容错 | P1 | [#4](https://github.com/ATEMall/can-log-analyzer/issues/4) | v2.1-R4 | W1（~09-05） | 逐行容错 + 错误报告 UI |
| R5/R6 工程+持久化 | P0 | [#5](https://github.com/ATEMall/can-log-analyzer/issues/5) | v2.1-R5/R6 | W3（~09-19） | .claproj + 最近文件 + settings.json |
| R7/R8 导出+UI 增量 | P1 | [#6](https://github.com/ATEMall/can-log-analyzer/issues/6) | v2.1-R7/R8 | W3（~09-19） | CSV/BLF 导出 + 8 项 UI |
| PM 验收发版 | — | — | 验收卡 | W3（09-19） | ACCEPTANCE-v2.1.md + 产物 |

### 3.2 周计划

**W1（09-01 ~ 09-05）—— 正确性**
- R1：修复 `decodeSignalFrame()` Motorola 遍历；构建 ≥60 布局对拍矩阵（cantools 基准）；新增 `TestExample/motorola_matrix/`（≥10 Motorola 信号 DBC + ASC/BLF + compare.js）；位布局视图同步 + 字节序图例。
- R4：ASC 逐行容错、BLF 坏块跳过、错误报告 Drawer。
- **周报检查点**：对拍 0 不一致证明 + 容错样例演示。

**W2（09-06 ~ 09-12）—— 架构与解析能力**
- R2：主进程数据驻留、6 条新 IPC 通道、分块解码 + 进度/取消、列式存储、100 万帧基准。
- R3：BA_ 属性 / 扩展帧 / 多路复用 / SIG_VALTYPE_，`TestExample/dbc_full/`，mux 对拍。
- **周报检查点**：100 万帧性能数据（≤5s / RSS≤800MB / 取消≤2s）+ mux 对拍结果。

**W3（09-13 ~ 09-19）—— 会话效率与收尾**
- R5/R6：.claproj 保存恢复、文件关联、最近文件、偏好持久化。
- R7/R8：CSV/BLF 导出往返验证、8 项 UI 增量。
- PM 验收：按 SRS §4 测试矩阵全量执行 → `docs/ACCEPTANCE-v2.1.md` → CHANGELOG → 构建 NSIS + Portable。
- **周报检查点**：验收结论 + 发版。

### 3.3 依赖与关键路径

```
R1(Motorola) ──┐
R4(容错) ──────┼──► R2(分块引擎, 基于修正后的解码逻辑) ──► R3(DBC补全) ──► R7(导出) ──► 验收发版
                                          └──► R5/R6(工程/持久化, 独立可并行) ──┘
```

- **关键路径**：R1 → R2 → 验收。R1 必须最先完成（R2 重构需基于正确解码逻辑）。
- R5/R6 与 R2/R3 无耦合，可并行。
- 风险缓冲：W3 后半段仅安排收尾，若 W2 延期，R7/R8 可降级到 v2.1.1（不影响 P0 交付）。

## 4. 质量门槛（每版本 DoD）

1. 全部单测通过，新增功能有对应用例；
2. 关键解析器与 cantools / 官方样例对拍 **0 不一致**；
3. 性能基准不劣化并记录进验收报告；
4. CHANGELOG 更新，版本号符合 semver；
5. 产出 Windows NSIS + Portable，均可正常启动；
6. PM 实测通过后方视为验收通过。

## 5. 汇报机制

- **每周五**：PM 出周报（本周完成 / 对拍与性能数据 / 阻塞项 / 下周计划 / 看板状态快照）。
- **验收日**：验收报告 + Issue 状态更新（关闭/新增缺陷 Issue）。
- **缺陷流程**：测试发现问题 → GitHub Issue（含复现步骤与期望值）→ 修复 → 回归 → 关闭。

## 6. 远期版本要点（概要）

- **v2.2**：深色模式、左侧面板折叠/拖宽、全局搜索、时间轴总览、总线负载与错误帧统计、曲线多 Y 轴、PNG/SVG 导出、日志差异对比。
- **v3.0 LIN**：LDF 解析（节点/帧/信号/调度表/校验和类型）、ASC LIN 帧解析、BLF LIN 对象、调度表时序视图。
- **v4.0 UDS/XCP**：ISO-TP 多帧重组、UDS 服务解析（SID/DID/DTC/安全访问/会话）、请求响应配对视图；A2L 解析、DAQ 解包、标定曲线。
- **v5.0 以太网**：PCAP/PCAPNG、SOME/IP、DoIP、AVB 统计、CAN↔ETH 时间对齐。

---

*本计划由 PM 维护；进度以 GitHub Issues 与项目看板为准，每周五同步。*
