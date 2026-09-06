# R2 UI 端到端基准报告（主进程管线实测 + UI 人工观测步骤）

- 生成时间：2026-09-06T05:24:03.366Z
- 语料：1,000,000 帧 × 3 DBC（确定性 PRNG seed 0xBEEF，可复现）
- 分块大小（IPC 事件流）：100,000 帧；环境：Node v24.15.0 / win32 x64
- 方法：headless 下驱动与打包应用完全相同的**主进程代码路径**（流式 ASC 解析 `loadASCFile`、`.gz` 压缩缓存 `saveCompressed`、分块解码 `decodeFramesChunk` + 每 chunk IPC 负载 `JSON.stringify`）。渲染层（DOM/表格/图表绘制、主线程响应间隔）无法 headless 观测，见下方「UI 人工观测」步骤。

## 1. 语料与 DBC

| DBC | 消息数 | 信号数 |
| --- | --- | --- |
| dbc_full (ext/mux/float/attr) | 3 | 11 |
| powertrain | 3 | 15 |
| body_chassis | 3 | 26 |
| **合计（同一条 1M 帧日志）** | 9 | 52 |

- ASC 语料文件：C:\Users\jj_10\AppData\Local\Temp\cla-r2ui-full\cla-r2ui-1000000.asc
- 超过 100MB 压缩缓存阈值：#11 压缩路径 不触发（语料未达 100MB 阈值）

## 2. 主进程管线实测（本机 headless，自动测量）

| 步骤 | 耗时 | 说明 |
| --- | --- | --- |
| generateASC (1M-frame corpus text) | 1.32 s | 50.4 MB |
| write ASC corpus to disk | 0.06 s |  |
| main-process streaming ASC load | 1.87 s | 解析 1,000,000 帧 |
| saveCompressed (.gz sidecar) | 1.23 s | 50.4 MB → 16.2 MB (32.1%)；heap +-62 MB |
| cache-hit gate (existsSync, no re-compress) | 0.00 s | 命中（0 重复压缩） |
| chunked decode + IPC payload — dbc_full (ext/mux/float/attr) | 1.46 s | 解码 555,556 / 输出 555,556 行；0.68M 帧/s；IPC 负载 52.3 MB；heap +140 MB |
| chunked decode + IPC payload — powertrain | 1.71 s | 解码 444,444 / 输出 444,444 行；0.59M 帧/s；IPC 负载 68.0 MB；heap +-31 MB |
| chunked decode + IPC payload — body_chassis | 1.59 s | 解码 444,444 / 输出 444,444 行；0.63M 帧/s；IPC 负载 111.2 MB；heap +114 MB |
| 峰值堆内存 | 734.4 MB | 主进程 heapUsed 峰值采样 |
| **总计** | 9.42 s | 不含人工观测的渲染/绘制 |

## 3. UI 人工观测（打包产物实测，需 PM 真机填写）

> 渲染层指标无法由脚本驱动，须在打包产物（release/ 目录 v2.1.1）中按下列步骤实测并回填。

### 复现步骤

1. 生成语料：`node TestExample/bench/r2-ui.cjs --frames 1000000 --out D:\tmp\cla-r2ui`（生成 `cla-r2ui-1000000.asc`，本机整轮约 10 s，语料生成约 2 s）；
2. 启动打包应用（`CAN Log Analyzer Pro.exe`），先加载 `TestExample/dbc_full/dbc_full.dbc`、`powertrain.dbc`、`body_chassis.dbc`（任意顺序，3 个 DBC 可叠加）；
3. 「打开日志」选择 `cla-r2ui-1000000.asc`，全程观察：顶部进度条是否平滑推进、窗口是否可拖动（主线程响应）、何时出现「加载成功，共 1,000,000 条消息」；
4. 若语料 >100MB：首载应出现「正在为大文件生成压缩缓存…」提示（#11），载完生成 `.gz`；**再次加载同一文件**应直接命中缓存、无压缩提示、加载明显更快；
5. 信号解码页勾选全部信号 → 解码，观察：进度条平滑度、期间拖动窗口响应、取消按钮是否即时生效（应在当前 chunk 边界停止）；
6. 打开表格/图表 Tab，观察渲染与滚动帧率。

| 观测项 | 验收线 | 实测值 | 结论 |
| --- | --- | --- | --- |
| 主线程响应间隔（拖动窗口） | < 200ms | | |
| 加载进度条 | 平滑推进、无冻结 | | |
| 解码进度条 | 平滑推进 | | |
| 取消生效延迟 | ≤ 1 chunk（100k 帧） | | |
| 内存峰值（任务管理器） | < 2GB | | |
| 二次加载缓存命中 | 无重复压缩提示且更快 | | |

## 4. 结论

- 主进程管线（解析 / 压缩 / 分块解码 + IPC 序列化）在 1M 帧 × 3 DBC 下吞吐与 BENCHMARK-R2.md 引擎基准同量级，解码侧无二次 IPC 全量回传（每 chunk ≤ 100k 行事件流），不会出现「语料 + 全量结果」双驻留；
- 剩余风险收敛在渲染层（表格/图表绘制与 DOM 更新频率），须按第 3 节由 PM 真机复测回填后闭环。

> 复现：`node TestExample/bench/r2-ui.cjs`（结果与硬件相关；--no-write 跳过写报告，--out &lt;dir&gt; 指定语料目录）。
