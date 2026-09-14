# Changelog

このファイルは、Git の commit 履歴、`manifest.json`、`shared/constants.js`、既存テスト記録から確認できる変更だけを記載します。

**Gofile Tab Manager v1.0.0 は 2026-09-14 に初回正式リリースされました。**

Version `1.0.0` の実装自体は 2026-09-07 にリポジトリへ追加され、その後 2026-09-07 と 2026-09-10 に安全性・競合対策・Gofile 現行 DOM への適合修正が行われました。これらはすべて、2026-09-14 に正式公開された **v1.0.0 の構成要素**です。

`manifest.json` と `shared/constants.js` の Version は `1.0.0` で一致しています。

## [Unreleased]

現在、v1.0.0 公開後の未リリース変更はありません。

## [1.0.0] - 2026-09-14

Gofile Tab Manager の初回正式リリースです。

GitHub Release:

- Tag: `v1.0.0`
- Title: `Gofile Tab Manager v1.0.0`

Chrome / Microsoft Edge（Chromium）向け Manifest V3 拡張として、Gofile の `https://gofile.io/d/<contentId>` タブを安全側に整理する機能を提供します。

### Added

- `https://gofile.io/d/<contentId>` 形式の Gofile タブ管理を追加。
- 明確に `DEAD` と分類されたタブの自動クローズを追加。
- canonical URL による重複タブ整理を追加。
- pinned / tab group 所属タブを `PROTECTED` として保護する処理を追加。
- Popup から現在ウィンドウだけを手動 stable partition する機能を追加。
- `chrome.storage.local` へ直近 50 件の自動クローズ履歴を保存し、Popup から再オープンする機能を追加。
- `chrome.storage.session` を利用した tab metadata / pending close state の保持を追加。
- Gofile origin の DOM を監視して `NORMAL` / `DEAD` / `RATE_LIMITED` / `LOADING` / `ATTENTION` を分類する content script を追加。
- Node 標準モジュールだけで実コードを検証する `tests/regression.test.js` を追加。

初回実装 commit:

`5a363e8e115b404b5fe615e5877d11c97344d26c` — `Add Gofile Tab Manager v1.0.0`

### Fixed

#### 2026-09-07 — tab lifecycle safety

Commit:

`a8db44c20539ea99c76ca8581ea7089160ca2904` — `Fix tab lifecycle safety and add regression tests`

- pending navigation 中の旧 URL 分類を無効化する処理を追加。
- navigation version / classification revision / route generation による stale classification 防止を追加。
- duplicate victim を削除する前に survivor の生存、URL、navigation、メタデータを再検証する処理を追加。
- newer `NORMAL` / `ATTENTION` / `LOADING` が到着した場合に古い `DEAD` close を無効化する処理を追加。
- pinned / tab group などの保護状態が await 中に変化した場合、古い削除・sort 計画を中止する処理を追加。
- replacement tab で同じ canonical URL の `firstSeenAt` だけを継承し、分類状態を `LOADING` へ戻す処理を追加。
- Close History の一時的な storage failure を再試行する処理を追加。
- pending close operation を session storage へ保持し、Worker 再起動後に成功を証明できる履歴だけ復旧する処理を追加。
- Close History の重複記録防止と並行 close への耐性を追加。
- window 単位の sort 直列化と snapshot 再検証を追加。

#### 2026-09-10 — Gofile DEAD detection / close races

Commit:

`862eab6c2df9aa22618a0cdd565cdcae8ad0607f` — `Fix Gofile DEAD detection and close races`

- DEAD 判定を広い本文文字列から、現在の Gofile not-found gate の具体的な DOM / page title 組み合わせへ限定。
- `main#page` → `#fm-root` → exact `h1` と `Content not found` title を使う肯定的 DEAD 判定へ変更。
- 正常 folder / file view の DOM を肯定的な `NORMAL` シグナルとして扱うよう改善。
- 正常ファイル名、hidden DOM、modal / toast、loading、401 / 403 / 429 / 5xx を DEAD と誤判定しない回帰テストを追加・強化。
- SPA route change 後に古い not-found DOM を新 route の証拠として扱わない fresh generation 管理を強化。
- page-world の URL 変更を補足する 250ms route poll を追加。
- 現在 route の完全な not-found gate が MutationObserver で確定した場合、通常の 800ms debounce を待たず分類通知するよう改善。
- `tabs.remove()` の開始を tab metadata / pending close intent の session storage 完了待ちにしないよう変更。
- user-visible close の速度を維持しつつ、削除後の Close History / crash recovery bookkeeping を継続するよう調整。

### Documentation

2026-09-14 の正式リリースに合わせ、リポジトリを v1.0.0 の Single Source of Truth として利用できるようドキュメントを整備しました。

- README を利用者向け主要ドキュメントとして拡充。
- `DEVELOPMENT.md` を追加し、内部実装、安全上の不変条件、既知問題、デバッグ、リリース手順を整理。
- `docs/ARCHITECTURE.md` を追加し、コンポーネントとデータフローを整理。
- CHANGELOG を正式リリース日基準へ整理。

### Tests

`tests/TEST_RESULTS.md` に保存されている v1.0.0 の現行記録:

```text
node --test tests/regression.test.js
21 passed, 0 failed
Node.js v24.19.0
```

主な回帰テスト範囲:

- DEAD / NORMAL 判定
- SPA route generation
- pending navigation / stale classification
- duplicate survivor 再検証
- PROTECTED tab
- manual sort
- replacement tab
- Close History の失敗・並行処理・Worker 再起動復旧
- host permission scope

同ファイルには、Node mock では PASS 扱いにしていない実ブラウザ確認項目も分離して記録されています。

### Known limitations

- Chrome / Edge の正確な最小対応バージョンは未定義です。
- 実ブラウザ固有のイベント順や大量タブでの性能は Node mock だけでは完全検証できません。
- Chromium に conditional `tabs.remove()` がないため、最終 `tabs.get()` と `tabs.remove()` の間には残余競合があります。
- `tabs.remove()` 成功直後、`removed` phase の永続化前に Service Worker が停止した場合、その close は履歴へ復元できません。
- Gofile の DOM / title 構造が変更された場合、安全側に倒れて自動クローズできなくなる可能性があります。
