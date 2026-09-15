<div align="center">

# <img src="images/VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

### もっと速く、もっと軽い VRCX。

[English](README.md) | [Français](README.fr-FR.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | 日本語 | [한국어](README.ko-KR.md)

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

VRCX-0 は、以前 VRCX のメンテナーを務めていたメンバーの一人が一から書き直したバージョンです。バックエンドに Rust を採用（Tauri + React）し、パフォーマンスが大きく向上しています。何年分の記録が積み重なっても動作は軽いまま、メモリ使用量もインストールサイズも VRCX を大きく下回ります。

初回起動時に、既存の VRCX のデータと設定を自動で引き継ぎます。元のデータには一切手を加えないため、いつでも元の環境に戻れます。

VRCX は成熟した安定版です。VRCX-0 では引き続き新機能を開発しています。

## インストール

[最新リリース](https://github.com/Map1en/VRCX-0/releases/latest) から、お使いのプラットフォーム向けのファイルをダウンロードしてください。

| プラットフォーム        | ファイル                                       |
| ----------------------- | ---------------------------------------------- |
| Windows                 | `VRCX-0_<バージョン>_windows_x86_64_setup.exe` |
| macOS（Apple シリコン） | `VRCX-0_<バージョン>_macos_aarch64.dmg`        |
| macOS（Intel）          | `VRCX-0_<バージョン>_macos_x86_64.dmg`         |
| Linux                   | `.AppImage`、`.deb`、`.rpm`                    |

ダウンロードは最初の一度だけ。以降は VRCX-0 が自動で更新します。

## 主な特徴

- **何年遊んでも重くならない** — VRCX では目に見えて重くなるデータ量でも、VRCX-0 なら軽快に動作。低スペック PC や NAS クラスの小型 PC でも問題なく動きます
- **通常使用時のメモリは VRCX の約 50%〜70% 減**
- **バックグラウンドモード**ならメモリをさらに数十 MB まで抑えつつ、すべての機能がそのまま動き続けます
- **アバター 1 体分より小さい** — インストーラーは 10 MB 台、インストール後も 30 MB 台。VRCX の 10 分の 1 以下のサイズです
- **乗り換えの手間はほぼゼロ** — VRCX のデータベースと設定を自動でインポート。元のデータは一切変更されません

### VRCX-0 だけの機能

- **AI アシスタント** — VRChat 生活をふり返る相棒。よく一緒に遊ぶ相手、疎遠になりつつある相手、フレンドをつかまえやすい時間帯などを質問でき、自分の AI サービスをつなぐだけで使えます
- **サイドバーモード** — 別の作業をしながら、細いサイドバーでフレンドの動きをチェック。大きなウインドウを行き来する必要はありません。Windows・macOS では画面の端にドッキングして自動で隠せます
- **ショートカットとグローバルショートカット** — ページ切り替え・設定・タブ移動をマウスなしで操作。Windows ではグローバルショートカットで、他のアプリを使いながら VRCX-0 を呼び出したり隠したりできます
- **ワールドコレクションの共有** — お気に入りのワールドを共有ページにまとめ、相手は見る・開く・インポートができます。ワールドやアバター単体の共有リンクも作成できます
- **MCP サーバー** — 外部の AI ツールからローカルのソーシャルデータに直接アクセス可能。AI アシスタントよりはるかに柔軟で、上級者におすすめです
- **アプリ連携 API** — 外部アプリ向けに、ゲーム中のルームデータをリアルタイムで提供。順次拡大予定
- **ヘッドレスモード** — 上級者向け。`crates/headless` を参照

### VRCX との違い

| 機能                           | VRCX                                                                                                                                                      | VRCX-0（+ は追加分）                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ソーシャルオートメーション** | 一人のとき・誰かと一緒のときにステータスとステータスメッセージを切り替え（インスタンスの種類で限定可）；招待リクエストに自動返信                          | + 時間ルール（時間帯・曜日）、複数の状況ルール（一緒にいるフレンド・人数・インスタンスの種類・お気に入りワールド、**優先度を設定可**）、**終了時に元のステータスへ復元** |
| **通知**                       | デスクトップ・読み上げ（TTS）・XSOverlay・OVR Toolkit・手首オーバーレイ（チャンネルごとに対応イベントが異なり、イベントで絞り込めるのはオーバーレイのみ） | + **Discord 互換の Webhook**、通知の一時停止；全チャンネルで対応イベントが共通、それぞれ個別にイベントで絞り込み可能                                                     |
| **VR オーバーレイ**            | 手首とヘッドセット、ブラウザ描画（メモリ 100 MB 以上）；OpenVR                                                                                            | + OpenXR（**WiVRn で実機確認済み**）；ネイティブ描画（メモリ数十 MB）                                                                                                    |
| スクリーンショット             | メタデータの表示と検索                                                                                                                                    | + グリッド表示、複数選択、一括削除、ZIP 書き出し                                                                                                                         |
| アバター詳細                   | パフォーマンスランクとファイルサイズ                                                                                                                      | + 三角ポリゴン数・テクスチャメモリー・マテリアル・ボーン・PhysBone・パーティクル・コライダー（プラットフォームごとの上限と比較）                                         |
| バックアップ                   | VRChat のレジストリ設定                                                                                                                                   | + データベースの定期バックアップ、複数世代の保持、ワンクリック復元                                                                                                       |
| グループ管理                   | プロフィール内で並べ替え、公開設定は 1 件ずつ                                                                                                             | + 「参加中のグループ」ページ（一括退出、一括で公開設定）                                                                                                                 |
| テーマ                         | 内蔵テーマ、カスタム CSS（ファイルを手動で配置）                                                                                                          | + コミュニティテーマのカタログ、背景画像、アプリ内 CSS エディター、アクセントカラー                                                                                      |
| ゲームログ                     | 全アカウントのログが混在                                                                                                                                  | アカウントごとに分けて保存                                                                                                                                               |

VRCX のそのほかの機能も、VRCX-0 にそのまま揃っています。

## ライセンス

VRCX-0 は GNU General Public License v3.0（GPLv3）の下で公開されています。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

## ソースからビルド

以下の手順は、VRCX-0 の開発に参加する場合や、ローカルでビルドする場合に使用します。コントリビュートする前に [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

必要なもの：Node.js ≥ 24.10、npm ≥ 11.5、rustup 経由でインストールした安定版 Rust ツールチェーン。
Windows の場合は、**Visual Studio Build Tools** をインストールし、**「C++ によるデスクトップ開発」** を選択してください。

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
```

開発サーバーを起動：

```bash
npm run tauri:dev
```

リリースビルド（署名とインストーラー生成をスキップ）：

```bash
npm run tauri:build -- --no-sign --no-bundle
```
