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

VRChat 桌面輔助工具：查看好友上線狀態與所在位置、記錄遇過的人和去過的世界、管理收藏等。

VRCX-0 是 VRCX 的完全重寫版本，由 VRCX 前任維護者之一開發。以 Rust 重建，更快、更輕，多年累積的資料依然流暢。

## 主要特點

- **多年紀錄依然流暢** — VRCX 明顯變卡的資料量，VRCX-0 依然流暢；老電腦、NAS 級小主機也能執行
- **記憶體用量比 VRCX 低約 50%–70%**
- **背景模式僅需數十 MB 記憶體**，核心功能照常運作
- **比一個模型還小** — 下載 10 多 MB，安裝後 30 多 MB，不到 VRCX 的十分之一
- **無縫遷移** — 自動匯入 VRCX 資料庫與設定，不更動 VRCX 原有資料庫，隨時可以切換回去

### VRCX-0 獨有

- **AI 助手** — 洞察你的 VRChat 社交：常和誰一起玩、和誰漸行漸遠、何時最容易遇到好友；接入你常用的 AI 服務即可使用
- **活動** — 依時間軸回顧每次去過的世界、同房的人與當時的截圖；還能看到常遇見的路人
- **側欄模式** — 以窄側欄隨時留意好友動態；Windows、macOS 支援貼邊自動隱藏
- **桌面疊加介面** — 為桌面模式玩家準備的通知小視窗，取代系統通知；僅限 Windows
- **固定世界到側欄** — 隨時查看該世界的公開房間與好友所在房間，直接加入
- **快捷鍵** — 常用操作不必碰滑鼠；Windows 支援全域快捷鍵
- **鎖定** — 密碼鎖定介面，保護你的隱私
- **分享** — 世界收藏集、世界、角色、房間皆可產生分享連結
- **補錄遊戲紀錄** — 從 VRChat 本身的紀錄檔補回 VRCX-0 未執行期間的遊戲紀錄

### 進階

- **MCP 伺服器** — 讓外部 AI 工具直接使用你的本機社交資料
- **整合 API** — 為第三方應用程式提供遊戲內即時資料
- **自架記錄端（實驗性）** — 部署在你自己的伺服器上，VRCX-0 關閉期間持續記錄好友動態，下次開啟時自動補上
- **無介面模式（Headless）** — 無介面執行，詳見 `crates/headless`

### 與 VRCX 的差異

| 功能           | VRCX                                           | VRCX-0（+ 為新增）                                                |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| **社交自動化** | 依是否獨處切換狀態；自動回覆加入申請           | + 定時規則、多條情境規則與優先順序、結束後還原原本狀態            |
| **通知**       | 桌面、語音、XSOverlay、OVR Toolkit、腕部懸浮層 | + 桌面疊加介面、Discord Webhook、勿擾模式；所有通道依事件獨立篩選 |
| **VR 懸浮層**  | 瀏覽器算繪（100 MB+）；OpenVR                  | + 原生算繪（數十 MB）；OpenXR（**WiVRn 實測通過**）               |
| 螢幕截圖       | 檢視與搜尋中繼資料                             | + 格狀檢視、收藏、批次管理、匯出 ZIP                              |
| 角色資訊       | 效能等級、檔案大小                             | + 完整效能指標，對照各平台上限                                    |
| 備份           | VRChat 登錄檔設定                              | + 資料庫定期備份、一鍵還原                                        |
| 好友位置       | 依同一房間分組                                 | + 世界檢視                                                        |
| 群組管理       | 逐一設定可見性                                 | + 批次退出、批次設定可見性；玩家列表顯示群組身分組                |
| 主題           | 內建主題、自訂 CSS 檔案                        | + 社群主題、背景圖片、應用程式內 CSS 編輯、強調色                 |
| 多帳號         | 多帳號遊戲紀錄混在一起                         | 遊戲紀錄依帳號分開儲存；用另一個帳號玩 VRChat 時互不影響          |

VRCX 的其他功能，VRCX-0 同樣具備。

## 安裝

在 [最新 Release](https://github.com/Map1en/VRCX-0/releases/latest) 下載對應平台的檔案：

| 平台                | 檔案                                       |
| ------------------- | ------------------------------------------ |
| Windows             | `VRCX-0_<版本號>_windows_x86_64_setup.exe` |
| macOS（Apple 晶片） | `VRCX-0_<版本號>_macos_aarch64.dmg`        |
| macOS（Intel）      | `VRCX-0_<版本號>_macos_x86_64.dmg`         |
| Linux               | `.AppImage`、`.deb` 或 `.rpm`              |

macOS 首次啟動若被系統阻擋，請前往 **系統設定 → 隱私權與安全性**，點選 **強制打開**。

### Linux

軟體介面的硬體加速預設關閉，可在 **設定 → 系統 → 硬體加速（實驗性）** 中開啟；若介面顯示異常，VRCX-0 會自動關閉硬體加速。自行設定 `WEBKIT_DISABLE_DMABUF_RENDERER` 時不會顯示此選項。

## 回饋與交流

- 交流與提問：[Discord](https://discord.gg/fehKP3SVPN)
- 問題回報與功能建議：[GitHub Issues](https://github.com/Map1en/VRCX-0/issues)
- 開發 blog：[blog.vrcx-0.dev](https://blog.vrcx-0.dev/zh/)

## 從原始碼建置

以下步驟適用於參與開發，或在本機自行建置 VRCX-0。參與貢獻前，請先閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)。

依賴：Node.js ≥ 24.10、npm ≥ 11.5，以及透過 rustup 安裝的穩定版 Rust 工具鏈。
Windows 使用者還需安裝 **Visual Studio Build Tools**，並勾選 **“使用 C++ 的桌面開發”**。

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

## 授權條款

VRCX-0 採用 GNU General Public License v3.0（GPLv3）授權。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

VRCX-0 未獲 VRChat Inc. 認可或背書。VRChat 及所有相關標誌均為 VRChat Inc. 的商標或註冊商標。
