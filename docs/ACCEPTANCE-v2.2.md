# v2.2.0 终验清单（ACCEPTANCE-v2.2.md）

- 编制：PM（待执行）　准备：开发侧　日期：2026-09-19
- 验收对象：**v2.2.0 发布产物**（tag `v2.2.0`，commit `035cb5b`；`release/CAN Log Analyzer Pro Setup 2.2.0.exe` + `CAN Log Analyzer Pro-Portable-2.2.0.exe`）
- 依据：`docs/PLAN-v2.2.md`（v2.2 六项需求 R9–R14 + 通用 DoD 7 条 + 发版批次）
- 用法：开发侧已填「可自证」部分（✅ + 证据 / ⚠️ 环境限制），**⏳ 项须 PM 在真机执行并回填结果**；全部通过后在 CHANGELOG/README 留档并关闭 #13 / #17。

---

## 一、发版 DoD（PLAN-v2.2 §四）

| # | DoD 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 分支与提交规范 + 合并前评论自测证据 + `Closes #N` 闭环 | ✅ | 需求分支 `feature/v2.2-r*` 逐个开发；#21/#22/#23 均「先 push → 先评论 → 再合并」，合并提交 `10be9b8` / `61024ea` / `4534c2e` 带 `Closes #N` 且 GitHub 自动闭环；流程约束在 Issue #20 已书面确认 |
| 2 | 每个需求附单测；全量回归 ≥163/163 不回退；cantools 对拍 0 不一致 | ✅ / ⏳ | **329/329**（24 文件，0 回退，v2.1.1 基线 162/162）；对拍 `signalDecode.js` 未被 R12 改动触碰（`git diff --name-only` 可核），有 cantools 环境的 23/23 + 12/12 **待 PM 复核** |
| 3 | 性能红线不劣化 | ✅ | 1M 帧统计 120 ms（R12 验收③ ≤2 s）；1M 点 × 双轴渲染 0.68 s（`docs/BENCHMARK-R13.md`）；1M 帧解析/解码见 `docs/BENCHMARK-R2.md` / `BENCHMARK-R2-UI.md` |
| 4 | UI 规范：主题令牌、无新增硬编码色、进度可取消、空态引导 | ✅ | 令牌化（`src/theme.js` + CSS 变量）；品牌红经 #19 落地；组件级断言 + 令牌覆盖检查 |
| 5 | 交付流程：推送后在 Issue 评论；CHANGELOG/README 同步 | ✅ | 各需求评论齐备；`CHANGELOG.md [2.2.0] - 2026-09-19` 定版；`README.md` 顶部标注当前版本 2.2.0 + 各功能章节同步 |
| 6 | PM 逐条复核（代码走查 + 实测 + 截图） | ⏳ | 见下节；本环境无 GUI，截图/走查项须 PM 执行 |
| 7 | 文档：影响使用方式的功能须更新 README | ✅ | 全局搜索 / 时间轴总览 / 总线统计 / 诊断日志 / cantools 对拍 均已入 README |

---

## 二、需求验收对照（⏳ = PM 真机执行）

### R9 深色模式（#13，P0）— ⏳

| 验收项 | 状态 | 证据 / 执行方式 |
|---|---|---|
| ① 全部视图逐屏走查无白块残留 | ⏳ | 报文表 / 信号表 / 曲线 / 位布局 / DBC 面板 / 统计 / 错误抽屉，浅深各 1 张 |
| ② 跟随系统切换即时生效 | ✅（可自证部分） | `src/test/theme.test.jsx` 14 例；PM 侧改系统主题观察 |
| ③ 重启后主题恢复 | ✅ | `App.test.jsx` R10 持久化用例 + settings.json 回读 |
| ④ 回归 + 主题单测 | ✅ | 329/329 |
| ⑤ 截图对照（浅/深 × ≥5 视图） | ⏳ | 本环境无 GUI，无法产出；PM 执行 |

### R10 可折叠布局（#14，P0）— ✅（PM 抽验）

- 折叠/展开/拖拽（15%–45%，4 px 步进）、`panelWidth`/`panelCollapsed`/`dbcExpanded`/`lastTab` 持久化：单测 `App.test.jsx` 4 例。
- ⏳ PM 抽验：拖拽帧率目测、1M 帧加载中折叠不丢滚动状态。

### R11 全局搜索 + 时间轴总览（#16，P1）— ✅

- 主进程索引（`electron/searchIndex.js`）+ 时间轴 ~2000 桶（`electron/timelineBuckets.js`）；单测 `searchIndex.test.js` 15 例、`timelineBuckets.test.js` 6 例、`TimelineOverview.test.jsx` 8 例、`GlobalSearchBar.test.jsx` 4 例、`MessageTable.test.jsx` 4 例、`App.test.jsx` 2 例。
- ⏳ PM 抽验：1M 帧首响应体感、拖拽缩放流畅度。

### R12 总线负载与错误帧统计（#17，P1）— ✅ / ⏳

| 验收项 | 状态 | 证据 |
|---|---|---|
| ① 周期均值/抖动与独立算法一致（±0.1 ms） | ✅ | `powertrain.asc` / `body_chassis.asc` 各 3 消息交叉核对，Δ ≤ 8.6e-14 ms |
| ② 含错误帧样例的分类与跳转 | ✅（素材 + 单测）/ ⏳（真机） | `TestExample/error_frames/error_frames.asc`（含 generate.js 可重复产出）；端到端断言 9 错误帧 / 2 BusOff / 2 Statistic / 声明 12 > 解析 9 |
| ③ 1M 帧统计 ≤2 s 不阻塞 UI | ✅ | 实测 120 ms |
| ④ 超差筛选联动 | ✅ | `StatsPanel.test.jsx` 超差筛选 + 周期行定位跳转 |

### R13 多 Y 轴曲线 + 降采样（#15，P1）— ✅

- 按量纲自动分组双轴 + 手动切轴 + min/max 保真降采样（尖峰不丢）：`chartDownsample.test.mjs` 10 例、`SignalChart.test.jsx` 6 例；1M 点 × 双轴渲染 0.68 s（`docs/BENCHMARK-R13.md`）。

### R14 错误上报与诊断日志（#18，P1）— ✅ / ⏳

- 按天滚动日志 + 7 天清理 + 脱敏 + 一键复制诊断信息：`diagLog.test.js` 11 例、`App.test.jsx` 4 例；版本链路经 #23 统一为 `package.json` → `app.getVersion()`。
- ⏳ PM 抽验：人为触发解析错误后 `帮助 → 打开诊断日志` 能定位当日日志、复制内容可直接粘贴。

---

## 三、产物冒烟（⏳ PM 执行）

| 形态 | 检查点 | 预期 |
|---|---|---|
| `CAN Log Analyzer Pro Setup 2.2.0.exe`（88.7 MB） | 安装 → 启动 → 关于对话框版本号 | `ProductVersion = 2.2.0`；主窗口、菜单、三视图空态正常 |
| `CAN Log Analyzer Pro-Portable-2.2.0.exe`（88.5 MB） | 直接启动 | 同上，UI 与安装版一致 |
| `帮助 → 打开诊断日志` / 一键复制诊断信息 | 复制文本首行 | `应用版本: v2.2.0` |

> 环境注意事项（v2.1 终验遗留）：宿主若设置 `ELECTRON_RUN_AS_NODE=1`，Electron 会「双击即退、无窗口」。启动前请清除该变量。

---

## 四、遗留 / 转后续

1. **#13 / #17 关闭**：待 PM 真机走查 + 截图证据回填后以 `Fixes #N` 关闭。
2. **#20 流程 P0**：已书面确认「先评论证据 → 2 小时窗口 → `Closes #N` 合并」；截图类验收项划为 PM 侧执行。
3. **cantools 对拍真机复核**：本机无 Python/cantools；`npm run compare -- --strict` 设计为 FATAL + exit 1（禁假绿）。PM 侧：`pip install -r requirements.txt` → `npm run compare`，期望 23/23 + 12/12、exit 0。
4. **S1–S3 转 v2.3**：信号表格虚拟滚动、`SIG_GROUP_`、信号值差异对比（09-19 确认 v2.2 不做）。
5. **#10 遗留 BENCHMARK-R2-UI 真机回填**：渲染层人工观测步骤与回填表仍待真机数据。

## 五、证据文件清单

- `CHANGELOG.md §[2.2.0] - 2026-09-19`（逐批次条目与回归数）
- `docs/BENCHMARK-R13.md`、`docs/BENCHMARK-R2.md`、`docs/BENCHMARK-R2-UI.md`
- `TestExample/error_frames/`（R12 错误帧样例 + 生成器）、`TestExample/motorola_matrix/`、`TestExample/dbc_full/`
- `requirements.txt` + `scripts/compare-all.js` + `.github/workflows/verify.yml`（对拍环境与严格模式）
