# Roadmap v3.x-v5.0 测试素材（2026-09-03 收集）

对应 PRD 路线图：v3.0 LIN / v4.0 UDS·XCP·DoIP / v5.0 车载以太网。来源均为公开开源仓库与标准示例，用于路线图需求的原型验证与解析器开发测试。

## lin/ — v3.0 LIN 支持（12 个 LDF）

| 文件 | 说明 | 来源 |
|---|---|---|
| lin22_example.ldf | **LIN 2.2A 规范官方示例** | c4deszes/ldfparser examples/ |
| lin13 / lin20 / lin21 / lin22.ldf | 各版本语言级测试集 | c4deszes/ldfparser tests/ldf/ |
| j2602_1.ldf | SAE J2602 变体 | 同上 |
| iso17987.ldf | ISO 17987 变体 | 同上 |
| lin_diagnostics.ldf | 诊断帧（NAD/DSI） | 同上 |
| lin_schedules.ldf | 调度表（Schedule_table） | 同上 |
| ldf_with_sporadic_frames.ldf | Sporadic frame | 同上 |
| lin_encoders.ldf | Signal encoding/representation | 同上 |
| exampleLIN_ti.ldf | TI 应用笔记示例 | PrajinkyaPimpalghare/LDF-File-Parser |

配套 LIN 日志缺失（ASC `Li` 帧格式样本未找到公开源）——v3.0 开发时需用 CANoe/自研生成。

## uds_xcp/ — v4.0 UDS + XCP（7 个文件）

| 文件 | 说明 | 来源 |
|---|---|---|
| ASAP2_Demo_V161.a2l / V171.a2l | **ASAM 官方 ASAP2 Demo**（1.6.1 / 1.7.1 全特性，157KB/242KB） | mrom1/a2lparser testfiles（源自 ASAM Wiki） |
| TEST_Nested_Includes.a2l | 嵌套 INCLUDE 解析用例 | 同上 |
| freeTest.a2l | MIT 许可完整示例工程 Free_Example | Luncher91/A2LParser src/test/resources |
| uds_msd80_*.cap ×3 | **真实 BMW MSD80（N54 DME）UDS/ISO-TP 总线日志**，candump 文本格式：0x7e0/0x7e8 UDS（ISO 14229）+ 0x6f1/0x612 KWP2000，含 ISO-TP 多帧重组（137B 长响应） | f8al/kernelcon-AKL captures/（KernelCon 2026） |

XCP 测量日志（DAQ 抓包）未找到公开源——v4.0 XCP 需求开发时需用 CANape/A2L+XCP simulator 自制。

## ethernet/ — v5.0 车载以太网（6 个 pcap/pcapng）

| 文件 | 说明 | 来源 |
|---|---|---|
| someip2.pcapng (255KB) / someip_s3.pcapng / someip_notification.pcapng / someip_vsomeip_capture.pcapng | **SOME/IP 与 SOME/IP-SD 报文**（vsomeip 框架实测） | thunder2005/SOMEIP demo/ |
| doip_communication.pcapng (1MB) | **完整 DoIP（ISO 13400）流程**：UDP 车辆发现 → TCP 路由激活 → UDS 0x22 诊断往返 | chipsoft/doip etc/ |

## 许可提示

- c4deszes/ldfparser、thunder2005/SOMEIP、chipsoft/doip、f8al/kernelcon-AKL：开源仓库（MIT/参考各仓库 LICENSE）
- ASAP2 Demo 文件：源自 ASAM 官方 Wiki 公开示例，仅测试用途
- 商用/发布前请核对各来源许可条款
