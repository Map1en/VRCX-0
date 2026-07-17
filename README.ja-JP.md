<div align="center">

# <img src="images\VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | 日本語 | [한국어](README.ko-KR.md)

[![Build](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=build&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Unit Test](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=tests&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat)](https://github.com/Map1en/VRCX-0/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat)](LICENSE)
[![Discord](https://img.shields.io/discord/1494343220467994644?logo=discord&logoColor=white&label=discord&style=flat)](https://discord.gg/fehKP3SVPN)

### もっと速く、もっと軽い VRCX。

</div>

VRCX-0 は、以前 VRCX のメンテナーを務めていたメンバーの一人が、VRCX を一から書き直したバージョンです。土台はネイティブな Rust コア（Tauri + React）に一新されており、その効果を最も実感できるのはパフォーマンスです。何年分の記録が積み重なっても、動作は軽いまま。メモリ使用量もインストールサイズも、VRCX を大きく下回ります。

初回起動時に、既存の VRCX のデータと設定を自動で引き継ぎます。元のデータには一切手を加えないため、いつでも元の環境に戻れます。

上流の VRCX がメンテナンス中心に移行していく中で、新機能の開発は VRCX-0 で進めていきます。

## 主な特徴

- **何年遊んでも重くならない** — VRCX では目に見えて重くなるデータ量でも、VRCX-0 なら軽快に動作。低スペック PC や NAS クラスの小型 PC でも問題なく動きます
- **メモリ使用量は VRCX 比で約 50%〜70% 減** — **バックグラウンドモード**をオンにすると数十 MB まで下がり、すべてのコア機能はそのまま動き続けます
- **アバター 1 体分より小さい** — インストーラーは 10 MB 台、インストール後も 30 MB 台。VRCX の 10 分の 1 以下のサイズです
- **乗り換えの手間はほぼゼロ** — VRCX のデータベースと設定を自動でインポート。元のデータは一切変更されません

このほかにも：

- **ソーシャル AI** — VRChat での交友をつかむための内蔵アシスタント。最もよく一緒に遊んでいる相手、疎遠になりつつある相手、フレンドをつかまえやすい時間帯などを質問できます。自分の OpenAI 互換エンドポイントで動作し、ローカル LLM にも対応
- **MCP サーバー** — 自分の PC 内だけで動作し、トークンで保護されたサーバーを通じて、ローカルの VRCX-0 ソーシャルデータを MCP 対応の AI クライアント（Claude など）に公開。使い慣れたツールからそのまま扱えます
- **ソーシャルオートメーション** — 時間帯・インスタンスの種類・一緒にいる相手に応じてステータスや自己紹介を自動変更；招待リクエストの自動承認；ルール終了後に元の状態へ自動復元
- **軽量な VR 手首 Overlay**、パフォーマンスへの影響は最小限；OpenVR（SteamVR）と **OpenXR（Linux / WiVRn / Monado）** の両方に対応
- **コミュニティテーマ** — カタログからテーマを閲覧してインストール、カスタム背景画像の設定、さらに独自の CSS を重ねがけ可能
- **4 チャンネル通知配信** — デスクトップ通知・テキスト読み上げ（TTS）・VR Overlay 通知・Webhook を、イベントの種類ごとにそれぞれ独立して設定
- **Webhook 通知** — 任意の Webhook URL にイベントを転送。Discord 互換のペイロードに対応し、送信するフィールドを細かく選べます
- アプリ全体で完全なキーボードナビゲーションに対応
- 上級者向けのヘッドレスモードも搭載 — `crates/headless` を参照

## データ移行

初回起動時に、既存の VRCX データベースと設定を自動でインポートできます。元のデータは変更されません。既存ユーザーは手動設定なしで、これまでのデータをそのまま引き継いで使い始めることができます。

## ライセンス

このリポジトリの初回コミットは、フォーク時点の上流 VRCX スナップショットに対応しており、MIT License に従います。

フォーク後に追加・変更・書き直されたすべてのコードは、GNU General Public License v3.0（GPLv3）に従います。

## 開発

必要なもの：Node.js ≥ 24.10、npm ≥ 11.5、rustup 経由でインストールした安定版 Rust ツールチェーン。
Windows の場合は、**Visual Studio Build Tools** をインストールし、**「C++ によるデスクトップ開発」** ワークロードを選択してください。

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
npm run tauri:dev
```
