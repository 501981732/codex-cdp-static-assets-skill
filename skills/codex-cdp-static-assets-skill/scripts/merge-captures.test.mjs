import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('merges capture runs by SHA-256 and preserves aggregate evidence', async () => {
  const scriptPath = new URL('./merge-captures.mjs', import.meta.url);
  const exists = await access(scriptPath).then(() => true, () => false);
  assert.equal(exists, true, 'merge-captures.mjs must exist');
  const { mergeCaptureDirectories } = await import(pathToFileURL(scriptPath.pathname));

  const root = await mkdtemp(join(tmpdir(), 'merge-captures-'));
  const run1 = join(root, 'run-1');
  const run2 = join(root, 'run-2');
  const output = join(root, 'merged');
  await mkdir(join(run1, 'assets', 'js'), { recursive: true });
  await mkdir(join(run2, 'assets', 'js'), { recursive: true });
  await writeFile(join(run1, 'assets', 'js', 'same.js'), 'same');
  await writeFile(join(run2, 'assets', 'js', 'same.js'), 'same');
  await writeFile(join(run2, 'assets', 'js', 'unique.js'), 'unique');

  const shared = { event: 'saved', kind: 'js', sha256: 'same', size: 4, file: 'assets/js/same.js', marker: 'P0' };
  await writeFile(join(run1, 'manifest.ndjson'), `${JSON.stringify(shared)}\n`);
  await writeFile(join(run2, 'manifest.ndjson'), `${JSON.stringify({ ...shared, marker: 'P1' })}\n${JSON.stringify({ event: 'saved', kind: 'js', sha256: 'unique', size: 6, file: 'assets/js/unique.js', marker: 'P1' })}\n`);
  await writeFile(join(run1, 'summary.json'), JSON.stringify({ captured: 1, totalBytes: 4, bodyFailures: 0, stopReason: 'quit' }));
  await writeFile(join(run2, 'summary.json'), JSON.stringify({ captured: 2, totalBytes: 10, bodyFailures: 1, stopReason: 'unapproved host' }));
  await writeFile(join(run2, 'risk-events.ndjson'), `${JSON.stringify({ kind: 'unapproved-host', host: 'api.example.com' })}\n`);

  const summary = await mergeCaptureDirectories([run1, run2], output);
  assert.deepEqual({
    savedEvents: summary.savedEvents,
    uniqueFiles: summary.uniqueFiles,
    duplicateEvents: summary.duplicateEvents,
    uniqueBytes: summary.uniqueBytes,
    capturedBytes: summary.capturedBytes,
  }, {
    savedEvents: 3,
    uniqueFiles: 2,
    duplicateEvents: 1,
    uniqueBytes: 10,
    capturedBytes: 14,
  });

  const mergedManifest = (await readFile(join(output, 'metadata', 'manifest.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(mergedManifest.length, 2);
  assert.deepEqual(mergedManifest.find((item) => item.sha256 === 'same').markers, ['P0', 'P1']);
  assert.equal((await readFile(join(output, 'metadata', 'risk-events.ndjson'), 'utf8')).includes('api.example.com'), true);
});

test('merges source-run component events into component-assets.json', async () => {
  const { mergeCaptureDirectories } = await import(new URL('./merge-captures.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'merge-component-assets-'));
  const run = join(root, 'capture-run-1');
  const output = join(root, 'merged');
  await mkdir(join(run, 'assets', 'js'), { recursive: true });
  await writeFile(join(run, 'assets', 'js', 'widget.js'), 'widget');
  const marker = 'widget:object-table:a1b2c3d4:editor-mounted';
  await writeFile(join(run, 'manifest.ndjson'), `${JSON.stringify({
    at: '2026-07-21T00:00:01.000Z', event: 'saved', marker, kind: 'js', sha256: 'widget',
    url: 'https://cdn.example/widget.js', size: 6, file: 'assets/js/widget.js',
  })}\n`);
  await writeFile(join(run, 'component-events.ndjson'), `${JSON.stringify({
    caseId: 'SEC-1', widgetKey: 'tables/object-table/v1', label: 'Object Table', category: 'Tables',
    capturePage: 'CDP Capture 001', visibleInstanceLabel: 'Object Table', marker,
    state: 'editor-mounted', status: 'captured', required: true,
    attemptId: 'capture-run-1:editor-mounted:1', at: '2026-07-21T00:00:01.000Z', failure: null,
  })}\n`);

  const summary = await mergeCaptureDirectories([run], output);
  const coverage = JSON.parse(await readFile(join(output, 'metadata', 'component-assets.json'), 'utf8'));
  const mergedEvents = (await readFile(join(output, 'metadata', 'component-events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(coverage.components[0].attempts[0].sourceRun, 'capture-run-1');
  assert.equal(mergedEvents[0].sourceRun, 'capture-run-1');
  assert.equal(coverage.caseId, 'SEC-1');
  assert.deepEqual({
    componentCount: summary.componentCount,
    completeComponents: summary.completeComponents,
    partialComponents: summary.partialComponents,
  }, { componentCount: 1, completeComponents: 1, partialComponents: 0 });
});

test('refuses to merge component evidence from different case IDs', async () => {
  const { mergeCaptureDirectories } = await import(new URL('./merge-captures.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'merge-case-boundary-'));
  const run1 = join(root, 'run-1');
  const run2 = join(root, 'run-2');
  await mkdir(run1, { recursive: true });
  await mkdir(run2, { recursive: true });
  const event = (caseId, run) => ({
    caseId, widgetKey: 'tables/object-table/v1', label: 'Object Table', category: 'Tables', capturePage: 'CDP Capture 001',
    visibleInstanceLabel: 'Object Table', marker: 'widget:object-table:a1b2c3d4:editor-mounted', state: 'editor-mounted',
    status: 'captured', required: true, attemptId: `${run}:editor-mounted:1`, at: '2026-07-21T00:00:00.000Z', failure: null,
  });
  await writeFile(join(run1, 'component-events.ndjson'), `${JSON.stringify(event('SEC-1', 'run-1'))}\n`);
  await writeFile(join(run2, 'component-events.ndjson'), `${JSON.stringify(event('SEC-2', 'run-2'))}\n`);
  await assert.rejects(mergeCaptureDirectories([run1, run2], join(root, 'merged')), /different caseIds/);
});

test('rejects missing case IDs and overrides untrusted sourceRun fields', async () => {
  const { mergeCaptureDirectories } = await import(new URL('./merge-captures.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'merge-source-boundary-'));
  const brokenRun = join(root, 'broken-run');
  await mkdir(brokenRun, { recursive: true });
  await writeFile(join(brokenRun, 'component-events.ndjson'), `${JSON.stringify({ widgetKey: 'tables/object-table/v1' })}\n`);
  await assert.rejects(mergeCaptureDirectories([brokenRun], join(root, 'broken-output')), /missing caseId/);

  const run = join(root, 'trusted-run');
  await mkdir(run, { recursive: true });
  await writeFile(join(run, 'component-events.ndjson'), `${JSON.stringify({
    caseId: 'SEC-1', sourceRun: 'forged-run', widgetKey: 'tables/object-table/v1', label: 'Object Table', category: 'Tables',
    capturePage: 'CDP Capture 001', visibleInstanceLabel: 'Object Table', marker: 'widget:object-table:a1b2c3d4:editor-mounted',
    state: 'editor-mounted', status: 'captured', required: true, attemptId: 'trusted-run:editor-mounted:1',
    at: '2026-07-21T00:00:00.000Z', failure: null,
  })}\n`);
  await mergeCaptureDirectories([run], join(root, 'trusted-output'));
  const events = (await readFile(join(root, 'trusted-output', 'metadata', 'component-events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].sourceRun, 'trusted-run');
});

test('refuses to merge capture runs from different known Workshop builds', async () => {
  const { mergeCaptureDirectories } = await import(new URL('./merge-captures.mjs', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'merge-captures-builds-'));
  const run1 = join(root, 'run-1');
  const run2 = join(root, 'run-2');
  const output = join(root, 'merged');
  await mkdir(run1, { recursive: true });
  await mkdir(run2, { recursive: true });
  await writeFile(join(run1, 'summary.json'), JSON.stringify({ workshopBuildIds: ['6.464.38'] }));
  await writeFile(join(run2, 'summary.json'), JSON.stringify({ workshopBuildIds: ['6.465.0'] }));

  await assert.rejects(
    mergeCaptureDirectories([run1, run2], output),
    /Workshop build mismatch/,
  );
  assert.equal(await access(output).then(() => true, () => false), false);
});
