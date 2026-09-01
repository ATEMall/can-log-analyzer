# v2.1 发版就绪度清单（Release Readiness Checklist）

- 编制：PM　日期：2026-09-01　基线：commit `013c7cd`（本地=远程）+ 验收记录 `ee89a5b`
- 依据：SRS-v2.1 §4.2 版本 DoD（继承 PRD §7.3，逐条执行）
- 状态：**6 项中 3 项就绪，3 项缺口待开发补齐后执行 PM 终验**

---

## DoD 逐条核对

| # | DoD 项 | 状态 | 证据 / 缺口说明 | 责任方 |
|---|---|---|---|---|
| 1 | 单测全过 + 新功能有对应用例 | ✅ 就绪 | `npm test` **162/162**（12 文件）；R2 收敛测试、R3 标志位单测、R5/R6/R7/R8 均有专项用例 | — |
| 2 | 对拍 0 不一致 | ✅ 就绪 | cantools 43.0.2：R1 286/286 + 23/23；R3 12/12（端到端）；证据见 `docs/ACCEPTANCE-2026-09-01.md` | — |
| 3 | 性能基准记录进验收报告且不劣化 | ✅ 就绪 | `docs/BENCHMARK-R2.md`（1M 帧 × 3 DBC，双路径收敛 3/3）；PM 本机复跑 0.24–0.33M 帧/s 与文档同量级；已引用进验收记录 | — |
| 4 | CHANGELOG + semver | ⚠️ **缺口** | `package.json` version=2.1.0 ✅；但 `CHANGELOG.md [2.1.0]` 只记录到 08-31（R1/R3/R4/R2 Phase 1），**缺 09-01 五项条目**：R2 Phase 2（纯流式+收敛+基准）、R5（.claproj 工程保存/恢复+最近文件）、R6（偏好持久化 settings）、R7（日志 CSV/信号 CSV/BLF 导出）、R8（UI 增量：进度/空态/徽章/快捷键） | 开发 |
| 5 | NSIS + Portable 产物可启动 | ⚠️ **缺口** | `release/CAN Log Analyzer Pro Setup 2.1.0.exe` 与 `-Portable-2.1.0.exe` 存在（08-31 打包，ae3aec6），但**不含 09-01 交付（013c7cd）**，须用最新 main 重新打包后冒烟启动验证 | 开发 |
| 6 | PM 实测通过 | ⬜ 待执行 | 缺口 4/5 补齐 + 重新打包后，PM 执行：安装/便携双形态启动 → 加载样例 → 三视图走查 → 保存工程 → 重启恢复 → 三类导出往返 | PM |

---

## 附加交付物核对（SRS §5 交付物清单）

| 交付物 | 状态 | 说明 |
|---|---|---|
| 代码 main R1-R8 | ✅ | 013c7cd 已推送，PM 已验收 |
| 测试矩阵全部用例 + 对拍脚本可重复执行 | ✅ | `TestExample/motorola_matrix/compare.js`（cantools 缺失时跳过、加载失败致命退出）、`TestExample/dbc_full/compare.js`、`TestExample/bench/r2-bench.cjs` |
| 样例 | ✅ | motorola_matrix / dbc_full / canfd_rich 全部重生成且 cantools 可直载 |
| README 更新 | ⚠️ **缺口** | README 已覆盖 R1/R3/R4 内容，但**缺 R5-R8 使用手册章节**（工程保存/最近文件/设置、三类导出、UI 快捷键），需补「使用手册」新增小节 | 开发 |
| CHANGELOG v2.1.0 | ⚠️ 缺口 | 见 DoD #4 | 开发 |
| release/ Setup + Portable | ⚠️ 缺口 | 见 DoD #5 | 开发 |

---

## 终验执行计划（缺口补齐后）

1. **开发补齐**（期望 09-05 前）：
   - [ ] CHANGELOG [2.1.0] 补 09-01 五项功能条目（R2 Phase 2 / R5 / R6 / R7 / R8）
   - [ ] README 补 R5-R8 使用手册小节
   - [ ] 用最新 main（013c7cd + 验收记录）重新打包 Setup + Portable 2.1.0
2. **PM 终验**（DoD #6，目标 09-19 前）：
   - [ ] Setup + Portable 双形态安装/启动冒烟
   - [ ] 加载 `TestExample/dbc_full/dbc_full.asc` + DBC → 三视图走查（含扩展帧 Ext 徽标 / mux 分支 / 浮点）
   - [ ] 工程保存（.claproj）→ 重启 → 恢复走查（DoD R5/R6 验收标准：现场 100% 恢复）
   - [ ] 三类导出（日志 CSV / 信号 CSV / BLF）→ 重新导入 diff（帧数/内容一致）
   - [ ] 回归抽查 + 与 BENCHMARK-R2.md 比对无劣化
   - [ ] 产出 `docs/ACCEPTANCE-v2.1.md`（含基准数据与终验结论）→ GitHub release v2.1.0

## 阻塞项

- GitHub 连接器断开：关闭 #2/#3/#5/#6/#7 与后续建 Issue（v2.1.1 候选）待连接器恢复后执行；验收正文已固化于 `docs/ACCEPTANCE-2026-09-01.md`，恢复后一键关闭。
