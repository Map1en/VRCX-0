# VRCX-0 自架記錄端（實驗性）

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

自架記錄端執行在常開的機器上，在 VRCX-0 關閉期間記錄好友動態。VRCX-0 啟動後，這段時間的紀錄會補回本機好友動態。

> [!WARNING]
> 實驗性功能。記錄端會用你的帳號從另一個 IP 登入 VRChat。受 VRChat 政策與安全檢測影響，可能出現斷線、反覆驗證，嚴重時帳號受限或停權，風險自負。登入資訊只會傳送到你自己的記錄端。

## 範圍

- 補回：好友上線、離線、位置、狀態、角色變更。在 VRCX-0 中開啟“自動更新好友自我介紹”後，也補回自我介紹變更。
- 一個記錄端對應一個 VRChat 帳號。
- 不補回：
    - VRCX-0 當機、被強制結束、睡眠或斷線後的約 30 秒；
    - 一段紀錄結束時尚未確認的離線；
    - 記錄端自身與 VRChat 中斷期間的變化。

## 執行需求

- 一台常開的機器：Linux（x86_64 或 ARM64），如 NAS、VPS、樹莓派；或 Windows 電腦（x86_64）。
- Docker 與 Docker Compose v2（`docker compose` 指令）。也提供獨立執行檔。
- VRCX-0 能透過網路連到這台機器。

## 安裝

### 安裝腳本

```sh
curl -fsSL https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/install.sh | sh
```

腳本依序詢問安裝目錄、發布通道、連接埠、監聽位址、保留天數、容量上限與密碼，直接按 Enter 使用方括號中的預設值，接著啟動容器，並顯示需要在 VRCX-0 中填寫的位址與密碼。設定儲存在安裝目錄的 `.env`，密碼儲存在 `password`。

- 更新：重新執行腳本。只詢問發布通道（預設為目前通道），`.env`、`password` 與 `compose.yaml` 保持不變。修改其他設定時，編輯 `.env` 後在安裝目錄執行 `docker compose up -d`。
- 停止：加上 `-s down`（`... | sh -s down`）。
- 目前使用者無權使用 Docker 時，改用 `sudo sh`。

### Docker Compose

```sh
mkdir vrcx-0-logger && cd vrcx-0-logger
curl -fsSLO https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/compose.yaml
printf '%s' '你的密碼' > password
docker compose up -d
```

NAS 圖形介面（Synology Container Manager、Unraid 等）：映像填 `ghcr.io/map1en/vrcx-0-logger:latest`，對應連接埠 `8787` 與一個目錄到 `/data`，設定環境變數 `VRCX0_LOGGER_PASSWORD`。Unraid 請把 `/data` 對應到快取碟或單一硬碟路徑（如 `/mnt/cache/appdata/vrcx-0-logger`），`/mnt/user` 共用路徑可能損壞 SQLite 資料庫。若把密碼直接寫進 Compose 檔案的 `environment:`，其中的 `$` 須寫成 `$$`。

### 發布通道

| 標籤     | 適用                         |
| -------- | ---------------------------- |
| `latest` | 正式版 VRCX-0                |
| `beta`   | 測試版 VRCX-0                |
| `x.y.z`  | 固定版本，如 `2.32.0-beta.1` |

正式版 VRCX-0 只能連接正式版記錄端。

### 獨立執行檔

從 [Releases](https://github.com/Map1en/VRCX-0/releases) 下載 `vrcx-0-logger_<版本>_linux_<架構>`，設定密碼環境變數後執行。需要常駐時，可交給 systemd 等服務管理器。

### Windows

從 [Releases](https://github.com/Map1en/VRCX-0/releases) 下載 `vrcx-0-logger_<版本>_windows_x86_64.exe` 並執行。視窗中會顯示要填入 VRCX-0 的位址和自動產生的密碼，以及監聽位址、連接埠、資料夾、保留天數和儲存上限。設定儲存在 `%LOCALAPPDATA%\VRCX-0 Logger\logger.env`，記錄預設存放在同目錄的 `data` 資料夾。視窗開著時記錄端就在執行，VRChat 連不上等連線問題會列在狀態下方。

不需要視窗時（例如交給工作排程器啟動），以 `--headless` 參數執行，並依「設定項目」設定環境變數。

### 設定項目

使用安裝腳本或 Docker Compose 時，編輯安裝目錄中的 `.env`，然後執行 `docker compose up -d`。密碼在 `password` 檔案中。

| `.env` 鍵                     | 預設值    | 說明                                                 |
| ----------------------------- | --------- | ---------------------------------------------------- |
| `VRCX0_LOGGER_TAG`            | `latest`  | 發布通道。                                           |
| `VRCX0_LOGGER_PORT`           | `8787`    | 主機連接埠。                                         |
| `VRCX0_LOGGER_BIND`           | `0.0.0.0` | 主機監聽位址。                                       |
| `VRCX0_LOGGER_RETENTION_DAYS` | 不限      | 刪除早於該天數的紀錄。                               |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`    | 超過該容量（MB）時從最舊的紀錄開始刪除；`0` 為不限。 |

獨立執行檔讀取以下環境變數；在 NAS 圖形介面中，把它們設定在容器上：

| 變數                          | 預設值                        | 說明                                                 |
| ----------------------------- | ----------------------------- | ---------------------------------------------------- |
| `VRCX0_LOGGER_PASSWORD`       | 必填                          | 至少 8 個字元，用於加密通訊與資料。                  |
| `VRCX0_LOGGER_PASSWORD_FILE`  |                               | 改為從檔案讀取密碼。                                 |
| `VRCX0_LOGGER_HOST`           | `0.0.0.0`                     | 監聽位址。                                           |
| `VRCX0_LOGGER_PORT`           | `8787`                        | 監聽連接埠。                                         |
| `VRCX0_LOGGER_DATA_DIR`       | `data`（Docker 中為 `/data`） | 資料目錄。                                           |
| `VRCX0_LOGGER_RETENTION_DAYS` | 不限                          | 刪除早於該天數的紀錄。                               |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`                        | 超過該容量（MB）時從最舊的紀錄開始刪除；`0` 為不限。 |

在容器中不要設定 `VRCX0_LOGGER_HOST`、`VRCX0_LOGGER_PORT` 與 `VRCX0_LOGGER_DATA_DIR`，需要換連接埠時改連接埠對應。

## 在 VRCX-0 中連線

**工具 → 自架記錄端**：

1. 開啟自動備份。
2. 填寫記錄端位址，如 `http://192.168.1.10:8787`。
3. 填寫記錄端密碼。
4. 讓記錄端登入 VRChat，需要時完成兩步驟驗證。

VRCX-0 與記錄端之間的通訊以密碼加密。不要把連接埠暴露到網際網路；需要遠端存取時使用 Tailscale 等 VPN。在 VPS 上，把監聽位址（`.env` 中的 `VRCX0_LOGGER_BIND`）設為 VPN 位址，或只透過防火牆放行該連接埠。

## 使用

- **狀態列**：代理圖示旁的圖示顯示記錄端狀態。橘色：登入中、重新連線中、帳號不一致或回應異常。紅色：無法連線、密碼錯誤、版本不相容，或 VRChat 需要登入、需要兩步驟驗證碼。
- **補回**：VRCX-0 連上後自動進行，也可以點“立即補回”。正常關閉 VRCX-0 會立即交給記錄端。
- **Webhook**：支援 Discord 或任何接收 POST 的網址。在登入停止、需要兩步驟驗證、無法儲存紀錄、未補回的紀錄因容量上限被刪除，以及恢復記錄時傳送。每則訊息開頭標明類型（`login`、`storage`、`recovered`、`test`），出錯時附上原始錯誤訊息。
- **健康檢查**：`GET /health` 在記錄端能讀取資料庫時回傳 200。映像中沒有 shell，請從容器外部監控。

## 升級

重新執行安裝腳本，或執行 `docker compose pull && docker compose up -d`。版本不需要完全一致：VRCX-0 提示記錄端需要更新時再更新即可。在此之前 VRCX-0 會暫停補回，紀錄不會遺失。

## 常見問題

| 問題              | 檢查                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| 無法連線到記錄端  | 容器是否執行、防火牆是否放行連接埠、位址是否正確。macOS 需在 **區域網路** 中允許 VRCX-0。                        |
| 密碼錯誤          | VRCX-0 中的密碼須與記錄端密碼一致。                                                                              |
| 帳號不一致        | 用 VRCX-0 目前的帳號重新登入記錄端。                                                                             |
| 正式版/測試版不符 | 正式版 VRCX-0 使用 `latest`，測試版使用 `beta`。                                                                 |
| 查看日誌          | 在安裝目錄執行 `docker compose logs`。Windows 上錯誤會列在記錄端視窗中；以 `--headless` 執行時日誌輸出到主控台。 |

## 資料與安全

- 紀錄與 VRChat 登入資訊儲存在資料目錄，以密碼加密。
- 開啟“在記錄端儲存密碼”後，登入過期時記錄端可自動重新登入；關閉後只保留登入權杖。
- 修改密碼會捨棄未補回的紀錄、VRChat 登入與 Webhook。先在 VRCX-0 中補回一次，再修改 `password` 檔案並執行 `docker compose up -d --force-recreate`，然後在 VRCX-0 中用新密碼重新連線，並重新讓記錄端登入 VRChat。
- VRCX-0 取得後，記錄端上的紀錄即被刪除。

## 解除安裝

在 VRCX-0 中點“中斷連線”：會先補回，再讓記錄端登出 VRChat 並清除記錄端設定。接著執行 `docker compose down` 並刪除安裝目錄。

## 授權

每個 Release 附帶第三方授權聲明，映像中位於 `/usr/share/licenses/vrcx-0-logger/`。如需自行建置映像，把 Release 中的執行檔放到 `crates/logger/dist/vrcx-0-logger-amd64` 與 `crates/logger/dist/vrcx-0-logger-arm64`，將 `LICENSE` 與 Release 中的 `THIRD_PARTY_NOTICES.txt` 複製到 `crates/logger/dist/`，然後執行 `docker build crates/logger`。
