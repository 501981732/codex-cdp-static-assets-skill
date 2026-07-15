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
  assert.deepEqual(scopeHost('wss://events.example.com/socket', ['events.example.com']), {
    network: true,
    allowed: true,
    host: 'events.example.com',
  });
});

test('keeps the marker from request start when the response arrives after a later marker', () => {
  assert.equal(typeof collector.selectResourceMarker, 'function');
  assert.equal(collector.selectResourceMarker({ marker: 'P2:table:mounted' }, 'P3:chart:mounted'), 'P2:table:mounted');
  assert.equal(collector.selectResourceMarker({}, 'P3:chart:mounted'), 'P3:chart:mounted');
});

test('budget reservations cannot exceed a hard limit under concurrent completions', async () => {
  assert.equal(typeof collector.createBudgetTracker, 'function');
  const tracker = collector.createBudgetTracker(
    { captured: 0, totalBytes: 0 },
    { maxAssets: 1, maxTotalMiB: 1, maxAssetMiB: 50 },
  );
  const results = await Promise.all([
    Promise.resolve().then(() => tracker.reserve(10)),
    Promise.resolve().then(() => tracker.reserve(10)),
  ]);
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.deepEqual(tracker.snapshot(), {
    captured: 1,
    totalBytes: 10,
    remainingAssets: 0,
    remainingBytes: 1048566,
  });
});

test('shutdown drains completed response work before closing CDP', async () => {
  assert.equal(typeof collector.closeAfterPending, 'function');
  const events = [];
  const pending = new Set();
  const task = new Promise((resolve) => setTimeout(resolve, 5))
    .then(() => events.push('body-saved'))
    .finally(() => pending.delete(task));
  pending.add(task);
  const outcome = await collector.closeAfterPending({ close: () => events.push('cdp-closed') }, pending, 100);
  assert.equal(outcome, 'settled');
  assert.deepEqual(events, ['body-saved', 'cdp-closed']);
});

test('detects Workshop build IDs from already captured JavaScript', () => {
  assert.equal(typeof collector.detectWorkshopBuildIds, 'function');
  assert.deepEqual(collector.detectWorkshopBuildIds(Buffer.from(`
    "__wizard_sls_asset_version__": "6.464.38",
    "__wizard_sls_asset_static_endpoint__": "/static/foundry-frontend-workshop/6.464.38/default/asset/workshop-app"
  `)), ['6.464.38']);
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

test('skill prefers explicit autoConnect authorization for the default Chrome profile', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /--autoConnect/);
  assert.match(skill, /chrome:\/\/inspect\/#remote-debugging/);
  assert.match(skill, /list_network_requests/);
  assert.match(skill, /get_network_request/);
  assert.match(skill, /import-mcp-response\.mjs/);
  assert.match(skill, /Chrome 144/);
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

test('preflight selects the approved page and ignores unrelated top-level tabs', () => {
  assert.equal(typeof collector.findPageTargetIssues, 'function');
  assert.equal(typeof collector.selectApprovedPageTarget, 'function');
  const selection = collector.selectApprovedPageTarget([
    { targetId: '1', type: 'page', url: 'https://app.example.com/workshop' },
    { targetId: '2', type: 'page', url: 'https://www.google.com/search?q=test' },
    { targetId: '3', type: 'service_worker', url: 'chrome-extension://abc/background.js' },
  ], ['app.example.com']);

  assert.equal(selection.target.targetId, '1');
  assert.deepEqual(selection.issues, []);
});

test('preflight stops when the approved page is missing or ambiguous', () => {
  const missing = collector.findPageTargetIssues([
    { targetId: '1', type: 'page', url: 'https://www.google.com/' },
  ], ['app.example.com']);
  assert.deepEqual(missing, [{ kind: 'approved-page-target-not-found' }]);

  const ambiguous = collector.findPageTargetIssues([
    { targetId: '1', type: 'page', url: 'https://app.example.com/workshop/a' },
    { targetId: '2', type: 'page', url: 'https://app.example.com/workshop/b' },
    { targetId: '3', type: 'page', url: 'https://unrelated.example.net/' },
  ], ['app.example.com']);
  assert.deepEqual(ambiguous, [{ kind: 'multiple-approved-page-targets', count: 2 }]);
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

test('collector attaches only to the selected approved page target', async () => {
  const source = await readFile(new URL('./capture-static-assets.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('selectedPageTarget.targetId'), true);
  assert.equal(source.includes('initialTargetInfos.filter((item) => TARGET_TYPES.has(item.type)'), false);
  assert.equal(source.includes("client.on('Target.attachedToTarget', (params, parentSessionId)"), true);
  assert.equal(source.includes('!sessions.has(parentSessionId)'), true);
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
    'log in before discovery',
  ]) {
    assert.equal(combined.includes(requirement), true, `missing workflow requirement: ${requirement}`);
  }
});

test('skill defaults to operator-driven UI with Codex-managed capture and optional hard totals', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const scopeReference = await readFile(new URL('../references/scope-config.md', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../references/workshop-runbook.md', import.meta.url), 'utf8');
  const combined = `${skill}\n${scopeReference}\n${runbook}`.toLowerCase();
  for (const requirement of [
    'codex manages the collector',
    'operator controls the visible browser',
    'hard cumulative limits are optional',
    'do not save raw html',
    'visible-and-covered',
    'registered-not-visible',
  ]) {
    assert.equal(combined.includes(requirement), true, `missing low-intrusion workflow requirement: ${requirement}`);
  }
});

test('Workshop workflow uses a baseline gate and one bounded page session per batch', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../references/workshop-runbook.md', import.meta.url), 'utf8');
  const combined = `${skill}\n${runbook}`.toLowerCase();
  for (const requirement of [
    'baseline classification gate',
    'preloaded',
    'lazy-load batches',
    'one selected page',
    'one marker per batch',
    'component-level markers are optional',
    'audit every run',
    'merge once at the end',
  ]) {
    assert.equal(combined.includes(requirement), true, `missing Workshop workflow requirement: ${requirement}`);
  }
});

test('workflow makes autosave and discovery cache tradeoffs explicit', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const scopeReference = await readFile(new URL('../references/scope-config.md', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../references/workshop-runbook.md', import.meta.url), 'utf8');
  const combined = `${skill}\n${scopeReference}\n${runbook}`.toLowerCase();
  for (const requirement of [
    'component addition may autosave',
    'written scope must explicitly allow',
    'default chrome',
    'reuse authenticated state in place',
    'fresh capture profile requires owner approval',
    'never clear cache',
    'never transfer',
  ]) {
    assert.equal(combined.includes(requirement), true, `missing safety guidance: ${requirement}`);
  }
});

test('Chinese README is a conversation-first Codex user manual', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (readme === null) return;
  for (const requirement of [
    '30 秒开始',
    '$codex-cdp-static-assets-skill',
    '你负责登录、刷新、添加组件和预览',
    '默认 Chrome 登录态',
    '--autoConnect',
    'chrome://inspect/#remote-debugging',
    '严格基线完成',
    '判断是否按需加载',
    '不再要求 `127.0.0.1:9222` 或新建 Profile',
    'P1 完成',
    '全部完成',
    '我不知道 CDN',
    'get_network_request',
  ]) {
    assert.equal(readme.includes(requirement), true, `README missing Codex user guidance: ${requirement}`);
  }
  assert.equal(readme.split('\n').length <= 280, true, 'Chinese README should stay concise');
  assert.equal(readme.includes('开始 P2:ObjectTable:edit-mounted'), false, 'README must not require per-component markers by default');
  assert.equal(readme.includes('$capture-static-assets-cdp'), false, 'README must not advertise the retired invocation name');
});

test('English README describes the same simple Workshop workflow', async () => {
  const readme = await readFile(new URL('../../../README.en.md', import.meta.url), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (readme === null) return;
  for (const requirement of [
    'reuse the default chrome login',
    '--autoconnect',
    'chrome://inspect/#remote-debugging',
    'list_network_requests',
    'get_network_request',
    'do not launch a second chrome profile',
  ]) {
    assert.equal(readme.toLowerCase().includes(requirement), true, `English README missing guidance: ${requirement}`);
  }
  assert.equal(readme.split('\n').length <= 190, true, 'English README should stay concise');
});

test('skill identity matches the public repository name', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const agent = await readFile(new URL('../agents/openai.yaml', import.meta.url), 'utf8');
  assert.match(skill, /^---\nname: codex-cdp-static-assets-skill\n/m);
  assert.equal(agent.includes('$codex-cdp-static-assets-skill'), true);
  assert.equal(agent.includes('$capture-static-assets-cdp'), false);
});
