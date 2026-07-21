import assert from 'node:assert/strict';
import test from 'node:test';

import { buildComponentCoverage } from './component-coverage.mjs';

const base = {
  caseId: 'SEC-1',
  widgetKey: 'tables/object-table/v1',
  label: 'Object Table',
  category: 'Tables',
  capturePage: 'CDP Capture 001',
  visibleInstanceLabel: 'Object Table',
};

function event(state, status, at, overrides = {}) {
  return {
    ...base,
    sourceRun: 'run-1',
    marker: `widget:object-table:a1b2c3d4:${state}`,
    state,
    status,
    required: !['not-applicable', 'not-requested'].includes(status),
    attemptId: `run-1:${state}:${at.slice(-1)}`,
    at: `2026-07-21T00:00:0${at}.000Z`,
    failure: null,
    ...overrides,
  };
}

test('builds deterministic complete and partial component coverage', () => {
  const objectEvents = [
    event('editor-mounted', 'captured', '1'),
    event('viewport-visible', 'captured', '2'),
    event('config-opened', 'failed', '3', { failure: { code: 'panel-timeout', message: 'Panel did not open' } }),
    event('config-opened', 'captured', '4'),
    event('data-bound', 'not-applicable', '5'),
    event('preview-visible', 'captured', '6'),
  ];
  const chartBase = {
    ...base,
    widgetKey: 'charts/line-chart/v2',
    label: 'Line Chart',
    category: 'Charts',
    capturePage: 'CDP Capture 002',
    visibleInstanceLabel: 'Line Chart',
  };
  const chartEvents = [
    event('editor-mounted', 'captured', '1', { ...chartBase, sourceRun: 'run-2', marker: 'widget:line-chart:bbbbbbbb:editor-mounted', attemptId: 'run-2:editor-mounted:1' }),
    event('data-bound', 'blocked-missing-fixture', '2', {
      ...chartBase,
      sourceRun: 'run-2',
      marker: 'widget:line-chart:bbbbbbbb:data-bound',
      attemptId: 'run-2:data-bound:2',
      failure: { code: 'fixture-map-missing', message: 'No approved fixture' },
    }),
  ];
  const manifests = [
    { sourceRun: 'run-1', at: '2026-07-21T00:00:00.000Z', event: 'saved', marker: 'baseline', kind: 'js', sha256: 'base', url: 'https://cdn.example/base.js', size: 10 },
    { sourceRun: 'run-1', at: '2026-07-21T00:00:01.500Z', event: 'saved', marker: 'widget:object-table:a1b2c3d4:editor-mounted', kind: 'js', sha256: 'shared', url: 'https://cdn.example/shared.js', size: 20 },
    { sourceRun: 'run-2', at: '2026-07-21T00:00:02.500Z', event: 'saved', marker: 'widget:line-chart:bbbbbbbb:editor-mounted', kind: 'js', sha256: 'shared', url: 'https://cdn.example/shared.js', size: 20 },
    { sourceRun: 'run-2', at: '2026-07-21T00:00:03.000Z', event: 'saved', marker: 'widget:line-chart:bbbbbbbb:data-bound', kind: 'css', sha256: 'chart', url: 'https://cdn.example/chart.css', size: 30 },
    { sourceRun: 'run-2', at: '2026-07-21T00:00:04.000Z', event: 'body-unavailable', marker: 'widget:line-chart:bbbbbbbb:data-bound', kind: 'js', url: 'https://cdn.example/missing.js', status: 200, requestId: '9' },
  ];

  objectEvents.push({ ...objectEvents[0], at: '2026-07-21T00:00:09.000Z' });
  const coverage = buildComponentCoverage({ caseId: 'SEC-1', events: [...objectEvents, ...chartEvents], manifest: manifests, generatedAt: '2026-07-21T01:00:00.000Z' });
  assert.equal(coverage.schemaVersion, 1);
  assert.equal(coverage.caseId, 'SEC-1');
  assert.equal(coverage.generatedAt, '2026-07-21T01:00:00.000Z');
  assert.deepEqual(coverage.baseline.assets.map((asset) => asset.sha256), ['base']);
  assert.deepEqual(coverage.summary, {
    total: 2,
    complete: 1,
    partial: 1,
    assetRetained: 2,
    assetUnavailable: 0,
    assetNotAttributable: 0,
  });

  const table = coverage.components.find((component) => component.widgetKey === base.widgetKey);
  assert.equal(table.coverageStatus, 'complete');
  assert.equal(table.behaviorCoverageStatus, 'complete');
  assert.equal(table.assetCoverageStatus, 'implementation-body-retained');
  assert.equal(table.states['config-opened'], 'captured');
  assert.equal(table.states['data-bound'], 'not-applicable');
  assert.equal(table.requiredStates.includes('data-bound'), false);
  assert.equal(table.failures[0].code, 'panel-timeout');
  assert.equal(table.attempts.filter((attempt) => attempt.attemptId === objectEvents[0].attemptId).length, 1);
  assert.deepEqual(table.firstObservedAssets.map((asset) => asset.sha256), ['shared']);

  const chart = coverage.components.find((component) => component.widgetKey === chartBase.widgetKey);
  assert.equal(chart.coverageStatus, 'partial');
  assert.equal(chart.behaviorCoverageStatus, 'partial');
  assert.equal(chart.assetCoverageStatus, 'implementation-body-retained');
  assert.deepEqual(chart.blockedStates, ['data-bound']);
  assert.deepEqual(chart.firstObservedAssets.map((asset) => asset.sha256), ['chart']);
  assert.equal(chart.bodyUnavailable[0].requestId, '9');
  assert.deepEqual(chart.attempts.map((attempt) => attempt.at), [...chart.attempts.map((attempt) => attempt.at)].sort());
});

test('groups the same widget key separately by capture page', () => {
  const events = [
    event('editor-mounted', 'captured', '1'),
    event('editor-mounted', 'captured', '2', { capturePage: 'CDP Capture 002', attemptId: 'run-1:editor-mounted:2' }),
  ];
  const coverage = buildComponentCoverage({ caseId: 'SEC-1', events, manifest: [], generatedAt: '2026-07-21T01:00:00.000Z' });
  assert.equal(coverage.components.length, 2);
});

test('uses required event flags and rejects cross-case events', () => {
  const events = [
    event('editor-mounted', 'captured', '1'),
    event('preview-visible', 'captured', '2', { required: false }),
  ];
  const coverage = buildComponentCoverage({ caseId: 'SEC-1', events, manifest: [], generatedAt: '2026-07-21T01:00:00.000Z' });
  assert.deepEqual(coverage.components[0].requiredStates, ['editor-mounted']);
  assert.equal(coverage.components[0].coverageStatus, 'complete');
  assert.equal(coverage.components[0].assetCoverageStatus, 'implementation-body-not-attributable');
  assert.throws(() => buildComponentCoverage({ caseId: 'OTHER', events, manifest: [] }), /caseId mismatch/);
});

test('keeps Catalog discovery assets shared instead of assigning them to the first Widget', () => {
  const events = [event('editor-mounted', 'captured', '1')];
  const manifest = [
    { sourceRun: 'run-1', at: '2026-07-21T00:00:00.000Z', event: 'saved', marker: 'baseline:catalog', kind: 'image', sha256: 'catalog-icon', url: 'https://cdn.example/catalog.svg', size: 10 },
    { sourceRun: 'run-1', at: '2026-07-21T00:00:01.000Z', event: 'saved', marker: events[0].marker, kind: 'js', sha256: 'widget', url: 'https://cdn.example/widget.js', size: 20 },
  ];
  const coverage = buildComponentCoverage({ caseId: 'SEC-1', events, manifest, generatedAt: '2026-07-21T01:00:00.000Z' });
  assert.deepEqual(coverage.baseline.assets.map((asset) => asset.marker), ['baseline:catalog']);
  assert.deepEqual(coverage.components[0].firstObservedAssets.map((asset) => asset.sha256), ['widget']);
});
