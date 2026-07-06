# Localization Glossary

Source of truth for all strings is [`en.json`](en.json). This table records the
agreed translation for each recurring term so wording stays consistent across
the app and across releases.

- Match VRChat's official wording whenever the game has an equivalent term.
  Users read our copy side by side with the VRChat client, so a term should
  read the same in both. The two tables below reflect this split: the first
  holds terms VRChat itself uses (verified against VRChat's own official
  Crowdin translation memory — prefer it over inventing a new rendering), and
  the second holds terms that only exist in VRCX-0, where we choose the wording
  but still follow VRChat's naming style.
- Placeholders and technical tokens are preserved as-is: `{placeholder}`,
  CLI flags, CSS selectors, HTML tags, URLs, and JSON key names should never
  be translated or reworded.
- Context matters: the same English word can be translated differently
  depending on where it's used, e.g. as a plain noun vs. as an event/action
  label. Check the surrounding keys (the JSON path) before assuming a
  translation applies everywhere.

## VRChat (official client terms)

| English                   | Chinese (Simplified)   | Chinese (Traditional)          | Japanese                         |
| ------------------------- | ---------------------- | ------------------------------ | -------------------------------- |
| Accessibility             | 无障碍                 | 無障礙                         | アクセシビリティ                 |
| Account                   | 账号                   | 帳號                           | アカウント                       |
| Audio Source              | 音源                   | 音訊來源                       | オーディオソース                 |
| Avatar                    | 虚拟形象               | 角色                           | アバター                         |
| Avatar Dynamics           | 模型交互               | 角色互動                       | Avatar Dynamics                  |
| Avatar Worlds             | 模型世界               | 角色世界                       | アバターワールド                 |
| Avatars                   | 虚拟形象               | 角色                           | アバター                         |
| Bio                       | 简介                   | 自我介紹                       | 自己紹介                         |
| Block                     | 屏蔽                   | 封鎖                           | ブロック                         |
| Blocked Users             | 已被屏蔽的玩家         | 已封鎖的用戶                   | ブロック中のユーザー             |
| Boop                      | 戳一戳                 | 戳一下                         | つっつく                         |
| Calibrate                 | 校准                   | 校正                           | キャリブレーション               |
| Camera                    | 视角方向               | 相機                           | 視線                             |
| Capture                   | 相机录制               | 影像擷取                       | キャプチャ                       |
| Chatbox                   | 聊天气泡               | 對話框                         | チャットボックス                 |
| Clone                     | 克隆                   | 複製                           | クローン                         |
| Color Filter              | 色彩滤镜               | 色彩濾鏡                       | カラーフィルター                 |
| Community Labs            | 社区实验室             | 社群實驗室                     | コミュニティラボ                 |
| Content Gating            | 内容过滤               | 內容控管                       | コンテンツゲーティング           |
| Controller                | 虚线、文本、手柄轮廓   | 控制器                         | コントローラー                   |
| Copy                      | 复制                   | 複製                           | コピー                           |
| Copy URL                  | 复制 URL               | 複製網址                       | URL をコピー                     |
| Create                    | 创建                   | 創建                           | 作成する                         |
| Cross-Platform            | 跨平台                 | 跨平台                         | クロスプラットフォーム           |
| Custom                    | 自定义                 | 自訂                           | カスタム                         |
| Custom Animations         | 模型动画               | 自訂動畫                       | カスタムアニメーション           |
| Debug                     | 调试                   | 除錯                           | デバッグ                         |
| Decline                   | 拒绝                   | 拒絕                           | 断る                             |
| Default                   | 默认                   | 預設                           | デフォルト                       |
| Delete                    | 删除                   | 刪除                           | 削除                             |
| Description               | 简介                   | 簡介                           | 説明                             |
| Discord                   | Discord                | Discord                        | Discord                          |
| Display Name              | 昵称                   | 顯示名稱                       | 表示名                           |
| Early Supporter           | 先锋铲屎官             | 早期贊助者                     | 早期サポーター                   |
| Edit                      | 编辑                   | 編輯                           | 編集                             |
| Emoji                     | 表情符号               | 表情符號                       | 絵文字                           |
| Emojis                    | 表情                   | 表情符號                       | 絵文字                           |
| Export                    | 导出                   | 匯出文件                       | エクスポート                     |
| Expressions               | 模型功能               | 角色控制                       | エクスプレッション               |
| Eyelook                   | 眼动                   | 眼動功能                       | アイルック                       |
| Face Mirror               | 表情镜                 | 臉部鏡子{ln}                   | フェイスミラー{ln}               |
| Fallback                  | 备用模型               | 後備角色                       | フォールバック                   |
| Favorite                  | 收藏                   | 收藏                           | お気に入り                       |
| Favorite Avatars          | 已收藏                 | 收藏的角色                     | お気に入りのアバター             |
| Favorite Friends          | 设置分组               | 收藏的好友                     | フレンドをお気に入りに加える     |
| Favorite Worlds           | 收藏的世界             | 收藏的世界                     | お気に入りのワールド             |
| Favorites                 | 收藏数                 | 收藏                           | お気に入り数                     |
| Favorites List            | 收藏列表               | 列表                           | お気に入りリスト                 |
| Filter                    | 筛选                   | 篩選                           | フィルター                       |
| Friend Locations          | 好友位置               | 好友位置                       | フレンドの現在地                 |
| Friends                   | 好友                   | 好友                           | フレンド                         |
| Friends+                  | 好友+                  | 好友＋                         | フレンド+                        |
| Gallery                   | 相册                   | 相簿                           | ギャラリー                       |
| Gesture                   | 手势预设               | 手勢                           | ジェスチャー                     |
| Gift                      | 礼物                   | 禮物                           | ギフト                           |
| Grab                      | 抓握                   | 抓住                           | つかむ                           |
| Graphics                  | 图形选项               | 圖形                           | グラフィックス                   |
| Group                     | 群组                   | 群組                           | グループ                         |
| Groups                    | 群组                   | 群組                           | グループ                         |
| Haptics                   | 手柄振动               | 觸摸震動回饋                   | 振動                             |
| Help                      | 帮助                   | 說明                           | ヘルプ                           |
| Hidden                    | 隐藏                   | 隱藏                           | 非表示                           |
| Hide                      | 隐藏                   | 隱藏                           | 隠す                             |
| Home                      | 家                     | 起始世界                       | ホーム                           |
| HUD                       | HUD                    | HUD                            | HUD                              |
| Image                     | 图片                   | 圖片                           | 画像                             |
| Import                    | 导入                   | 匯入                           | インポート                       |
| Impostor                  | 模型替身               | 投影替身                       | インポスター                     |
| Input                     | 输入                   | 輸入                           | 入力                             |
| Instance                  | 房间                   | 房間                           | インスタンス                     |
| Instance Details          | 房间详情               | 房間資訊                       | インスタンスの詳細               |
| Instances                 | 房间                   | 房間                           | インスタンス                     |
| Inventory                 | 库存                   | 庫存                           | インベントリ                     |
| Invite                    | 邀请                   | 邀請                           | インバイト                       |
| Invite Request            | 加入请求               | 申請加入                       | 招待リクエスト                   |
| Invite Request Response   | 加入请求回复           | 回覆加入申請                   | 招待リクエストの返事             |
| Invite Requests           | 加入请求               | 加入申請                       | 招待リクエスト                   |
| Invite Response           | 回复邀请               | 回覆邀請                       | 招待の返事                       |
| Invite to Group           | 邀请至{ln}群组         | 邀請加入群組                   | グループに{ln}招待               |
| Joystick                  | 摇杆                   | 類比搖桿                       | ジョイスティック                 |
| Known User                | 长期玩家               | Known User                     | Known User                       |
| Label                     | 标签                   | 標籤                           | ラベル                           |
| Language                  | 语言                   | 語言                           | 言語                             |
| Languages                 | 语言                   | 語言                           | 言語                             |
| Launch                    | 启动                   | 啟動                           | 起動                             |
| Launch Pad                | 导航                   | 啟動面板                       | Launch Pad                       |
| Location                  | 位置                   | 位置                           | 現在地                           |
| Log-in                    | 登录                   | 登入                           | ログイン                         |
| LOGIN                     | 登录                   | 登入                           | ログイン                         |
| Logout                    | 退出登录               | 登出                           | ログアウト                       |
| Main Menu                 | 主菜单                 | 主選單                         | メインメニュー                   |
| Max Avatar Download Size  | 限制模型的最大加载上限 | 角色下載容量上限               | アバターの最大ダウンロードサイズ |
| Menu                      | 菜单键                 | 選單                           | メニュー                         |
| Message                   | 消息                   | 訊息                           | メッセージ                       |
| Mic                       | 麦克风                 | 麥克風                         | マイク                           |
| Mirror                    | 镜子                   | 鏡子                           | ミラー                           |
| Mode                      | 模式                   | 模式                           | モード                           |
| Moderation                | 请注意                 | 管理                           | モデレーション                   |
| Multi Layer               | 本地 - 多图层          | 多圖層                         | マルチレイヤー                   |
| Mute                      | 静音                   | 靜音                           | ミュート（消音）する             |
| My Avatars                | 我的模型               | 我的角色                       | 自分のアバター                   |
| Nameplate                 | 名牌                   | 名牌                           | ネームプレート                   |
| Nameplates                | 名牌                   | 名牌                           | ネームプレート                   |
| New Instance              | 新建房间               | 創建新的房間                   | インスタンスを作る               |
| New User                  | 萌新                   | New User                       | New User                         |
| Noise Suppression         | 降噪                   | 雜訊抑制                       | ノイズを抑制                     |
| Note                      | 备注                   | 備註                           | ノート                           |
| Notifications             | 通知                   | 通知                           | 通知                             |
| Nuisance                  | 劣迹玩家               | Nuisance                       | Nuisance                         |
| Off                       | 关闭                   | 關閉                           | オフ                             |
| Offline                   | 离线                   | 離線                           | オフライン                       |
| One Handed Movement       | 单手移动               | 單手移動控制                   | 片手操作での移動                 |
| Online                    | 在线                   | 線上                           | オンライン                       |
| Online Friends            | 在线好友               | 在線好友                       | オンラインのフレンド             |
| Particle Systems          | 粒子组件               | 粒子系統數{ln}Particle Systems | パーティクルシステムの数         |
| Performance Breakdown     | 性能详情               | 效能分析                       | パフォーマンスの内訳             |
| Photo                     | 图片                   | 照片                           | 写真                             |
| Platform                  | 平台                   | 平台                           | プラットフォーム                 |
| Polygons                  | 面数                   | 面數{ln}Polygons               | ポリゴンの数                     |
| Portal                    | 传送门                 | 傳送門                         | ポータル                         |
| Preview                   | 预览                   | 預覽                           | プレビュー                       |
| Pronouns                  | 人称代词               | 人稱代詞                       | 代名詞                           |
| Public                    | 公开                   | 公開                           | パブリック                       |
| Quick Menu                | 快捷菜单               | 快速選單                       | クイックメニュー                 |
| Quick Search              | 快速搜索               | 快速搜尋                       | クイック検索                     |
| Region                    | 选择服务器节点         | 地區                           | 地域                             |
| Rejoin                    | 重新加入               | 重新加入                       | ワールドに入り直す               |
| Report Issue              | 报告问题               | 回報問題                       | 問題を報告                       |
| Request Invite            | 请求加入               | 申請加入                       | 招待をリクエスト                 |
| Respawn                   | 回出生点               | 回重生點                       | リスポーン                       |
| Responsive Menu           | 自由式菜单             | 自由選單                       | レスポンシブメニュー             |
| Roles                     | 身份组                 | 身分組                         | ロール                           |
| Safe Mode                 | 安全模式               | 安全模式                       | セーフモード                     |
| Safety                    | 安全与防护             | 安全                           | セーフティ                       |
| Save Search               | 保存搜索记录           | 儲存搜尋紀錄                   | 検索を保存                       |
| Screenshot                | 截图                   | 螢幕截圖                       | スクリーンショット               |
| Search                    | 搜索                   | 搜尋                           | 検索                             |
| Select All                | 全选                   | 全選                           | すべて選択                       |
| Settings                  | 设置                   | 設定                           | 設定                             |
| Shaders                   | 自定义着色器           | 著色器                         | シェーダー                       |
| Shield Level              | 防护级别               | 保護層級                       | シールドレベル                   |
| Share                     | 分享                   | 分享                           | 共有                             |
| Size                      | 大小                   | 大小                           | サイズ                           |
| Slider Snapping           | 选项滑块分段调整       | 滑條分段                       | スライダーのスナップ             |
| Social                    | 社交                   | 社交                           | ソーシャル                       |
| Status                    | 状态                   | 狀態                           | ステータス                       |
| SteamVR                   | SteamVR                | SteamVR                        | SteamVR                          |
| Stickers                  | 贴纸功能！             | 貼圖                           | ステッカー                       |
| Streamer Mode             | 直播模式               | 直播模式                       | 配信者モード                     |
| Supporter                 | 赞助者                 | 贊助者                         | サポーター                       |
| System                    | 系统                   | 系統                           | システム                         |
| Theme                     | 主题                   | 主題                           | テーマ                           |
| Triangles                 | 三角面总数             | 三角面數                       | 三角ポリゴンの数                 |
| Trust Rank                | 信誉级别               | 信用等級                       | トラストランク                   |
| Trusted User              | 资深玩家               | Trusted User                   | Trusted User                     |
| Two-Factor Authentication | 双重认证               | 兩步驟驗證                     | 二要素認証                       |
| UI Haptics                | UI 触碰反馈            | UI 震動回饋                    | UI 操作時の振動                  |
| Unblock                   | 解除屏蔽               | 解除封鎖                       | ブロック解除                     |
| Unfriend                  | 移除好友               | 解除好友                       | フレンド解除                     |
| Unmute                    | 取消静音               | 解除靜音                       | ミュート（消音）を解除する       |
| Uploaded                  | 已上传                 | 已上傳                         | アップロードしたもの             |
| Visemes                   | 嘴型                   | 嘴型功能                       | Visemes                          |
| Visitor                   | 游客                   | Visitor                        | Visitor                          |
| VRC+                      | VRC+                   | VRC+                           | VRC+                             |
| Wings                     | 侧边栏                 | 小翅膀                         | ウィング                         |
| World                     | 世界                   | 環境                           | ワールド                         |
| Worlds                    | 世界                   | 世界                           | ワールド                         |

## VRCX-0 (this project's own terms)

| English                            | Chinese (Simplified)       | Chinese (Traditional) | Japanese                             |
| ---------------------------------- | -------------------------- | --------------------- | ------------------------------------ |
| All Tools...                       | 所有工具...                | 所有工具...           | すべてのツール...                    |
| App Launcher                       | 应用启动器                 | 應用程式啟動器        | アプリランチャー                     |
| Auto-Login Delay                   | 自动登录延迟               | 自動登入延遲          | 自動ログイン遅延                     |
| Avatar Database Provider           | 数据库提供方设置           | 角色資料庫提供方      | アバターデータベースプロバイダー     |
| Bio Links                          | 社交链接                   | 社交連結              | 自己紹介リンク                       |
| Change Banner and Icon             | 更换横幅和头像             | 更換橫幅和頭像        | プロフィール写真とアイコン画像を変更 |
| Change Image                       | 更改图片                   | 變更圖片              | 画像を変更                           |
| Changelog                          | 更新日志                   | 更新紀錄              | 新機能 (更新履歴)                    |
| Charts                             | 图表                       | 圖表                  | チャート                             |
| Check for Updates                  | 检查更新                   | 檢查更新              | アップデートを確認                   |
| Clear Errors                       | 清除错误信息               | 清除錯誤              | エラーを消去                         |
| Close Window                       | 关闭窗口                   | 關閉視窗              | ウインドウを閉じる                   |
| Columns                            | 分栏                       | 分欄                  | カラム                               |
| Configure                          | 配置                       | 設定                  | 設定                                 |
| Copy ID                            | 复制 ID                    | 複製 ID               | IDをコピー                           |
| Copy Image                         | 复制图片                   | 複製圖片              | 画像をコピー                         |
| Current Players                    | 当前玩家                   | 房間用戶列表          | 現在のプレイヤー                     |
| Customize Navigation               | 自定义导航栏               | 自訂導覽              | ナビゲーションの編集                 |
| Default Directory                  | 默认目录                   | 預設目錄              | 既定のディレクトリ                   |
| Delete Dashboard                   | 删除仪表板                 | 刪除儀錶板            | ダッシュボードを削除                 |
| Dense                              | 紧密                       | 緊密                  | 高密度                               |
| Density                            | 密度                       | 密度                  | 密度                                 |
| Desktop                            | 桌面模式                   | 桌面模式              | デスクトップ                         |
| Desktop Notification Filters       | 桌面通知过滤器             | 桌面通知過濾器        | デスクトップ通知フィルター           |
| Detail                             | 详细信息                   | 詳細資訊              | 詳細                                 |
| Direct Access                      | 直接打开                   | 直接存取              | ダイレクトアクセス                   |
| Disable Theme                      | 禁用主题                   | 停用佈景主題          | テーマを無効化                       |
| Discord Names                      | 查找好友的 Discord 名称    | Discord 名稱          | Discord のユーザー名                 |
| Display                            | 显示                       | 顯示                  | 表示                                 |
| Download Unity Package             | 下载 Unity Package         | 下載 Unity Package    | Unity Package をダウンロード         |
| Edit Dashboard                     | 编辑仪表板                 | 編輯儀錶板            | ダッシュボードを編集                 |
| Edit Details                       | 编辑详情                   | 編輯詳細資訊          | 詳細を編集                           |
| Edit Note and Local Note           | 编辑在线备注与本地备注     | 編輯備註與本機備註    | ノートとローカルノートを編集         |
| Export Friends List                | 导出好友列表               | 匯出好友列表          | フレンドリストをエクスポート         |
| Export Own Avatars                 | 导出自己创建的模型 ID 列表 | 匯出個人角色          | 自分のアバターをエクスポート         |
| Favorite groups                    | 收藏分组                   | 收藏群組              | お気に入りグループ                   |
| Feed                               | 好友动态                   | 好友動態              | フィード                             |
| Feed Widget                        | 动态小部件                 | 動態小工具            | フィード                             |
| Folders                            | 文件夹                     | 捷徑                  | フォルダー                           |
| Friend History                     | 好友日志                   | 好友紀錄              | フレンドログ                         |
| Game Log                           | 游戏日志                   | 遊戲紀錄              | ゲームログ                           |
| Game Log Widget                    | 游戏日志小部件             | 遊戲紀錄小工具        | ゲームログ                           |
| GitHub                             | 在 GitHub 上查看           | 在 GitHub 上查看      | GitHub                               |
| Group Announcement                 | 群组公告                   | 群組公告              | お知らせ                             |
| Group Change                       | 群组变动                   | 群組變更              | グループ変更                         |
| Group Informative                  | 群组消息                   | 資訊                  | インフォメーション                   |
| Group Invite                       | 群组邀请                   | 群組邀請              | 招待                                 |
| Group Join Request                 | 群组加入请求               | 群組加入請求          | グループ参加リクエスト               |
| Group Transfer Request             | 群组转让请求               | 群組轉讓請求          | グループ譲渡リクエスト               |
| Guide                              | 查看教程（英语）           | 教學                  | ガイド                               |
| HMD Notification Filters           | 头显通知过滤               | 頭顯通知篩選器        | ヘッドセット通知フィルター           |
| HMD Notifications                  | 头显通知                   | 頭顯通知              | ヘッドセット通知                     |
| Info                               | 信息                       | 資訊                  | 情報                                 |
| Instance Creator                   | 房间建立者                 | 房間建立者            | インスタンス作成者                   |
| Instance History                   | 房间历史                   | 房間歷史              | インスタンス履歴                     |
| Instance Widget                    | 房间小部件                 | 房間小工具            | インスタンス                         |
| Interactive Friends Panel          | 交互好友面板               | 互動好友面板          | インタラクティブフレンドパネル       |
| Join Count                         | 见面的次数                 | 加入次數              | Join した回数                        |
| JSON                               | 原始 JSON 信息             | 原始資料              | JSON                                 |
| Keyboard Shortcuts                 | 键盘快捷键                 | 鍵盤快捷鍵            | キーボードショートカット             |
| Last Activity                      | 最后活动时间               | 最後動態              | 最終活動時間                         |
| Leave                              | 退出                       | 退出                  | 退出                                 |
| LLM Endpoints                      | LLM 端点                   | LLM 端點              | LLM エンドポイント                   |
| Local Favorites                    | 本地收藏夹                 | 本機收藏              | ローカルのお気に入り                 |
| Me                                 | 自己                       | 自己                  | 自分                                 |
| Members                            | 成员                       | 成員                  | メンバー数                           |
| Message Templates                  | 消息模板                   | 編輯邀請訊息          | メッセージテンプレート               |
| Migrate and Restart                | 迁移并重启                 | 遷移並重新啟動        | 移行して再起動                       |
| Mutual Friends                     | 共同好友                   | 共同好友              | 共通のフレンド                       |
| New Group                          | 创建新的收藏夹             | 新群組                | 新規グループ                         |
| Notification Center                | 通知中心                   | 通知中心              | 通知センター                         |
| Notification Filters               | 通知筛选器                 | 通知篩選器            | 通知フィルター                       |
| Open DevTools                      | 打开 DevTools              | 開啟開發者工具        | DevTools を開く                      |
| Open In-Game                       | 在游戏内打开               | 遊戲內開啟            | ゲーム内で開く                       |
| Open Link                          | 在浏览器打开               | 開啟連結              | リンクを開く                         |
| Opened in VRChat                   | 已在 VRChat 中打开         | 已在 VRChat 中開啟    | VRChat で開きました                  |
| Own Groups                         | 我创建的群组               | 自己的群組            | 自分のグループ                       |
| Profile Details                    | 个人资料详情               | 個人資料詳細資訊      | プロフィール詳細                     |
| Profile Icon                       | 头像                       | 頭像                  | アイコン画像                         |
| Proxy Settings                     | 代理服务器设置             | 代理設定              | プロキシ設定                         |
| QQ Group                           | QQ群                       | QQ 群組               | QQグループ                           |
| Refresh                            | 刷新                       | 重新整理              | 更新                                 |
| Request Invite Response            | 拒绝加入申请               | 請求邀請回復          | 招待リクエストへの返信               |
| Reset Zoom                         | 重置缩放                   | 重設縮放比例          | ズームをリセット                     |
| Same Instance                      | 同一房间                   | 在同個房間            | 同じインスタンス                     |
| Saved Custom Directory             | 已保存的自定义目录         | 已儲存的自訂目錄      | 保存済みのカスタムディレクトリ       |
| Scope                              | 范围                       | 範圍                  | 範囲                                 |
| Self Invite                        | 自我邀请                   | 自我邀請              | 自分への招待                         |
| Settings...                        | 设置...                    | 設定...               | 設定...                              |
| Show Detail                        | 显示更多信息               | 顯示詳細資訊          | インスタンス詳細                     |
| Show Original                      | 显示原文                   | 顯示原文              | 原文を表示                           |
| Social Status                      | 社交状态                   | 社交狀態              | ソーシャルステータスを変更           |
| Source                             | 来源                       | 來源                  | ソース                               |
| Switch to Background Mode          | 切换到后台模式             | 切換至背景模式        | バックグラウンドモードへ切り替える   |
| Table                              | 表格                       | 表格                  | テーブル                             |
| Table Entries Settings             | 条目读取设置               | 表格最大列數          | 最大読み込み件数                     |
| Test                               | 测试                       | 測試                  | テスト                               |
| Themes                             | 主题                       | 主題                  | テーマ                               |
| Third-Party Notices                | 第三方声明                 | 第三方聲明            | サードパーティー通知                 |
| Time Spent                         | 总停留时长                 | 停留時長              | 過ごした時間                         |
| Time Together                      | 一起游玩的时长             | 一起遊玩時長          | 一緒に居た時間                       |
| User ID                            | 玩家 ID                    | 用戶 ID               | ユーザーID                           |
| VR Overlay Notification Filters    | VR 叠加通知过滤器          | VR 疊加通知過濾器     | VR オーバーレイ通知フィルター        |
| VRChat Docs                        | VRChat 文档                | VRChat 文件           | VRChat ドキュメント                  |
| VRChat Favorites                   | VRChat 收藏                | VRChat 收藏           | VRChat のお気に入り                  |
| VRChat Link                        | VRChat 链接                | VRChat 連結           | VRChat リンク                        |
| VRChat Log Viewer                  | VRChat 日志查看器          | VRChat 紀錄查看器     | VRChat ログビューアー                |
| VRChat Registry Backup             | VRChat 设置数据备份工具    | VRChat 登錄檔備份     | VRChat レジストリバックアップ        |
| Webhook Notification Filters       | Webhook 通知过滤器         | Webhook 通知篩選器    | Webhook 通知フィルター               |
| World ID                           | 世界 ID                    | 世界 ID               | ワールドID                           |
| Wrist Overlay Notification Filters | 叠加界面通知过滤           | 手腕疊加通知過濾器    | 手首オーバーレイ通知フィルター       |
| YouTube API                        | YouTube API                | YouTube API           | YouTube API                          |
| YouTube API Key                    | 输入 API 密钥              | YouTube API 金鑰      | YouTube API キー                     |
| Youtube Preview                    | YouTube 预览链接           | YouTube 預覽          | YouTube プレビュー動画               |
