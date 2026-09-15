# Gofile Tab Manager v1.1.0 — Test Results

## Automated regression tests

テストは Node 標準モジュールだけで動作し、依存パッケージは使用していません。

```bash
npm test
```

`package.json` は `tests/*.test.js` を実行します。

現在のテスト構成:

- `tests/regression.test.js` — v1.0.0 から継続している DOM / tabs / storage / race 回帰テスト
- `tests/safety-invariants.test.js` — Version 一致、visibility、BFCache route poll、SPA settle、status text scope などの安全性 invariant
- `tests/popup-features.test.js` — Popup の再判定・詳細ステータス表示の配線
- `tests/auto-close-pause.test.js` — 自動クローズ一時停止の destructive boundary guard

GitHub Actions の Node.js 24 ジョブで、v1.1.0 変更を含む `npm test` が成功しています。

### v1.0.0 historical result

v1.0.0 時点で保存されていた基礎回帰テスト結果:

```text
node --test tests/regression.test.js
21 passed, 0 failed
Node.js v24.19.0
```

この 21 件は v1.1.0 でも削除せず維持し、新しい安全性・Popup・pause テストを追加しています。

## Automated test coverage

主な確認範囲:

- **DEAD判定**: 正常ファイル名、hidden DOM、CSS で非表示の祖先、modal/toast、loading、401/403/429/5xx を DEAD にしない。現在の Gofile not-found gate が揃った場合だけ DEAD とする。
- **正常画面**: `#fm-header` / `#fm-list`、単一ファイル表示の download/properties 操作を肯定的な NORMAL signal とする。
- **status text scope**: 401 / 403 / 429 / 5xx 等の文字列をページ本文全体ではなく可視 status heading / alert へ限定し、通常ファイル名や本文中の数値で誤分類しない。
- **visibility**: 判定対象自身だけでなく祖先 chain の computed style も確認する。
- **duplicate**: canonical URL、最古 survivor、PROTECTED 優先、survivor の close/navigation/DEAD 化を await 境界で再検証する。
- **navigation**: pendingUrl、A→B、管理対象外への commit、reload、redirect 相当、A→B→A を確認する。
- **分類世代**: DEAD の await 中に NORMAL / ATTENTION / LOADING が到着した場合、古い削除を無効化する。
- **SPA / BFCache**: route poll、route generation、pageshow 復帰、route ごとの settle timer を確認する。
- **sort**: 現在 window のみ、PROTECTED を固定 barrier として stable partition。構成変更時は abort。
- **replacement**: 同一 canonical URL なら firstSeenAt のみ継承し、state は LOADING へ reset。
- **Close History**: remove failure、storage failure retry、並行 close、worker restart、重複記録防止、最大 50 件。
- **高速close**: session storage 保存完了を `tabs.remove` の必須前提にしない。
- **Popup**: `RATE_LIMITED` / `LOADING` の詳細表示、現在 window の手動再判定。
- **auto-close pause**: DEAD / DUPLICATE の両方を停止し、close 開始時と最終 `tabs.remove` 直前の両方で pause を確認する。
- **Version**: `manifest.json` と `shared/constants.js` の Version が一致する。
- **構成**: host permission を `https://gofile.io/*` に限定する。

## Real-browser verification — 2026-09-15

v1.1.0 リリース候補について実ブラウザ検証を実施し、**不具合なし**を確認しました。

確認対象:

- Chrome / Edge 系 Chromium ブラウザへ unpacked Manifest V3 拡張としてロード
- 現在の Gofile 実 DOM で NORMAL / DEAD / RATE_LIMITED / ATTENTION 系の分類
- DEAD 自動クローズ
- duplicate 自動整理
- pinned / tab group の PROTECTED
- Popup の詳細 status count
- Popup の手動再判定
- 自動クローズ一時停止中に DEAD / DUPLICATE を削除しないこと
- 自動クローズ再開後の再判定
- 現在 window の manual sort
- Recent auto-closed と再オープン
- SPA route change / BFCache 復帰
- 複数 window
- Service Worker 停止・再起動後の再同期

正確な Chrome / Edge の Version 番号は記録していないため、**最小対応ブラウザ Version は引き続き未定義**です。

## Remaining design limitations

以下は不具合ではなく、API / 永続化モデル上の残余制約です。

- Chromium に conditional `tabs.remove()` がないため、最終 `tabs.get()` と `tabs.remove()` の間は原子的ではない。
- `tabs.remove()` 成功直後から `phase=removed` の session 保存までの間に Service Worker が停止した場合、extension 自身の成功を証明できないため Close History を復元しない。
- Gofile の DOM / title 構造が将来変更された場合は false positive を避けるため安全側に倒れ、`ATTENTION` になって自動クローズできなくなる可能性がある。
- PROTECTED は sort の固定 barrier なので、window 全体が理想的な完全順序にならない場合がある。
