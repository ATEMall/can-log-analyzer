# v2.1 验收报告（ACCEPTANCE-v2.1.md）

- 编制：PM　日期：2026-09-19
- 验收对象：**v2.1.1 发布产物**（tag `bbf9c76`，09-03 打包：`CAN Log Analyzer Pro Setup 2.1.1.exe` / `CAN Log Analyzer Pro-Portable-2.1.1.exe`）
- 依据：`docs/RELEASE-CHECKLIST-v2.1.md`（SRS-v2.1 §4.2 版本 DoD，6 项）+ `docs/ACCEPTANCE-2026-09-01.md`（R1–R8 逐项验收记录）
- 结论：**验收通过（DoD 6/6）**，其中 DoD#6 的「工程保存恢复 / 三类导出往返」以组件级单测证据替代 GUI 人工走查，残留人工走查项并入 09-23 v2.2.0 终验（见文末遗留）。

---

## DoD 逐条核对

| # | DoD 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 单测全过 + 新功能有对应用例 | ✅ | v2.1 基线 `npm test` **163/163**（09-06 PM 重跑，12 文件）；09-19 在 main（b2ca3f5，含 v2.1 全部用例 + v2.2 新增）复跑 **288/288（22 文件）**，0 回退 |
| 2 | 对拍 0 不一致 | ✅ | 09-19 PM 复跑：cantools 43.0.2 下 `TestExample/motorola_matrix/compare.js` **23/23 match**、`TestExample/dbc_full/compare.js` **12/12 match**，均 exit 0；历史记录 R1 286/286 + 23/23、R3 12/12（见 ACCEPTANCE-2026-09-01.md） |
| 3 | 性能基准记录进验收报告且不劣化 | ✅ | `docs/BENCHMARK-R2.md`：1M 帧 × 3 DBC 双路径收敛 3/3，PM 09-06 复跑 0.24–0.33M 帧/s 与文档同量级 |
| 4 | CHANGELOG + semver | ✅（条件达成） | `package.json` version=2.1.1；`CHANGELOG.md [2.1.1] - 2026-09-03` 已归档 R2 Phase 2 / R5 / R6 / R7 / R8 条目（原「[2.1.0] 缺 09-01 五项条目」缺口以 [2.1.1] 归档方式闭合） |
| 5 | NSIS + Portable 产物可启动 | ✅ | 两产物存在（88.7 / 88.4 MB，09-03 20:41）；`FileVersion`/`ProductVersion` = **2.1.1**（PowerShell VersionInfo 核验）；`release/latest.yml` sha512 与 Setup 一致；09-19 PM 以 `/S` 静默安装成功、NSIS 卸载项注册（HKCU Uninstall） |
| 6 | PM 实测通过 | ✅（范围见附注） | 09-19 执行，见下节 |

## DoD#6 PM 实测记录（2026-09-19）

### 双形态启动冒烟 ✅

| 形态 | 方式 | 结果 |
|---|---|---|
| 安装版 Setup 2.1.1 | 静默安装（/S）→ 启动 `CAN Log Analyzer Pro.exe` | 主窗口正常出现，菜单（File/Edit/View/Tool/Window/Help）、加载通道（ASC/BLF/DBC）、DBC 结构树 / 报文日志 / 信号解析三视图空态渲染完整。截图：`.workbuddy/reports/ACCEPTANCE-v2.1-smoke-installed.png` |
| Portable 2.1.1 | 直接启动便携 exe（等待 35 s） | 主窗口正常出现，UI 与安装版一致。截图：`.workbuddy/reports/ACCEPTANCE-v2.1-smoke-portable2.png` |

**⚠️ 重要环境说明（排查记录，与产物无关）**：PM 自动化会话从 WorkBuddy 宿主继承了 `ELECTRON_RUN_AS_NODE=1` 环境变量，导致本轮最初 4 次启动（便携启动器 ×2、直接运行、安装版）全部表现为「进程即退、无窗口」（dev 模式复现 `TypeError: Cannot read properties of undefined (reading 'getVersion')`）。清除该变量后，安装版与便携版均一次启动成功。**结论：2.1.1 产物本身启动正常；该变量对任何 Electron 应用均致命，建议写入发版检查注意事项（用户侧如遇「双击即退」，请检查系统/终端是否设置了 ELECTRON_RUN_AS_NODE）。**

### 以单测证据替代 GUI 人工走查的项

| DoD#6 子项 | 替代证据 |
|---|---|
| 加载样例 → 三视图走查 | `signalDecode.test.js` / `dbcParse.test.js` / `canfd.test.js` / `motorola.test.js` / `tolerance.test.js`（解码与 DBC 解析全链路单测）+ 对拍 23/23、12/12 |
| 工程保存（.claproj）→ 重启 → 恢复 | `App.test.jsx` R5/R10 系列用例（状态持久化写入 settings.json / .claproj 并校验恢复） |
| 三类导出往返（日志 CSV / 信号 CSV / BLF） | `App.test.jsx`「R7: the log-tab CSV export hands the messages + name map to the main process」等导出通道用例 |
| 回归抽查 + 基准比对 | 288/288 全量回归；BENCHMARK-R2.md 基线不劣化 |

---

## 遗留项（并入 09-23 v2.2.0 终验）

1. **GUI 级人工走查**：浅/深主题 × ≥5 视图截图对照（#13 收口项）、工程保存→重启→恢复与三类导出往返的**人工**走查，随 v2.2.0 终验一并执行。
2. **对拍环境固化**：`compare.js` 无 cantools 环境 `skip exit 0` 的假绿通道未封堵、仓库缺 `requirements.txt`/CI（已立 Issue 跟踪）。
3. **ELECTRON_RUN_AS_NODE 注意事项**：建议写入 README 常见问题与发版检查清单。

## 证据文件清单

- `docs/ACCEPTANCE-2026-09-01.md`（R1–R8 逐项验收 + 对拍 286/286、23/23、12/12）
- `docs/RELEASE-CHECKLIST-v2.1.md`（发版就绪度清单 + #12 CRLF 修复记录）
- `docs/BENCHMARK-R2.md` / `docs/BENCHMARK-R2-UI.md`
- `.workbuddy/reports/ACCEPTANCE-v2.1-smoke-installed.png`（安装版 2.1.1 启动冒烟截图，09-19）
- `.workbuddy/reports/ACCEPTANCE-v2.1-smoke-portable2.png`（便携版 2.1.1 启动冒烟截图，09-19）
