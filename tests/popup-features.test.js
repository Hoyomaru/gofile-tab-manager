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
  assert.match(popup, /status--success/);
  assert.match(popup, /status--error/);

  assert.match(popup, /reason === 'DEAD'.*'リンク切れ'/);
  assert.match(popup, /reason === 'DUPLICATE'.*'重複'/);
});

test('reclassification reuses the existing mutation-driven classifier', () => {
  const helper = source('reclassify.js');
  assert.match(helper, /REQUEST_RECLASSIFICATION/);
  assert.match(helper, /appendChild\(marker\)/);
  assert.match(helper, /marker\.remove\(\)/);
  assert.doesNotMatch(helper, /TAB_CLASSIFICATION/);
});
