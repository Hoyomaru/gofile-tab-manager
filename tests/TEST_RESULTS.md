# Gofile Tab Manager v1.0.0 — Test Results

## 実行可能な回帰テスト

テストコードは `tests/regression.test.js` です。依存パッケージは使用していません。

```text
node --test tests/regression.test.js
```

結果: **13 passed, 0 failed**（Node.js v24.19.0）

修正前の再現確認は、作業ツリーを変更せずHEADのファイルを `git show` で読み込む方式です。

```text
node -e "process.env.GFTM_SOURCE='HEAD'; require('./tests/regression.test.js')"
```

結果: **12 failed**。本文全体のDEAD誤判定、origin外からのSPA監視欠落、duplicate survivor消失、pendingUrl無視、stale DEAD、sort中の保護構造変更、replacementのfirstSeenAt消失、履歴保存欠落などを修正前に検出しました。

## テスト範囲

- **DEAD判定**: ファイル名、hidden DOM、modal/toast、正常領域との共存、loading中、401/403/429/5xxとの共存をDEADにしないこと。可視の `[role="alert"]` にある明示的なコンテンツ不存在表示だけをDEADとすること。
- **duplicate**: canonical URL（query/fragment/末尾slash除去、contentIdの大小文字維持）、最古のsurvivor、PROTECTED優先、survivorのclose/navigation/DEAD化をawait境界で再検証すること。
- **navigation**: pendingUrl中の旧URL分類の無効化、A→B、管理対象外へのcommit、同一URLreload、redirect相当、A→B→Aを確認すること。
- **分類世代**: DEADのawait中にNORMAL/ATTENTION/LOADINGが到着した場合、古い削除を無効化すること。
- **SPA**: origin全体でcontent scriptが待機し、pushState/replaceState/popstate相当のroute世代変更で旧DOMのDEADを送らないこと。connectedなbackgroundまで通して確認すること。
- **sort**: 現在windowだけ、PROTECTED（pinned/group）を固定barrierとしてstable partitionし、1タブずつ現在indexへmoveすること。move待機中のgroup化で古い計画を中止し、sort多重要求とno-opを確認すること。
- **replacement**: 同一canonical URLのreplacementでfirstSeenAtだけ継承し、分類状態はLOADINGへresetすること。
- **Close History**: remove失敗は記録せず、local get/setの一時失敗を保留して再試行し、並行close、worker再起動、重複記録防止、直近50件・新しい順を確認すること。
- **構成**: manifestのhost scopeを `https://gofile.io/*` に限定し、不要なhost権限を追加しないこと。

## 実ブラウザ確認が必要な項目

以下はNodeのChrome API mockではPASS扱いにしていません。

- Chrome/Edgeへunpacked Manifest V3拡張を実際にロードできること
- 実Gofileページの現在のDOMが、標準の可視alertと実際の正常/読み込み領域として期待どおり分類されること
- 実ブラウザの `tabs.remove` / `tabs.move` のイベント順、複数window、pinned、tab group、redirect、BFCache復帰、Service Worker停止・再起動
- 実際の大量タブでの自動closeとPopup表示・再オープン

`tabs.get` による最終再検証は、Chromium APIに条件付きremoveがないため原子的ではありません。最終検証と `tabs.remove` の間に外部navigation/closeが入る残余競合は、実ブラウザでも別途確認が必要です。

また、`tabs.remove` 成功と `removed` フェーズのsession保存の間でworkerが停止した場合は、成功を証明できないため履歴を復元しません。これは誤った成功履歴を避けるための残余窓で、実ブラウザのworker停止タイミング確認が必要です。
