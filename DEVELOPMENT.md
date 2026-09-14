# DEVELOPMENT.md

Gofile Tab Manager の開発・保守・AI引き継ぎ用ドキュメントです。

このファイルでは README より内部実装寄りの情報を扱います。利用方法は [README.md](README.md)、バージョン履歴は [CHANGELOG.md](CHANGELOG.md)、全体のデータフローは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、回帰テストの記録は [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) を参照してください。

## 現在の状態

| 項目 | 状態 |
|---|---|
| Manifest version | 3 |
| アプリ Version | `1.0.0` |
| 安定版 | `v1.0.0` |
| 初回正式リリース日 | 2026-09-14 |
| Release / Tag 識別子 | `v1.0.0` |
| GitHub Release 運用 | 手動公開 |
| Version 定義 | `manifest.json` / `shared/constants.js` |
| 実装の主要安全修正基準 commit | `862eab6c2df9aa22618a0cdd565cdcae8ad0607f` |
| 上記 commit 日時 | 2026-09-10 |
| default branch | `main` |
| GitHub Actions | 未導入 |
| License | 未設定 |

v1.0.0 は、2026-09-07 の初回実装、その後の tab lifecycle safety 修正、2026-09-10 の DEAD detection / close race 修正、2026-09-14 の正式リリース用ドキュメント整備をまとめた最初の正式リリースです。

実装仕様を追う場合は、Release note や古い説明より、まず `manifest.json`、`shared/constants.js`、`background.js`、`content.js`、`tests/regression.test.js` の該当 release / 現行版を正としてください。

### 現在の主要機能

- `https://gofile.io/d/<contentId>` タブの分類
- 肯定的に確認できた `DEAD` タブの自動クローズ
- canonical URL が同じ重複タブの自動整理
- pinned / tab group 所属タブの保護
- Popup から現在ウィンドウだけを手動 stable partition
- 自動クローズ履歴を最大 50 件保持し再オープン
- Service Worker 再起動時の live tab 再同期と一部クローズ履歴復旧

### 実機検証状況

`tests/TEST_RESULTS.md` に記録された Node 回帰テスト結果は **21 passed, 0 failed（Node.js v24.19.0）** です。

ただし以下は実ブラウザ確認が必要と記録されています。

- Chrome / Edge へ unpacked Manifest V3 拡張としてロードできること
- 現在の Gofile 実 DOM で not-found gate / 正常画面を正しく分類できること
- 実 Tabs API のイベント順、複数 window、pinned、tab group、redirect、BFCache
- Service Worker の停止・再起動
- 大量タブでの close / Popup / reopen
- `tabs.get` 最終検証と `tabs.remove` 間の残余競合

2026-09-14 のリリース用ドキュメント整理環境では GitHub をローカル clone できなかったため、テストは独自再実行していません。上記はリポジトリ内に保存された確認結果です。

## アーキテクチャ概要

本拡張はビルド工程を持たない Manifest V3 拡張です。

```text
Gofile page
  │
  │ DOM / History API / URL poll
  ▼
content.js
  │ TAB_CLASSIFICATION / TAB_ROUTE_CHANGED
  ▼
background.js (Service Worker)
  ├─ tabMeta / generation guards
  ├─ DEAD close
  ├─ duplicate reconciliation
  ├─ manual sort
  ├─ reopen history
  └─ chrome.storage.local / session
  ▲
  │ GET_POPUP_STATE / SORT_CURRENT_WINDOW / REOPEN_HISTORY_ITEM
  │
popup.js
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

重要事項:

- host permission を Gofile 以外へ広げない
- content script は Gofile origin 全体で待機するが、管理対象 URL 自体は `/d/<contentId>` に限定する

### `shared/constants.js`

責務:

- Version
- 状態値
- Close reason
- Storage key
- History 上限
- classification timing
- Runtime message type

主要定数:

```text
VERSION = 1.0.0
HISTORY_LIMIT = 50
CLASSIFY_DEBOUNCE_MS = 800
CLASSIFY_SETTLE_MS = 12000
```

状態:

```text
NORMAL
DEAD
RATE_LIMITED
LOADING
ATTENTION
PROTECTED
```

`PROTECTED` は background がタブ属性から判定する概念です。content script の通常分類結果として採用しません。

### `shared/url.js`

責務:

- 管理対象 URL の解析
- canonical URL 生成

受理条件:

- protocol は HTTPS
- hostname は `gofile.io`（比較時は lower-case）
- port は未指定または `443`
- pathname は `/d/<contentId>` または末尾 `/` 付き
- 追加 path segment は不可

canonicalization:

```text
https://gofile.io/d/<contentId>
```

query / fragment / trailing slash は除去し、`contentId` の大小文字は維持します。

### `shared/signatures.js`

責務:

- DEAD にしてはいけない注意文言
- 429 / rate limit 文言
- DEAD gate の DOM / title signature
- NORMAL の肯定的 DOM signature
- LOADING signature

現行 DEAD gate は以下を同時に要求します。

```text
main#page #fm-root
main#page #fm-root h1 = "This content does not exist"
document.title = "Content not found" または "Content not found · Gofile"
```

これらの条件を安易に弱めないでください。過去に本文全体や広い error text を根拠にした誤判定が問題になっています。

### `content.js`

責務:

- Gofile origin 上で route を監視
- DOM を安全側に分類
- route change / classification を background へ通知
- background からの `REQUEST_CLASSIFICATION` へ応答

#### `classifyDocument()`

概略順序:

1. 管理対象 URL か確認
2. body 未描画なら `LOADING`、12 秒経過後は `ATTENTION`
3. route 切替後に新 render をまだ見ていなければ `LOADING`
4. password/private/401/403/network/5xx 等を `ATTENTION`
5. 429/rate limit を `RATE_LIMITED`
6. 12 秒以内で loading indicator があれば `LOADING`
7. 正常 folder/file の肯定的 DOM があれば `NORMAL`
8. 現在 route の新しい not-found gate があれば `DEAD`
9. 12 秒以内なら `LOADING`
10. それ以外は `ATTENTION`

順序は安全上重要です。error 文言を含む正常ファイル名、password gate、429、loading を DEAD より先に除外します。

#### route generation

Gofile は SPA として同一 document 内で URL が変わる可能性があります。

`content.js` は次で route change を監視します。

- `history.pushState`
- `history.replaceState`
- `popstate`
- `hashchange`
- 250ms poll
- `pageshow`

route change ごとに `routeGeneration` を更新し、古い DOM を新 URL の DEAD 根拠にしないようにします。

MutationObserver の未配送 records は generation 更新前に `takeRecords()` で処理します。これは A の not-found DOM が A→B の直前に追加された場合、それを B の証拠として誤帰属しないためです。

#### immediate DEAD notification

現在 generation の完全な not-found gate が MutationObserver で確定した場合は通常の 800ms debounce を待たずに `sendClassification()` します。ただし `classifyDocument()` の安全条件は必ず再評価されます。

### `background.js`

本プロジェクトの中心です。

責務:

- Service Worker 初期化
- live tab authoritative state の取得
- classification の受理・世代管理
- DEAD close
- duplicate reconciliation
- manual sort
- Popup state
- Close History / crash recovery

主要な in-memory state:

| 変数 | 用途 |
|---|---|
| `tabMeta` | 管理タブの現在メタデータ |
| `closingTabIds` | 同じ tab の二重 close 防止 |
| `pendingCloseOperations` | close の復旧用操作状態 |
| `unsavedHistoryEntries` | local storage 保存待ち履歴 |
| `navigationVersions` | navigation 世代 |
| `classificationRevisions` | background が採用した分類世代 |
| `latestRouteGenerations` | document ごとの最新 route generation |
| `sortChains` | window 単位の sort 直列化 |
| `historyWriteChain` | Close History 書き込み直列化 |
| `reconciliationChain` | duplicate reconciliation 直列化 |

#### `initializeFromLiveTabs()`

1. `chrome.tabs.query({})` で全 live tab を取得
2. `chrome.storage.session.tabMeta` から過去の `firstSeenAt` を可能な範囲で復元
3. 分類状態は `LOADING` にリセット
4. pending close を復旧
5. session metadata を保存
6. content script へ分類問い合わせ
7. duplicate reconciliation

**live tab が正です。session storage は補助情報です。**

#### `applyClassification()`

message の URL と canonical URL を再計算して照合し、さらに `chrome.tabs.get()` で live tab の現在 URL / loading 状態を確認します。

次の stale 条件を拒否します。

- message URL と canonical URL が一致しない
- live tab が別 URL へ移動した
- tab が navigation 中
- route generation が古い
- documentId が既知の document と食い違う
- observedAt が同 generation の過去値

分類を採用するたび `classificationRevision` を進めます。

#### `closeTabSafely()`

DEAD / DUPLICATE の共通 close 経路です。

削除直前まで次を確認します。

- tab ID が有効
- 同じ tab を別 close が処理中でない
- `chrome.tabs.get()` で live tab が存在
- canonical URL が期待値と一致
- pinned / group ではない
- pending navigation / loading ではない
- DEAD の場合は navigationVersion / classificationRevision / documentId / routeGeneration が候補と一致
- DUPLICATE の場合は survivor も live で同じ canonical URL、navigation 中でなく、必要なメタデータが変化していない
- unprotected survivor が `DEAD` 化していない
- victim / survivor の pinned / group 状態が計画時から変わっていない

duplicate guard を確認したあと victim をもう一度 `chrome.tabs.get()` して、最後の非原子的チェックを行います。

Chromium API に conditional remove はないため、**この最終チェックと `tabs.remove()` の間の競合を完全には消せません。**

#### Close History の書き込み順

現在の設計は user-visible close を storage より待たせない方針です。

```text
最終 live/guard 検証
  ↓
pending close を memory に登録 (phase=remove-issued)
  ├─ session storage への保存を開始
  └─ tabs.remove を開始
       ↓ success
      tabMeta 削除
       ↓
pending intent の保存完了を待つ
       ↓
phase=removed を session 保存
       ↓
chrome.storage.local.closeHistory へ追加
```

`tabs.remove` 成功後に local history 保存が失敗しても `unsavedHistoryEntries` に残し、約 1 秒後に再試行します。

Worker 再起動後は `phase === 'removed'` が durable に残っている operation だけ成功済み履歴として復旧します。

`remove-issued` のまま tab が消えていても、別要因で閉じられた可能性を排除できないため成功履歴へ変換しません。

#### duplicate reconciliation

canonical URL ごとにグループ化します。

- PROTECTED が 1 件以上ある場合: PROTECTED は残し、unprotected だけ victim 候補
- PROTECTED がない場合: `firstSeenAt` が最小の tab、同値なら tab ID が小さい tab を survivor
- victim ごとに `closeTabSafely()` で再検証して削除

#### manual sort

カテゴリ:

```text
0 = 非Gofile
1 = NORMAL Gofile
2 = その他Gofile
```

`splitIntoMovableSegments()` が PROTECTED を barrier として movable segment を分割し、各 segment 内だけ stable partition します。

1 回の move ごとに window の snapshot を取り直し、tab 集合・index・pinned・group・PROTECTED 構造が変わったら abort します。

window 単位に `sortChains` で直列化するため、複数の sort 要求が同じ window で同時実行されません。

### `popup.js`

責務:

- active tab から現在 window ID を取得
- background から state count / history を取得
- manual sort を要求
- history item の reopen を要求

Popup は destructive decision を独自に行いません。close / sort / URL 検証の実体は background にあります。

## 状態遷移

```text
route開始
   ↓
LOADING
   ├─ 正常DOM確認 ─────────→ NORMAL
   ├─ 429確認 ────────────→ RATE_LIMITED
   ├─ 認証/権限/通信問題 ─→ ATTENTION
   ├─ 現routeのDEAD gate ─→ DEAD ─→ 最終guard ─→ close
   └─ 12秒経過して不明 ───→ ATTENTION
```

navigation が始まると旧 classification は無効化され、新しい世代の `LOADING` へ戻ります。

## 永続化

### `chrome.storage.local.closeHistory`

自動 close した DEAD / DUPLICATE のユーザー向け履歴です。最大 50 件です。

主な entry:

```text
url
canonicalUrl
reason
closedAt
title
sourceTabId
closeId
```

`sourceTabId` は履歴情報であり、再オープン時に再利用しません。

### `chrome.storage.session.tabMeta`

保存内容は意図的に最小限です。

```text
{
  [tabId]: {
    canonicalUrl,
    firstSeenAt
  }
}
```

classification state、navigationVersion、revision、documentId 等は session 復旧後に live tab と content script から再構築します。

### `chrome.storage.session.pendingCloses`

close 復旧用です。operation には概ね `operationId`、`phase`、`entry` を保存します。現行 phase は通常 `remove-issued` → `removed` です。

## 外部 API / 外部通信

本プロジェクト独自の Gofile API 呼び出しはありません。

現行ソースに `fetch` / `XMLHttpRequest` はなく、Endpoint / HTTP Method / Request / Response を管理するコードもありません。

使用する外部境界は以下です。

- Gofile ページ DOM
- `chrome.tabs`
- `chrome.storage`
- `chrome.runtime` messaging

Gofile の Cookie / Token / Password / Authorization header を読み取り、独自保存・転送する実装はありません。

## 認証・署名

独自認証・署名処理はありません。

`shared/signatures.js` の "signatures" は認証署名ではなく、DOM/text classification 用の判定パターンです。

## Queue / 非同期処理

専用 Queue ライブラリは使っていません。Promise chain と Set/Map で競合を制御しています。

| 仕組み | 目的 |
|---|---|
| `reconciliationChain` | duplicate reconciliation を直列化 |
| `historyWriteChain` | Close History 更新を直列化 |
| `sortChains[windowId]` | window ごとに sort を直列化 |
| `closingTabIds` | 同一 tab の同時 close 防止 |
| `navigationVersions` | navigation を跨いだ stale close 防止 |
| `classificationRevisions` | 新しい classification が古い close を無効化 |
| `latestRouteGenerations` | SPA route の stale message 防止 |

Lease / heartbeat はありません。

## 再試行ポリシー

| 事象 | 現行処理 |
|---|---|
| content → background message 失敗 | `lastSentKey` を解除し、次の DOM change / settle pass で再送可能にする |
| Close History local get/set 失敗 | memory に残し、約 1 秒後に再試行 |
| session `tabMeta` 保存失敗 | 無視。live tabs を authoritative とする |
| `pendingCloses` session 保存失敗 | close 自体を必ずしも止めない。後続 bookkeeping を試行 |
| tab が消えた / navigation した | close / classification / reconciliation を中止 |
| sort 中に構成変更 | abort。古い plan を継続しない |
| 判定不能 DOM | `ATTENTION`。削除しない |
| 429 | `RATE_LIMITED`。自動 retry / reload しない |

## クラッシュリカバリ

Service Worker 起動時:

1. 全 live tabs を取得
2. session `tabMeta` を読み込む
3. canonical URL が同じ tab の `firstSeenAt` だけ引き継ぐ
4. state は `LOADING` へ reset
5. `pendingCloses` を確認
6. live tab が残っている close operation は成功履歴にしない
7. live tab が消えていて、かつ durable な `phase=removed` がある operation だけ history 保存対象へ戻す
8. content scripts へ分類問い合わせ
9. duplicate reconciliation

重要な残余窓:

`tabs.remove()` が成功した直後、`phase=removed` の session 保存前に Worker が停止すると、その成功を再起動後に証明できません。その場合は **履歴を復元しない**設計です。

## 絶対に壊してはいけない不変条件

以下は便利さや速度のために弱めないでください。

1. **肯定的に確認できない状態を DEAD にしない。** 不明は `ATTENTION`、処理途中は `LOADING`。
2. **password / private / 401 / 403 / 429 / 5xx / network / timeout を DEAD として閉じない。**
3. **pinned / tab group 所属タブを自動 close しない。**
4. **PROTECTED を manual sort で move しない。** barrier を跨いだ再配置もしない。
5. **削除前に live tab を再取得し、canonical URL と navigation 状態を再確認する。**
6. **古い classification revision / navigation version / document generation で削除しない。**
7. **duplicate victim を閉じる直前に survivor の生存・URL・状態も再確認する。**
8. **unprotected survivor が DEAD 化している状態で duplicate victim を閉じない。** 最後の有効 tab を失う可能性がある。
9. **SPA の古い not-found DOM を新 route の DEAD 根拠にしない。**
10. **本文中の "not found" のような曖昧な文言だけで DEAD にしない。** 正常ファイル名等と衝突する。
11. **storage 保存完了を user-visible close の必須前提に戻す場合は、速度とクラッシュ意味論を再検証する。**
12. **削除成功を証明できない pending operation を成功履歴へ変換しない。**
13. **sort 中に snapshot が変わったら abort する。** 古い計画を続行しない。
14. **host permission を理由なく Gofile 以外へ広げない。**
15. **Gofile API や認証情報へアクセスする機能を、既存仕様の延長として勝手に追加しない。**

## 過去に発生した重要な問題

v1.0.0 の正式リリース日は 2026-09-14 です。以下の 2026-09-07 / 2026-09-10 の修正は **v1.0.0 公開前に取り込まれた修正**であり、別 Version のリリースではありません。

### 2026-09-07 — tab lifecycle safety 修正

Commit: `a8db44c20539ea99c76ca8581ea7089160ca2904`

確認できる主な問題:

- pending navigation 中に旧 URL の分類を使える余地
- stale DEAD が新しい NORMAL / ATTENTION / LOADING より後から close へ進む競合
- duplicate survivor が await 中に消える / navigation する競合
- sort 中に protected 構造が変わった場合の stale plan
- replacement tab で firstSeenAt を失う問題
- Close History の storage 失敗、並行 close、worker restart への耐性不足

修正の方向:

- navigationVersion / classificationRevision / route generation を導入
- duplicate victim / survivor の再検証
- pending close operation と history retry を導入
- sort snapshot / protected structure 検証と window 単位直列化
- replacement 時に同一 canonical URL の firstSeenAt のみ継承
- 回帰テストを追加

再発防止:

- `tests/regression.test.js` の navigation / stale DEAD / duplicate / sort / replacement / Close History テストを維持する
- async 境界を追加する変更では、await 前後に identity が変わり得る前提でテストする

### 2026-09-10 — Gofile DEAD detection / close race 修正

Commit: `862eab6c2df9aa22618a0cdd565cdcae8ad0607f`

確認できる主な問題:

- 広すぎる DEAD text 判定による誤検出
- SPA route 後に古い DOM を新 route へ誤帰属する可能性
- 実 Gofile not-found gate / NORMAL DOM への適合不足
- DEAD 判定から `tabs.remove` まで session storage 書き込みを待つことによる遅延
- page-world の route change を content script 側 history hook だけで取り切れない場合

修正の方向:

- `main#page` / `#fm-root` / exact h1 / page title の組み合わせへ DEAD signal を限定
- NORMAL folder/file DOM を肯定的に確認
- route poll を追加
- fresh DOM generation 管理を強化
- 完全な current-route DEAD gate は debounce を待たず通知
- 最終 live guard 後、pending close intent / tab metadata の session 保存を `tabs.remove` の前提にしない

再発防止:

- exact not-found gate と正常 folder/file の両方を fixture 化したテストを維持する
- file name / hidden DOM / modal / toast / loading / 401 / 403 / 429 / 5xx が DEAD にならないテストを削除しない
- performance 改善で安全 guard を省略しない

## デバッグ

### 回帰テスト

```bash
npm test
```

または:

```bash
node --test tests/regression.test.js
```

テストは Node 標準モジュールだけで動作し、依存 package はありません。

`GFTM_SOURCE=HEAD` を指定すると、test file は `git show HEAD:<file>` からソースを読むモードを持ちます。`tests/TEST_RESULTS.md` では過去の修正前再現確認に利用した記録があります。

### Browser Developer Tools

調査時に確認する場所:

- Gofile tab の DevTools: DOM / `document.title` / content script 相当の分類条件
- `chrome://extensions/` / `edge://extensions/`: Service Worker の inspect / error
- Popup DevTools: runtime message / UI error
- Extension storage: `closeHistory`, `tabMeta`, `pendingCloses`

秘密情報をログへ追加しないでください。特に Cookie / Token / Authorization / password 入力値を問題報告用ログへ保存しないでください。

### DEAD 判定を調べる場合

まず現在の実 Gofile not-found page を観察し、次を確認します。

```text
main#page
└─ #fm-root
   └─ h1: This content does not exist

document.title: Content not found [· Gofile]
```

DOM が変わっていても、最初から selector を広くしないでください。

1. 実 DOM を確認
2. 誤検出しそうな正常画面を列挙
3. regression test を先に追加
4. positive signal を可能な限り限定して更新
5. 401/403/429/5xx/password/loading/normal fixture を全て再実行

の順で進めてください。

## テスト構成

`tests/regression.test.js` は実ソースを Node `vm` へ読み込み、簡易 DOM / Chrome API mock を使います。

確認範囲は `tests/TEST_RESULTS.md` に整理されています。

主なカテゴリ:

- manifest host scope
- DEAD / NORMAL classification
- immediate DEAD notification
- SPA route generation
- duplicate survivor revalidation
- PROTECTED
- pending navigation
- fast close
- stale classification cancellation
- replacement
- manual sort
- Close History failure / concurrency / recovery

テストコードの fixture が実サイト仕様そのものとは限りません。Gofile の DOM 変更時は fixture と実ページを両方確認してください。

## 開発時の変更ルール

開発開始時:

1. `README.md`
2. `DEVELOPMENT.md`
3. `CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. 最新コード
6. `tests/TEST_RESULTS.md`

を確認してください。

機能変更時:

- classification 条件を変えるなら `shared/signatures.js` と `content.js` と regression test を同時に確認
- close / duplicate を変えるなら `background.js` の generation / guard / recovery を確認
- storage schema を変えるなら migration / backward compatibility の必要性を先に検討
- manifest permission を増やす場合は必要性とセキュリティ影響を README に明記
- destructive behavior を広げる変更は「便利だから」で実施しない

開発終了時:

1. コード
2. regression test
3. `README.md`
4. `DEVELOPMENT.md`
5. `CHANGELOG.md`
6. 必要なら `docs/ARCHITECTURE.md`
7. `tests/TEST_RESULTS.md`

を同期してください。

## リリース運用

v1.0.0 から、GitHub Tag / GitHub Release を正式な Version 境界として使用します。

Release の命名規則:

```text
Tag: v<major>.<minor>.<patch>
Title: Gofile Tab Manager v<major>.<minor>.<patch>
```

v1.0.0:

```text
Tag: v1.0.0
Title: Gofile Tab Manager v1.0.0
Release date: 2026-09-14
```

現在は build 工程・配布バイナリ・Release Asset 生成処理を持ちません。GitHub が自動提供する Source code archive が配布元です。

安定版利用者向け README は Release / tag を基準にし、`main` は将来 Release より先行する可能性があるものとして扱います。

### 手動リリース手順

1. Release 対象コードを確定する。
2. `manifest.json` と `shared/constants.js` の Version が一致することを確認する。
3. 回帰テストと可能な実ブラウザ smoke test を行う。
4. `README.md`、`DEVELOPMENT.md`、`CHANGELOG.md`、必要な docs / test results を同期する。
5. Release 対象の最終 commit を確定する。
6. 最終 commit に `vX.Y.Z` tag を作成する。
7. GitHub Release を tag `vX.Y.Z` から作成する。
8. Release title を `Gofile Tab Manager vX.Y.Z` とする。
9. CHANGELOG と一致する Release notes を設定する。
10. Pre-release ではない正式 Release として公開する。
11. 公開後、Release の tag / date / Source code archive が正しいことを確認する。
12. README / DEVELOPMENT / CHANGELOG の Release 情報と公開内容を再照合する。

## リリース前チェックリスト

- [ ] `manifest.json` の Version を確認
- [ ] `shared/constants.js` の `VERSION` を確認
- [ ] 2 箇所の Version が一致
- [ ] `npm test` が PASS
- [ ] Chrome unpacked load smoke test
- [ ] Edge unpacked load smoke test（対象に含める場合）
- [ ] 実 Gofile の NORMAL / DEAD / password/private / 429 を可能な範囲で smoke test
- [ ] pinned / tab group が閉じられないことを確認
- [ ] duplicate survivor が残ることを確認
- [ ] manual sort が現在 window のみで動くことを確認
- [ ] Recent auto-closed / reopen を確認
- [ ] Service Worker 再起動を確認
- [ ] `README.md` 更新
- [ ] `DEVELOPMENT.md` 更新
- [ ] `CHANGELOG.md` 更新
- [ ] `tests/TEST_RESULTS.md` 更新
- [ ] Release 対象 commit を確定
- [ ] `vX.Y.Z` Tag 作成
- [ ] GitHub Release 作成
- [ ] Release title / notes / date を確認
- [ ] Source code archive から `manifest.json` が取得できることを確認

## 既知制限

- Browser 実機での残余競合を Node mock だけでは完全再現できない
- final `tabs.get` と `tabs.remove` の間は原子的でない
- remove 成功後、`removed` phase 永続化前に Worker が停止すると履歴復元不能
- Gofile DOM 依存のため、サイト変更で自動 close が安全側に停止する可能性がある
- PROTECTED barrier により全体完全 sort にならないことがある

## 未確認事項

- Chrome / Edge の正確な最小対応 version
- 現時点の Gofile 本番 DOM との実機一致
- unpacked extension をフォルダ移動した場合の storage 引き継ぎ
- uninstall 後の extension storage の実ブラウザ上の削除タイミング
- 大量タブ時の性能上限
- v1.0.0 より後の versioning cadence / release frequency

## 現在の不要ファイル調査

調査対象 tree には、以下のような明確な不要物は確認できませんでした。

- `.bak` / `.tmp`
- debug log
- cache
- 古い archive
- 重複バイナリ
- 古い workflow
- build artifact
- package lock（依存 package 自体なし）

`tests/TEST_RESULTS.md` は重複資料ではなく、実行結果と browser-only 検証項目の記録として維持価値があります。

現時点で削除推奨ファイルはありません。
