<div align="center">

# <img src="images/VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

### 更快、更轻的 VRCX。

[English](README.md) | [Français](README.fr-FR.md) | 简体中文 | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat&color=4c566a&labelColor=1f2328&logo=github&logoColor=white)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat&color=4c566a&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/releases)
[![Windows installer size](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/windows-installer-size.json&style=flat&label=installer&color=4c566a&labelColor=1f2328&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTIuNCAyLjRoOC41djguNUgyLjR6TTEzLjEgMi40SDIxLjZ2OC41aC04LjV6TTIuNCAxMy4xaDguNVYyMS42SDIuNHpNMTMuMSAxMy4xSDIxLjZWMjEuNmgtOC41eiIvPjwvc3ZnPg%3D%3D)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Discord](https://img.shields.io/discord/1494343220467994644?style=flat&logo=discord&logoColor=white&label=discord&color=5865f2&labelColor=1f2328)](https://discord.gg/fehKP3SVPN)
<br>
[![CI](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=ci&style=flat&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat&color=4c566a&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-GPL--3.0-4c566a?style=flat&labelColor=1f2328)](LICENSE)

[![Download](https://img.shields.io/badge/Download%20VRCX--0-4340a2?style=for-the-badge)](https://github.com/Map1en/VRCX-0/releases/latest)

Windows · macOS · Linux

![VRCX-0](images/screenshot-user-dialog.webp)

</div>

VRChat 桌面辅助工具：查看好友在线状态和所在位置、记录遇到过的人和去过的世界、管理收藏等。

VRCX-0 是 VRCX 的完全重写版本，由 VRCX 前维护者之一开发。基于 Rust 重建，更快、更轻，多年积累的数据依然流畅。

## 主要特点

- **多年记录依然流畅** — VRCX 明显变卡的数据量，VRCX-0 依然流畅；低配电脑、NAS 级小主机也能运行
- **内存占用比 VRCX 低约 50%–70%**
- **后台模式仅需几十 MB 内存**，核心功能照常运行
- **比一个模型包还小** — 下载 10 多 MB，安装后 30 多 MB，不到 VRCX 的十分之一
- **无缝迁移** — 自动导入 VRCX 数据库和设置，不改动 VRCX 原有数据库，随时可以切换回去

### VRCX-0 独有

- **AI 助手** — 洞察你的 VRChat 社交：常和谁一起玩、和谁渐行渐远、何时最容易遇到好友；接入你常用的 AI 服务即可使用
- **活动** — 按时间线回看每次去过的世界、同房的人和当时的截图；还能看到常遇见的路人
- **侧栏模式** — 以窄侧栏随时关注好友动态；Windows、macOS 支持贴边自动隐藏
- **桌面叠加界面** — 为桌面模式玩家准备的通知小窗，替代系统通知；仅限 Windows
- **固定世界到侧边栏** — 随时查看该世界的公开房间和好友所在房间，直接加入
- **快捷键** — 常用操作无需鼠标；Windows 支持全局热键
- **锁定** — 密码锁定界面，保护你的隐私
- **分享** — 世界合集、世界、模型、房间均可生成分享链接
- **补录游戏日志** — 从 VRChat 自身的日志补回 VRCX-0 未运行期间的游戏日志

### 进阶

- **MCP 服务器** — 让外部 AI 工具直接使用你的本地社交数据
- **集成 API** — 为第三方应用提供游戏内实时数据
- **自建记录端（实验性）** — 部署在你自己的服务器上，VRCX-0 关闭期间继续记录好友动态，下次打开时自动补上
- **无头模式（Headless）** — 无界面运行，详见 `crates/headless`

### 与 VRCX 的对比

| 功能           | VRCX                                           | VRCX-0（+ 为新增）                                                |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| **社交自动化** | 按是否独处切换状态；自动回复加入请求           | + 定时规则、多条情境规则与优先级、结束后恢复原状态                |
| **通知**       | 桌面、语音、XSOverlay、OVR Toolkit、腕部悬浮层 | + 桌面叠加界面、Discord Webhook、勿扰模式；所有通道按事件独立筛选 |
| **VR 悬浮层**  | 浏览器渲染（100 MB+）；OpenVR                  | + 原生渲染（几十 MB）；OpenXR（**WiVRn 实测通过**）               |
| 截图           | 查看和搜索元数据                               | + 网格视图、收藏、批量管理、ZIP 导出                              |
| 模型详情       | 性能等级、文件大小                             | + 完整性能指标，对照各平台上限                                    |
| 备份           | VRChat 注册表设置                              | + 数据库定时备份、一键恢复                                        |
| 好友位置       | 按同一房间分组                                 | + 世界视图                                                        |
| 群组管理       | 逐个设置可见性                                 | + 批量退出、批量设置可见性；玩家列表显示群组身份组                |
| 主题           | 内置主题、自定义 CSS 文件                      | + 社区主题、背景图片、应用内 CSS 编辑、强调色                     |
| 多账号         | 多账号游戏日志混在一起                         | 游戏日志按账号分开存储；用另一个账号玩 VRChat 时互不影响          |

VRCX 的其他功能，VRCX-0 同样具备。

## 安装

在 [最新 Release](https://github.com/Map1en/VRCX-0/releases/latest) 里下载对应平台的文件：

| 平台                | 文件                                       |
| ------------------- | ------------------------------------------ |
| Windows             | `VRCX-0_<版本号>_windows_x86_64_setup.exe` |
| macOS（Apple 芯片） | `VRCX-0_<版本号>_macos_aarch64.dmg`        |
| macOS（Intel）      | `VRCX-0_<版本号>_macos_x86_64.dmg`         |
| Linux               | `.AppImage`、`.deb` 或 `.rpm`              |

macOS 首次启动如被系统拦截，请前往 **系统设置 → 隐私与安全性**，点击 **仍要打开**。

### Linux

软件界面的硬件加速默认关闭，可在 **设置 → 系统 → 硬件加速（实验性）** 中开启；若界面显示异常，VRCX-0 会自动关闭硬件加速。自行设置 `WEBKIT_DISABLE_DMABUF_RENDERER` 时不显示此选项。

## 反馈与交流

- 交流与提问：[Discord](https://discord.gg/fehKP3SVPN)
- 问题反馈与功能建议：[GitHub Issues](https://github.com/Map1en/VRCX-0/issues)
- 开发 blog：[blog.vrcx-0.dev](https://blog.vrcx-0.dev/zh/)

## 从源码构建

以下步骤适用于参与开发或在本地自行构建 VRCX-0。参与贡献前，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

依赖：Node.js ≥ 24.10、npm ≥ 11.5，以及通过 rustup 安装的稳定版 Rust 工具链。
Windows 用户还需安装 **Visual Studio Build Tools**，并勾选 **"使用 C++ 的桌面开发"**。

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
```

启动开发服务器：

```bash
npm run tauri:dev
```

构建发布版（跳过签名和安装包）：

```bash
npm run tauri:build -- --no-sign --no-bundle
```

## 许可

VRCX-0 采用 GNU General Public License v3.0（GPLv3）授权。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

VRCX-0 未获 VRChat Inc. 认可或背书。VRChat 及所有相关标识均为 VRChat Inc. 的商标或注册商标。
