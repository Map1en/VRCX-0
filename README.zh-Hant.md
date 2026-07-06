<div align="center">

# <img src="images\VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

[English](README.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

[![Build](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/build.yml?branch=master&label=build&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/build.yml)
[![Unit Test](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/unit-test.yml?branch=master&label=tests&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/unit-test.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/unit-test.yml)
[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat)](https://github.com/Map1en/VRCX-0/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat)](LICENSE)
[![Discord](https://img.shields.io/discord/1494343220467994644?logo=discord&logoColor=white&label=discord&style=flat)](https://discord.gg/fehKP3SVPN)

### 更快、更輕的 VRCX。

</div>

VRCX-0 是 VRCX 的完全重寫版本，由 VRCX 前任維護者之一開發，底層改為原生 Rust 核心（Tauri + React）。重寫最直接的收益是效能：多年累積的歷史資料也能保持流暢，記憶體用量與安裝體積都大幅低於原版。

首次啟動會自動匯入你現有的 VRCX 資料與設定，原始資料不會被更動，隨時可以換回去。

隨著上游 VRCX 轉向以維護為主，VRCX-0 是新功能的主戰場。

## 主要特點

- **多年紀錄也不拖慢** — 讓 VRCX 明顯變卡的資料量，在 VRCX-0 中依然流暢；老電腦、NAS 等級的小主機上也能流暢運作
- **記憶體用量比 VRCX 低約 50%–70%** — **背景模式**開啟後可降至僅數十 MB，所有核心功能照常運作
- **比一個模型還小** — 安裝程式 10 多 MB，安裝後 30 多 MB，比 VRCX 小 10 倍以上
- **遷移零負擔** — 自動匯入 VRCX 的資料庫與設定，原始資料絕不會被修改

其他特性：

- **社交 AI** — 內建助手，幫你讀懂自己的 VRChat 社交：問問最常和誰一起玩、正在和誰漸行漸遠，或什麼時候上線最容易遇到好友。由你自己的 OpenAI 相容端點驅動，並支援本地 LLM
- **MCP 伺服器** — 透過僅在本機執行、附權杖保護的伺服器，將本地 VRCX-0 社交資料開放給相容 MCP 的 AI 用戶端（如 Claude 等），讓你在既有的工具裡直接使用
- **社交自動化** — 依時間、實例類型或在場人員自動切換狀態與簽名；自動接受邀請請求；規則失效後自動還原原有狀態
- **輕量 VR 腕部 Overlay**，效能影響極低；同時支援 OpenVR（SteamVR）和 **OpenXR（Linux / WiVRn / Monado）**
- **社群主題** — 瀏覽並安裝主題商城中的主題，設定自訂背景圖片，還可疊加自己的 CSS
- **四通道通知系統** — 桌面通知、TTS 語音、VR Overlay 推播、Webhook，每個通道可依事件類型獨立設定
- **Webhook 通知** — 將事件轉發到任意 Webhook URL，採用 Discord 相容格式；可精確選擇要傳送的欄位
- 全介面支援完整鍵盤導航
- 無介面模式（Headless），適合進階用途 — 詳見 `crates/headless`

## 資料遷移

首次啟動時，VRCX-0 可自動匯入現有 VRCX 的資料庫與設定，原始資料不會被修改。現有使用者無需手動設定，即可直接從原有資料繼續使用。

## 授權條款

本儲存庫的初始提交對應分叉時的上游 VRCX 快照，依 MIT License 發布。

fork 後新增、修改、重寫及新建的所有程式碼，均依 GNU General Public License v3.0（GPLv3）發布。

## 開發

依賴：Node.js ≥ 24.10、npm ≥ 11.5，以及透過 rustup 安裝的穩定版 Rust 工具鏈。
Windows 使用者還需安裝 **Visual Studio Build Tools**，並勾選 **「使用 C++ 的桌面開發」** 工作負載。

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
npm run tauri:dev
```
