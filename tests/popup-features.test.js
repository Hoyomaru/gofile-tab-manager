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

test('popup exposes detailed status counters and reclassify control', () => {
  const html = source('popup.html');
  assert.match(html, /id="rate-limited-count"/);
  assert.match(html, /id="loading-count"/);
  assert.match(html, /id="reclassify-button"/);
  assert.match(html, /shared\/url\.js/);
});

test('reclassification reuses the existing mutation-driven classifier', () => {
  const helper = source('reclassify.js');
  assert.match(helper, /REQUEST_RECLASSIFICATION/);
  assert.match(helper, /appendChild\(marker\)/);
  assert.match(helper, /marker\.remove\(\)/);
  assert.doesNotMatch(helper, /TAB_CLASSIFICATION/);
});
