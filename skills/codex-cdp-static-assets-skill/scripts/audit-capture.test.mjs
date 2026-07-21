import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCapture } from './audit-capture.mjs';

test('audits saved assets and flags an all-zero JavaScript file', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cdp-audit-'));
  const jsDir = join(output, 'assets', 'js');
  await mkdir(jsDir, { recursive: true });
  await writeFile(join(jsDir, 'zero.js'), Buffer.alloc(8));
  await writeFile(join(jsDir, 'valid.js'), '(()=>{})();');

  const report = await auditCapture(output);
  assert.equal(report.totalFiles, 2);
  assert.equal(report.validFiles, 1);
  assert.deepEqual(report.invalid, [{ file: 'assets/js/zero.js', reason: 'all-zero-body' }]);
});

test('audits HTML bodies using their manifest kind', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cdp-audit-html-'));
  const htmlDir = join(output, 'assets', 'html');
  await mkdir(htmlDir, { recursive: true });
  const valid = Buffer.from('<!doctype html><title>Workshop</title>');
  const invalid = Buffer.from('{"api":true}');
  const validSha = createHash('sha256').update(valid).digest('hex');
  const invalidSha = createHash('sha256').update(invalid).digest('hex');
  await writeFile(join(htmlDir, `${validSha}.html`), valid);
  await writeFile(join(htmlDir, `${invalidSha}.html`), invalid);
  await writeFile(join(output, 'manifest.ndjson'), [
    { event: 'saved', kind: 'html', sha256: validSha, file: `assets/html/${validSha}.html` },
    { event: 'saved', kind: 'html', sha256: invalidSha, file: `assets/html/${invalidSha}.html` },
  ].map(JSON.stringify).join('\n'));

  const report = await auditCapture(output);
  assert.equal(report.validFiles, 1);
  assert.deepEqual(report.invalid, [{ file: `assets/html/${invalidSha}.html`, reason: 'invalid-html-body' }]);
});

test('audits component-assets schema, asset references, attempts, and status consistency', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cdp-audit-components-'));
  const metadata = join(output, 'metadata');
  await mkdir(join(output, 'assets', 'cdn.example.com'), { recursive: true });
  await mkdir(metadata, { recursive: true });
  const body = Buffer.from('widget');
  const sha256 = createHash('sha256').update(body).digest('hex');
  await writeFile(join(output, 'assets', 'cdn.example.com', 'widget.js'), body);
  await writeFile(join(metadata, 'manifest.ndjson'), `${JSON.stringify({
    event: 'saved', kind: 'js', sha256, url: 'https://cdn.example.com/widget.js', file: 'assets/cdn.example.com/widget.js',
  })}\n`);
  const editorAttempt = {
    caseId: 'SEC-1', sourceRun: 'run-1', attemptId: 'run-1:editor-mounted:1', widgetKey: 'tables/object-table/v1', capturePage: 'CDP Capture 001',
  };
  const viewportAttempt = {
    caseId: 'SEC-1', sourceRun: 'run-1', attemptId: 'run-1:viewport-visible:2', widgetKey: 'tables/object-table/v1', capturePage: 'CDP Capture 001',
  };
  await writeFile(join(metadata, 'component-events.ndjson'), `${JSON.stringify(editorAttempt)}\n${JSON.stringify(viewportAttempt)}\n`);
  await writeFile(join(metadata, 'merge-summary.json'), JSON.stringify({ componentCount: 1 }));
  await writeFile(join(metadata, 'component-assets.json'), JSON.stringify({
    schemaVersion: 1,
    caseId: 'SEC-1',
    generatedAt: '2026-07-21T00:00:00.000Z',
    summary: { total: 1, complete: 0, partial: 1 },
    baseline: { marker: 'baseline', status: 'captured', assets: [], bodyUnavailable: [], failures: [] },
    components: [{
      widgetKey: 'tables/object-table/v1', label: 'Object Table', category: 'Tables', capturePage: 'CDP Capture 001',
      visibleInstanceLabel: 'Object Table', marker: 'widget:object-table:a1b2c3d4', coverageStatus: 'partial',
      requiredStates: ['editor-mounted', 'viewport-visible'], coveredStates: ['editor-mounted'], blockedStates: ['viewport-visible'],
      states: { 'editor-mounted': 'captured', 'viewport-visible': 'failed' },
      attempts: [
        { sourceRun: 'run-1', attemptId: 'run-1:editor-mounted:1', at: '2026-07-21T00:00:00.000Z', state: 'editor-mounted', status: 'captured', required: true, failure: null },
        { sourceRun: 'run-1', attemptId: 'run-1:viewport-visible:2', at: '2026-07-21T00:00:01.000Z', state: 'viewport-visible', status: 'failed', required: true, failure: { code: 'timeout', message: 'Not visible' } },
      ],
      firstObservedAssets: [{ kind: 'js', sha256, url: 'https://cdn.example.com/widget.js', size: 6 }],
      bodyUnavailable: [], failures: [],
    }],
  }));

  const report = await auditCapture(output);
  assert.deepEqual(report.componentMap, { present: true, componentCount: 1, completeComponents: 0, partialComponents: 1 });
  assert.deepEqual(report.invalid, []);

  const invalidMap = JSON.parse(await readFile(join(metadata, 'component-assets.json'), 'utf8'));
  invalidMap.components[0].coverageStatus = 'complete';
  invalidMap.summary = { total: 1, complete: 1, partial: 0 };
  invalidMap.components[0].requiredStates = ['editor-mounted'];
  invalidMap.components[0].states['viewport-visible'] = 'missing';
  invalidMap.components[0].blockedStates = [];
  invalidMap.components[0].firstObservedAssets.push({ kind: 'css', sha256: 'missing', url: 'https://cdn.example.com/missing.css', size: 1 });
  invalidMap.components[0].attempts[0].attemptId = 'not-recorded';
  await writeFile(join(metadata, 'component-assets.json'), JSON.stringify(invalidMap));
  const invalidReport = await auditCapture(output);
  assert.deepEqual(invalidReport.invalid.map((entry) => entry.reason).sort(), [
    'component-asset-not-in-manifest',
    'component-attempt-not-in-events',
    'component-coverage-status-inconsistent',
    'component-required-states-inconsistent',
  ]);
});
