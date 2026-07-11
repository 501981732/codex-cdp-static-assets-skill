import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyResource,
  hostIsAllowed,
  normalizeScope,
  redactUrl,
  scopeHost,
  summarizeHostObservations,
  validateBody,
  waitForPending,
} from './capture-static-assets.mjs';

test('classifies the static resource types in scope', () => {
  assert.equal(classifyResource({ type: 'Script', mimeType: 'text/javascript', url: 'https://cdn.test/app' }), 'js');
  assert.equal(classifyResource({ type: 'Stylesheet', mimeType: 'text/css', url: 'https://cdn.test/app' }), 'css');
  assert.equal(classifyResource({ type: 'Other', mimeType: 'application/wasm', url: 'https://cdn.test/module' }), 'wasm');
  assert.equal(classifyResource({ type: 'Font', mimeType: 'font/woff2', url: 'https://cdn.test/font' }), 'font');
  assert.equal(classifyResource({ type: 'Fetch', mimeType: 'application/json', url: 'https://cdn.test/api' }), null);
});

test('redacts all query values and fragments from stored URLs', () => {
  assert.equal(
    redactUrl('https://cdn.test/app.js?v=123&token=secret#fragment'),
    'https://cdn.test/app.js?v=%5BREDACTED%5D&token=%5BREDACTED%5D',
  );
});

test('matches exact and wildcard allowlisted hosts', () => {
  assert.equal(hostIsAllowed('app.example.com', ['app.example.com']), true);
  assert.equal(hostIsAllowed('cdn.example.com', ['*.example.com']), true);
  assert.equal(hostIsAllowed('example.com', ['*.example.com']), false);
  assert.equal(hostIsAllowed('example.net', ['*.example.com']), false);
});

test('distinguishes approved, unapproved, and non-network URLs', () => {
  assert.deepEqual(scopeHost('https://cdn.example.com/app.js', ['*.example.com']), {
    network: true,
    allowed: true,
    host: 'cdn.example.com',
  });
  assert.deepEqual(scopeHost('https://outside.test/app.js', ['*.example.com']), {
    network: true,
    allowed: false,
    host: 'outside.test',
  });
  assert.deepEqual(scopeHost('data:text/javascript,ok', ['*.example.com']), {
    network: false,
    allowed: false,
    host: null,
  });
});

test('bounds shutdown when a CDP request never settles', async () => {
  const never = new Promise(() => {});
  const outcome = await waitForPending(new Set([never]), 5);
  assert.equal(outcome, 'timed-out');
});

test('normalizes an explicit scope without auto-approving observed CDNs', () => {
  const scope = normalizeScope({
    caseId: 'SEC-42',
    pageHosts: ['workshop.example.com'],
    assetHosts: ['cdn.example.com'],
    limits: { maxAssets: 20, maxTotalMiB: 40 },
  });
  assert.deepEqual(scope.approvedNetworkHosts, ['workshop.example.com', 'cdn.example.com']);
  assert.equal(scope.limits.maxAssets, 20);
  assert.equal(scope.limits.maxTotalMiB, 40);
});

test('rejects zero and HTML bodies before they become JavaScript assets', () => {
  assert.deepEqual(validateBody('js', Buffer.alloc(12)), { accepted: false, reason: 'all-zero-body' });
  assert.deepEqual(validateBody('css', Buffer.from('<!doctype html><title>Denied</title>')), { accepted: false, reason: 'html-body-for-css' });
  assert.deepEqual(validateBody('wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])), { accepted: true, reason: null });
  assert.deepEqual(validateBody('font', Buffer.from('wOF2')), { accepted: true, reason: null });
});

test('summarizes discovery observations without treating them as approval', () => {
  const summary = summarizeHostObservations([
    { host: 'cdn.example.com', kind: 'js', mimeType: 'application/javascript' },
    { host: 'cdn.example.com', kind: 'css', mimeType: 'text/css' },
    { host: 'fonts.example.net', kind: 'font', mimeType: 'font/woff2' },
  ]);
  assert.deepEqual(summary, [
    { host: 'cdn.example.com', requests: 2, kinds: ['css', 'js'], mimeTypes: ['application/javascript', 'text/css'] },
    { host: 'fonts.example.net', requests: 1, kinds: ['font'], mimeTypes: ['font/woff2'] },
  ]);
});

test('collector contains no active retrieval or page-driving CDP methods', async () => {
  const source = await readFile(new URL('./capture-static-assets.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('enableDurableMessages: true'), true, 'response bodies must survive renderer lifecycle changes');
  for (const forbidden of [
    'Network.loadNetworkResource',
    'Network.setCacheDisabled',
    'Network.setBypassServiceWorker',
    'Page.navigate',
    'Page.reload',
    'Runtime.evaluate',
    'CacheStorage.',
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden active method: ${forbidden}`);
  }
});
