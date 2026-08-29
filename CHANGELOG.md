# 更新记录（Changelog）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
