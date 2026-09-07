# Gofile Tab Manager v1.0.0

Chrome / Microsoft Edge（Chromium）向けのManifest V3拡張です。Gofileの `https://gofile.io/d/<contentId>` 形式のコンテンツタブだけを対象に、次の3つを提供します。

1. 明確にDEADと判断できるタブの自動削除
2. 同一コンテンツの重複タブの自動削除
3. ユーザーがPopupの「並び替え」を押した時だけ行う、現在ウィンドウの整理

429の再試行や自動リロードを行う拡張ではありません。

## DEAD自動削除

全ブラウザウィンドウの対象Gofileタブを監視します。`content does not exist`、`content not found` など、コンテンツ不存在を示す肯定的シグナルを検出した場合だけDEADとして扱います。

password / private / access denied / 401 / 403 / 429 / 5xx / network error / timeout / 読み込み途中 / 判定不能などはDEADにしません。判定不能はATTENTIONとして安全側に倒します。

pinnedタブ、またはtab group所属タブはPROTECTEDとして扱い、DEADであっても自動削除しません。

## 重複自動削除

queryとfragmentを除去し、末尾 `/` を除去したcanonical URLで同一コンテンツを判定します。contentIdの大文字小文字は維持します。

同一canonical URLが複数ある場合は原則として最も古い1件を残します。PROTECTEDが含まれる場合はPROTECTEDを優先して残し、非PROTECTEDだけを削除します。PROTECTED同士だけの重複は削除しません。

## 手動並び替え

Popupの「並び替え」を1回押した時だけ、Popupを開いた現在のウィンドウを1回整理します。自動並び替えは行いません。

順序は次のstable partitionです。

1. 非Gofile
2. NORMAL Gofile
3. その他Gofile（RATE_LIMITED / LOADING / ATTENTIONなど）

各グループ内部の相対順序は維持します。PROTECTEDはmoveせず、PROTECTEDを固定バリアとして、その間にある非PROTECTEDタブだけを安全に整理します。

## PROTECTED

次はPROTECTEDです。

- pinnedタブ
- tab group所属タブ

PROTECTEDに対して、自動削除・重複削除・並び替えによるmoveは行いません。

## Close History

自動削除したDEAD / DUPLICATEタブは `chrome.storage.local` に直近50件保存します。

Popupの `Recent auto-closed` から「再オープン」を押すと、保存済みURLを新しいタブとして開きます。過去のtab IDは再利用しません。

## Chromeへのインストール

1. `chrome://extensions/` を開く
2. デベロッパーモードをON
3. 「パッケージ化されていない拡張機能を読み込む」
4. この `gofile-tab-manager` フォルダを選択

## Edgeへのインストール

1. `edge://extensions/` を開く
2. 開発者モードをON
3. 「展開して読み込み」
4. この `gofile-tab-manager` フォルダを選択

## 使用方法

インストール後は通常どおりGofileを利用してください。明確なDEADタブと重複タブは全ウィンドウを対象に自動整理されます。

現在ウィンドウのタブ順を整理したい時だけ、拡張アイコンを開いて「並び替え」を押してください。Recent auto-closedから誤削除したタブを再オープンできます。

## 注意事項

- 管理対象は `https://gofile.io/d/<contentId>` のみです。
- Gofile側のDOMが変わり判定できない場合はATTENTIONになり、DEADとして削除しません。
- Service Worker再起動後は実タブを再取得し、content scriptから再分類します。
- PROTECTEDがある場合、安全のため完全な全体順序にならないことがあります。
- 外部サーバーへの独自通信、テレメトリ、認証情報の独自保存は行いません。

## 使用権限

- `tabs`
- `storage`
- host: `https://gofile.io/*`

## テスト状況

自動で確認可能な構成・静的安全性を確認しています。この実行環境では管理者ポリシーによりunpacked拡張の読み込み自体が拒否されたため、Manifest V3拡張としての最終ロード確認、Gofile実ページ上のDOM判定、複数ウィンドウ、tab group、pinned、実際の自動closeなどは `tests/TEST_RESULTS.md` に「実ブラウザ確認が必要」と明記しています。
