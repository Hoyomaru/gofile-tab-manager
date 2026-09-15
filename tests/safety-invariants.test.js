const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('manifest and shared constant versions stay aligned', () => {
  const manifest = JSON.parse(source('manifest.json'));
  const context = vm.createContext({ globalThis: undefined, Object });
  context.globalThis = context;
  vm.runInContext(source('shared/constants.js'), context, { filename: 'shared/constants.js' });
  assert.equal(context.GofileTabManager.Constants.VERSION, manifest.version);
});

test('visibility checks computed style for every ancestor', () => {
  const content = source('content.js');
  const visibilityFunction = content.match(/function isHiddenByAttributesOrStyle\(node\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(visibilityFunction, /for \(let current = node; current; current = current\.parentElement\)/);
  assert.match(visibilityFunction, /getComputedStyle\?\.\(current\)/);
});

test('pageshow restarts the route polling fallback', () => {
  const content = source('content.js');
  const pageshowHandler = content.match(/addEventListener\('pageshow',[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.match(pageshowHandler, /startRoutePoll\(\)/);
});

test('each SPA route schedules its own settle reclassification', () => {
  const content = source('content.js');
  const routeInvalidation = content.match(/function invalidateRouteIfChanged\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(routeInvalidation, /scheduleSettleClassification\(\)/);
});

test('status-code and rate-limit patterns are not matched against the whole body', () => {
  const content = source('content.js');
  const classifier = content.match(/function classifyDocument\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(classifier, /anyPatternMatches\(Signatures\.NON_DEAD_ATTENTION_TEXT, bodyText\)/);
  assert.doesNotMatch(classifier, /anyPatternMatches\(Signatures\.RATE_LIMIT_TEXT, bodyText\)/);
  assert.match(classifier, /visibleStatusText\(\)/);
});
