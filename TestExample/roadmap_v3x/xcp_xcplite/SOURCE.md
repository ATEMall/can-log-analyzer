# XCPlite 测试素材来源说明

本目录下的 `.a2l` 文件来自 **Vector Informatik GmbH** 的开源项目 **XCPlite**。

| 项 | 内容 |
|---|---|
| 上游仓库 | https://github.com/vectorgrp/XCPlite |
| 许可证 | **MIT**（经 GitHub API 确认：`license.spdx_id = MIT`）——允许再分发，需保留版权与许可声明 |
| 版权 | Copyright 2024 Vector Informatik GmbH |
| 获取方式 | GitHub Contents API 下载（`scripts` 侧一次性脚本，非运行时依赖） |

## 文件清单与用途

| 本地文件 | 上游路径 | 用途 |
|---|---|---|
| `hello_xcp_autodetect.a2l` | `examples/hello_xcp/CANape/xcp_demo_autodetect.a2l` | 最小 XCP 样例：内联 `ECU_ADDRESS`、少量测量/标定量 |
| `c_demo_autodetect.a2l` | `examples/c_demo/CANape/xcp_demo_autodetect.a2l` | 含多种数据类型（U8/U16/U32/U64）的标定量 |
| `no_a2l_demo.a2l` | `examples/no_a2l_demo/CANape/no_a2l_demo.a2l` | 仅 MEASUREMENT（34 个）、无 CHARACTERISTIC，用于覆盖边界 |
| `a2l_test_autodetect.a2l` | `test/a2l_test/CANape/xcp_demo_autodetect.a2l` | 标定量最多的样例（49 个 CHARACTERISTIC） |
| `no_a2l_demo.log` | `examples/no_a2l_demo/CANape/no_a2l_demo.log` | **注意**：这是 A2L 生成器的 ELF 解析日志，**不是 XCP 测量数据**，仅供格式参考 |

## 重要发现（影响验收）

1. **这些 A2L 没有显式的 XCP 传输层块**：四个文件中 `XCP_ON_CAN` / `XCP_ON_TCP_IP` / `XCP_ON_USB` 计数均为 **0**（XCPlite 使用 "autodetect"，由工具在运行时探测传输层）。因此 `detectXcpTransport()` 对它们返回 `explicit: false`——**不能据此假设为 XCP on CAN**。
   本项目 `electron/a2l.js` 明确区分「显式声明 XCP_ON_CAN」与「未声明」，避免把以太网误当 CAN（PLAN §三 T5 的约束）。真正含 `XCP_ON_CAN` 的素材见用户提供的 EIS A2L（`XCP_ON_CAN` × 9）。
2. **地址写法**：这些文件用**内联** `ECU_ADDRESS 0x10090`（不是 `IF_DATA CANAPE_EXT 100 <addr>`），由此发现并修复了 `a2l.js` 原先取不到地址的问题。
3. 同目录内的 `.log` 不是 XCP DAQ 记录，故 XCP 侧的对拍仍以用户提供的 EIS `.trc`（PCAN CAN FD，含真实 DAQ 数据）为准。

## 未采用的素材（供后续参考）

- `christoph2/pyA2L` 仓库内含 34 个 `.a2l`（多为 VW/Bosch 真实 ECU 文件，单文件可达 17MB）。
  - **未采用原因**：仓库许可为 **GPL-2.0**，且样例含真实 ECU 的完整标定／地址信息，入库会带来许可传染与再分发风险。仅列为「外部参考」，不入库、不参与自动化测试。
  - 若后续需要真实 ECU 大文件对拍，建议由具备授权的一方在 CI 中通过
    `XCP_EIS_DIR` 类似的外部变量挂载，而不是提交到仓库。
