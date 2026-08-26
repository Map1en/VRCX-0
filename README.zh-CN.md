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

VRCX-0 是 VRCX 的完全重写版本，由 VRCX 前维护者之一开发，底层采用原生 Rust 核心（Tauri + React），性能大幅提升：多年积累的数据也不会卡，内存和安装体积都远小于原版。

首次启动会自动导入你现有的 VRCX 数据和设置，原始数据不会被改动，随时可以换回去。

原版 VRCX 已转向维护为主，VRCX-0 则持续开发新功能。

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
- **后台模式**下进一步降至仅几十 MB，所有核心功能照常运行
- **比一个模型包还小** — 安装包 10 多 MB，安装后 30 多 MB，比 VRCX 小 10 倍以上
- **迁移零负担** — 自动导入 VRCX 的数据库和设置，原始数据不会被改动

其他特性：

- **AI 助手** — 内置助手，帮你回顾自己的 VRChat 生活：最常和谁一起玩、正在和谁渐行渐远、什么时候上线最容易遇到好友，接入你自己的 AI 服务即可使用
- **MCP 服务器** — 让外部 AI 工具直接访问你的本地社交数据，比内置助手灵活得多；适合进阶用户
- **每个账号都有独立的本地历史** — 游戏日志等账号相关记录分开存储，多账号使用时不再混进同一条时间线
- **备份与恢复** — 一键压缩备份，支持定时自动备份和多版本保留，随时恢复
- **分享世界合集** — 把收藏的世界做成可分享的页面，对方可以浏览、打开或导入；也支持单独分享世界和模型链接
- **社交自动化** — 按时间、实例类型或在场人员自动切换状态和签名；自动接受邀请请求；规则失效后自动恢复原有状态
- **轻量 VR 腕部 Overlay** — 支持 OpenVR（SteamVR）和 **Linux OpenXR（WiVRn 实机测试通过）**
- **社区主题** — 浏览并安装主题商城中的主题，设置自定义背景图片，还可叠加自己的 CSS
- **通知系统** — 桌面通知、语音播报、VR 弹窗、Webhook 四个通道，按事件类型独立配置；Webhook 支持 Discord 格式
- 全界面支持完整键盘导航
- 面向第三方应用的集成 API — 目前提供房间数据，后续逐步扩展
- 无头模式（Headless），适合进阶用途 — 详见 `crates/headless`

## 许可

VRCX-0 采用 GNU General Public License v3.0（GPLv3）授权。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

## 从源码构建

以下步骤适用于参与开发或在本地自行构建 VRCX-0。参与贡献前，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

依赖：Node.js ≥ 24.10、npm ≥ 11.5，以及通过 rustup 安装的稳定版 Rust 工具链。
Windows 用户还需安装 **Visual Studio Build Tools**，并勾选 **"使用 C++ 的桌面开发"** 工作负载。

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
