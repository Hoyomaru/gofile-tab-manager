const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('reclassification helper is loaded after the main content script', () => {
  const manifest = JSON.parse(source('manifest.json'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('content.js'));
  assert.ok(scripts.includes('reclassify.js'));
  assert.ok(scripts.indexOf('reclassify.js') > scripts.indexOf('content.js'));
});

test('shared message types expose popup reclassification', () => {
  const context = vm.createContext({ globalThis: undefined, Object });
  context.globalThis = context;
  vm.runInContext(source('shared/constants.js'), context);
  assert.equal(
    context.GofileTabManager.Constants.MESSAGE_TYPES.REQUEST_RECLASSIFICATION,
    'REQUEST_RECLASSIFICATION'
  );
});

test('popup makes sort the primary action and keeps detailed status controls', () => {
  const html = source('popup.html');
  const sortIndex = html.indexOf('id="sort-button"');
  const stateIndex = html.indexOf('id="window-state-heading"');

  assert.ok(sortIndex >= 0);
  assert.ok(stateIndex >= 0);
  assert.ok(sortIndex < stateIndex);
  assert.match(html, /id="sort-button" class="primary wide"/);
  assert.match(html, />Gofileタブを並び替え</);
  assert.match(html, /id="rate-limited-count"/);
  assert.match(html, /id="loading-count"/);
  assert.match(html, /id="reclassify-button"/);
  assert.match(html, /id="pause-button"/);
  assert.match(html, /shared\/url\.js/);
});

test('popup presents internal states and close reasons in user-facing Japanese', () => {
  const html = source('popup.html');
  const popup = source('popup.js');

  assert.match(html, />正常</);
  assert.match(html, />アクセス制限</);
  assert.match(html, />読み込み中</);
  assert.match(html, />要確認</);
  assert.match(html, />保護</);
  assert.match(html, />最近自動で閉じたタブ\s*</);
  assert.match(html, /id="history-count"/);
  assert.match(popup, /setStatus\([^\n]+, 'success'\)/);
  assert.match(popup, /setStatus\([^\n]+, 'error'\)/);

  assert.match(popup, /reason === 'DEAD'.*'リンク切れ'/);
  assert.match(popup, /reason === 'DUPLICATE'.*'重複'/);
});

test('popup gives sorting progress, success, and actionable error feedback', () => {
  const popup = source('popup.js');
  const css = source('popup.css');

  assert.match(popup, /sortButton\.textContent = '並び替え中…'/);
  assert.match(popup, /✓ Gofileタブを並び替えました。/);
  assert.match(popup, /「再判定」後にもう一度お試しください。/);
  assert.match(popup, /role', tone === 'error' \? 'alert' : 'status'/);
  assert.match(css, /\.status--success/);
  assert.match(css, /\.status--error/);
});

test('history exposes count and full truncated title', () => {
  const popup = source('popup.js');
  assert.match(popup, /historyCount\.textContent = history\.length \? `（\$\{history\.length\}）` : ''/);
  assert.match(popup, /title\.title = title\.textContent/);
});

test('manifest exposes a customizable shortcut for the primary sort action', () => {
  const manifest = JSON.parse(source('manifest.json'));
  const command = manifest.commands?.['sort-current-window'];
  assert.ok(command);
  assert.equal(command.suggested_key?.default, 'Alt+Shift+S');
  assert.match(command.description, /Gofileタブを並び替え/);
});

test('sort command does not expand extension permissions or become a global shortcut', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.deepEqual([...manifest.permissions].sort(), ['storage', 'tabs']);
  assert.deepEqual(manifest.host_permissions, ['https://gofile.io/*']);
  const command = manifest.commands?.['sort-current-window'];
  assert.ok(command);
  assert.equal(command.global, undefined);
  assert.equal(command.suggested_key?.default, 'Alt+Shift+S');
});

test('keyboard shortcut reuses the existing safe current-window sorter', () => {
  const background = source('background.js');
  const handlerAt = background.indexOf("chrome.commands?.onCommand?.addListener");
  assert.ok(handlerAt > 0);
  const handler = background.slice(handlerAt);
  assert.match(handler, /command !== 'sort-current-window'/);
  assert.match(background, /async function sortLastFocusedWindowFromShortcut\(\)/);
  assert.match(background, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(background, /const result = await sortWindowOnce\(windowId\)/);
  assert.match(background, /result\.aborted \? '!' : \(result\.changed \? '✓' : '0'\)/);
});

test('reclassification reuses the existing mutation-driven classifier', () => {
  const helper = source('reclassify.js');
  assert.match(helper, /REQUEST_RECLASSIFICATION/);
  assert.match(helper, /appendChild\(marker\)/);
  assert.match(helper, /marker\.remove\(\)/);
  assert.doesNotMatch(helper, /TAB_CLASSIFICATION/);
});
