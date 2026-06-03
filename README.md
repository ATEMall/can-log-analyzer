# CAN Log Analyzer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue.svg)](https://www.python.org/)
[![GitHub Stars](https://img.shields.io/github/stars/ATEMall/can-log-analyzer?style=social)](https://github.com/ATEMall/can-log-analyzer)
[![ATEMall](https://img.shields.io/badge/Platform-ATEMall-orange.svg)](https://github.com/ATEMall)

一款专业的 CAN 总线日志分析工具，支持 ASC / BLF / TRC 等多种日志格式，帮助汽车测试工程师快速定位通信问题。

## 功能特性

- **多格式支持** — 支持 ASC、BLF、TRC 等主流 CAN 日志格式
- **报文过滤** — 按 ID、数据内容、时间范围灵活过滤
- **信号解码** — 基于 DBC 文件解析物理信号值
- **统计分析** — 报文周期统计、负载率分析、错误帧检测
- **可视化图表** — 信号趋势图、报文分布图
- **差异对比** — 对比两份日志的差异，快速定位异常

## 快速开始

### 安装

```bash
pip install -r requirements.txt
```

### 基本使用

```bash
# 分析 ASC 日志文件
python -m can_log_analyzer analyze input.asc

# 使用 DBC 文件解码信号
python -m can_log_analyzer analyze input.asc --dbc database.dbc

# 过滤指定 CAN ID
python -m can_log_analyzer analyze input.asc --filter-id 0x100,0x200

# 导出分析报告
python -m can_log_analyzer analyze input.asc --output report.html
```

### Python API

```python
from can_log_analyzer import LogAnalyzer

# 加载日志文件
analyzer = LogAnalyzer("test_drive.asc")

# 加载 DBC 数据库
analyzer.load_dbc("database.dbc")

# 获取报文统计
stats = analyzer.get_message_stats()
print(stats)

# 解码信号值
signals = analyzer.decode_signal(0x100, data_bytes=[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
print(signals)
```

## 截图

> 截图即将补充

| 日志分析界面 | 信号可视化 |
|-------------|-----------|
| ![日志分析](docs/screenshot_analyzer.png) | ![信号可视化](docs/screenshot_signal.png) |

## 常见问题 (FAQ)

**Q: 支持哪些日志格式？**

A: 目前支持 ASC (Vector CANalyzer/CANoe)、BLF (Binary Log Format)、TRC (PEAK) 格式，后续会扩展更多格式。

**Q: 如何处理大日志文件？**

A: 工具内置分块读取机制，可处理 GB 级别日志文件。建议使用 `--filter-id` 参数缩小分析范围以提升速度。

**Q: DBC 文件在哪里获取？**

A: DBC 文件通常由 OEM 或供应商提供，属于项目机密。你也可以使用 [CANFrameAnalyzer](https://github.com/ATEMall/CANFrameAnalyzer) 辅助理解 CAN 帧结构。

**Q: 能否批量处理多个日志文件？**

A: 可以。使用 `--batch` 参数指定目录即可批量分析：

```bash
python -m can_log_analyzer analyze ./logs/ --batch --output ./reports/
```

**Q: 分析报告支持哪些导出格式？**

A: 目前支持 HTML 和 CSV 格式，JSON 格式支持正在开发中。

## 项目结构

```
can-log-analyzer/
├── can_log_analyzer/   # 核心模块
│   ├── parsers/        # 日志解析器
│   ├── decoders/       # 信号解码器
│   ├── analyzers/      # 分析引擎
│   └── reporters/      # 报告生成
├── tests/              # 单元测试
├── docs/               # 文档
├── examples/           # 示例日志与脚本
└── README.md
```

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/new-parser`)
3. 提交更改 (`git commit -m 'Add new log parser'`)
4. 推送到分支 (`git push origin feature/new-parser`)
5. 发起 Pull Request

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 🔗 更多资源

- 🤖 [ATEMall AI知识库](https://atemall-ai.com) — 汽车测试工程师的AI助手
- 💬 免费使用AI问答，覆盖 HIL / CAN / UDS / EMB 测试领域
- 📋 注册即可获取完整测试模板和DBC文件库
- ⭐ 如果这个工具对你有帮助，欢迎 Star 支持我们！
