# Gofile Tab Manager v1.0.0 — Test Results

## 自動確認の範囲

- `manifest.json` のJSON妥当性
- Manifest V3 / version / permissions / host permission / content script構成
- 必須ファイル構成
- `shared/url.js` 実コードのURL canonicalization代表ケース検証
- 禁止機能由来の識別子・API文字列の全文検索
- 手動並び替え以外から `chrome.tabs.move()` が呼ばれないことの静的確認
- Chromiumによるunpacked読み込み試行（この環境では管理者ポリシーによりunpacked拡張が禁止され、読み込み完了までは確認不可）

実際のGofile通信、DOM描画、複数window、pinned、tab group、実タブclose/moveを伴う項目は、この環境では完全な操作確認を行えないためPASSと偽らず「実ブラウザ確認が必要」としています。Chromiumのunpacked読み込みも実行環境の管理者ポリシーで拒否されたため、Manifest V3拡張としての最終ロード確認は実ブラウザ確認が必要です。

## 自動検証結果サマリ

- 必須ファイル / Manifest JSON: PASS
- JavaScript構文チェック: PASS
- `shared/url.js` 実コードのcanonicalization代表ケース: PASS
- 禁止機能由来の指定文字列（コード全文）: 0件
- 不要permission / `<all_urls>`: 0件
- Chromium `--pack-extension` によるパッケージ生成: PASS
- ZIP整合性（14ファイル）: PASS
- Chromium unpackedロード: 実行環境の管理者ポリシーにより拒否されたため、実ブラウザ確認が必要
- Service Worker起動時のcontent classification再同期: モックPASS
- PROTECTED判定 / duplicate survivor / stable partition / current-window限定 / no-op move / Close History 50件: モックPASS

## T01 — DEAD判定

**結果: PASS（静的ロジック） / 実ブラウザ確認が必要**

DEADは明示的な不存在シグナルだけで確定し、NORMALではないことを理由にDEADへ落とす分岐はありません。実Gofile画面での文言・DOM最終確認が必要です。

## T02 — Fail Safe

**結果: PASS（静的ロジック） / 実ブラウザ確認が必要**

password / private / access denied / network / 5xx系表現はATTENTION側で先に判定されます。429はRATE_LIMITEDです。実画面の文言差異を含む確認が必要です。

## T03 — 全ウィンドウDEAD処理

**結果: PASS（モック/静的ロジック） / 実ブラウザ確認が必要**

backgroundはwindow指定なしの実タブ同期を行い、DEAD通知されたtab IDをwindowに依存せず処理します。モックでは別window IDのDEAD close経路に加え、Service Worker起動時にcontent scriptへ再分類要求を送り、DEADを再同期してcloseする経路を確認済みです。複数windowでの実close確認が必要です。

## T04 — PROTECTED保護

**結果: PASS（モックロジック） / 実ブラウザ確認が必要**

pinned / group所属のPROTECTED判定、pinned DEADをcloseしないこと、並び替えでPROTECTEDをsegment境界としてmove対象から除外することをモック確認済みです。実操作確認が必要です。

## T05 — 重複削除

**結果: PASS（モックロジック） / 実ブラウザ確認が必要**

同一canonical URL 3件で `firstSeenAt` が最古の1件だけ残ること、query / fragment違いでも同じcanonical URLとして別windowを跨いで2件がDUPLICATE closeされることをモック確認済みです。実タブでの確認が必要です。

## T06 — 重複とPROTECTED

**結果: PASS（モックロジック） / 実ブラウザ確認が必要**

PROTECTED 1件＋通常2件では通常2件だけが削除候補、PROTECTED同士だけでは削除候補0件になることをモック確認済みです。実操作確認が必要です。

## T07 — Close History

**結果: PASS（モックロジック） / 実ブラウザ確認が必要**

成功した自動close後に `url / canonicalUrl / reason / closedAt / title / sourceTabId` が保存されること、最大50件・新しい順になることをモック確認済みです。Popup再オープンはURLだけを使って新規タブを作る実装で、実操作確認が必要です。

## T08 — 自動並び替え禁止

**結果: PASS（静的確認）**

`chrome.tabs.move()` はPopupの明示メッセージから呼ばれる手動並び替え関数内にだけ存在します。tab eventやclassification処理からsort関数を呼ぶ経路はありません。

## T09 — 現在ウィンドウ限定

**結果: PASS（モック/静的ロジック） / 実ブラウザ確認が必要**

Popupがactive/currentWindowのwindow IDを取得し、そのIDだけを手動並び替え要求に渡します。モックではwindow 1だけをsortした際にwindow 2のtab ID順とmove対象が不変であることを確認済みです。複数windowでの実操作確認が必要です。

## T10 — 並び替え結果とstable order

**結果: PASS（モックロジック） / 実ブラウザ確認が必要**

各非PROTECTED segmentで `非Gofile → NORMAL → その他Gofile` の3bucket stable partitionを行い、bucket内では元配列順を維持します。実 `tabs.move()` のブラウザ挙動は確認が必要です。

## T11 — 1クリック1回

**結果: PASS（モック/静的ロジック） / 実ブラウザ確認が必要**

モックで1回の手動sortが変更segmentをtab ID配列1回でmoveし、同じ並びに対する2回目の呼び出しではmoveが増えないことを確認済みです。tab eventから手動sortを再呼出しする実装もありません。実API動作は確認が必要です。

## T12 — 大量タブ安全性

**結果: 実ブラウザ確認が必要**

moveは1枚ずつ末尾送りせず、変更が必要な非PROTECTED segmentごとにtab ID配列をまとめて渡します。二重close防止Setがあります。active tab変更やwindow focus変更APIは使用していません。100タブ規模の実ブラウザ確認が必要です。
