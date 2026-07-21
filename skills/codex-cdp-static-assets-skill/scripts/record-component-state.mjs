#!/usr/bin/env node

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_COMPONENT_STATES } from './automation-policy.mjs';
import { normalizeScope } from './capture-core.mjs';

export const COMPONENT_STATUSES = Object.freeze([
  'captured',
  'not-applicable',
  'not-requested',
  'failed',
  'blocked-missing-fixture',
  'blocked-page-capacity',
  'blocked-existing-instance-ambiguous',
]);

const FAILURE_STATUSES = new Set(COMPONENT_STATUSES.filter((status) => status === 'failed' || status.startsWith('blocked-')));

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Component event requires ${field}`);
  return value.trim();
}

export function validateComponentEvent(input, { runName } = {}) {
  const event = {
    caseId: requiredString(input.caseId, 'caseId'),
    widgetKey: requiredString(input.widgetKey, 'widgetKey'),
    label: requiredString(input.label, 'label'),
    category: requiredString(input.category, 'category'),
    capturePage: requiredString(input.capturePage, 'capturePage'),
    visibleInstanceLabel: input.visibleInstanceLabel == null ? null : requiredString(input.visibleInstanceLabel, 'visibleInstanceLabel'),
    marker: requiredString(input.marker, 'marker'),
    state: input.state,
    status: input.status,
    required: input.required,
    attemptId: requiredString(input.attemptId, 'attemptId'),
    at: input.at || new Date().toISOString(),
    failure: input.failure ?? null,
  };
  if (!KNOWN_COMPONENT_STATES.includes(event.state)) throw new Error(`Unknown component state: ${event.state}`);
  if (!COMPONENT_STATUSES.includes(event.status)) throw new Error(`Unknown component status: ${event.status}`);
  if (typeof event.required !== 'boolean') throw new Error('Component event required must be boolean');
  if (['not-applicable', 'not-requested'].includes(event.status) && event.required !== false) {
    throw new Error(`${event.status} must use required: false`);
  }
  if (FAILURE_STATUSES.has(event.status)) {
    if (!event.failure || typeof event.failure.code !== 'string' || !event.failure.code.trim()
      || typeof event.failure.message !== 'string' || !event.failure.message.trim()) {
      throw new Error(`${event.status} requires structured failure code and message`);
    }
    event.failure = { code: event.failure.code.trim(), message: event.failure.message.trim() };
  } else if (event.failure !== null) {
    throw new Error(`${event.status} must not include failure details`);
  }
  if (Number.isNaN(Date.parse(event.at)) || new Date(event.at).toISOString() !== event.at) throw new Error('Component event at must be an ISO timestamp');
  const markerPattern = new RegExp(`^widget:[^:]+:[a-f0-9]{8}:${event.state}$`);
  if (!markerPattern.test(event.marker)) throw new Error(`Component marker does not match state ${event.state}`);
  if (runName) {
    const prefix = `${runName}:${event.state}:`;
    if (!event.attemptId.startsWith(prefix) || !/^\d+$/.test(event.attemptId.slice(prefix.length))) {
      throw new Error(`attemptId must use ${prefix}<monotonic-number>`);
    }
  }
  return Object.freeze(event);
}

async function readEvents(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function recordComponentState({ scopePath, output, event }) {
  const normalizedOutput = resolve(output);
  const scope = normalizeScope(JSON.parse(await readFile(resolve(scopePath), 'utf8')));
  if (scope.caseId !== event.caseId) throw new Error(`Component event caseId mismatch: expected ${scope.caseId || 'null'}`);
  const normalized = validateComponentEvent(event, { runName: basename(normalizedOutput) });
  const eventsPath = resolve(normalizedOutput, 'component-events.ndjson');
  const prior = await readEvents(eventsPath);
  if (prior.some((entry) => entry.attemptId === normalized.attemptId)) throw new Error(`duplicate attemptId in run: ${normalized.attemptId}`);
  await mkdir(normalizedOutput, { recursive: true });
  await appendFile(eventsPath, `${JSON.stringify(normalized)}\n`);
  return normalized;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--required') {
      if (options.required !== undefined) throw new Error('Specify only one required flag');
      options.required = true;
      continue;
    }
    if (arg === '--not-required') {
      if (options.required !== undefined) throw new Error('Specify only one required flag');
      options.required = false;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
  }
  return options;
}

export async function runRecordComponentStateCli(argv) {
  const options = parseArgs(argv);
  const failureProvided = options['failure-code'] !== undefined || options['failure-message'] !== undefined;
  return recordComponentState({
    scopePath: options.scope,
    output: options.output,
    event: {
      caseId: JSON.parse(await readFile(resolve(options.scope), 'utf8')).caseId,
      widgetKey: options['widget-key'],
      label: options.label,
      category: options.category,
      capturePage: options['capture-page'],
      visibleInstanceLabel: options['visible-instance-label'] ?? null,
      marker: options.marker,
      state: options.state,
      status: options.status,
      required: options.required,
      attemptId: options['attempt-id'],
      at: options.at,
      failure: failureProvided ? { code: options['failure-code'], message: options['failure-message'] } : null,
    },
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runRecordComponentStateCli(process.argv.slice(2)).then((event) => {
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
