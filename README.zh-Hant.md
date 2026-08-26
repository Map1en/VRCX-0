<div align="center">

# <img src="images/VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

### 更快、更輕的 VRCX。

[English](README.md) | [Français](README.fr-FR.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

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

VRCX-0 是 VRCX 的完全重寫版本，由 VRCX 前任維護者之一開發，底層採用原生 Rust 核心（Tauri + React），效能大幅提升：多年累積的歷史資料也不會卡，記憶體和安裝體積都遠小於原版。

首次啟動會自動匯入你現有的 VRCX 資料與設定，原始資料不會被更動，隨時可以換回去。

原版 VRCX 已轉向維護為主，VRCX-0 則持續開發新功能。

## 安裝

在 [最新 Release](https://github.com/Map1en/VRCX-0/releases/latest) 下載對應平台的檔案：

| 平台                | 檔案                                       |
| ------------------- | ------------------------------------------ |
| Windows             | `VRCX-0_<版本號>_windows_x86_64_setup.exe` |
| macOS（Apple 晶片） | `VRCX-0_<版本號>_macos_aarch64.dmg`        |
| macOS（Intel）      | `VRCX-0_<版本號>_macos_x86_64.dmg`         |
| Linux               | `.AppImage`、`.deb` 或 `.rpm`              |

只需下載這一次 — 之後 VRCX-0 會自動更新。

## 主要特點

- **多年紀錄也不拖慢** — 在 VRCX 裡明顯變卡的資料量，放到 VRCX-0 依然流暢；老電腦、家用 NAS 也跑得動
- **日常使用記憶體比 VRCX 低約 50%–70%**
- **背景模式**下進一步降至僅數十 MB，所有核心功能照常運作
- **比一個模型還小** — 安裝程式 10 多 MB，安裝後 30 多 MB，比 VRCX 小 10 倍以上
- **遷移零負擔** — 自動匯入 VRCX 的資料庫與設定，原始資料不會被更動

其他特性：

- **AI 助手** — 內建助手，幫你回顧自己的 VRChat 生活：最常和誰一起玩、正在和誰漸行漸遠、什麼時候上線最容易遇到好友，接入你自己的 AI 服務即可使用
- **MCP 伺服器** — 讓外部 AI 工具直接存取你的本機社交資料，比內建助手靈活得多；適合進階使用者
- **每個帳號都有獨立的本機記錄** — 遊戲記錄等帳號相關資料分開儲存，使用多個帳號時不再混在同一條時間軸
- **備份與還原** — 一鍵壓縮備份，支援定期自動備份和多版本保留，隨時還原
- **分享世界收藏集** — 把收藏的世界做成可分享的頁面，對方可以瀏覽、開啟或匯入；也支援單獨分享世界和角色連結
- **社交自動化** — 依時間、實例類型或在場人員自動切換狀態與簽名；自動接受邀請請求；規則失效後自動還原原有狀態
- **輕量 VR 腕部 Overlay** — 支援 OpenVR（SteamVR）和 **Linux OpenXR（WiVRn 實測通過）**
- **社群主題** — 瀏覽並安裝主題商城中的主題，設定自訂背景圖片，還可疊加自己的 CSS
- **通知系統** — 桌面通知、語音播報、VR 彈窗、Webhook 四個通道，按事件類型獨立設定；Webhook 支援 Discord 格式
- 全介面支援完整鍵盤導航
- 面向第三方應用的整合 API — 目前提供房間資料，後續逐步擴充
- 無介面模式（Headless），適合進階用途 — 詳見 `crates/headless`

## 授權條款

VRCX-0 採用 GNU General Public License v3.0（GPLv3）授權。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

## 從原始碼建置

以下步驟適用於參與開發，或在本機自行建置 VRCX-0。參與貢獻前，請先閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)。

依賴：Node.js ≥ 24.10、npm ≥ 11.5，以及透過 rustup 安裝的穩定版 Rust 工具鏈。
Windows 使用者還需安裝 **Visual Studio Build Tools**，並勾選 **「使用 C++ 的桌面開發」** 工作負載。

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
```

啟動開發伺服器：

```bash
npm run tauri:dev
```

建置發佈版（略過簽署和安裝程式）：

```bash
npm run tauri:build -- --no-sign --no-bundle
```
