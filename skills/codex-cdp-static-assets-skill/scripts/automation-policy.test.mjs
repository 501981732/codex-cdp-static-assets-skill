import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCatalogQueue,
  canonicalWidgetKey,
  classifyBaselineGate,
  createCatalogCompletionTracker,
  createNetworkStabilityTracker,
  markerForWidget,
  normalizeAutomationPolicy,
  planCapturePage,
  planResume,
  runAutomationPolicyCli,
} from './automation-policy.mjs';

const states = ['editor-mounted', 'viewport-visible', 'config-opened', 'data-bound', 'preview-visible'];

function validInput(overrides = {}) {
  return {
    fixtureProfiles: {
      objectSet: { kind: 'synthetic-object-set', visibleOption: 'CDP Synthetic Objects' },
    },
    widgetFixtureMap: { 'tables/object-table/v1': 'objectSet' },
    ...overrides,
    automation: {
      enabled: true,
      mode: 'full-catalog',
      allowAutosave: true,
      allowCreateCapturePages: true,
      maxWidgetsPerPage: 8,
      states,
      ...overrides.automation,
    },
  };
}

test('normalizes and freezes a fully authorized automation policy', () => {
  const policy = normalizeAutomationPolicy(validInput());
  assert.equal(policy.enabled, true);
  assert.equal(policy.mode, 'full-catalog');
  assert.equal(policy.maxWidgetsPerPage, 8);
  assert.deepEqual(policy.states, states);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.states), true);
  assert.deepEqual(policy.fixtureProfileNames, ['objectSet']);
});

test('rejects incomplete or unsafe automation authorization', () => {
  assert.throws(() => normalizeAutomationPolicy({ automation: { mode: 'full-catalog' } }), /explicit boolean/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ automation: { allowAutosave: false } })), /allowAutosave/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ automation: { allowCreateCapturePages: false } })), /allowCreateCapturePages/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ automation: { mode: 'single-page', allowCreateCapturePages: true } })), /single-page/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ automation: { maxWidgetsPerPage: 0 } })), /maxWidgetsPerPage/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ automation: { mode: 'other' } })), /mode/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ automation: { states: ['editor-mounted', 'hidden-state'] } })), /state/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ fixtureProfiles: { broken: { kind: 'synthetic' } } })), /visibleOption/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ widgetFixtureMap: { 'tables/object-table/v1': 'missing' } })), /unknown fixture profile/);
  assert.throws(() => normalizeAutomationPolicy(validInput({ fallbackDataSource: 'production' })), /real data source fallback/);
});

test('supports explicitly disabled automation without fixture authorization', () => {
  assert.deepEqual(normalizeAutomationPolicy({ automation: { enabled: false } }), Object.freeze({ enabled: false }));
});

test('builds stable widget identities and deduplicates cross-snapshot observations', () => {
  const entry = { label: 'Object Table', category: 'Tables', versionOrType: 'v1' };
  assert.equal(canonicalWidgetKey(entry), 'tables/object-table/v1');
  assert.deepEqual(buildCatalogQueue([
    { snapshotId: 's1', entries: [entry] },
    { snapshotId: 's2', entries: [entry] },
  ]).map((item) => item.widgetKey), ['tables/object-table/v1']);
  assert.throws(() => buildCatalogQueue([
    { snapshotId: 's1', entries: [entry, { ...entry }] },
  ]), /catalog-identity-ambiguity/);
  assert.match(markerForWidget('tables/object-table/v1', 'data-bound'), /^widget:object-table:[a-f0-9]{8}:data-bound$/);
});

test('requires bottom discovery plus two consecutive snapshots without a new widget', () => {
  const tracker = createCatalogCompletionTracker();
  assert.deepEqual(tracker.update([{ label: 'Table', category: 'Data', versionOrType: 'v1' }], false), { complete: false, stableCount: 0, totalKeys: 1 });
  assert.deepEqual(tracker.update([{ label: 'Table', category: 'Data', versionOrType: 'v1' }], true), { complete: false, stableCount: 1, totalKeys: 1 });
  assert.deepEqual(tracker.update([{ label: 'Table', category: 'Data', versionOrType: 'v1' }], true), { complete: true, stableCount: 2, totalKeys: 1 });
  assert.deepEqual(tracker.update([{ label: 'Chart', category: 'Data', versionOrType: 'v1' }], true), { complete: false, stableCount: 0, totalKeys: 2 });
  assert.throws(() => tracker.update([
    { label: 'Chart', category: 'Data', versionOrType: 'v1' },
    { label: 'Chart', category: 'Data', versionOrType: 'v1' },
  ], true), /catalog-identity-ambiguity/);
});

test('requires baseline plus two identical network observations and resets on change', () => {
  const tracker = createNetworkStabilityTracker();
  const requests = [{ requestId: '2', status: 200 }, { requestId: '1', status: 304 }];
  assert.equal(tracker.update(requests).stable, false);
  assert.equal(tracker.update([...requests].reverse()).stable, false);
  assert.equal(tracker.update(requests).stable, true);
  assert.deepEqual(tracker.update([...requests, { requestId: '3', status: 200 }]), { stable: false, stableCount: 0, fingerprint: '1:304|2:200|3:200' });
});

test('plans baseline, capacity, and state-level resume deterministically', () => {
  assert.equal(classifyBaselineGate({ automationEnabled: true, classification: 'preloaded' }), 'continue');
  assert.equal(classifyBaselineGate({ automationEnabled: false, classification: 'preloaded' }), 'stop');
  assert.deepEqual(planCapturePage({ count: 8, maxWidgetsPerPage: 8, allowCreateCapturePages: false }), { accepted: false, reason: 'blocked-page-capacity' });
  assert.deepEqual(planCapturePage({ count: 8, maxWidgetsPerPage: 8, allowCreateCapturePages: true, pageCount: 1 }), { accepted: true, createPage: true, capturePage: 'CDP Capture 002' });
  assert.deepEqual(planResume({ completedStates: ['editor-mounted'], added: true, fixtureAvailable: false, visibleMatches: 1 }), {
    action: 'resume-existing',
    missingStates: ['viewport-visible', 'config-opened', 'data-bound', 'preview-visible'],
    dataState: 'blocked-missing-fixture',
  });
  assert.deepEqual(planResume({ completedStates: [], added: true, fixtureAvailable: true, visibleMatches: 2 }), {
    action: 'blocked',
    reason: 'blocked-existing-instance-ambiguous',
  });
  assert.equal(planResume({ completedStates: [], added: false, fixtureAvailable: true, visibleMatches: 1 }).action, 'resume-existing');
  assert.deepEqual(planResume({ completedStates: [], added: true, fixtureAvailable: true, visibleMatches: 0 }), {
    action: 'blocked',
    reason: 'blocked-existing-instance-ambiguous',
  });
});

test('CLI state files retain only canonical keys or request fingerprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automation-policy-'));
  const catalogState = join(root, 'catalog-state.json');
  const networkState = join(root, 'network-state.json');
  await runAutomationPolicyCli(['catalog-update', '--state', catalogState, '--entries-json', JSON.stringify([
    { label: 'Object Table', category: 'Tables', versionOrType: 'v1', dom: '<secret>', cookie: 'secret' },
  ]), '--at-bottom', 'true']);
  await runAutomationPolicyCli(['network-update', '--state', networkState, '--requests-json', JSON.stringify([
    { requestId: '1', status: 200, headers: { authorization: 'secret' } },
  ])]);
  const catalog = JSON.parse(await readFile(catalogState, 'utf8'));
  const network = JSON.parse(await readFile(networkState, 'utf8'));
  assert.deepEqual(Object.keys(catalog).sort(), ['atBottom', 'keys', 'stableCount']);
  assert.deepEqual(catalog.keys, ['tables/object-table/v1']);
  assert.deepEqual(Object.keys(network).sort(), ['fingerprint', 'stableCount']);
  assert.equal(JSON.stringify([catalog, network]).includes('secret'), false);
});

test('catalog-update CLI stops on indistinguishable same-snapshot widgets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automation-policy-ambiguity-'));
  await assert.rejects(runAutomationPolicyCli([
    'catalog-update',
    '--state', join(root, 'catalog-state.json'),
    '--entries-json', JSON.stringify([
      { label: 'Chart', category: 'Data', versionOrType: 'v1' },
      { label: 'Chart', category: 'Data', versionOrType: 'v1' },
    ]),
    '--at-bottom', 'false',
  ]), /catalog-identity-ambiguity/);
});
