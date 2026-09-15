const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('shared constants define the persisted auto-close pause key', () => {
  const context = vm.createContext({ globalThis: undefined, Object });
  context.globalThis = context;
  vm.runInContext(source('shared/constants.js'), context);
  assert.equal(
    context.GofileTabManager.Constants.STORAGE_KEYS.AUTO_CLOSE_PAUSED,
    'autoClosePaused'
  );
});

test('closeTabSafely checks pause before and immediately before destructive work', () => {
  const background = source('background.js');
  const closeFunction = background.match(/async function closeTabSafely\(tab, reason, expectedCanonicalUrl, guard = null\) \{[\s\S]*?\n\}/)?.[0] || '';
  const checks = closeFunction.match(/autoClosePaused/g) || [];
  assert.ok(checks.length >= 2, 'pause must be checked at entry and after async revalidation');
  assert.match(closeFunction, /if \(autoClosePaused\) \{\s*return false;\s*\}/);
  assert.ok(
    closeFunction.indexOf('if (autoClosePaused)') < closeFunction.indexOf('startCloseOperation(historyEntry)'),
    'final pause check must happen before close intent/remove work'
  );
});

test('pause preference fails safe if storage cannot be read', () => {
  const background = source('background.js');
  const loader = background.match(/async function loadAutoClosePaused\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(loader, /catch \{[\s\S]*?return true;/);
});

test('background observes pause changes and resumes duplicate reconciliation', () => {
  const background = source('background.js');
  assert.match(background, /chrome\.storage\.onChanged/);
  assert.match(background, /AUTO_CLOSE_PAUSED/);
  assert.match(background, /if \(!autoClosePaused\) \{\s*enqueueReconciliation\(\);/);
});

test('popup exposes pause control and globally reclassifies on resume', () => {
  const html = source('popup.html');
  const popup = source('popup.js');
  assert.match(html, /id="pause-button"/);
  assert.match(popup, /STORAGE_KEYS\.AUTO_CLOSE_PAUSED/);
  assert.match(popup, /chrome\.storage\.local\.set/);
  assert.match(popup, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(popup, /requestReclassification\(allTabs\)/);
});
