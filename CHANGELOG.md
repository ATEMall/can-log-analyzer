# 更新记录（Changelog）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] - 2026-09-19（v2.2.0 版本号一致性 #23）

### 修复

- **`package.json` version 2.1.1 → 2.2.0**（v2.2.0 发版基线）
- **断言不再依赖硬编码字面量（#23）**：`src/components/__tests__/App.test.jsx` 的「一键复制诊断信息」用例改为 `import pkg from '../../../package.json'`，mock 注入 `version: pkg.version`、断言 `应用版本: v${pkg.version}`；此前面板显示真实版本、断言却写死 `v2.2.0`，真实值漂移时测试仍恒绿
- **新增 `src/test/version.test.js`（5 例）**，把版本单一来源钉死在源码层面：
  - `package.json` 版本号为合法 semver 且 ≥ 2.2.0
  - 主进程 `APP_VERSION` 只能来自 `app.getVersion()`（禁止 `APP_VERSION = '2.2.0'` 这类字面量赋值）
  - 诊断日志初始化与 About 对话框都复用 `APP_VERSION`
  - 渲染进程 `src/App.jsx` 不硬编码版本号（诊断文案取 IPC 回传值）
  - 诊断信息单测断言引用 `pkg.version`，而非字面量
- 产物侧：「帮助 → 打开诊断日志」「关于」「一键复制诊断信息」均取 `app.getVersion()`，随 `package.json` 一同变为 2.2.0
## [Unreleased] - 2026-09-19（验收工具链：cantools 43.0.2 环境固化 + 严格模式 #22）

> 解决「对拍通过实为未执行」的假绿通道（#12 / #7 的历史成因）。

### 新增

- **对拍环境固化**：新增 `requirements.txt`，锁定 `cantools==43.0.2` + `python-can`，README 写明环境准备步骤（`python -m venv` → `pip install -r requirements.txt` → `npm run compare`）
- **统一对拍入口**：新增 `scripts/compare-all.js`，遍历 `TestExample/**/compare.js` 并透传参数，汇总 PASS/FAIL；npm 脚本 `npm run compare` / `npm run compare:strict`
- **严格模式**：`--strict`、`CI=1` 或 `CANTOOLS_STRICT=1` 下，Python/cantools 不可用（或 `import cantools` 失败）**直接非零退出（exit 4）**并打印 FATAL；普通模式保留 skip 行为，但输出 `NOT executed` 显著提示与修复指引
  - 判定与文案抽为纯模块 `scripts/compareEnv.js`（`isStrictMode` / `handleMissingEnv` / `skipNotice` / `strictFailure`），两个 compare.js 共用，避免两处策略漂移
  - 退出码语义化：0 通过 / 1 解码不一致 / 2 import 失败 / 3 DBC 加载失败 / 4 环境缺失
- **（stretch）CI**：新增 `.github/workflows/verify.yml`，push/PR 时跑 `npm test` + `pip install -r requirements.txt` + `npm run compare -- --strict`

### 测试

- 新增 `scripts/__tests__/compareEnv.test.js`（严格模式判定、普通模式 skip + exit 0、严格模式 FATAL + exit 4、argv/env 推断、文案与退出码语义，**9 例**）
- 实测：本机无 cantools 时 `npm run compare` → 2/2 skip + 显著提示（exit 0）；`npm run compare -- --strict` → 2/2 FAIL（exit 4，聚合 exit 1）
- 全量回归 **324/324** 通过（23 文件），较 #21 基线 315/315 净增 9 例、0 回退

## [Unreleased] - 2026-09-19（v2.2 R12 修复：Vector 统计行 / ErrorFrame 编码位 / 样例日志 #21）

> PM 09-19 复核 #17（R12）提出的 P1 缺口，修复分支 `feature/v2.2-r12-fix`。**未触碰 `signalDecode.js` 解码路径**。

### 修复

- **识别 Vector `Statistic:` 统计行（#21 ①）**：`1.000000 1  Statistic: D 12 R 0 XD 1 XR 0 E 5 O 0 BusLoad 8.2 %` 原先返回 `null`（落入 headerLines），现解析为 `kind: 'statistic'` 事件，带出 `D/R/XD/XR/E/O` 计数与 `BusLoad`
  - 统计行**不计入**逐行错误帧总数与分类；`buildErrorStats` 新增 `declared`（累计错误/过载计数、BusLoad 均值与峰值、`diff = 声明 − 解析`）与 `statistics` 列表
  - 统计面板新增「日志声明: 错误帧 N / 过载帧 M」标签与**日志自带 BusLoad**（与本机估算的负载交叉校验）；声明数与解析数不一致时提示「**错误计数以日志声明为准**」
- **ErrorFrame Flags / Code 编码位解析（#21 ②）**：`0.123456 CAN 1 ErrorFrame Flags = 0x0001`（原一律 `other`）现解析 `Flags / Code / CodeExt / ID / DLC / Position / Length`，并按 Vector/SJA1000 ECC 编码分类：`0 Bit / 1 Form / 2 Stuff / 3 Other / 4 CRC / 5 Ack-Del / 7 Ack`；无 `Code` 时回落 `CodeExt`（bits 6-11）。行尾文本描述优先，既有分类行为不回退
- **CANoe `Status:chip status <state>` 事件（#21）**：识别 `error active / warning level / error passive / busoff` 四种芯片状态（新增 `warning` 状态色），既有 `CAN 1 Bus Off` / `Chip State:` 写法保持兼容
- **事件行判定单一来源**：ASC 读取的预筛条件抽为 `asc.js` 的 `isErrorEventCandidate(line)`（error / bus / overload / statistic / status / warning），主进程与单测共用，杜绝「chip status 行被当成坏行计入解析错误」

### 样例

- 新增 `TestExample/error_frames/`：`error_frames.asc`（100 数据帧 + 7 × Code 编码 ErrorFrame + 文本 ErrorFrame + 过载帧 + chip status 迁移 + Bus Off + 2 条 Statistic 行）+ `generate.js`（确定性生成，可重复产出）

### 测试

- `electron/__tests__/ascErrorFrame.test.js` 增至 **26 例**：Statistic 行解析与缺失字段容错、Code 编码位 7 种映射、CodeExt 回落、文本优先、字段明细解析、chip status 四态、`isErrorEventCandidate`、**样例日志端到端解析**（9 错误帧 / 2 BusOff / 2 Statistic / 声明 12 > 解析 9）
- `electron/__tests__/busStats.test.js` 增 5 例（统计行不污染分类、declared 汇总与 diff、无统计行时 `declared === null`、warning 不计 BusOff）
- `src/components/__tests__/StatsPanel.test.jsx` 增 4 例（声明标签、自带 BusLoad、差异提示、一致时不提示）
- 全量回归 **315/315** 通过（22 文件），较 R14 基线 288/288 净增 27 例、0 回退；`vite build` 通过

## [Unreleased] - 2026-09-15（v2.2 W2 批次：R14 错误上报与诊断日志）

> v2.2 W2 批次第三项：R14 错误上报与诊断日志（#18）。

### 新增

- **按天滚动诊断日志（R14 / TD-7）**：新增 `electron/diagLog.js`，日志落在 `userData/logs/app-YYYY-MM-DD.log`（Windows 即 `%APPDATA%/can-log-analyzer/logs/`），`info/warn/error` 三级，**异步追加不阻塞 UI**，跨天自动切新文件
  - 记录关键事件：应用启动（版本 / 平台 / Electron / Node）、日志与 DBC 加载（帧数 + 解析错误数 + 错误帧数，**只记计数与原因**）、加载失败、渲染进程崩溃（`render-process-gone`）、页面加载失败、主进程 `uncaughtException` / `unhandledRejection`、退出
  - **7 天自动清理**：启动与跨天时按文件名日期清理过期日志（保留今天 + 7 天，可用假日期单测验证）
  - **脱敏**：`sanitizeDetail()` 对 `data / frames / messages / line / payload` 等内容类键统一替换为 `<redacted>`，字符串截断 200 字、数组截断 5 项、嵌套限深 3 层，日志与诊断信息均不含 CAN 报文内容
- **渲染进程错误上报（R14）**：`App.jsx` 挂载 `window.onerror` 与 `unhandledrejection`，经 `diag:log` IPC 汇总到同一份日志（级别只允许 debug/info/warn/error，事件名截断 120 字）
- **「帮助 → 打开诊断日志」（R14）**：一键 flush 后在文件管理器中定位当日日志；错误报告抽屉同步新增「打开诊断日志」按钮
- **「一键复制诊断信息」（R14）**：错误报告抽屉新增按钮，复制**版本 / 平台 / 运行时 / 会话开始与运行时长 / 日志目录与当日日志路径 / 日志源与帧数 / 解析错误条数与 Top3 原因 / 总线错误帧与 Bus Off 计数**，可直接粘贴进 Issue 定位问题；`navigator.clipboard` 不可用时回退 `execCommand('copy')`

### 测试

- 新增 `electron/__tests__/diagLog.test.js`（文件命名与日期解析、脱敏裁剪与 Error 摘要、行格式、**7 天清理（假日期 -10…+3 天文件）**、跨天滚动触发清理、目录缺失容错、级别过滤、无目录时静默、队列上限丢弃，11 例）
- `src/components/__tests__/App.test.jsx` 增 R14 用例（`window.onerror` / `unhandledrejection` 上报、复制脱敏诊断信息（断言**不含**坏行原文与报文内容）、打开诊断日志，4 例）
- 全量回归 **288/288** 通过（22 文件），较 R12 基线 273/273 净增 15 例、0 回退

## [Unreleased] - 2026-09-14（v2.2 W2 批次：R12 总线负载与错误帧统计）

> v2.2 W2 批次第二项：R12 总线负载与错误帧统计（#17）。

### 新增

- **逐秒总线负载（R12 / FR-VIS-003）**：统计面板新增「总线负载」卡片，展示**逐秒负载率曲线（%）**、平均负载、峰值负载与峰值时刻；比特率可在 125k / 250k / 500k / 1M 间切换并即时重算
  - 聚合在主进程：`electron/busStats.js` 单遍 O(n) 桶聚合，桶间隔自适应（`ceil(span / 2000)` 秒）保证曲线点数 ≤2000；帧位长按标准帧 `44 + 8×len` / 扩展帧 `64 + 8×len` / CAN FD `67 + 8×len` 估算，IPC 只回传点数级序列
- **周期与抖动（R12 / FR-VIS-003）**：按消息 ID 统计帧数、DBC 周期（`GenMsgCycleTime`）、实测周期均值/最小/最大、**抖动（实测周期 − 参考周期）均值与最大值**、超差帧数与占比（阈值 ±10%）；「仅看超差」开关过滤，**点击任一行跳转报文表并高亮该 ID + 定位首帧**
  - 两遍 O(n) 计算，不缓存逐帧时间戳；DBC 无周期时退化为实测均值作为参考
- **错误帧与总线状态（R12 / FR-VIS-004）**：ASC 解析新增 `parseASCErrorLine`，识别 `ErrorFrame`（位填充/格式/应答/CRC/位错误/过载分类）与 `Bus Off` / `Error Passive` / `Error Active` / `Chip State` 事件，不再被计入解析错误；BLF（python-can 路径）错误帧单独上报
  - 统计面板展示错误帧总数、分类计数、Bus Off 次数、**状态时间线标记**（绿/黄/红）与错误帧明细，**点击错误帧跳转报文表对应时刻**（按时间戳二分定位最近帧）
  - 错误事件上限 20 万条保护内存；仅记录时间与分类，不含报文内容
- **统计 CSV 导出（R12）**：沿用 R7 主进程写文件通道新增 `stats:exportCSV`，导出负载序列（time/load/frames）、周期抖动表与错误帧/状态明细

### 测试

- 新增 `electron/__tests__/busStats.test.js`（位长估算/逐秒聚合与自适应间隔/自定义比特率/周期均值与 DBC 抖动/超差占比/首帧下标/行数上限/错误分类与 Bus Off/时间线裁剪，18 例）、`electron/__tests__/ascErrorFrame.test.js`（Vector / CAN / Chip State 三种写法 + 分类 + 数据行不误判，8 例）
- 新增 `src/components/__tests__/StatsPanel.test.jsx`（空态/负载与错误计数/曲线渲染/错误跳转/周期行定位/仅看超差/状态时间线/CSV 导出，8 例）；`App.test.jsx` 增 R12 用例（统计 IPC 参数与渲染、周期行跳转切页签、统计 CSV 导出，3 例）
- 全量回归 **273/273** 通过（21 文件），较 R11 基线 236/236 净增 37 例、0 回退
- 验收对拍：用 `TestExample/powertrain.asc` / `body_chassis.asc` 各取 3 个消息与独立朴素算法交叉核对周期均值与最大抖动，**Δ ≤ 8.6e-14 ms（0 不一致）**；1M 帧统计（负载 + 周期）实测 **120 ms**（验收③ ≤2s）

## [Unreleased] - 2026-09-14（v2.2 W2 批次：R11 全局搜索 + 时间轴总览）

> v2.2「体验与健壮」W2 批次首项：R11 全局搜索 + 时间轴总览（#16）。

### 新增

- **全局搜索（R11 / UI-002）**：顶部单一搜索入口统一检索**消息名 / 信号名 / CAN ID（十进制 + `0x` 十六进制）/ DID**；`Ctrl+F` 唤起、`Esc` 清除，`Enter` 定位首个命中帧；命中以品牌红浅底（`.search-hit-row`）高亮并给出计数（`12 hits`）；搜索范围可选「全部视图（报文帧 + DBC 结构）/ 当前视图（仅 DBC 结构）」
  - 索引在主进程：`electron/searchIndex.js` 单遍 O(n) 扫描落成 `ID -> {count, firstIndex, firstTimestamp}` 稀疏索引，按日志文件路径缓存（`storeMessages` 时失效 + `setImmediate` 预热），1M 帧首建后每次查询为 Map 查找；IPC 只传 `filePath + query`，不回传帧数据
  - 数字类查询同时给出十进制/十六进制两种解释（`291` → `0x123`）；文本类大小写不敏感匹配消息名与信号名，因此 `F190` 可命中 `DID_F190`
- **时间轴总览 minimap（R11 / FR-VIS-002）**：报文日志与曲线视图底部共享缩放条，`electron/timelineBuckets.js` 在主进程 O(n) 单遍聚合为 **~2000 桶**（`bucketCount` 按帧数收敛），IPC 只传桶数组；画布按 top-6 ID 堆叠渲染密度热条（其余 ID 以淡色兜底）
  - 交互：拖拽平移、滚轮 / 双击以光标为中心缩放（最小视窗 1/5000 跨度）、「重置」恢复全览；视窗变化经 `onWindowChange` 冒泡，报文表按时间窗过滤、信号曲线/表格按同一时间窗切片，**两视图共享 `timeWindow` 状态**
  - `MessageTable` 改为受控分页以支持定位跳页：命中 ID 高亮 + 定位帧所在页自动翻页并 `scrollIntoView`（`locateIndex` / `locateNonce`）

### 测试

- 新增 `electron/__tests__/searchIndex.test.js`（ID 解析 / 索引聚集 / 名称+信号+DID 匹配 / scope 切换，15 例）、`electron/__tests__/timelineBuckets.test.js`（桶数收敛 / 总量守恒 / 时间跨度 / per-ID 密度与真实分布一致 / 空语料，6 例）
- 新增 `src/components/__tests__/TimelineOverview.test.jsx`（刷选定位 / 滚轮与双击缩放 / 拖拽平移 / 重置 / 热条标签，8 例）、`GlobalSearchBar.test.jsx`（计数标签 / 定位提示 / 无匹配 / 输入与回车，4 例）
- `MessageTable.test.jsx` 增 R11 用例（命中高亮 / 定位翻页 / 时间窗过滤，4 例）、`App.test.jsx` 增 R11 用例（`Ctrl+F` + 回车定位切页签、`Esc` 清除，2 例）
- 全量回归 **236/236** 通过（18 文件），较 W1 基线 197/197 净增 39 例、0 回退

## [Unreleased] - 2026-09-11（v2.2 W1 批次 + 复核返工）

> v2.2「体验与健壮」W1 批次：R9 深色模式（#13）、R10 可折叠布局与状态记忆（#14）、R13 多 Y 轴曲线（#15）。09-11 依 PM 复核完成 #15 降采样返工（补齐 min/max 保真降采样）与 #19 品牌强调色对齐。

### 新增

- **深色模式（R9 / #13）**：浅色/深色两套 CSS 变量设计令牌（`:root` + `[data-theme='dark']`），跟随系统（`prefers-color-scheme`）+ 主菜单手动切换（`theme:set`）即时生效、无需刷新；选择持久化 `settings.json` 启动恢复；全部组件硬编码色迁移为令牌（`--bg-*`/`--text-*`/`--border-*`/`--chart-grid` 等），antd 经 `ConfigProvider` 切换 `darkAlgorithm`，recharts 轴/网格/提示经 `useThemeTokens` 随主题实时重绘；信号曲线/位布局色板跨主题保持同一语义
- **可折叠布局与状态记忆（R10 / #14）**：左侧 DBC 面板可折叠为一列窄条 rail（默认展开宽 25%；拖拽区间 15%–45%、最小步进 4px 量化）；`panelWidth` / `panelCollapsed` / `dbcExpanded` / `lastTab` 全部写入 `settings.json` 并在启动时校验恢复；DBCPanel 展开状态改为受控 prop + 内部回退
- **多 Y 轴曲线 + min/max 保真降采样（R13 / #15）**：曲线视图支持左/右双 Y 轴——按信号量纲（DBC `unit`）自动分组，同单位共享一轴，最大分组占左轴、其余归右轴；每个信号可经下拉手动切换左/右轴；各轴独立自适应量程（含常量曲线防塌陷 padding）；轴色取该轴首个信号的曲线颜色保持一致；**新增 min/max 分桶保真降采样**——超过渲染预算（`MAX_RENDER_POINTS = 5000`）时按 `buckets = clamp(floor(maxPoints / (2 × 信号数)), 1, n)` 分桶，每桶每信号保留 argmin/argmax 极值点（替换原等步长抽样，任何瞬时尖峰/毛刺不再被抽样丢弃），并提示「已按 min/max 分桶保真降采样至 N 点（保留峰值）」；图例逐信号显隐不变
- **品牌强调色对齐（R9-fix / #19）**：品牌红 `#C62828` 经 antd `ConfigProvider` `colorPrimary`（`theme.js` `BRAND_PRIMARY` 单一来源）与 CSS 令牌 `--brand` 落地，替代 antd 默认蓝；选择态强调（`--bg-selected`/`--border-selected`/`--text-accent`）随品牌红对齐；深色底使用品牌红提亮变体（`--brand: #e5484d`，对比度 ≥4.5:1）；曲线/位布局调色板仍由 `palette.js` 独立持有，不受影响

### 测试

- 新增 `src/test/theme.test.jsx`（主题核心 + ThemedApp 宿主 + #19 品牌色，14 例）、`App.test.jsx` R10 布局持久化用例（4 例）、`src/test/chartDownsample.test.mjs`（min/max 分桶降采样 10 例：单点尖峰 / 负向极值 / 多信号独立 / 预算上限 / 升序去重 / 非有限值忽略，含等步长对照回归证明旧算法丢尖峰）、`SignalChart.test.jsx` R13 多 Y 轴 + 降采样用例（6 例：多轴分组 / 轴色 / 单轴 / 手动切轴 + 渲染预算内降采样提示 + 尖峰端到端保留）
- 新增 `TestExample/bench/r13-render.mjs` → `docs/BENCHMARK-R13.md`：1M 点 × 双轴渲染路径本机 headless 实测 **0.68 s**（min/max 降采样 1,000,000 → 4,801 点 + chartData 构建 + recharts 双轴挂载），满足验收② ≤2 s
- 全量回归 **197/197** 通过（14 文件）

## [Unreleased] - 2026-09-06（Issue #8–#12 批次）

> open Issues 清零批次：#8 R2 双路径收敛断言、#9 BLF 超时参数化、#10 R2 UI 基准、#11 大文件压缩缓存进度提示、#12 对拍脚本 cantools NamedSignalValue 序列化崩溃。

### 修复

- **对拍脚本 cantools 43.0.2 崩溃（#12）**：`TestExample/motorola_matrix/compare.js` 与 `TestExample/dbc_full/compare.js` 内嵌 pyScript 新增 `_norm(v)`（`getattr(v, 'value', v)` 解包枚举信号 `NamedSignalValue`）+ `json.dumps(..., default=str)` 兜底，含 cantools 环境不再抛序列化异常；收紧策略保留（import 失败 skip exit 0、DBC 加载失败 FATAL exit 1）。无 cantools 环境 skip exit 0、全量 `npm test` 163/163 通过
- **BLF 解析超时误杀（#9）**：`electron/main.js` BLF python-can 子进程超时由硬编码 600000ms 改为按文件大小自适应（2 min 基准 + 6 s/MB，上限 60 min），并支持 settings.json `blfParseTimeoutMs` 覆盖（每次加载即时生效、无需重启）；超时错误信息包含当前超时值与调参路径
- **大文件压缩缓存无反馈（#11）**：`file:loadASC` 对 >100MB 文件生成 `.gz` 缓存前通过 `cache:compress-progress` 事件通知渲染进程（start/done/error 三阶段），二次加载直接命中缓存跳过压缩；preload 暴露 `onCacheCompressProgress`，App 以 keyed toast 提示「正在为大文件生成压缩缓存…」

### 新增

- **R2 双路径收敛断言（#8）**：`signalDecode.test.js` 新增单测断言 `decodeAll` 与整批 `decodeFramesChunk` 位级一致（decodeAll 已收敛为薄封装）
- **R2 UI 端到端基准（#10）**：`TestExample/bench/r2-ui.cjs`（确定性 1M 帧 × 3 DBC，驱动主进程同款解析/压缩/分块解码+IPC 序列化路径）→ `docs/BENCHMARK-R2-UI.md`：本机主进程解析 1M 帧 2.0s、.gz 压缩 1.5s、分块解码 ~1.8s/DBC、峰值堆 735MB；渲染层人工观测步骤与回填表（待 PM 真机实测）

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
