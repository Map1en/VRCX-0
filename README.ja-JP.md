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

VRChat のためのデスクトップツール。フレンドのオンライン状況や居場所の確認、出会った人や訪れたワールドの記録、お気に入りの整理など。

VRCX-0 は、元 VRCX メンテナーの一人がゼロから書き直した VRCX です。Rust で再構築し、より速く、より軽く。何年分の記録があっても快適なままです。

## 主な特徴

- **何年分の記録でも快適** — VRCX が重くなるデータ量でも、VRCX-0 なら軽快。低スペック PC や NAS クラスの小型 PC でも動作
- **メモリ使用量は VRCX の約 50%〜70% 減**
- **バックグラウンドモードならメモリ数十 MB**、主要機能はそのまま動作
- **アバター 1 体分より小さい** — ダウンロード 10 MB 台、インストール後 30 MB 台。VRCX の 10 分の 1 以下
- **スムーズな乗り換え** — VRCX のデータベースと設定を自動インポート。VRCX 側のデータベースには手を加えないので、いつでも戻せます

### VRCX-0 だけの機能

- **AI アシスタント** — VRChat での交流をひも解く。よく遊ぶ相手、疎遠になりつつある相手、フレンドに会いやすい時間帯まで。普段使いの AI サービスをつなぐだけ
- **アクティビティ** — 訪れたワールド、一緒にいた人、そのときのスクリーンショットをタイムラインで振り返り。よく見かける人もひと目で
- **サイドバーモード** — 細いサイドバーでフレンドの動きをいつでもチェック。Windows・macOS では画面端で自動的に隠せます
- **デスクトップのオーバーレイ** — デスクトップモードのプレイヤー向けに、最近の通知を小さなウィンドウで表示。システム通知の代わりに。Windows のみ
- **ワールドをサイドバーに固定** — そのワールドの公開インスタンスやフレンドの居場所をいつでも確認し、そのまま参加
- **ショートカット** — よく使う操作はマウスなしで。Windows ではグローバルショートカットにも対応
- **ロック** — パスコードで画面をロックし、プライバシーを保護
- **共有** — ワールドコレクション・ワールド・アバター・インスタンスの共有リンクを作成
- **ゲームログの補完** — VRCX-0 を起動していなかった間のゲームログを、VRChat 自身のログから取り戻せます

### 上級者向け

- **MCP サーバー** — 外部の AI ツールからローカルのソーシャルデータを直接活用
- **アプリ連携 API** — 外部アプリにゲーム中のデータをリアルタイムで提供
- **セルフホストレコーダー（試験的）** — 自分のサーバーで動かしておけば、VRCX-0 を閉じている間もフィードを記録。次に開いたとき自動で反映
- **ヘッドレスモード** — UI なしで動作。`crates/headless` を参照

### VRCX との違い

| 機能                           | VRCX                                                             | VRCX-0（+ は追加分）                                                                                     |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **ソーシャルオートメーション** | 一人かどうかでステータスを切り替え；招待リクエストに自動返信     | + 時間ルール、優先度付きの複数状況ルール、終了時に元のステータスへ復元                                   |
| **通知**                       | デスクトップ・読み上げ・XSOverlay・OVR Toolkit・手首オーバーレイ | + デスクトップのオーバーレイ、Discord 互換 Webhook、通知の一時停止；全チャンネルでイベントごとに絞り込み |
| **VR オーバーレイ**            | ブラウザ描画（100 MB 以上）；OpenVR                              | + ネイティブ描画（数十 MB）；OpenXR（**WiVRn で実機確認済み**）                                          |
| スクリーンショット             | メタデータの表示と検索                                           | + グリッド表示、お気に入り、一括管理、ZIP 書き出し                                                       |
| アバター詳細                   | パフォーマンスランクとファイルサイズ                             | + 詳細なパフォーマンス指標をプラットフォームごとの上限と比較                                             |
| バックアップ                   | VRChat のレジストリ設定                                          | + データベースの定期バックアップ、ワンクリック復元                                                       |
| フレンドの現在地               | 同じインスタンスごとにまとめて表示                               | + ワールド表示                                                                                           |
| グループ管理                   | 公開設定は 1 件ずつ                                              | + 一括退出・一括公開設定；プレイヤーリストにグループロールを表示                                         |
| テーマ                         | 内蔵テーマ、カスタム CSS ファイル                                | + コミュニティテーマ、背景画像、アプリ内 CSS 編集、アクセントカラー                                      |
| 複数アカウント                 | 全アカウントのゲームログが混在                                   | ゲームログはアカウントごとに保存；別アカウントで VRChat を遊んでもお互いに影響なし                       |

VRCX のそのほかの機能も、VRCX-0 にそのまま揃っています。

## インストール

[最新リリース](https://github.com/Map1en/VRCX-0/releases/latest) から、お使いのプラットフォーム向けのファイルをダウンロードしてください。

| プラットフォーム        | ファイル                                       |
| ----------------------- | ---------------------------------------------- |
| Windows                 | `VRCX-0_<バージョン>_windows_x86_64_setup.exe` |
| macOS（Apple シリコン） | `VRCX-0_<バージョン>_macos_aarch64.dmg`        |
| macOS（Intel）          | `VRCX-0_<バージョン>_macos_x86_64.dmg`         |
| Linux                   | `.AppImage`、`.deb`、`.rpm`                    |

macOS で初回起動がブロックされた場合は、**システム設定 → プライバシーとセキュリティ** で **このまま開く** をクリックしてください。

### Linux

アプリ画面のハードウェアアクセラレーションは初期状態でオフです。**設定 → システム → ハードウェアアクセラレーション（試験的）** からオンにでき、表示に問題があれば VRCX-0 が自動でオフに戻します。`WEBKIT_DISABLE_DMABUF_RENDERER` を自分で設定している場合、この項目は表示されません。

## フィードバック

- 質問・交流：[Discord](https://discord.gg/fehKP3SVPN)
- 不具合報告・機能リクエスト：[GitHub Issues](https://github.com/Map1en/VRCX-0/issues)
- 開発ブログ：[blog.vrcx-0.dev](https://blog.vrcx-0.dev/ja/)

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

## ライセンス

VRCX-0 は GNU General Public License v3.0（GPLv3）の下で公開されています。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

VRCX-0 は VRChat Inc. の公認を受けたものではありません。VRChat および関連するすべての名称・ロゴは VRChat Inc. の商標または登録商標です。
