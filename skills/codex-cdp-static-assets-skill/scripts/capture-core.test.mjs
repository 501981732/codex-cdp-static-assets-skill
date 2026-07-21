import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBudgetTracker,
  detectWorkshopBuildIds,
  hostIsAllowed,
  normalizeScope,
  redactUrl,
  scopeHost,
  summarizeLedgerEntries,
  validateBody,
} from './capture-core.mjs';

test('redacts query values and URL fragments', () => {
  assert.equal(
    redactUrl('https://cdn.test/app.js?v=123&token=secret#fragment'),
    'https://cdn.test/app.js?v=%5BREDACTED%5D&token=%5BREDACTED%5D',
  );
});

test('enforces exact and explicit wildcard host scope', () => {
  assert.equal(hostIsAllowed('app.example.com', ['app.example.com']), true);
  assert.equal(hostIsAllowed('cdn.example.com', ['*.example.com']), true);
  assert.equal(hostIsAllowed('example.com', ['*.example.com']), false);
  assert.deepEqual(scopeHost('data:text/javascript,ok', ['*.example.com']), { network: false, allowed: false, host: null });
});

test('normalizes scope without auto-approving observed hosts', () => {
  const scope = normalizeScope({
    caseId: 'CASE-1',
    pageHosts: ['workshop.example.com'],
    assetHosts: ['cdn.example.com'],
    approvedNetworkHosts: ['api.example.com'],
  });
  assert.deepEqual(scope.assetHosts, ['workshop.example.com', 'cdn.example.com']);
  assert.deepEqual(scope.approvedNetworkHosts, ['workshop.example.com', 'cdn.example.com', 'api.example.com']);
});

test('accepts html as an explicit scope type', () => {
  const scope = normalizeScope({
    pageHosts: ['workshop.example.com'],
    types: ['html'],
  });
  assert.deepEqual([...scope.types], ['html']);
});

test('normalizes the automation and synthetic fixture policy with the capture scope', () => {
  const scope = normalizeScope({
    pageHosts: ['workshop.example.com'],
    automation: {
      enabled: true,
      mode: 'single-page',
      allowAutosave: true,
      allowCreateCapturePages: false,
      maxWidgetsPerPage: 5,
      states: ['editor-mounted', 'viewport-visible', 'config-opened', 'data-bound', 'preview-visible'],
    },
    fixtureProfiles: { objects: { kind: 'synthetic-object-set', visibleOption: 'CDP Objects' } },
    widgetFixtureMap: { 'tables/object-table/v1': 'objects' },
  });
  assert.equal(scope.automation.mode, 'single-page');
  assert.deepEqual(scope.fixtureProfileNames, ['objects']);
  assert.deepEqual(scope.widgetFixtureMap, { 'tables/object-table/v1': 'objects' });
});

test('rejects empty, zero, HTML, invalid WASM, and invalid font bodies', () => {
  assert.equal(validateBody('js', Buffer.alloc(0)).reason, 'empty-body');
  assert.equal(validateBody('js', Buffer.alloc(4)).reason, 'all-zero-body');
  assert.equal(validateBody('js', Buffer.from('<!doctype html>')).reason, 'html-body-for-js');
  assert.equal(validateBody('wasm', Buffer.from('nope')).reason, 'invalid-wasm-magic');
  assert.equal(validateBody('font', Buffer.from('nope')).reason, 'invalid-font-magic');
  assert.equal(validateBody('font', Buffer.from('wOF2')).accepted, true);
});

test('accepts document-shaped HTML and rejects JSON bodies for html', () => {
  assert.equal(validateBody('html', Buffer.from('<!doctype html><title>Widget</title>')).accepted, true);
  assert.equal(validateBody('html', Buffer.from('<html><body>Widget</body></html>')).accepted, true);
  assert.equal(validateBody('html', Buffer.from(`${' '.repeat(1024)}<!doctype html><title>Widget</title>`)).accepted, true);
  assert.equal(validateBody('html', Buffer.from('{"data":1}')).reason, 'invalid-html-body');
});

test('tracks one cumulative ledger budget', () => {
  const prior = summarizeLedgerEntries([
    { event: 'saved', caseId: 'CASE-1', size: 30 },
    { event: 'saved', caseId: 'CASE-1', size: 20 },
  ], { maxAssets: 3, maxTotalMiB: 1 }, 'CASE-1');
  const tracker = createBudgetTracker(prior, { maxAssets: 3, maxTotalMiB: 1 });
  assert.equal(tracker.reserve(10).accepted, true);
  assert.equal(tracker.reserve(10).reason, 'asset-count-budget-exceeded');
});

test('detects Workshop build IDs in captured JavaScript', () => {
  assert.deepEqual(detectWorkshopBuildIds(Buffer.from(
    '/static/foundry-frontend-workshop/6.464.38/default/asset/workshop-app',
  )), ['6.464.38']);
});
