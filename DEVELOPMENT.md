# DEVELOPMENT.md

Gofile Tab Manager の開発・保守・AI 引き継ぎ用ドキュメントです。

利用者向け情報は [README.md](README.md)、バージョン履歴は [CHANGELOG.md](CHANGELOG.md)、全体のデータフローは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、テスト記録は [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) を参照してください。

## 現在の状態

| 項目 | 状態 |
|---|---|
| Manifest version | 3 |
| アプリ Version | `1.1.0` |
| 安定版 | `v1.1.0` |
| v1.1.0 リリース日 | 2026-09-15 |
| Release / Tag 識別子 | `v1.1.0` |
| GitHub Release 運用 | 手動公開 |
| Version 定義 | `manifest.json` / `shared/constants.js` |
| default branch | `main` |
| GitHub Actions | 導入済み。Node.js 24 / `npm test` |
| 実ブラウザ検証 | 2026-09-15 実施、不具合なし |
| 最小対応ブラウザ Version | 未定義 |
| License | 未設定 |

v1.1.0 は v1.0.0 の destructive safety 方針を維持しつつ、content lifecycle 修正、CI、Popup の再判定 / 詳細状態表示、自動クローズ一時停止 / 再開を追加したリリースです。

## 現在の主要機能

- `https://gofile.io/d/<contentId>` タブの分類
- 肯定的に確認できた `DEAD` タブの自動クローズ
- canonical URL が同じ重複タブの自動整理
- pinned / tab group 所属タブの `PROTECTED` 保護
- Popup の `NORMAL` / `RATE_LIMITED` / `LOADING` / `ATTENTION` / `PROTECTED` 状態表示
- Popup から現在 window の管理対象タブを手動再判定
- グローバルな自動クローズ一時停止 / 再開
- Popup から現在 window だけを手動 stable partition
- 自動クローズ履歴を最大 50 件保持し再オープン
- Service Worker 再起動時の live tab 再同期と一部クローズ履歴復旧
- GitHub Actions による回帰テスト

## 実機検証状況

2026-09-15 に v1.1.0 リリース候補の実ブラウザ検証を実施し、不具合なしを確認しています。

確認内容は [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) を正としてください。正確な Chrome / Edge Version 番号は記録していないため、最小対応 Version は未定義のままです。

## アーキテクチャ概要

本拡張はビルド工程を持たない Manifest V3 拡張です。

```text
Gofile page
  │
  │ DOM / URL / route changes
  ▼
content.js
  │ TAB_CLASSIFICATION / TAB_ROUTE_CHANGED
  ▼
background.js (Service Worker)
  ├─ tabMeta / generation guards
  ├─ DEAD / duplicate close
  ├─ auto-close pause
  ├─ manual sort
  ├─ reopen history
  └─ chrome.storage.local / session
  ▲
  │ runtime messages
  │
popup.js
  │
  └─ tabs message → reclassify.js → content.js MutationObserver path
```

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## モジュール構成

### `manifest.json`

責務:

- Manifest V3 設定
- `background.js` を Service Worker として登録
- Popup 登録
- `https://gofile.io/*` へ content script を注入
- `tabs` / `storage` 権限と Gofile host permission を宣言

content scripts:

```text
shared/constants.js
shared/url.js
shared/signatures.js
content.js
reclassify.js
```

host permission を Gofile 以外へ広げないでください。

### `shared/constants.js`

主な定数:

```text
VERSION = 1.1.0
HISTORY_LIMIT = 50
CLASSIFY_DEBOUNCE_MS = 800
CLASSIFY_SETTLE_MS = 12000
```

states:

```text
NORMAL
DEAD
RATE_LIMITED
LOADING
ATTENTION
PROTECTED
```

storage keys:

```text
closeHistory
tabMeta
pendingCloses
autoClosePaused
```

message types:

```text
TAB_CLASSIFICATION
TAB_ROUTE_CHANGED
REQUEST_CLASSIFICATION
REQUEST_RECLASSIFICATION
GET_POPUP_STATE
SORT_CURRENT_WINDOW
REOPEN_HISTORY_ITEM
```

`PROTECTED` はページ分類ではなく browser tab property から判断します。

### `shared/url.js`

管理対象 URL:

```text
https://gofile.io/d/<contentId>
```

受理条件:

- HTTPS
- hostname `gofile.io`
- port 未指定または `443`
- `/d/<contentId>` または末尾 `/`
- 追加 path segment は不可

canonicalization では query / fragment / trailing slash を除去し、contentId の大小文字は維持します。

### `shared/signatures.js`

責務:

- DEAD にしてはいけない attention 文言
- 429 / rate limit 文言
- DEAD gate DOM / title signature
- NORMAL の肯定的 DOM signature
- LOADING signature

現行 DEAD gate:

```text
main#page #fm-root
main#page #fm-root h1 = "This content does not exist"
document.title = "Content not found" または "Content not found · Gofile"
```

広い本文文字列だけで DEAD にしないでください。

### `content.js`

責務:

- Gofile origin 上で route を監視
- DOM を安全側に分類
- route change / classification を background へ通知
- `REQUEST_CLASSIFICATION` へ応答

#### Classification order

概略:

1. 管理対象 URL か確認
2. body 未描画なら `LOADING`、settle 後は `ATTENTION`
3. route 切替後に新 render 未確認なら `LOADING`
4. 可視 status heading / alert で password/private/401/403/network/5xx 等を `ATTENTION`
5. 可視 status heading / alert で 429/rate limit を `RATE_LIMITED`
6. settle 前で loading indicator があれば `LOADING`
7. 正常 folder/file の肯定的 DOM があれば `NORMAL`
8. current generation の fresh not-found gate があれば `DEAD`
9. settle 前なら `LOADING`
10. それ以外は `ATTENTION`

status code / error text を body 全体へ適用しないでください。正常なファイル名や本文中の数字と衝突します。

#### Visibility

`isHiddenByAttributesOrStyle()` は対象 node だけでなく祖先 chain について hidden / aria-hidden / modal 系 class / inline style / computed style を確認します。

CSS class で `display:none` になった stale DOM を可視 DEAD signal として扱わないための安全策です。

#### Route lifecycle

route change 検知:

- content-world `history.pushState`
- content-world `history.replaceState`
- `popstate`
- `hashchange`
- 250ms route poll
- `pageshow`

`pagehide` で observer / poll / timers を停止し、`pageshow` で observer と route poll を再開します。

route change ごとに `routeGeneration` と settle timer を更新します。SPA route ごとに静的な `LOADING` が残り続けないよう、generation-aware settle reclassification を行います。

### `reclassify.js`

Popup の `REQUEST_RECLASSIFICATION` を受け取ります。

分類ロジックは複製しません。管理対象ページに hidden marker を一時的に追加・削除し、`content.js` の既存 MutationObserver / debounce / route-generation guard 経路を再利用します。

このファイルへ独自 classification decision を追加しないでください。

### `background.js`

本プロジェクトの destructive operation の中心です。

責務:

- Service Worker 初期化
- live tab authoritative state の取得
- classification の受理・世代管理
- DEAD close
- duplicate reconciliation
- auto-close pause
- manual sort
- Popup state
- Close History / crash recovery

主要 in-memory state:

| 変数 | 用途 |
|---|---|
| `tabMeta` | 管理タブの現在メタデータ |
| `closingTabIds` | 同じ tab の二重 close 防止 |
| `pendingCloseOperations` | close 復旧用操作状態 |
| `unsavedHistoryEntries` | local storage 保存待ち履歴 |
| `navigationVersions` | navigation 世代 |
| `classificationRevisions` | background が採用した分類世代 |
| `latestRouteGenerations` | document ごとの最新 route generation |
| `sortChains` | window 単位の sort 直列化 |
| `historyWriteChain` | Close History 書き込み直列化 |
| `reconciliationChain` | duplicate reconciliation 直列化 |
| `autoClosePaused` | destructive auto-close の global pause |

#### Initialization

1. live tabs を取得
2. session `tabMeta` を読み込む
3. local `autoClosePaused` を読み込む
4. state を `LOADING` へ再構築
5. pending close recovery
6. session metadata 保存
7. content scripts へ再分類要求
8. duplicate reconciliation

pause 読み込みに失敗した場合は `true` を返し、destructive behavior を安全側に停止します。

#### `applyClassification()`

content script の報告をそのまま信用せず、次を再確認します。

- message URL / canonical URL
- live `chrome.tabs.get()` URL
- navigation 中でないこと
- documentId
- routeGeneration
- observedAt
- classificationRevision

### `closeTabSafely()`

DEAD / DUPLICATE の共通 close 経路です。

主な guard:

- tab ID が有効
- 同じ tab が closing 中でない
- `autoClosePaused === false`
- live tab が存在
- canonical URL が期待値と一致
- pinned / group でない
- navigation / loading 中でない
- DEAD identity が現在 state と一致
- DUPLICATE survivor が live / stable / 同 canonical / 非 DEAD
- victim / survivor の protection state が計画時と一致

async guard 実行中に pause が切り替わる可能性があるため、**close 開始時だけでなく最終 `tabs.remove()` 直前にも `autoClosePaused` を再確認します。**

Chromium API に conditional remove はないため、最終 `tabs.get()` と `tabs.remove()` の間は完全には atomic にできません。

### Auto-close pause

`chrome.storage.local.autoClosePaused` が global preference です。

- pause 中も classification は継続
- DEAD / DUPLICATE の `closeTabSafely()` は停止
- manual sort は利用可能
- history reopen は利用可能
- Popup state は利用可能
- resume 時、background の storage listener が duplicate reconciliation を起動
- Popup は全 window の managed tabs へ再判定要求を送り、停止中の DEAD を再評価

### Close History

`closeHistory` は local storage に最大 50 件保存します。

user-visible close を storage latency で待たせない設計です。

```text
final live / identity / pause guard
  ↓
pending operation = remove-issued
  ├─ session persistence start
  └─ tabs.remove
       ↓ success
phase=removed persistence
       ↓
closeHistory append
```

local history 書き込み失敗時は memory に残し再試行します。

Worker restart では durable `phase=removed` がある operation だけ成功履歴として復旧します。

### Duplicate reconciliation

- PROTECTED があれば PROTECTED を survivor とし unprotected だけ victim 候補
- PROTECTED がなければ最古 `firstSeenAt`、同値なら小さい tab ID を survivor
- victim ごとに `closeTabSafely()` を通す

### Manual sort

カテゴリ:

```text
0 = 非Gofile
1 = NORMAL Gofile
2 = その他Gofile
```

PROTECTED は固定 barrier。各 movable segment 内だけ stable partition します。

1 move ごとに snapshot を再取得し、tab set / index / pinned / group / protected structure が変われば abort します。

### `popup.js`

責務:

- current window の status count / history 表示
- `RATE_LIMITED` / `LOADING` の live detail 取得
- auto-close pause / resume
- current window の再判定
- manual sort
- history reopen

Popup 自身は `tabs.remove()` を呼びません。

## Persistence

### `chrome.storage.local`

```text
closeHistory
  最大50件の自動 close 履歴

autoClosePaused
  global auto-close pause preference
```

### `chrome.storage.session`

```text
tabMeta
  canonicalUrl + firstSeenAt の compact metadata

pendingCloses
  crash recovery 用 close operation state
```

classification state / navigation version / revision / documentId は durable truth とせず、Worker restart 後に live tabs + content scripts から再構築します。

## External API / security

独自 Gofile API client はありません。

現行 source は Gofile credential / Cookie / Token / Password / Authorization header を独自保存・転送しません。外部 telemetry もありません。

security boundary:

```text
tabs
storage
https://gofile.io/*
```

## 非同期・競合制御

| 仕組み | 目的 |
|---|---|
| `reconciliationChain` | duplicate reconciliation の直列化 |
| `historyWriteChain` | Close History 更新の直列化 |
| `sortChains[windowId]` | window ごとの sort 直列化 |
| `closingTabIds` | 同一 tab の同時 close 防止 |
| `navigationVersions` | navigation を跨いだ stale close 防止 |
| `classificationRevisions` | 新 classification が古い close を無効化 |
| `latestRouteGenerations` | SPA route stale message 防止 |
| `autoClosePaused` double check | pause と進行中 close の競合を安全側へ寄せる |

## 再試行ポリシー

| 事象 | 処理 |
|---|---|
| content → background message 失敗 | `lastSentKey` を解除し、次の DOM change / settle pass で再送可能 |
| Close History local get/set 失敗 | memory に残し約1秒後に再試行 |
| session `tabMeta` 保存失敗 | live tabs を authoritative として継続 |
| `pendingCloses` 保存失敗 | close 後の bookkeeping を可能な範囲で継続 |
| pause 読み込み失敗 | fail-safe で pause |
| tab が消えた / navigation | close / classification / reconciliation 中止 |
| sort 中に構成変更 | abort |
| 判定不能 DOM | `ATTENTION` |
| 429 | `RATE_LIMITED`。自動 retry / reload なし |

## 絶対に壊してはいけない不変条件

1. 肯定的に確認できない状態を DEAD にしない。
2. password / private / 401 / 403 / 429 / 5xx / network / timeout を DEAD として閉じない。
3. pinned / tab group を自動 close しない。
4. PROTECTED を manual sort で move しない。
5. 削除前に live tab / canonical URL / navigation state を再確認する。
6. stale classification / navigation / route generation で削除しない。
7. duplicate victim close 前に survivor を再確認する。
8. unprotected survivor が DEAD の場合、duplicate victim を閉じない。
9. SPA の古い not-found DOM を新 route の DEAD 根拠にしない。
10. 本文中の曖昧な文字列だけで DEAD にしない。
11. CSS で非表示の ancestor 配下を visible signal として扱わない。
12. pause 中は DEAD / DUPLICATE の両方を閉じない。
13. pause は最終 destructive boundary でも確認する。
14. 削除成功を証明できない pending operation を成功履歴へ変換しない。
15. sort 中に snapshot が変わったら abort する。
16. host permission を理由なく Gofile 以外へ広げない。
17. Gofile API / credentials へアクセスする機能を既存仕様の延長として勝手に追加しない。

## 過去に発生した重要な問題

### v1.0.0 前

- pending navigation / stale DEAD race
- duplicate survivor disappearance / state change
- sort 中の protected structure change
- replacement firstSeenAt loss
- Close History storage / restart race
- 広すぎる DEAD text detection
- SPA stale DOM
- storage wait による visible close delay

これらの regression test は削除しないでください。

### v1.1.0 で修正

- CSS hidden ancestor を visible と扱う可能性
- BFCache `pageshow` 後に route poll が再開されない問題
- SPA route ごとの settle reclassification 欠落
- body 全体の status code text による ATTENTION / RATE_LIMITED 誤分類

## テスト

```bash
npm test
```

`tests/*.test.js` を実行します。依存 package はありません。

GitHub Actions:

- `main` push
- `main` 向け pull request
- Node.js 24
- `npm test`

テスト詳細は [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) を参照してください。

## 開発時の変更ルール

開発開始時:

1. README
2. DEVELOPMENT
3. CHANGELOG
4. ARCHITECTURE
5. latest code
6. TEST_RESULTS

機能変更時:

- classification 変更 → signatures / content / regression test を同時確認
- reclassification 変更 → `reclassify.js` が classification logic を複製しないことを維持
- close / duplicate / pause 変更 → `background.js` の generation / identity / pause / recovery guard を確認
- storage schema 変更 → migration / backward compatibility を検討
- permission 追加 → README に security impact を明記
- destructive behavior 拡張 → positive proof と regression test を先に用意

開発終了時:

1. code
2. automated tests
3. README
4. DEVELOPMENT
5. CHANGELOG
6. ARCHITECTURE
7. TEST_RESULTS
8. real-browser validation when relevant

## Release 運用

GitHub Tag / GitHub Release を正式な Version 境界として使用します。

命名規則:

```text
Tag: v<major>.<minor>.<patch>
Title: Gofile Tab Manager v<major>.<minor>.<patch>
```

現在は build 工程・配布バイナリ・Release Asset 生成処理を持ちません。GitHub が自動提供する Source code archive が配布元です。

### 手動リリース手順

1. Release 対象コードを確定。
2. `manifest.json` と `shared/constants.js` の Version 一致を確認。
3. `npm test` と GitHub Actions を確認。
4. 実ブラウザ smoke test を実施。
5. README / DEVELOPMENT / CHANGELOG / ARCHITECTURE / TEST_RESULTS を同期。
6. Release 対象の最終 commit を確定。
7. 最終 commit に `vX.Y.Z` tag を作成。
8. GitHub Release をその tag から作成。
9. Title を `Gofile Tab Manager vX.Y.Z` とする。
10. CHANGELOG と一致する Release notes を設定。
11. Pre-release ではない正式 Release として公開。
12. 公開後、tag / date / source archive / README の Version を確認。

### v1.1.0 release checklist

- [x] `manifest.json` = `1.1.0`
- [x] `shared/constants.js` = `1.1.0`
- [x] GitHub Actions CI 導入済み
- [x] Automated tests success
- [x] 2026-09-15 real-browser verification: no defects found
- [x] README / DEVELOPMENT / CHANGELOG / ARCHITECTURE / TEST_RESULTS synchronized
- [ ] `v1.1.0` tag created
- [ ] GitHub Release `Gofile Tab Manager v1.1.0` published

## License

未設定です。LICENSE / NOTICE はありません。ライセンス選択は project policy / legal decision のため、推測で追加しないでください。
