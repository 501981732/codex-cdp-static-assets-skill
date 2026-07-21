import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordComponentState, runRecordComponentStateCli, validateComponentEvent } from './record-component-state.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'component-state-'));
  const scopePath = join(root, 'scope.json');
  const output = join(root, 'capture-run-1');
  await writeFile(scopePath, JSON.stringify({ caseId: 'SEC-1', pageHosts: ['workshop.example.com'] }));
  return { root, scopePath, output };
}

function validEvent(overrides = {}) {
  return {
    caseId: 'SEC-1',
    widgetKey: 'tables/object-table/v1',
    label: 'Object Table',
    category: 'Tables',
    capturePage: 'CDP Capture 001',
    visibleInstanceLabel: 'Object Table',
    marker: 'widget:object-table:a1b2c3d4:data-bound',
    state: 'data-bound',
    status: 'captured',
    required: true,
    attemptId: 'capture-run-1:data-bound:1',
    at: '2026-07-21T00:00:00.000Z',
    failure: null,
    ...overrides,
  };
}

test('validates and appends a complete component state event', async () => {
  const paths = await fixture();
  const result = await recordComponentState({ scopePath: paths.scopePath, output: paths.output, event: validEvent() });
  assert.deepEqual(result, validEvent());
  const events = (await readFile(join(paths.output, 'component-events.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events, [validEvent()]);
});

test('rejects unknown states, statuses, missing identity, and case mismatch', async () => {
  assert.throws(() => validateComponentEvent(validEvent({ state: 'hidden' })), /state/);
  assert.throws(() => validateComponentEvent(validEvent({ status: 'skipped' })), /status/);
  for (const field of ['widgetKey', 'capturePage', 'marker', 'attemptId']) {
    assert.throws(() => validateComponentEvent(validEvent({ [field]: '' })), new RegExp(field));
  }
  const paths = await fixture();
  await assert.rejects(recordComponentState({ scopePath: paths.scopePath, output: paths.output, event: validEvent({ caseId: 'OTHER' }) }), /caseId mismatch/);
});

test('enforces required semantics and structured failures', () => {
  assert.throws(() => validateComponentEvent(validEvent({ status: 'not-applicable', required: true })), /required: false/);
  assert.throws(() => validateComponentEvent(validEvent({ status: 'not-requested', required: true })), /required: false/);
  assert.throws(() => validateComponentEvent(validEvent({ status: 'failed', failure: null })), /failure/);
  assert.throws(() => validateComponentEvent(validEvent({ status: 'blocked-missing-fixture', failure: { code: '', message: 'missing' } })), /failure/);
  assert.equal(validateComponentEvent(validEvent({
    status: 'blocked-missing-fixture',
    failure: { code: 'fixture-map-missing', message: 'No approved fixture mapping' },
  })).status, 'blocked-missing-fixture');
});

test('rejects duplicate attempt IDs within one run', async () => {
  const paths = await fixture();
  await recordComponentState({ scopePath: paths.scopePath, output: paths.output, event: validEvent() });
  await assert.rejects(recordComponentState({
    scopePath: paths.scopePath,
    output: paths.output,
    event: validEvent({ at: '2026-07-21T00:00:01.000Z' }),
  }), /duplicate attemptId/);
});

test('CLI builds captured and blocked events with explicit attempt metadata', async () => {
  const paths = await fixture();
  const common = [
    '--scope', paths.scopePath,
    '--output', paths.output,
    '--widget-key', 'tables/object-table/v1',
    '--label', 'Object Table',
    '--category', 'Tables',
    '--capture-page', 'CDP Capture 001',
    '--visible-instance-label', 'Object Table',
  ];
  const captured = await runRecordComponentStateCli([
    ...common,
    '--marker', 'widget:object-table:a1b2c3d4:editor-mounted',
    '--state', 'editor-mounted',
    '--status', 'captured',
    '--required',
    '--attempt-id', 'capture-run-1:editor-mounted:1',
    '--at', '2026-07-21T00:00:00.000Z',
  ]);
  assert.equal(captured.required, true);

  const blocked = await runRecordComponentStateCli([
    ...common,
    '--marker', 'widget:object-table:a1b2c3d4:data-bound',
    '--state', 'data-bound',
    '--status', 'blocked-missing-fixture',
    '--required',
    '--attempt-id', 'capture-run-1:data-bound:2',
    '--failure-code', 'fixture-map-missing',
    '--failure-message', 'No approved fixture mapping',
    '--at', '2026-07-21T00:00:01.000Z',
  ]);
  assert.deepEqual(blocked.failure, { code: 'fixture-map-missing', message: 'No approved fixture mapping' });
});
