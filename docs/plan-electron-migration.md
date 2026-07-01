# Plotop Electron 迁移规划

## 1. 整体规划（Overall Plan）

将 Plotop 服务端从 Python/Flask 完全迁移到 TypeScript/Electron 架构。

### 目标

- 统一入口：单个应用/二进制同时承担后端与 UI。
- 两种启动模式：
  - `plotop --web`：仅启动后端 server，监听 `0.0.0.0:5000`（HTTP）和 `0.0.0.0:8001`（TCP），通过浏览器访问。
  - `plotop`：启动 Electron 桌面窗口，内嵌本地 Web UI。
- 后端：Express + Socket.IO + Node.js `net`，完整复刻现有协议。
- 前端：静态页面 + Socket.IO，替代 Jinja2 模板。
- 构建与分发：npm + electron-builder，替代 setuptools/pip。
- C++ client 不变：继续使用 `make` 编译，`./plotop -i <ip> -p 8001 -d 1`。
- 版本管理：从 git tag 读取，构建时注入。

### 后续可扩展项

- 数据持久化（数据库替代内存缓存）。
- 远程模式 / 多窗口支持。
- 配置持久化。
- 自动更新。
- 打包签名。

## 2. 最小可用版本（MVP）

第一期交付功能等价于当前 Python 版本的最小可用 Electron 应用。

### 范围

- 项目骨架：
  - `package.json`、`tsconfig.json`。
  - `src/main.ts`：解析 `--web`，启动 server，决定是否创建 Electron 窗口。
  - `src/server/`：Express + Socket.IO + TCP server。
  - `src/renderer/`：迁移 `index.html`、`plot.html`、`plotop-chart-core.js`。
- 协议兼容：
  - TCP 8001 接收 C++ client 的 JSONL，保持原有消息类型解析。
  - Socket.IO 事件与现有前端完全一致。
- 前端最小改动：
  - `index.html` 改为通过 Socket.IO 动态拉取 IP 列表。
  - `plot.html` 的 `{{ ip }}` 改为从 URL query 参数读取。
- 构建脚本：
  - `npm run dev`：ts-node 开发启动。
  - `npm run build`：编译到 `dist/`。
  - `npm run electron`：启动桌面模式。
  - `npm run web`：启动 web 模式。
  - `npm run dist`：electron-builder 打包。
- 清理：
  - 移除 `server/`、`setup.py`、`requirements.txt`、以及 `pyproject.toml` 中的 Python 构建配置（保留 `makefile` 用于 C++ client）。
  - 更新 `README.md`。
