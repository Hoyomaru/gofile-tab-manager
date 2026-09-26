# Changelog

このファイルは、Git の commit 履歴、`manifest.json`、`shared/constants.js`、テスト記録から確認できる変更を記載します。

`manifest.json` と `shared/constants.js` の Version は常に一致させます。

## [Unreleased]

### Changed

- Popup の最頻操作である「並び替え」を最上位の Primary Action に変更。
- Popup の状態表示を `NORMAL` / `RATE_LIMITED` / `LOADING` / `ATTENTION` / `PROTECTED` から、利用者向けの日本語ラベルへ変更。内部状態値は変更しない。
- 自動クローズ履歴の理由表示を `DEAD` / `DUPLICATE` から「リンク切れ」/「重複」へ変更。
- 履歴見出しを日本語化し、再判定と自動クローズ制御を補助操作として整理。

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
