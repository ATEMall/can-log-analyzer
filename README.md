# CAN Log Analyzer

> 一款面向汽车/工控测试工程师的桌面端 CAN 日志分析工具，支持 ASC / BLF 文件的加载、过滤与导出。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 📂 加载 ASC 文件 | 支持 Vector CANoe / TSMaster 多种 ASC 格式，流式解析大文件 |
| 📂 加载 BLF 文件 | 优先使用 `python-can` 解析，自动回退纯 JS 解析器 |
| 📋 DBC 文件解析 | 导入 DBC 数据库，自动识别消息名称与信号定义 |
| 🔍 消息 ID 过滤 | 按消息 ID 勾选过滤，支持全选 / 反选 |
| 💾 导出为 ASC | 流式写入，支持百万级报文导出，实时进度反馈 |
| 🗜️ 大文件压缩 | 自动对 >100 MB 的 ASC 文件进行 gzip 压缩缓存 |

---

## 技术栈

- **前端**：React 18 + Ant Design 5
- **桌面框架**：Electron 28
- **构建工具**：Vite 5
- **后端（主进程）**：Node.js 原生模块（`fs` / `zlib` / `readline` / `child_process`）
- **BLF 解析**：python-can（可选，未安装时自动回退内置 JS 解析器）

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- Python 3（可选，用于 BLF 文件解析）

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 方式一：一键启动（Vite 开发服务 + Electron）
npm run electron:dev

# 方式二：分步启动
npm run dev          # 终端 1：启动 Vite 开发服务器
# 终端 2 等待 http://localhost:5173 可用后，再启动 Electron
```

### 构建安装包

```bash
npm run electron:build
```

构建产物位于 `release/` 目录：

| 平台 | 产物 |
|------|------|
| Windows | `CAN Log Analyzer Setup x.x.x.exe`（NSIS 安装包） |
| macOS | `CAN Log Analyzer-x.x.x.dmg` |

---

## 使用说明

### 1. 加载日志文件

- 点击 **ASC** 按钮 → 选择 `.asc` 格式日志文件
- 点击 **BLF** 按钮 → 选择 `.blf` 格式日志文件

### 2. 加载 DBC 文件（可选）

- 点击 **加载 DBC** 按钮 → 选择 `.dbc` 数据库文件
- 加载后消息列表将显示可读名称，便于勾选过滤

### 3. 过滤消息

- 在消息列表中勾选需要保留的消息 ID
- 支持 **全部选择** / **取消全选**
- 点击 **应用过滤** 生效

### 4. 导出结果

- 点击 **导出为 ASC** → 选择保存路径
- 支持大文件流式写出，底部进度条实时反馈

---

## BLF 文件支持说明

BLF 解析优先调用系统 Python + `python-can` 库（精度更高）：

```bash
pip install python-can
```

若 Python 环境不可用，程序将自动切换到内置 JS 解析器（支持标准 BLF 及 TSMaster 自定义格式）。

---

## 文件格式说明

| 格式 | 全称 | 说明 |
|------|------|------|
| ASC | ASCII Logging Format | Vector 文本日志，人类可读，支持多总线类型 |
| BLF | Binary Logging Format | Vector 二进制日志，高效压缩，适合长时间记录 |
| DBC | Database CAN | CAN 网络数据库，定义消息 ID 与信号解析规则 |

---

## 系统要求

| 平台 | 最低版本 |
|------|---------|
| Windows | Windows 10 (64-bit) |
| macOS | macOS 10.14 Mojave |
| Linux | Ubuntu 18.04+ |

---

## 开发相关

```
can-log-analyzer/
├── electron/
│   ├── main.js        # 主进程：文件 I/O、IPC 处理、DBC/ASC/BLF 解析
│   └── preload.js     # 预加载脚本：contextBridge 暴露 API
├── src/
│   ├── App.jsx        # 主界面组件
│   ├── main.jsx       # React 入口
│   ├── index.css      # 全局样式
│   ├── components/    # UI 子组件
│   └── utils/         # 工具函数
├── public/            # 静态资源（图标等）
├── dist/              # Vite 构建产物（自动生成）
├── release/           # electron-builder 打包产物
└── vite.config.js     # Vite 配置
```

---

## License

MIT © 2024
