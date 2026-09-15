# Gofile Tab Manager

Gofile Tab Manager は、Chrome / Microsoft Edge（Chromium）向けの **Manifest V3 ブラウザ拡張**です。

Gofile の `https://gofile.io/d/<contentId>` 形式のコンテンツタブだけを対象に、明確に不存在と確認できたタブの自動クローズ、同一コンテンツの重複タブ整理、現在ウィンドウの手動並び替えを行います。

> [!IMPORTANT]
> Gofile の公式機能・公式拡張ではありません。Gofile とは無関係の非公式ツールです。

現在の安定版は **v1.1.0** です。`manifest.json` と `shared/constants.js` の Version は `1.1.0` で一致しています。

## Release

| 項目 | 内容 |
|---|---|
| 安定版 | `v1.1.0` |
| リリース日 | 2026-09-15 |
| Git tag | `v1.1.0` |
| GitHub Release title | `Gofile Tab Manager v1.1.0` |
| License | MIT License |
| ビルド済みバイナリ | なし |
| 配布形態 | GitHub Release の Source code archive または tag `v1.1.0` のソース |

v1.1.0 では、分類 lifecycle の安全性修正、GitHub Actions CI、Popup の再判定 / 詳細状態表示、自動クローズ一時停止 / 再開を追加しています。変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。

## 主な機能

- 明確に `DEAD` と確認できた Gofile タブを自動で閉じる
- 同一 canonical URL の重複タブを自動で整理する
- pinned / tab group 所属タブを `PROTECTED` として保護する
- Popup から現在ウィンドウの Gofile タブを手動で再判定する
- Popup で `NORMAL` / `RATE_LIMITED` / `LOADING` / `ATTENTION` / `PROTECTED` の状態を確認する
- 自動クローズをグローバルに一時停止 / 再開する
- Popup の操作時だけ、現在ウィンドウのタブを安全に並び替える
- 自動で閉じたタブを直近 50 件まで保存し、Popup から再オープンする

**429 の自動再試行、自動リロード、Gofile API への独自リクエスト、ダウンロード管理は行いません。**

## 主な安全方針

本拡張は「不明なら閉じない」を基本方針にしています。

- password / private / access denied / 401 / 403 / 5xx / network error / timeout は `DEAD` にしません
- 429 / Too Many Requests / rate limit は `RATE_LIMITED` として扱い、閉じません
- 読み込み中や判定途中は `LOADING` とし、閉じません
- 判定不能は最終的に `ATTENTION` とし、閉じません
- pinned タブと tab group 所属タブは `PROTECTED` とし、自動クローズ・重複削除・move の対象にしません
- 削除直前に実タブの URL・navigation 状態・保護状態・分類世代を再確認します
- stale な `DEAD` 判定や古い SPA DOM を根拠に削除しないよう、navigation / document generation を追跡します
- 自動クローズ一時停止中は `DEAD` / `DUPLICATE` の両方を削除しません
- pause 状態は close 開始時と最終 `tabs.remove()` 直前の両方で再確認します
- pause 設定を Service Worker 起動時に読めない場合は安全側に倒して停止扱いにします

## 動作環境

| 項目 | 状態 |
|---|---|
| ブラウザ | Chrome / Microsoft Edge（Chromium）を想定 |
| 拡張方式 | Manifest V3 |
| 対象サイト | `https://gofile.io/*` |
| 管理対象 URL | `https://gofile.io/d/<contentId>` |
| 必要権限 | `tabs`, `storage` |
| Host permission | `https://gofile.io/*` のみ |
| ビルド | 不要 |
| npm 依存パッケージ | なし |
| CI | GitHub Actions / Node.js 24 / `npm test` |
| 実ブラウザ検証 | 2026-09-15 に実施、不具合なし |
| 最小対応ブラウザ Version | 未定義 |

正確な実機ブラウザ Version 番号は記録していないため、最小対応 Version は確定していません。Manifest V3、`chrome.storage.session`、tab group 関連の Tabs API を利用できる Chromium 系ブラウザが必要です。

## インストール

安定版を利用する場合は、GitHub Release `v1.1.0` の **Source code (zip)** を取得して展開する方法を推奨します。Git を利用する場合は tag `v1.1.0` を checkout してください。

### Chrome

1. `v1.1.0` の Source code archive を取得し、任意の場所へ展開します。
2. `chrome://extensions/` を開きます。
3. **デベロッパーモード**を ON にします。
4. **パッケージ化されていない拡張機能を読み込む**を押します。
5. `manifest.json` がある `gofile-tab-manager` フォルダを選択します。

### Microsoft Edge

1. `v1.1.0` の Source code archive を取得し、任意の場所へ展開します。
2. `edge://extensions/` を開きます。
3. **開発者モード**を ON にします。
4. **展開して読み込み**を押します。
5. `manifest.json` がある `gofile-tab-manager` フォルダを選択します。

ビルドや `npm install` は不要です。ブラウザがリポジトリ内の JavaScript / HTML / CSS を直接読み込みます。

## 更新

安定版利用者は、原則として GitHub Release の新しい Version へ更新してください。`main` は将来 Release より先行する可能性があります。

1. 新しい Release の Source code を取得します。
2. 現在と同じ展開先へ上書きします。
3. 拡張機能管理画面を開きます。
4. Gofile Tab Manager の **再読み込み**を実行します。
5. 必要に応じて Gofile の既存タブを再読み込みします。

`chrome.storage.local` / `chrome.storage.session` の引き継ぎは拡張 ID に依存します。展開先フォルダを変更した場合のデータ引き継ぎは保証していないため、更新時は同じ展開先を維持することを推奨します。

## 使用方法

インストール後は通常どおり Gofile を利用します。`https://gofile.io/d/<contentId>` 形式のタブは自動的に監視されます。

### 1. DEAD タブの自動クローズ

現在の実装では、次が揃った場合のみ `DEAD` の肯定的シグナルとして扱います。

- `main#page` 配下に `#fm-root` が存在する
- その中に `This content does not exist` と一致する可視 `h1` がある
- ページタイトルが `Content not found` または `Content not found · Gofile` と一致する
- password / private / 401 / 403 / 429 / 5xx 等の非 DEAD 条件に該当しない
- 現在の route generation に対応する新しい DOM である

可視性は対象要素だけでなく祖先 chain の computed style も確認します。Gofile 側の DOM が変わり条件を満たせなくなった場合は、安全側に倒れて原則 `ATTENTION` になります。

### 2. 重複タブの自動整理

対象 URL は次の形式へ canonicalize します。

```text
https://gofile.io/d/<contentId>
```

- query を除去
- fragment を除去
- 末尾 `/` を除去
- `contentId` の大文字・小文字は維持
- `https://gofile.io` 以外は対象外

同一 canonical URL が複数ある場合、通常は最も古く認識された非 PROTECTED タブを残します。PROTECTED が含まれる場合は PROTECTED を優先して残し、非 PROTECTED だけを削除します。PROTECTED 同士は削除しません。

### 3. 自動クローズの一時停止 / 再開

Popup の **自動クローズ一時停止** を押すと、分類自体は継続したまま `DEAD` / `DUPLICATE` の自動削除だけを停止します。

停止中も次は利用できます。

- 状態表示
- 手動再判定
- 手動並び替え
- Recent auto-closed の再オープン

**自動クローズ再開**を押すと、全ウィンドウの管理対象 Gofile タブを再判定します。停止中に残っていた `DEAD` も再評価対象になります。

### 4. 手動再判定

Popup の **再判定**を押すと、現在ウィンドウの管理対象 Gofile タブを再判定します。

再判定用の `reclassify.js` は分類ロジックを複製せず、`content.js` の既存 MutationObserver / debounce / route-generation guard 経路を再利用します。

### 5. 現在ウィンドウの手動並び替え

Popup の **並び替え**を押した時だけ現在ウィンドウを整理します。自動並び替えは行いません。

基本順序:

1. 非 Gofile
2. `NORMAL` Gofile
3. その他 Gofile（`RATE_LIMITED` / `LOADING` / `ATTENTION` など）

各グループ内の相対順序は維持します。PROTECTED は固定 barrier として扱われ、その位置を跨いだ move は行いません。並び替え中にタブ構成や保護状態が変わった場合は古い計画を中止します。

### 6. Recent auto-closed

Popup の **Recent auto-closed** には、自動クローズされた `DEAD` / `DUPLICATE` タブが新しい順に最大 50 件表示されます。

**再オープン**を押すと保存 URL を新しいタブとして開きます。過去の tab ID は再利用せず、URL も管理対象形式か再検証します。

## 状態の意味

| 状態 | 意味 | 自動クローズ |
|---|---|---|
| `NORMAL` | 正常な Gofile コンテンツと判断 | しない |
| `DEAD` | 現行の not-found gate を肯定的に確認 | 対象。ただし PROTECTED / pause 中は除外 |
| `RATE_LIMITED` | 429 / rate limit を検出 | しない |
| `LOADING` | 読み込み中・route 切替直後・判定待ち | しない |
| `ATTENTION` | 認証、権限、通信失敗、判定不能など | しない |
| `PROTECTED` | pinned または tab group 所属 | しない。move もしない |

`PROTECTED` は content script のページ分類ではなく、background / Popup がブラウザのタブ属性から判断します。

## Popup の表示

現在ウィンドウについて次の件数を表示します。

- `NORMAL`
- その他 Gofile
- `RATE_LIMITED`
- `LOADING`
- `ATTENTION`
- `PROTECTED`

操作:

- **自動クローズ一時停止 / 再開**
- **再判定**
- **並び替え**
- Recent auto-closed の **再オープン**

## データと保存先

本拡張はブラウザの extension storage だけを使用します。

| Storage | Key | 内容 |
|---|---|---|
| `chrome.storage.local` | `closeHistory` | 自動クローズ履歴。最大 50 件 |
| `chrome.storage.local` | `autoClosePaused` | グローバルな自動クローズ一時停止状態 |
| `chrome.storage.session` | `tabMeta` | `canonicalUrl` と `firstSeenAt` の簡易メタデータ |
| `chrome.storage.session` | `pendingCloses` | クローズ処理の復旧用状態 |

認証情報、Gofile の Cookie、Access Token、Password、API Key を本拡張独自の storage へ保存する実装はありません。

## 再起動・復旧

Manifest V3 Service Worker が再起動した場合、background は全 live tab を再取得し、保存済み `firstSeenAt` を利用できる場合だけ引き継ぎつつ、分類状態を `LOADING` に戻して content script から再分類します。

`autoClosePaused` は local storage から復元します。読み込みに失敗した場合は destructive behavior を安全側に止めるため pause 扱いにします。

自動クローズ履歴の保存途中で Worker が停止した場合は `pendingCloses` を利用して復旧します。ただし、`tabs.remove` 成功後から `removed` フェーズを session storage へ保存するまでの間に Worker が停止した場合、成功を証明できないため履歴を復元しません。

## エラー時の挙動

- classification message 失敗時は次の DOM change / settle pass で再送可能に戻す
- Close History の local storage 書き込み失敗時は memory に保留し約 1 秒後に再試行
- navigation 中の古い分類は受理しない
- 並び替え中にタブ集合や PROTECTED 構造が変化した場合は中止
- 判定不能 / 想定外 DOM は削除せず `ATTENTION`
- pause 設定読み込み失敗時は自動クローズを停止

## セキュリティと権限

`manifest.json` の権限は次だけです。

```text
tabs
storage
host: https://gofile.io/*
```

独自の `fetch` / `XMLHttpRequest` による外部 API 通信、テレメトリ送信、認証情報保存処理はありません。

content script は SPA 内で管理対象ページへ出入りする route change を検知するため Gofile origin 全体で待機しますが、自動整理の管理対象は `https://gofile.io/d/<contentId>` 形式だけです。

## 技術概要

```text
Gofile page
   ↓ DOM / route監視
content.js + reclassify.js
   ↓ classification / route message
background.js
   ├─ DEAD / duplicate safety guard → tabs.remove
   ├─ pause state
   ├─ Popup要求 → 状態集計 / sort / reopen
   └─ storage.local / storage.session
        ↑
popup.js ─ runtime / tabs message
```

主要構成:

```text
gofile-tab-manager/
├─ .github/workflows/test.yml
├─ LICENSE
├─ manifest.json
├─ background.js
├─ content.js
├─ reclassify.js
├─ popup.html
├─ popup.js
├─ popup.css
├─ shared/
│  ├─ constants.js
│  ├─ signatures.js
│  └─ url.js
├─ icons/
├─ tests/
│  ├─ regression.test.js
│  ├─ safety-invariants.test.js
│  ├─ popup-features.test.js
│  ├─ auto-close-pause.test.js
│  └─ TEST_RESULTS.md
├─ README.md
├─ DEVELOPMENT.md
├─ CHANGELOG.md
└─ docs/ARCHITECTURE.md
```

## テスト

```bash
npm test
```

`tests/*.test.js` を Node.js 24 で実行します。GitHub Actions でも push / pull request ごとに同じテストを実行します。

2026-09-15 に v1.1.0 リリース候補の実ブラウザ検証を行い、不具合なしを確認しています。詳細は [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) を参照してください。

## 既知の制限

- ブラウザ最小対応 Version は未定義
- `tabs.get` による最終確認と `tabs.remove` の間は Chromium API 上原子的ではない
- `tabs.remove` 成功直後、`removed` phase 保存前に Worker が停止した場合は Close History を復元できない
- PROTECTED が固定 barrier になるため、window 全体が完全な理想順にならない場合がある
- Gofile の DOM / title 構造変更時は安全側に倒れて自動削除できなくなる可能性がある

## トラブルシューティング

### DEAD のはずのタブが閉じない

自動クローズ一時停止、PROTECTED、`LOADING` / `ATTENTION`、Gofile DOM 変更を確認してください。まず Popup の状態と pause ボタンを確認し、必要なら **再判定**を実行してください。

### 重複タブが残る

一方が pinned / tab group、navigation 中、pause 中、または URL の `<contentId>` が異なる可能性があります。query / fragment の違いだけなら同一 canonical URL として扱われます。

### 並び替えが途中で中止される

並び替え中にタブ追加・削除・group化・pin 状態変更が発生すると古い plan を中止します。タブ操作が落ち着いてからもう一度 **並び替え**を押してください。

### Recent auto-closed に履歴が出ない

local storage の一時失敗は自動再試行します。Worker 停止が「削除成功を証明できない残余窓」に入った場合は、誤った成功履歴を作らないため復元しません。

## 開発者向け資料

- [DEVELOPMENT.md](DEVELOPMENT.md) — 実装内部、保守ルール、安全上の不変条件、デバッグ、リリースチェック
- [CHANGELOG.md](CHANGELOG.md) — バージョン履歴
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — コンポーネント、データフロー、競合対策
- [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) — 自動テストと実ブラウザ検証記録

## License

このプロジェクトは **MIT License** で提供されます。詳細は [LICENSE](LICENSE) を参照してください。

Copyright (c) 2026 Hoyomaru
