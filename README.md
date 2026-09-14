# Gofile Tab Manager

Gofile Tab Manager は、Chrome / Microsoft Edge（Chromium）向けの **Manifest V3 ブラウザ拡張**です。

Gofile の `https://gofile.io/d/<contentId>` 形式のコンテンツタブだけを対象に、明確に不存在と確認できたタブの自動クローズ、同一コンテンツの重複タブ整理、現在ウィンドウの手動並び替えを行います。

> [!IMPORTANT]
> Gofile の公式機能・公式拡張ではありません。Gofile とは無関係の非公式ツールです。

現在の安定版は **v1.0.0** です。初回正式リリース日は **2026-09-14** とし、`manifest.json` と `shared/constants.js` の Version は `1.0.0` で一致しています。

## Release

| 項目 | 内容 |
|---|---|
| 安定版 | `v1.0.0` |
| 正式リリース日 | 2026-09-14 |
| Git tag | `v1.0.0` |
| GitHub Release title | `Gofile Tab Manager v1.0.0` |
| ビルド済みバイナリ | なし |
| 配布形態 | GitHub Release の Source code archive または tag `v1.0.0` のソース |

v1.0.0 は、2026-09-07 の初回実装、その後の tab lifecycle safety 修正、2026-09-10 の DEAD 判定・close race 修正、および 2026-09-14 のドキュメント整備を含む最初の正式リリースです。

変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。

## このツールが解決する問題

多数の Gofile コンテンツをタブで開いていると、削除済みコンテンツ、同じコンテンツの重複、確認が必要なタブが混在しやすくなります。本拡張は、誤削除を避けることを優先しながら次の整理を行います。

- 明確に `DEAD` と確認できた Gofile タブを自動で閉じる
- 同一 canonical URL の重複タブを自動で整理する
- pinned / tab group 所属タブを `PROTECTED` として保護する
- Popup の操作時だけ、現在ウィンドウのタブを安全に並び替える
- 自動で閉じたタブを直近 50 件まで保存し、Popup から再オープンできるようにする

**429 の再試行、自動リロード、Gofile API への独自リクエスト、ダウンロード管理を行う拡張ではありません。**

## 主な安全方針

本拡張は「不明なら閉じない」を基本方針にしています。

- password / private / access denied / 401 / 403 / 5xx / network error / timeout は `DEAD` にしません
- 429 / Too Many Requests / rate limit は `RATE_LIMITED` として扱い、閉じません
- 読み込み中や判定途中は `LOADING` とし、閉じません
- 判定不能は最終的に `ATTENTION` とし、閉じません
- pinned タブと tab group 所属タブは `PROTECTED` とし、自動クローズ・重複削除・move の対象にしません
- 削除直前に実タブの URL・navigation 状態・保護状態・分類世代を再確認します
- stale な `DEAD` 判定や古い SPA DOM を根拠に削除しないよう、navigation / document generation を追跡します

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
| テスト用ランタイム | Node.js（リポジトリ記録では v24.19.0） |
| 実ブラウザの確認済みバージョン | **未確認** |

ブラウザの最小対応バージョンは明示されていません。Manifest V3、`chrome.storage.session`、tab group 関連の Tabs API を利用できる Chromium 系ブラウザが必要です。

## インストール

安定版を利用する場合は、GitHub Release `v1.0.0` の **Source code (zip)** を取得して展開する方法を推奨します。Git を利用する場合は tag `v1.0.0` を checkout してください。

### Chrome

1. `v1.0.0` の Source code archive を取得し、任意の場所へ展開します。
2. `chrome://extensions/` を開きます。
3. **デベロッパーモード**を ON にします。
4. **パッケージ化されていない拡張機能を読み込む**を押します。
5. `manifest.json` がある `gofile-tab-manager` フォルダを選択します。

### Microsoft Edge

1. `v1.0.0` の Source code archive を取得し、任意の場所へ展開します。
2. `edge://extensions/` を開きます。
3. **開発者モード**を ON にします。
4. **展開して読み込み**を押します。
5. `manifest.json` がある `gofile-tab-manager` フォルダを選択します。

ビルドや `npm install` は不要です。ブラウザがリポジトリ内の JavaScript / HTML / CSS を直接読み込みます。

## 更新

安定版利用者は、原則として GitHub Release の新しい Version へ更新してください。`main` は今後の開発で Release より先行する可能性があります。

1. 新しい Release の Source code を取得します。
2. 現在と同じ展開先へ上書きします。
3. 拡張機能管理画面を開きます。
4. Gofile Tab Manager の **再読み込み**を実行します。
5. 必要に応じて Gofile の既存タブを再読み込みします。

`chrome.storage.local` / `chrome.storage.session` の引き継ぎは拡張 ID に依存します。**展開先フォルダを変更した場合のデータ引き継ぎは未確認**のため、更新時は同じ展開先を維持することを推奨します。

## アンインストール

Chrome / Edge の拡張機能管理画面から Gofile Tab Manager を削除してください。

本拡張が独自に作成する外部ファイルやデータベースはありません。Close History 等はブラウザの extension storage に保存されます。拡張削除後の storage の完全削除タイミングはブラウザ実機で未確認です。

## 使用方法

インストール後は、通常どおり Gofile を利用します。`https://gofile.io/d/<contentId>` 形式のタブは自動的に監視されます。

### 1. DEAD タブの自動クローズ

現在の実装では、次が揃った場合のみ `DEAD` の肯定的シグナルとして扱います。

- `main#page` 配下に `#fm-root` が存在する
- その中に `This content does not exist` と一致する可視 `h1` がある
- ページタイトルが `Content not found` または `Content not found · Gofile` と一致する
- password / private / 401 / 403 / 429 / 5xx 等の非 DEAD 条件に該当しない
- 現在の route generation に対応する新しい DOM である

Gofile 側の DOM が変わり、この条件を満たせなくなった場合は安全側に倒れ、原則 `ATTENTION` になります。

### 2. 重複タブの自動整理

対象 URL を次の形式へ canonicalize して同一コンテンツを判定します。

```text
https://gofile.io/d/<contentId>
```

- query を除去
- fragment を除去
- 末尾 `/` を除去
- `contentId` の大文字・小文字は維持
- `https://gofile.io` 以外は対象外

同一 canonical URL が複数ある場合、通常は最も古く認識された非 PROTECTED タブを残します。PROTECTED が含まれる場合は PROTECTED を優先して残し、非 PROTECTED だけを削除します。PROTECTED 同士は削除しません。

### 3. 現在ウィンドウの手動並び替え

拡張アイコンを開き、**並び替え**を押した時だけ現在ウィンドウを整理します。自動並び替えは行いません。

基本順序は次の stable partition です。

1. 非 Gofile
2. `NORMAL` Gofile
3. その他 Gofile（`RATE_LIMITED` / `LOADING` / `ATTENTION` など）

各グループ内の相対順序は維持します。PROTECTED は固定バリアとして扱われ、その位置を跨いだ move は行いません。並び替え中にタブ構成や保護状態が変わった場合は古い計画を中止します。

### 4. Recent auto-closed

Popup の **Recent auto-closed** には、自動クローズされた `DEAD` / `DUPLICATE` タブが新しい順に最大 50 件表示されます。

**再オープン**を押すと、保存されている URL を新しいタブとして開きます。過去の tab ID は再利用しません。再オープン時にも URL が管理対象形式か再検証されます。

## 状態の意味

| 状態 | 意味 | 自動クローズ |
|---|---|---|
| `NORMAL` | 正常な Gofile コンテンツと判断 | しない |
| `DEAD` | 現行の not-found gate を肯定的に確認 | 対象。ただし PROTECTED は除外 |
| `RATE_LIMITED` | 429 / rate limit を検出 | しない |
| `LOADING` | 読み込み中・route 切替直後・判定待ち | しない |
| `ATTENTION` | 認証、権限、通信失敗、判定不能など | しない |
| `PROTECTED` | pinned または tab group 所属 | しない。move もしない |

`PROTECTED` はページ分類として content script から送られる状態ではなく、background 側がブラウザのタブ属性から判断します。

## Popup の表示

Popup では現在ウィンドウについて次の件数を表示します。

- `NORMAL`
- その他 Gofile
- `ATTENTION`
- `PROTECTED`

加えて **並び替え**ボタンと **Recent auto-closed** 履歴を表示します。

## データと保存先

本拡張はブラウザの extension storage だけを使用します。

| Storage | Key | 内容 |
|---|---|---|
| `chrome.storage.local` | `closeHistory` | 自動クローズ履歴。最大 50 件 |
| `chrome.storage.session` | `tabMeta` | `canonicalUrl` と `firstSeenAt` の簡易メタデータ |
| `chrome.storage.session` | `pendingCloses` | クローズ処理の復旧用状態 |

認証情報、Gofile の Cookie、Access Token、Password、API Key を本拡張独自の storage へ保存する実装はありません。

## 再起動・復旧

Manifest V3 Service Worker が再起動した場合、background は全実タブを再取得し、保存済み `firstSeenAt` を利用できる場合だけ引き継ぎつつ、分類状態を `LOADING` に戻して content script から再分類します。

自動クローズ履歴の保存途中で Worker が停止した場合は `pendingCloses` を利用して復旧します。ただし、**`tabs.remove` 成功後から `removed` フェーズを session storage へ保存するまでの間に Worker が停止した場合、成功を証明できないため履歴を復元しません。** これは誤った成功履歴を作らないための意図的な安全設計です。

## エラー時の挙動

- classification message の送信に失敗した場合、content script は次回の DOM 変更や settle pass で再送可能な状態に戻します
- Close History の local storage 書き込みに失敗した場合、メモリ上で保留し約 1 秒後に再試行します
- navigation 中の古い分類は受理しません
- 並び替え中にタブ集合や PROTECTED 構造が変化した場合は処理を中止します
- 判定不能や想定外 DOM は削除せず `ATTENTION` にします

## セキュリティと権限

`manifest.json` の権限は次だけです。

```text
tabs
storage
host: https://gofile.io/*
```

現在のソースには独自の `fetch` / `XMLHttpRequest` による外部 API 通信、テレメトリ送信、認証情報保存処理はありません。

content script は Gofile origin 全体で待機しますが、自動整理の管理対象として認識するのは `https://gofile.io/d/<contentId>` 形式だけです。これは SPA 内で管理対象ページへ遷移した場合も検知するためです。

## 技術概要

```text
Gofile page
   ↓ DOM監視 / route監視
content.js
   ↓ classification / route message
background.js
   ├─ DEAD安全確認 → tabs.remove
   ├─ duplicate reconciliation → tabs.remove
   ├─ Popup要求 → 状態集計 / sort / reopen
   └─ storage.local / storage.session
        ↑
popup.js ─ runtime message
```

主要な構成は次のとおりです。

```text
gofile-tab-manager/
├─ manifest.json
├─ background.js
├─ content.js
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
│  └─ TEST_RESULTS.md
├─ README.md
├─ DEVELOPMENT.md
├─ CHANGELOG.md
└─ docs/
   └─ ARCHITECTURE.md
```

内部実装、競合対策、不変条件、開発手順は [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。より詳しいデータフローは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) に分離しています。

## テスト

依存パッケージは不要です。

```bash
npm test
```

実体は次のコマンドです。

```bash
node --test tests/regression.test.js
```

`tests/TEST_RESULTS.md` に記録されている v1.0.0 の結果は **21 passed, 0 failed（Node.js v24.19.0）** です。

2026-09-14 のリリース用ドキュメント整備環境では、作業環境から GitHub を直接 clone できなかったため、上記テストを独自再実行できていません。したがってこれは「リポジトリに記録されている確認結果」であり、今回のドキュメント作業で再検証済みという意味ではありません。

実ブラウザでのみ確認できる項目や残余競合は [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) を参照してください。

## 既知の制限・未確認事項

- 実 Chrome / Edge での unpacked 拡張ロードと現行 Gofile DOM の実機確認は、テスト記録上 **未確認**
- ブラウザ最小対応バージョンは未定義
- `tabs.get` による最終確認と `tabs.remove` の間は Chromium API 上原子的ではなく、外部操作が割り込む残余競合がある
- `tabs.remove` 成功直後、`removed` フェーズ保存前に Worker が停止した場合は Close History を復元できない
- PROTECTED が固定バリアになるため、ウィンドウ全体が理想順に完全整列しない場合がある
- Gofile の DOM / title 構造変更により分類できなくなった場合は、安全側に倒れて自動削除できなくなる可能性がある

## トラブルシューティング

### DEAD のはずのタブが閉じない

**原因候補:** Gofile の DOM が変わった、まだ `LOADING`、`ATTENTION` 条件に該当、またはタブが PROTECTED。

**対処:** pinned / tab group を確認し、ページの読み込み完了後も続く場合は Developer Tools で現在の not-found gate が `main#page` → `#fm-root` → `h1` 構造になっているか確認してください。DOM変更が疑われる場合は自動削除条件を安易に緩めず、テスト追加を先に行ってください。

### 重複タブが残る

**原因候補:** 一方が pinned / tab group、navigation 中、または URL が実際には異なる contentId。

**対処:** PROTECTED 状態と URL の `<contentId>` を確認してください。query / fragment の違いだけなら同一 canonical URL として扱われます。

### 並び替えが途中で中止される

**原因候補:** 並び替え中にタブ追加・削除・group化・pin状態変更などが発生。

**対処:** タブ操作が落ち着いてからもう一度 **並び替え**を押してください。古い計画を続行しないのは安全仕様です。

### Recent auto-closed に履歴が出ない

**原因候補:** storage 書き込み失敗、または Worker 停止タイミングが「削除成功を証明できない残余窓」に入った可能性があります。

**対処:** Popup を開き直してください。local storage の一時エラーは自動再試行します。それでも再現する場合は `tests/TEST_RESULTS.md` の Close History / worker restart 項目と合わせて調査してください。

## 開発者向け資料

- [DEVELOPMENT.md](DEVELOPMENT.md) — 実装内部、保守ルール、安全上の不変条件、デバッグ、リリースチェック
- [CHANGELOG.md](CHANGELOG.md) — 正式リリース日を含むバージョン履歴
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — コンポーネント、データフロー、競合対策
- [tests/TEST_RESULTS.md](tests/TEST_RESULTS.md) — 回帰テスト結果と実ブラウザ未確認項目

## License

**未設定です。** リポジトリに LICENSE / NOTICE は存在しません。ライセンスを推測して追加しないでください。
