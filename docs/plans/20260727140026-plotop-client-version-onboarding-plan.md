# Plotop Client 版本感知与连接引导优化计划

- 文档编号：20260727140026
- 标题：plotop-client-version-onboarding-plan
- 状态：待评审
- 作者：OpenCode

---

## 1. 背景与问题

Plotop 把采集端（C++ client）和分析端（Electron server）分成两个独立工具：

- Server 通过 GitHub Releases 发布桌面安装包；
- Client 通过 GitHub Actions 交叉编译成 `x86_64` / `arm64` Linux 二进制，同样上传到 Releases。

当前用户在桌面端打开 Plotop 后，面对"暂无客户端连接"的空状态，只知道一条固定命令 `./plotop -i <server_ip> -p 28081 -d 1`，但不知道：

1. client 去哪里下载；
2. 该下载哪个架构；
3. 本机实际 IP、当前 TCP 端口是什么；
4. 已连接的 client 是什么版本，是否与 server 兼容；
5. 有没有 break change，是否需要升级。

因此需要强化连接引导，并在 client/server 之间交换版本信息。

---

## 2. 目标

- 用户在 Plotop 桌面应用内即可自然完成"在目标设备上启动 client"的引导。
- Server 能识别每个已连接 client 的 app 版本、协议版本、架构。
- 当 client 版本过旧、存在 break change 或 client 比 server 新时，在 IP 列表对应行给出明确提示。
- 通过独立的协议版本号精确控制 break change 判定，避免误报。

---

## 3. 非目标

- 不将 client 二进制打包进 server 安装包（保持安装包小巧）。
- 不实现自动 SSH/SCP 部署。
- 不修改现有 stats / heartbeat 数据协议语义。
- 不为 Windows/macOS 客户端做额外适配（当前 client 仅支持 Linux）。

---

## 4. 总体方案

1. 引入**独立的协议版本号** `protocol_version`，与 app `version` 解耦。
2. Client 连接成功后立即发送 `hello` 握手消息，携带版本、协议版本、架构。
3. Server 保存每个 client 的版本信息，并缓存 GitHub latest release 信息。
4. Renderer 端：
   - 空状态改造成"连接向导"：列出本机 IP、选择架构/来源（下载 vs 编译）、一键复制部署命令。
   - IP 列表每行显示 client 版本标签（含 protocol_version、架构），并根据兼容性状态显示提示/警告。

---

## 5. 详细设计

### 5.1 协议版本号

- 常量：
  - Client：`PLOTOP_PROTOCOL_VERSION`，通过 makefile `-D` 注入。
  - Server：`SERVER_PROTOCOL_VERSION` 和 `MIN_CLIENT_PROTOCOL_VERSION`。
- 初始值均为 `1`。
- 仅当 client/server 通信语义不兼容时才 bump。

### 5.2 何时算 break change（需 bump protocol_version）

算 break change：

- 修改已有字段含义（如 `cpu_user` 从 ticks 改成百分比）。
- 删除 server 还在依赖的字段。
- 新增 server 必须识别的必填字段。
- 改变消息分帧方式（当前为 `\n` 分隔 JSON）。
- 改变握手流程。

不算 break change：

- 新增可选字段。
- 新增 server 可忽略的消息类型。
- client 新增命令行参数。
- 仅改动 UI 或 server 内部逻辑。

### 5.3 Client 握手

Client 在 TCP 连接建立后、进入主循环前，立即发送：

```json
{
  "type": "hello",
  "version": "0.2.3",
  "protocol_version": 1,
  "arch": "x86_64"
}
```

- `version` 来自已有的 `PLOTOP_VERSION`。
- `protocol_version` 来自 `PLOTOP_PROTOCOL_VERSION`。
- `arch` 通过 makefile 的 `-DPLOTOP_ARCH="x86_64"` / `arm64` 注入。

### 5.4 Server 状态

`src/server/store.ts` 中 `ClientState` 新增字段：

```ts
clientVersion?: string;
protocolVersion?: number;
arch?: string;
versionStatus?: 'unknown' | 'compatible' | 'outdated' | 'break-change' | 'newer-than-server';
```

### 5.5 版本检查逻辑

Server 在收到 `hello` 后计算状态。所有状态都不阻断使用，仅做提示：

| 条件 | 状态 | UI 提示 |
|------|------|---------|
| 未收到 `hello` | `unknown` | 版本未知，建议升级到支持版本信息的 client |
| `protocol_version < MIN_CLIENT_PROTOCOL_VERSION` | `break-change` | ⚠️ 协议版本不兼容，建议升级 client，否则可能出现数据异常 |
| `protocol_version > SERVER_PROTOCOL_VERSION` | `newer-than-server` | client 比 server 新，建议升级 server |
| `clientVersion < latestReleaseVersion` | `outdated` | 有新版本可用，建议升级 |
| 其他 | `compatible` | 正常，显示版本号 |

GitHub latest release 信息在 server 启动后异步获取并缓存（TTL 5 分钟），避免每次 UI 请求都访问 API。

### 5.6 空状态连接向导

将 `src/renderer/index.html` 的 `emptyHint` 改造为交互面板，包含三个标签页/折叠区：

1. **下载二进制（默认）**
   - 选择架构：`x86_64` / `arm64`
   - 选择本机 IP
   - 动态生成并一键复制 `wget` 命令

2. **从源码编译**
   - 提供完整编译命令：
     ```bash
     git clone https://github.com/caibingcheng/plotop.git
     cd plotop
     make
     # 交叉编译: make CROSSCOMPILER=aarch64-linux-gnu-
     # 然后：
     ./plotop -i <server_ip> -p <port> -d 1
     ```
   - 同样支持填入 IP 和端口

3. **连接帮助**：检查防火墙、端口、网络连通性

Server 通过 socket.io 发送 server_info：

```ts
{
  serverVersion: '0.2.3',
  latestClientVersion: '0.2.3',
  downloadUrl: 'https://github.com/caibingcheng/plotop/releases/download/v0.2.3/plotop-v0.2.3-x86_64.zip',
  localIps: ['192.168.1.100', '10.0.0.5'],
  tcpPort: 28081
}
```

### 5.7 IP 列表版本提示

每个 IP 行右侧显示：

```
v0.2.3 (p1, x86_64)  [黄色 badge: 可升级]
```

- `v0.2.3`：client app 版本
- `p1`：protocol version
- `x86_64`：架构
- badge 颜色与文案根据状态变化，但点击 IP 仍可正常进入图表页

状态徽标文案：

| 状态 | 颜色 | 文案 |
|------|------|------|
| `compatible` | 绿色 | 正常 |
| `unknown` | 灰色 | 版本未知 |
| `outdated` | 黄色 | 可升级 |
| `break-change` | 橙色/红色 | 建议升级（不兼容） |
| `newer-than-server` | 蓝色 | server 可升级 |

点击 badge 后弹出/展开提示框，给出下载链接或编译说明。

---

## 6. 文件改动清单

| 文件 | 改动内容 |
|------|----------|
| `client/packet.h` | 新增 `to_hello(version, protocol_version, arch)` |
| `client/main.cc` | 连接成功后发送 `hello` |
| `makefile` | 注入 `PLOTOP_PROTOCOL_VERSION` 和 `PLOTOP_ARCH` |
| `src/server/store.ts` | `ClientState` 增加版本相关字段 |
| `src/server/tcp-server.ts` | 解析 `hello`，保存版本，emit `client_info/<ip>` |
| `src/server/index.ts` 或新增模块 | 缓存 GitHub latest release，提供 `server_info` 事件 |
| `src/main.ts` | 版本/Release 获取逻辑可复用或迁移 |
| `src/renderer/index.html` | 空状态改成连接向导 + IP 列表版本徽标 |
| `src/renderer/desktop-ui.css` | 新增版本徽标、提示样式 |
| `README.md` | 更新使用说明和版本匹配说明 |

---

## 7. 数据结构 / 接口定义

### Client → Server hello

```json
{
  "type": "hello",
  "version": "0.2.3",
  "protocol_version": 1,
  "arch": "x86_64"
}
```

### Server → Renderer client_info

```json
{
  "ip": "192.168.1.101",
  "alive": true,
  "clientVersion": "0.2.3",
  "protocolVersion": 1,
  "arch": "x86_64",
  "status": "outdated",
  "latestVersion": "0.2.4",
  "downloadUrl": "https://github.com/caibingcheng/plotop/releases/download/v0.2.4/plotop-v0.2.4-x86_64.zip"
}
```

### Server → Renderer server_info

```json
{
  "version": "0.2.3",
  "protocolVersion": 1,
  "latestVersion": "0.2.4",
  "tcpPort": 28081,
  "localIps": ["192.168.1.100"]
}
```

---

## 8. 兼容性与降级

- 旧 client 不发送 `hello` 仍可正常连接和传输数据。
- Server 对旧 client 标记为 `unknown`，UI 提示建议升级，但不强制断开。
- 新 client 连接旧 server：如果旧 server 不识别 `hello`，client 应忽略，不影响后续 stats/heartbeat。
- 协议版本不匹配时，仍保持连接，但 UI 明确提示数据可能不可靠。

---

## 9. 发布与文档

- 每次 release 继续由 `build.yml` 生成 client 二进制、`electron.yml` 生成 server 安装包。
- Release Note 中明确列出对应版本的 client 下载链接。
- README.md 增加一节"Client 与 Server 版本匹配"。
- 约定：任何修改 client/server 通信协议的 PR，必须同时 review 是否需要 bump `protocol_version`，并在 PR 描述中说明。

---

## 10. 验收标准

- [ ] 空状态提供"下载二进制"和"从源码编译"两个入口。
- [ ] 编译命令可直接复制并在目标设备上执行。
- [ ] IP 列表显示 `vX.Y.Z (pN, arch)` 格式的版本信息。
- [ ] `break-change` 状态显示强烈升级建议，但不阻止用户点击进入图表。
- [ ] `outdated` / `newer-than-server` / `unknown` 状态仅显示建议，不影响使用。

---

## 11. 风险与应对

| 风险 | 应对 |
|------|------|
| GitHub API 访问失败导致 latest release 获取不到 | 缓存 + 失败时降级为空，不影响已有功能 |
| client 架构识别错误 | 默认显示 x86_64，用户可手动切换 |
| 旧 client 被误判为不兼容 | 通过独立 protocol_version 精确控制，不改变则不会误判 |
| 安装包不打包 client，用户网络受限时无法下载 | 在引导中保留"从源码编译"说明，作为 fallback |

---

## 12. 待确认事项

- 在确认实施前已全部确认。
