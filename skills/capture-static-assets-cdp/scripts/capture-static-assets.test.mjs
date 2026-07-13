import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as collector from './capture-static-assets.mjs';

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

test('discovery summarizes static and network-only hosts for batch approval', () => {
  assert.equal(typeof collector.summarizeNetworkObservations, 'function');
  const summary = collector.summarizeNetworkObservations([
    { host: 'cdn.example.com', kind: 'js', mimeType: 'application/javascript', resourceType: 'Script' },
    { host: 'api.example.com', kind: null, mimeType: 'application/json', resourceType: 'Fetch' },
    { host: 'images.example.com', kind: 'image', mimeType: 'image/png', resourceType: 'Image' },
  ], new Set(['js', 'css', 'wasm', 'font']), ['app.example.com']);

  assert.deepEqual(summary.scopeCandidates, {
    assetHosts: ['cdn.example.com'],
    approvedNetworkHosts: ['api.example.com', 'images.example.com'],
  });
  assert.equal(summary.hosts.find((item) => item.host === 'api.example.com').role, 'network-only');
});

test('task ledger enforces one cumulative budget across capture runs', () => {
  assert.equal(typeof collector.summarizeLedgerEntries, 'function');
  const budget = collector.summarizeLedgerEntries([
    { event: 'saved', caseId: 'CASE-1', size: 30 },
    { event: 'saved', caseId: 'CASE-1', size: 20 },
    { event: 'body-unavailable', caseId: 'CASE-1', size: 0 },
  ], { maxAssets: 3, maxTotalMiB: 1, maxAssetMiB: 50 }, 'CASE-1');

  assert.deepEqual(budget, {
    captured: 2,
    totalBytes: 50,
    remainingAssets: 1,
    remainingBytes: 1048526,
  });
  assert.throws(() => collector.summarizeLedgerEntries([
    { event: 'saved', caseId: 'OTHER', size: 1 },
  ], { maxAssets: 3, maxTotalMiB: 1, maxAssetMiB: 50 }, 'CASE-1'), /caseId/);
});

test('preflight identifies unrelated or excess page targets', () => {
  assert.equal(typeof collector.findPageTargetIssues, 'function');
  const issues = collector.findPageTargetIssues([
    { targetId: '1', type: 'page', url: 'https://app.example.com/workshop' },
    { targetId: '2', type: 'page', url: 'https://www.google.com/search?q=test' },
    { targetId: '3', type: 'service_worker', url: 'chrome-extension://abc/background.js' },
  ], ['app.example.com']);

  assert.deepEqual(issues.map((item) => item.kind), ['unapproved-page-target', 'multiple-page-targets']);
});

test('extension targets are ignored instead of logged as attachment risks', () => {
  assert.equal(typeof collector.isIgnorableTarget, 'function');
  assert.equal(collector.isIgnorableTarget({ type: 'service_worker', url: 'chrome-extension://abc/background.js' }), true);
  assert.equal(collector.isIgnorableTarget({ type: 'service_worker', url: 'https://app.example.com/sw.js' }), false);
});

test('collector validates and opens CDP before creating the output directory', async () => {
  const source = await readFile(new URL('./capture-static-assets.mjs', import.meta.url), 'utf8');
  const endpointFetch = source.indexOf("fetch(new URL('/json/version', options.endpoint))");
  const outputCreation = source.indexOf('mkdir(options.output, { recursive: false })');
  assert.notEqual(endpointFetch, -1);
  assert.notEqual(outputCreation, -1);
  assert.equal(endpointFetch < outputCreation, true);
});

test('status exposes target and network diagnostics', async () => {
  const source = await readFile(new URL('./capture-static-assets.mjs', import.meta.url), 'utf8');
  for (const field of ['attachedTargets', 'networkEvents', 'lastNetworkEventAt', 'targetEventCounts']) {
    assert.equal(source.includes(field), true, `missing status diagnostic: ${field}`);
  }
});

test('skill workflow requires batch approval, cumulative budget, and merged delivery', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const scopeReference = await readFile(new URL('../references/scope-config.md', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../references/workshop-runbook.md', import.meta.url), 'utf8');
  const combined = `${skill}\n${scopeReference}\n${runbook}`;
  for (const requirement of [
    'scope-candidates.json',
    'observed-network-hosts.json',
    '--ledger',
    'merge-captures.mjs',
    'batch approval',
    'log in before starting discovery',
  ]) {
    assert.equal(combined.includes(requirement), true, `missing workflow requirement: ${requirement}`);
  }
});
