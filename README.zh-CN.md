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

VRCX-0 是 VRCX 的完全重写版本，由 VRCX 前维护者之一开发，后端为 Rust（Tauri + React），性能大幅提升：多年积累的数据也不会卡，内存和安装体积都远小于原版。

首次启动会自动导入你现有的 VRCX 数据和设置，原始数据不会被改动，随时可以换回去。

VRCX 已是成熟稳定的版本，VRCX-0 则持续开发新功能。

## 安装

在 [最新 Release](https://github.com/Map1en/VRCX-0/releases/latest) 里下载对应平台的文件：

| 平台                | 文件                                       |
| ------------------- | ------------------------------------------ |
| Windows             | `VRCX-0_<版本号>_windows_x86_64_setup.exe` |
| macOS（Apple 芯片） | `VRCX-0_<版本号>_macos_aarch64.dmg`        |
| macOS（Intel）      | `VRCX-0_<版本号>_macos_x86_64.dmg`         |
| Linux               | `.AppImage`、`.deb` 或 `.rpm`              |

只需下载这一次 — 之后 VRCX-0 会自动更新。

## 主要特点

- **多年记录也不拖慢** — 在 VRCX 里明显变卡的数据量，放到 VRCX-0 依然流畅；土豆机、家用 NAS 也跑得动
- **日常使用内存比 VRCX 低约 50%–70%**
- **后台模式**下内存进一步降至仅几十 MB，所有核心功能照常运行
- **比一个模型包还小** — 安装包 10 多 MB，安装后 30 多 MB，比 VRCX 小 10 倍以上
- **迁移零负担** — 自动导入 VRCX 的数据库和设置，原始数据不会被改动

### VRCX-0 独有

- **AI 助手** — 帮你回顾自己的 VRChat 生活：最常和谁一起玩、正在和谁渐行渐远、什么时候上线最容易遇到好友，接入你自己的 AI 服务即可使用
- **侧栏模式** — 做别的事时用一条窄侧栏关注好友动态，不必开着大窗口来回切换；Windows 和 macOS 支持停靠到屏幕边缘并自动隐藏
- **快捷键与全局热键** — 切换页面、打开设置、切换分页都不用碰鼠标；Windows 支持全局热键，在其他应用中随时显示或隐藏 VRCX-0
- **分享世界合集** — 把收藏的世界做成可分享的页面，对方可以浏览、打开或导入；也支持单独分享世界和模型链接
- **MCP 服务器** — 让外部 AI 工具直接访问你的本地社交数据，比 AI 助手灵活得多；适合进阶用户
- **集成 API** — 面向第三方应用，提供游戏时房间实时数据，后续逐步扩展
- **无头模式（Headless）** — 适合进阶用途，详见 `crates/headless`

### 与 VRCX 的对比

| 功能           | VRCX                                                                                               | VRCX-0（+ 为新增）                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **社交自动化** | 独处或有人在场时切换状态和签名（可限定实例类型）；自动回复邀请请求                                 | + 定时规则（时间段、星期）、多条情境规则（在场好友、人数、实例类型、收藏世界，**可设优先级**）、**规则结束时恢复原状态** |
| **通知**       | 桌面、语音播报、XSOverlay、OVR Toolkit、腕部悬浮层（各通道支持的事件不同，只有悬浮层可按事件筛选） | + **Discord 格式 Webhook**、勿扰模式；所有通道支持相同事件，各自独立配置                                                 |
| **VR 悬浮层**  | 腕部和头显，浏览器渲染（内存占用 100 MB+）；OpenVR                                                 | + OpenXR（**WiVRn 实机测试通过**）；原生渲染（内存占用几十 MB）                                                          |
| 截图           | 查看和搜索元数据                                                                                   | + 网格视图、多选、批量删除、ZIP 导出                                                                                     |
| 模型详情       | 性能等级和文件大小                                                                                 | + 三角面、纹理内存、材质、骨骼、PhysBone、粒子、碰撞体（对照各平台上限）                                                 |
| 备份           | VRChat 注册表设置                                                                                  | + 数据库定时备份、多版本、一键恢复                                                                                       |
| 群组管理       | 个人资料内调整顺序，逐个设置可见性                                                                 | + "我的群组"页面（批量退出、批量设置可见性）                                                                             |
| 主题           | 内置主题、自定义 CSS（需手动放置文件）                                                             | + 社区主题目录、背景图片、应用内 CSS 编辑器、强调色                                                                      |
| 游戏日志       | 多账号记录混在一起                                                                                 | 按账号分开存储                                                                                                           |

VRCX 的其他功能，VRCX-0 同样具备。

## 许可

VRCX-0 采用 GNU General Public License v3.0（GPLv3）授权。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

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
