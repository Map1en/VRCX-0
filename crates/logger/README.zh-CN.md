# VRCX-0 自建记录端（实验性）

[English](README.md) | **简体中文** | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

自建记录端运行在常开的机器上，在 VRCX-0 关闭期间记录好友动态。VRCX-0 启动后，这段时间的记录会补回本地好友动态。

> [!WARNING]
> 实验性功能。记录端会用你的账号从另一个 IP 登录 VRChat。受 VRChat 政策与安全检测影响，可能出现掉线、反复验证，严重时账号受限或封禁，风险自负。登录信息只发送到你自己的记录端。

## 范围

- 补回：好友上线、下线、位置、状态、模型变更。在 VRCX-0 中开启“自动更新好友简介”后，也补回简介变更。
- 一个记录端对应一个 VRChat 账号。
- 不补回：
    - VRCX-0 崩溃、被强制结束、睡眠或断网后的约 30 秒；
    - 一段记录结束时尚未确认的下线；
    - 记录端自身与 VRChat 断开期间的变化。

## 运行要求

- 一台常开的机器：Linux（x86_64 或 ARM64），如 NAS、VPS、树莓派；或 Windows 电脑（x86_64）。
- Docker 与 Docker Compose v2（`docker compose` 命令）。也提供独立可执行文件。
- VRCX-0 能通过网络访问这台机器。

## 安装

### 安装脚本

```sh
curl -fsSL https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/install.sh | sh
```

脚本依次询问安装目录、发布通道、端口、监听地址、保留天数、容量上限和密码，直接回车使用方括号中的默认值，随后启动容器，并显示需要在 VRCX-0 中填写的地址和密码。设置保存在安装目录的 `.env`，密码保存在 `password`。

- 更新：重新运行脚本。只询问发布通道（默认为当前通道），`.env`、`password` 和 `compose.yaml` 保持不变。修改其他设置时，编辑 `.env` 后在安装目录执行 `docker compose up -d`。
- 停止：追加 `-s down`（`... | sh -s down`）。
- 当前用户无权使用 Docker 时，改用 `sudo sh`。

### Docker Compose

```sh
mkdir vrcx-0-logger && cd vrcx-0-logger
curl -fsSLO https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/compose.yaml
printf '%s' '你的密码' > password
docker compose up -d
```

NAS 图形界面（群晖 Container Manager、Unraid 等）：镜像填 `ghcr.io/map1en/vrcx-0-logger:latest`，映射端口 `8787` 和一个目录到 `/data`，设置环境变量 `VRCX0_LOGGER_PASSWORD`。Unraid 请把 `/data` 映射到缓存盘或单块硬盘路径（如 `/mnt/cache/appdata/vrcx-0-logger`），`/mnt/user` 共享路径可能损坏 SQLite 数据库。若把密码直接写进 Compose 文件的 `environment:`，其中的 `$` 需写成 `$$`。

### 发布通道

| 标签     | 适用                         |
| -------- | ---------------------------- |
| `latest` | 正式版 VRCX-0                |
| `beta`   | 测试版 VRCX-0                |
| `x.y.z`  | 固定版本，如 `2.32.0-beta.1` |

正式版 VRCX-0 只能连接正式版记录端。

### 独立可执行文件

从 [Releases](https://github.com/Map1en/VRCX-0/releases) 下载 `vrcx-0-logger_<版本>_linux_<架构>`，设置密码环境变量后运行。需要常驻时，可交给 systemd 等服务管理器。

### Windows

从 [Releases](https://github.com/Map1en/VRCX-0/releases) 下载 `vrcx-0-logger_<版本>_windows_x86_64.exe` 并运行。窗口中会显示要填入 VRCX-0 的地址和自动生成的密码，以及监听地址、端口、数据文件夹、保留天数和存储上限。设置保存在 `%LOCALAPPDATA%\VRCX-0 Logger\logger.env`，记录默认存放在同目录的 `data` 文件夹。窗口开着时记录端就在运行，VRChat 连不上等连接问题会列在状态下方。

不需要窗口时（例如交给任务计划程序启动），用 `--headless` 参数运行，并按「配置项」设置环境变量。

### 配置项

使用安装脚本或 Docker Compose 时，编辑安装目录中的 `.env`，然后执行 `docker compose up -d`。密码在 `password` 文件中。

| `.env` 键                     | 默认值    | 说明                                                 |
| ----------------------------- | --------- | ---------------------------------------------------- |
| `VRCX0_LOGGER_TAG`            | `latest`  | 发布通道。                                           |
| `VRCX0_LOGGER_PORT`           | `8787`    | 宿主机端口。                                         |
| `VRCX0_LOGGER_BIND`           | `0.0.0.0` | 宿主机监听地址。                                     |
| `VRCX0_LOGGER_RETENTION_DAYS` | 不限      | 删除早于该天数的记录。                               |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`    | 超过该容量（MB）时从最旧的记录开始删除；`0` 为不限。 |

独立可执行文件读取以下环境变量；在 NAS 图形界面中，把它们设置在容器上：

| 变量                          | 默认值                        | 说明                                                 |
| ----------------------------- | ----------------------------- | ---------------------------------------------------- |
| `VRCX0_LOGGER_PASSWORD`       | 必填                          | 至少 8 位，用于加密通信和数据。                      |
| `VRCX0_LOGGER_PASSWORD_FILE`  |                               | 改为从文件读取密码。                                 |
| `VRCX0_LOGGER_HOST`           | `0.0.0.0`                     | 监听地址。                                           |
| `VRCX0_LOGGER_PORT`           | `8787`                        | 监听端口。                                           |
| `VRCX0_LOGGER_DATA_DIR`       | `data`（Docker 中为 `/data`） | 数据目录。                                           |
| `VRCX0_LOGGER_RETENTION_DAYS` | 不限                          | 删除早于该天数的记录。                               |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`                        | 超过该容量（MB）时从最旧的记录开始删除；`0` 为不限。 |

在容器中不要设置 `VRCX0_LOGGER_HOST`、`VRCX0_LOGGER_PORT` 和 `VRCX0_LOGGER_DATA_DIR`，需要换端口时改端口映射。

## 在 VRCX-0 中连接

**工具 → 自建记录端**：

1. 开启自动备份。
2. 填写记录端地址，如 `http://192.168.1.10:8787`。
3. 填写记录端密码。
4. 让记录端登录 VRChat，需要时完成双重认证。

VRCX-0 与记录端之间的通信用密码加密。不要把端口暴露到公网；需要远程访问时使用 Tailscale 等 VPN。在 VPS 上，把监听地址（`.env` 中的 `VRCX0_LOGGER_BIND`）设为 VPN 地址，或只通过防火墙放行该端口。

## 使用

- **状态栏**：代理图标旁的图标显示记录端状态。橙色：登录中、重连中、账号不一致或响应异常。红色：无法连接、密码错误、版本不兼容，或 VRChat 需要登录、需要双重认证验证码。
- **补回**：VRCX-0 连上后自动进行，也可以点“立即补回”。正常关闭 VRCX-0 会立即交给记录端。
- **Webhook**：支持 Discord 或任意接收 POST 的地址。在登录停止、需要双重认证、无法保存记录、未补回的记录因容量上限被删除，以及恢复记录时发送。每条消息开头标明类型（`login`、`storage`、`recovered`、`test`），出错时附带原始错误信息。
- **健康检查**：`GET /health` 在记录端能读取数据库时返回 200。镜像中没有 shell，请从容器外部监控。

## 升级

重新运行安装脚本，或执行 `docker compose pull && docker compose up -d`。版本不需要完全一致：VRCX-0 提示记录端需要更新时再更新即可。在此之前 VRCX-0 会暂停补回，记录不会丢失。

## 常见问题

| 问题                | 检查                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 无法连接记录端      | 容器是否运行、防火墙是否放行端口、地址是否正确。macOS 需在 **本地网络** 中允许 VRCX-0。                          |
| 密码错误            | VRCX-0 中的密码须与记录端密码一致。                                                                              |
| 账号不一致          | 用 VRCX-0 当前的账号重新登录记录端。                                                                             |
| 正式版/测试版不匹配 | 正式版 VRCX-0 使用 `latest`，测试版使用 `beta`。                                                                 |
| 查看日志            | 在安装目录执行 `docker compose logs`。Windows 上错误会列在记录端窗口中；用 `--headless` 运行时日志输出到控制台。 |

## 数据与安全

- 记录与 VRChat 登录信息保存在数据目录，用密码加密。
- 开启“在记录端保存密码”后，登录过期时记录端可自动重新登录；关闭后只保存登录令牌。
- 修改密码会丢弃未补回的记录、VRChat 登录和 Webhook。先在 VRCX-0 中补回一次，再修改 `password` 文件并执行 `docker compose up -d --force-recreate`，然后在 VRCX-0 中用新密码重新连接，并重新让记录端登录 VRChat。
- VRCX-0 拉取后，记录端上的记录即被删除。

## 卸载

在 VRCX-0 中点“断开连接”：会先补回，再让记录端退出 VRChat 登录并清除记录端设置。然后执行 `docker compose down` 并删除安装目录。

## 许可证

每个 Release 附带第三方许可证声明，镜像中位于 `/usr/share/licenses/vrcx-0-logger/`。如需自行构建镜像，把 Release 中的可执行文件放到 `crates/logger/dist/vrcx-0-logger-amd64` 和 `crates/logger/dist/vrcx-0-logger-arm64`，将 `LICENSE` 与 Release 中的 `THIRD_PARTY_NOTICES.txt` 复制到 `crates/logger/dist/`，然后执行 `docker build crates/logger`。
