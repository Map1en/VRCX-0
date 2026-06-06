# VRCX-0

[English](README.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

VRCX-0 是 VRCX 的重寫版本，以 **Tauri + React** 取代原有的 CefSharp + Vue 架構，由 VRCX 前任維護者之一開發。

VRCX-0 專注於玩家的日常使用：更低的資源佔用、更小的安裝體積，以及持續的功能開發與維護支援。

目前的 VRCX 專案已相當穩定，未來上游的變更可能主要集中於維護與修復，而非重大功能更新。VRCX-0 將持續進行功能開發與支援，並依照自身的開發路線圖推進。

## 主要特點

- 記憶體用量比 VRCX 低約 50%–70%
- 背景模式僅需數十 MB 即可維持核心服務運行
- Windows 與 macOS 安裝程式約 20 MB，應用程式體積大幅縮小
- 全新 UI 與互動模式
- 完整鍵盤導航支援
- 無介面（Headless）模式
- 持續的功能開發與維護支援

## 資料遷移

首次執行時，VRCX-0 可自動遷移您現有的 VRCX 資料庫與設定。

您原有的 VRCX 資料不會被修改。
現有使用者無需任何手動設定，即可直接以現有資料開始使用 VRCX-0。

## 授權條款

本儲存庫的初始提交對應分叉時的上游 VRCX 快照，依 MIT License 發布。

fork 後新增、修改、重寫及新建的所有程式碼，均依 GNU General Public License v3.0（GPLv3）發布。

## 開發

環境需求：

- Node.js LTS
- 建議透過 rustup 安裝最新穩定版 Rust 工具鏈

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
npm run tauri:dev
```
