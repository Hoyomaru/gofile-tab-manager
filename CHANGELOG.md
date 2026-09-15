# Changelog

このファイルは、Git の commit 履歴、`manifest.json`、`shared/constants.js`、テスト記録から確認できる変更を記載します。

`manifest.json` と `shared/constants.js` の Version は常に一致させます。

## [Unreleased]

現在、v1.1.0 公開予定内容以外の未リリース変更はありません。

## [1.1.0] - 2026-09-15

v1.0.0 公開後の安全性修正、Popup 改善、運用機能、CI をまとめた機能追加リリースです。

GitHub Release:

- Tag: `v1.1.0`
- Title: `Gofile Tab Manager v1.1.0`
- License: MIT License
- 配布形態: GitHub が自動提供する Source code archive

### Added

- GitHub Actions で Node.js 24 の `npm test` を push / pull request ごとに自動実行する CI を追加。
- `manifest.json` と `shared/constants.js` の Version 一致を含む安全性 invariant test を追加。
- Popup に `RATE_LIMITED` / `LOADING` の詳細件数表示を追加。
- Popup に現在ウィンドウの Gofile タブを手動で再判定する機能を追加。
- Popup にグローバルな自動クローズ一時停止 / 再開機能を追加。停止中も分類・表示・手動並び替え・履歴再オープンは利用可能。
- 自動クローズ再開時に全ウィンドウの管理対象タブを再判定し、停止中に残った `DEAD` を再評価する処理を追加。
- `.gitignore` を追加。
- MIT License を追加し、`package.json` と各ドキュメントのライセンス表記を統一。

### Fixed

- CSS class 等によって祖先要素が非表示になっている場合、子要素だけの computed style を見て可視と誤判定する可能性を修正。祖先 chain の computed style も確認するよう変更。
- `pagehide` 後の `pageshow` / BFCache 復帰で 250ms route poll が再開されない問題を修正。
- SPA route change ごとに settle 再分類 timer を作り直し、DOM mutation が止まった場合でも `LOADING` が適切に再評価されるよう修正。
- 401 / 403 / 429 / 5xx 等の文字列をページ本文全体へ適用していた分類を、可視な status heading / alert 領域へ限定し、正常ファイル名や本文中の数字による誤分類を抑制。
- 自動クローズ一時停止を `closeTabSafely()` の開始時と、非同期 guard 完了後の最終 destructive boundary の両方で再確認するようにし、停止操作と進行中 close の競合を安全側へ寄せた。
- 自動クローズ設定を Service Worker 起動時に読み取れない場合は fail-safe で停止扱いにするよう変更。

### Tests

- 既存の `tests/regression.test.js` に加え、安全性 invariant、Popup 再判定配線、自動クローズ一時停止 guard のテストを追加。
- `npm test` は `tests/*.test.js` を実行するよう変更。
- GitHub Actions 上で既存回帰テストを含むテストスイートの成功を確認。
- 2026-09-15 に実ブラウザ検証を実施し、不具合なしを確認。確認対象には Gofile 実画面での分類、Popup 操作、自動クローズ一時停止 / 再開、BFCache / SPA 遷移、PROTECTED、複数 window、Service Worker 再起動を含む。正確なブラウザ Version は記録していないため、最小対応 Version は引き続き未定義。

### Documentation

- README / DEVELOPMENT / ARCHITECTURE / TEST_RESULTS を v1.1.0 の実装・運用内容へ同期。
- GitHub Actions 導入済み、実機検証済み、自動クローズ一時停止、再判定、詳細ステータス表示を反映。
- README / DEVELOPMENT / ARCHITECTURE / `package.json` を MIT License 表記へ統一し、ルートへ `LICENSE` を追加。

## [1.0.0] - 2026-09-14

Gofile Tab Manager の初回正式リリースです。

GitHub Release:

- Tag: `v1.0.0`
- Title: `Gofile Tab Manager v1.0.0`

Chrome / Microsoft Edge（Chromium）向け Manifest V3 拡張として、Gofile の `https://gofile.io/d/<contentId>` タブを安全側に整理する機能を提供しました。

### Added

- `https://gofile.io/d/<contentId>` 形式の Gofile タブ管理。
- 明確に `DEAD` と分類されたタブの自動クローズ。
- canonical URL による重複タブ整理。
- pinned / tab group 所属タブを `PROTECTED` として保護。
- Popup から現在ウィンドウだけを手動 stable partition。
- `chrome.storage.local` へ直近 50 件の自動クローズ履歴を保存し、Popup から再オープン。
- `chrome.storage.session` を利用した tab metadata / pending close state の保持。
- Gofile origin の DOM を監視して `NORMAL` / `DEAD` / `RATE_LIMITED` / `LOADING` / `ATTENTION` を分類する content script。
- Node 標準モジュールだけで実コードを検証する回帰テスト。

### Safety fixes included before release

#### 2026-09-07 — tab lifecycle safety

- pending navigation 中の旧 URL 分類を無効化。
- navigation version / classification revision / route generation による stale classification 防止。
- duplicate victim 削除前の survivor 再検証。
- newer `NORMAL` / `ATTENTION` / `LOADING` 到着時に古い `DEAD` close を無効化。
- pinned / tab group などの保護状態が await 中に変化した場合、古い削除・sort 計画を中止。
- replacement tab で同じ canonical URL の `firstSeenAt` だけを継承し、分類状態を `LOADING` へ戻す。
- Close History の storage failure 再試行、pending close recovery、並行 close 耐性、sort snapshot 再検証を追加。

#### 2026-09-10 — Gofile DEAD detection / close races

- DEAD 判定を広い本文文字列から、`main#page` → `#fm-root` → exact `h1` と `Content not found` title の肯定的 DOM 判定へ限定。
- 正常 folder / file view の DOM を肯定的な `NORMAL` シグナルとして扱うよう改善。
- 正常ファイル名、hidden DOM、modal / toast、loading、401 / 403 / 429 / 5xx を DEAD と誤判定しない回帰テストを追加・強化。
- SPA route change 後に古い not-found DOM を新 route の証拠として扱わない fresh generation 管理を強化。
- page-world の URL 変更を補足する 250ms route poll を追加。
- current-route の完全な not-found gate が確定した場合、通常の debounce を待たず分類通知。
- `tabs.remove()` の開始を tab metadata / pending close intent の session storage 完了待ちにしないよう変更。

### Known limitations

- Chrome / Edge の正確な最小対応バージョンは未定義。
- Chromium に conditional `tabs.remove()` がないため、最終 `tabs.get()` と `tabs.remove()` の間には残余競合がある。
- `tabs.remove()` 成功直後、`removed` phase の永続化前に Service Worker が停止した場合、その close は履歴へ復元できない。
- Gofile の DOM / title 構造が変更された場合、安全側に倒れて自動クローズできなくなる可能性がある。
