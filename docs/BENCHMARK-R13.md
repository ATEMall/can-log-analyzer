# R13 多 Y 轴曲线 — 1M 点 × 双轴渲染基准报告

- 生成时间：2026-09-11T14:43:09.518Z
- 语料：1,000,000 点 × 3 信号（rpm / degC / deg，确定性 PRNG seed 0x1A2B，可复现）
- 渲染预算：`MAX_RENDER_POINTS = 5,000`（min/max 分桶降采样上限）
- 环境：Node v24.15.0 / win32 x64
- 方法：headless 下驱动与曲线视图**完全相同的渲染路径**——`src/chartDownsample.mjs#minMaxDownsampleIndices`（降采样）→ `chartData` 构建（与 `SignalChart` 同逻辑）→ 真实 `recharts` 双 Y 轴图表挂载（jsdom 无头渲染）。浏览器真实绘制帧率需按第 3 节真机走查。

## 1. 语料与信号分组

| 信号 | 量纲 (unit) | Y 轴 |
| --- | --- | --- |
| 256::EngineSpeed | rpm | 右 |
| 256::CoolantTemp | degC | 左 |
| 512::SteeringAngle | deg | 右 |

- 左轴量程：[73.4, 86.6]；右轴量程：[-605.0, 10504.0]
- 注入尖峰：9999 @ 第 337,000 点（等步长抽样会跳过该点）；降采样后保留：**是 ✅**

## 2. 渲染路径实测（本机 headless，自动测量）

| 阶段 | 耗时 | 结果 |
| --- | --- | --- |
| generate corpus (1M × 3 signals) | 0.118 s |  |
| min/max bucket decimation | 0.047 s | 输入 1,000,000 点；输出 4,801 点 |
| build chartData | 0.004 s | 输出 4,801 点 |
| recharts dual-axis render (jsdom) | 0.630 s | 3 条曲线 / 2 条 Y 轴 |
| **渲染路径合计（降采样 + 构建 + 挂载）** | **0.681 s** | 验收线 ≤ 2 s → **✅ 通过** |
| 峰值堆内存（headless） | 456.4 MB | heapUsed 采样 |

> 验收②判定：1M 点经 min/max 降采样至 4,801 点后，双轴图表实际挂载 **0.630 s**（本机 headless）≤ 2 s。

## 3. 真机 UI 走查（打包产物，需 PM 回填）

> jsdom 无真实栅格化/合成，浏览器端的绘制帧率与时交互需在打包产物中实测回填。

### 复现步骤

1. 加载一份 ≈1M 帧的日志并解码 ≥3 个不同量纲的信号（或复用 `TestExample/bench/r2-ui.cjs` 生成的 1M 帧 ASC 语料）；
2. 打开「曲线」视图，确认自动分组为左/右双 Y 轴；
3. 观察：图表出现耗时、缩放/平移是否流畅、顶部是否显示「已按 min/max 分桶保真降采样至 N 点（保留峰值）」提示；
4. 对已知含瞬时尖峰的数据，确认尖峰在曲线中可见（不被降采样抹平）。

| 观测项 | 验收线 | 实测值 | 结论 |
| --- | --- | --- | --- |
| 1M 点 × 双轴首屏渲染 | ≤ 2 s | | |
| 缩放/平移交互 | 流畅（主线程无长任务） | | |
| 降采样提示文案 | 出现且点数正确 | | |
| 尖峰保真 | 尖峰可见、轴量程覆盖峰值 | | |

## 4. 结论

- 曲线视图不把 1M 原始点交给 recharts：`minMaxDownsampleIndices` 以「每桶每信号保留 argmin/argmax」把点数压到预算内（本例约 4801 点），任何瞬时峰值都不被抽样丢弃；
- 端到端渲染路径（降采样 + 数据构建 + recharts 双轴挂载）本机 headless 实测 **0.681 s**，满足 ≤2s 验收线；
- 剩余风险在浏览器真实绘制/交互，须按第 3 节由 PM 真机复测回填后闭环。

> 复现：`node TestExample/bench/r13-render.mjs`（结果与硬件相关；`--no-write` 跳过写报告，`--points <n>` 指定语料规模）。
