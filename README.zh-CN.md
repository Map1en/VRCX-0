<div align="center">

# <img src="images\VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

[English](README.md) | 简体中文 | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

[![Build](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/build.yml?branch=master&label=build&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/build.yml)
[![Unit Test](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/unit-test.yml?branch=master&label=tests&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/unit-test.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/unit-test.yml)
[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat)](https://github.com/Map1en/VRCX-0/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat)](LICENSE)
[![Discord](https://img.shields.io/discord/1494343220467994644?logo=discord&logoColor=white&label=discord&style=flat)](https://discord.gg/fehKP3SVPN)

### 更快、更轻的 VRCX。

</div>

VRCX-0 是 VRCX 的完全重写版本，由 VRCX 前维护者之一开发，底层换成了原生 Rust 核心（Tauri + React）。重写最直接的收益是性能：多年积累的历史数据也能保持流畅，内存占用和安装体积都大幅低于原版。

首次启动会自动导入你现有的 VRCX 数据和设置，原始数据不会被改动，随时可以换回去。

随着上游 VRCX 转向以维护为主，VRCX-0 是新功能的主战场。

## 主要特点

- **多年记录也不拖慢** — 让 VRCX 明显变卡的数据量，在 VRCX-0 中依然流畅；土豆机、NAS 级别的小主机上也能流畅运行
- **内存占用比 VRCX 低约 50%–70%** — **后台模式**开启后可降至仅几十 MB，所有核心功能照常运行
- **比一个模型包还小** — 安装包 10 多 MB，装完 30 多 MB，比 VRCX 小 10 倍以上
- **迁移零负担** — 自动导入 VRCX 的数据库和设置，原始数据绝不被修改

其他特性：

- **AI 助手** — 内置助手，帮你读懂自己的 VRChat 社交：问问最常和谁一起玩、正在和谁渐行渐远，或什么时候上线最容易遇到好友。由你自己的 OpenAI 兼容端点驱动，并支持本地 LLM
- **MCP 服务器** — 通过仅在本地运行、带令牌保护的服务器，将本地 VRCX-0 社交数据开放给兼容 MCP 的 AI 客户端（如 Claude 等），让你在已有的工具里直接使用
- **社交自动化** — 按时间、实例类型或在场人员自动切换状态和签名；自动接受邀请请求；规则失效后自动恢复原有状态
- **轻量 VR 腕部 Overlay**，性能影响极低；同时支持 OpenVR（SteamVR）和 **OpenXR（Linux / WiVRn / Monado）**
- **社区主题** — 浏览并安装主题商城中的主题，设置自定义背景图片，还可叠加自己的 CSS
- **四通道通知系统** — 桌面通知、TTS 语音、VR Overlay 推送、Webhook，每个通道按事件类型独立配置
- **Webhook 通知** — 将事件转发到任意 Webhook URL，采用 Discord 兼容格式；可精确选择要发送的字段
- 全界面支持完整键盘导航
- 无头模式（Headless），适合进阶用途 — 详见 `crates/headless`

## 数据迁移

首次启动时，VRCX-0 可自动导入现有 VRCX 的数据库和配置，原始数据不会被修改。现有用户无需手动设置，可直接从原来的数据继续使用。

## 许可

本仓库的第一个提交对应 fork 时的上游 VRCX 项目快照，遵循 MIT License。

fork 之后新增、修改、重写的所有代码，均遵循 GNU General Public License v3.0（GPLv3）。

## 开发

依赖：Node.js ≥ 24.10、npm ≥ 11.5，以及通过 rustup 安装的稳定版 Rust 工具链。
Windows 用户还需安装 **Visual Studio Build Tools**，并勾选 **"使用 C++ 的桌面开发"** 工作负载。

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
npm run tauri:dev
```
