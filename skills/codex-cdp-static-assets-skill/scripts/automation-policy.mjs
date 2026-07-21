#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPONENT_STATES = Object.freeze([
  'editor-mounted',
  'data-bound',
  'preview-visible',
]);

// Keep prior deliveries auditable after the capture matrix was simplified.
// These states are no longer accepted in new automation Scopes.
export const LEGACY_COMPONENT_STATES = Object.freeze([
  'viewport-visible',
  'config-opened',
]);

export const KNOWN_COMPONENT_STATES = Object.freeze([
  ...COMPONENT_STATES,
  ...LEGACY_COMPONENT_STATES,
]);

const FORBIDDEN_REAL_DATA_FIELDS = new Set([
  'fallbackDataSource',
  'dataSourceRid',
  'allowRealDataSources',
  'realDataSource',
]);

function assertNoRealDataFallback(value, path = 'scope') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REAL_DATA_FIELDS.has(key)) throw new Error(`Scope must not define real data source fallback field: ${path}.${key}`);
    assertNoRealDataFallback(child, `${path}.${key}`);
  }
}

function freezeRecord(record) {
  return Object.freeze(Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Object.freeze({
    kind: value.kind.trim(),
    visibleOption: value.visibleOption.trim(),
  })])));
}

export function normalizeAutomationPolicy(input = {}) {
  assertNoRealDataFallback(input);
  const automation = input.automation || { enabled: false };
  if (automation.enabled === false) return Object.freeze({ enabled: false });
  if (automation.enabled !== true) throw new Error('Automation enabled must be an explicit boolean');
  if (!['full-catalog', 'single-page'].includes(automation.mode)) throw new Error('Automation mode must be full-catalog or single-page');
  if (automation.allowAutosave !== true) throw new Error('Enabled automation requires allowAutosave: true');
  if (automation.mode === 'full-catalog' && automation.allowCreateCapturePages !== true) {
    throw new Error('full-catalog automation requires allowCreateCapturePages: true');
  }
  if (automation.mode === 'single-page' && automation.allowCreateCapturePages !== false) {
    throw new Error('single-page automation requires allowCreateCapturePages: false');
  }
  if (!Number.isInteger(automation.maxWidgetsPerPage) || automation.maxWidgetsPerPage < 1) {
    throw new Error('Automation maxWidgetsPerPage must be an integer >= 1');
  }
  if (!Array.isArray(automation.states) || automation.states.length === 0) throw new Error('Automation states must be a non-empty array');
  const normalizedStates = [...new Set(automation.states)];
  for (const state of normalizedStates) if (!COMPONENT_STATES.includes(state)) throw new Error(`Unknown automation state: ${state}`);
  if (automation.captureStateScreenshots !== undefined && typeof automation.captureStateScreenshots !== 'boolean') {
    throw new Error('Automation captureStateScreenshots must be a boolean');
  }
  if (automation.allowExistingModuleVariables !== undefined && typeof automation.allowExistingModuleVariables !== 'boolean') {
    throw new Error('Automation allowExistingModuleVariables must be a boolean');
  }

  const fixtureProfiles = input.fixtureProfiles || {};
  if (!fixtureProfiles || Array.isArray(fixtureProfiles) || typeof fixtureProfiles !== 'object') throw new Error('fixtureProfiles must be an object');
  for (const [name, profile] of Object.entries(fixtureProfiles)) {
    if (!profile || typeof profile.kind !== 'string' || !profile.kind.trim()) throw new Error(`Fixture profile ${name} requires kind`);
    if (typeof profile.visibleOption !== 'string' || !profile.visibleOption.trim()) throw new Error(`Fixture profile ${name} requires visibleOption`);
  }
  const widgetFixtureMap = input.widgetFixtureMap || {};
  if (!widgetFixtureMap || Array.isArray(widgetFixtureMap) || typeof widgetFixtureMap !== 'object') throw new Error('widgetFixtureMap must be an object');
  for (const [widgetKey, profileName] of Object.entries(widgetFixtureMap)) {
    if (!Object.hasOwn(fixtureProfiles, profileName)) throw new Error(`Widget ${widgetKey} references unknown fixture profile: ${profileName}`);
  }

  return Object.freeze({
    enabled: true,
    mode: automation.mode,
    allowAutosave: true,
    allowCreateCapturePages: automation.allowCreateCapturePages,
    allowExistingModuleVariables: automation.allowExistingModuleVariables === true,
    captureStateScreenshots: automation.captureStateScreenshots === true,
    maxWidgetsPerPage: automation.maxWidgetsPerPage,
    states: Object.freeze(normalizedStates),
    fixtureProfiles: freezeRecord(fixtureProfiles),
    fixtureProfileNames: Object.freeze(Object.keys(fixtureProfiles).sort()),
    widgetFixtureMap: Object.freeze({ ...widgetFixtureMap }),
  });
}

function slug(value) {
  const result = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return result || 'unknown';
}

export function canonicalWidgetKey(entry) {
  for (const field of ['label', 'category', 'versionOrType']) {
    if (typeof entry?.[field] !== 'string' || !entry[field].trim()) throw new Error(`Widget identity requires ${field}`);
  }
  return `${slug(entry.category)}/${slug(entry.label)}/${slug(entry.versionOrType)}`;
}

export function buildCatalogQueue(snapshots) {
  if (!Array.isArray(snapshots)) throw new Error('Catalog snapshots must be an array');
  const queue = new Map();
  for (const snapshot of snapshots) {
    if (typeof snapshot?.snapshotId !== 'string' || !Array.isArray(snapshot.entries)) throw new Error('Catalog snapshot requires snapshotId and entries');
    const seenInSnapshot = new Set();
    for (const entry of snapshot.entries) {
      const widgetKey = canonicalWidgetKey(entry);
      if (seenInSnapshot.has(widgetKey)) throw new Error(`catalog-identity-ambiguity: ${snapshot.snapshotId}:${widgetKey}`);
      seenInSnapshot.add(widgetKey);
      if (!queue.has(widgetKey)) queue.set(widgetKey, Object.freeze({ ...entry, widgetKey }));
    }
  }
  return [...queue.values()];
}

export function markerForWidget(widgetKey, state) {
  if (!KNOWN_COMPONENT_STATES.includes(state)) throw new Error(`Unknown component state: ${state}`);
  const parts = String(widgetKey).split('/');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('widgetKey must contain category/label/version');
  const hash = createHash('sha256').update(widgetKey).digest('hex').slice(0, 8);
  return `widget:${slug(parts[1])}:${hash}:${state}`;
}

export function classifyBaselineGate({ automationEnabled, classification }) {
  if (classification !== 'preloaded') return 'continue';
  return automationEnabled ? 'continue' : 'stop';
}

export function planCapturePage({ count, maxWidgetsPerPage, allowCreateCapturePages, pageCount = 1 }) {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(maxWidgetsPerPage) || maxWidgetsPerPage < 1) throw new Error('Invalid capture page counts');
  if (count < maxWidgetsPerPage) return { accepted: true, createPage: false, capturePage: `CDP Capture ${String(pageCount).padStart(3, '0')}` };
  if (!allowCreateCapturePages) return { accepted: false, reason: 'blocked-page-capacity' };
  return { accepted: true, createPage: true, capturePage: `CDP Capture ${String(pageCount + 1).padStart(3, '0')}` };
}

export function createCatalogCompletionTracker(initial = {}) {
  const keys = new Set(Array.isArray(initial.keys) ? initial.keys : []);
  let atBottom = initial.atBottom === true;
  let stableCount = Number.isInteger(initial.stableCount) ? initial.stableCount : 0;
  return {
    update(entries, nextAtBottom) {
      if (!Array.isArray(entries)) throw new Error('Catalog observation entries must be an array');
      const observedKeys = entries.map((entry) => {
        if (typeof entry === 'string' && entry.trim()) return entry.trim();
        return canonicalWidgetKey(entry);
      });
      if (new Set(observedKeys).size !== observedKeys.length) {
        throw new Error('catalog-identity-ambiguity: current-observation');
      }
      let added = 0;
      for (const key of observedKeys) {
        if (!keys.has(key)) {
          keys.add(key);
          added += 1;
        }
      }
      atBottom = nextAtBottom === true;
      if (!atBottom || added > 0) stableCount = 0;
      else stableCount += 1;
      return { complete: atBottom && stableCount >= 2, stableCount, totalKeys: keys.size };
    },
    snapshot() {
      return { keys: [...keys].sort(), atBottom, stableCount };
    },
  };
}

function requestFingerprint(requests) {
  return requests.map(({ requestId, status }) => {
    if (requestId === undefined || !Number.isInteger(Number(status))) throw new Error('Network observations require requestId and integer status');
    return `${requestId}:${Number(status)}`;
  }).sort().join('|');
}

export function createNetworkStabilityTracker(initial = {}) {
  let fingerprint = typeof initial.fingerprint === 'string' ? initial.fingerprint : null;
  let stableCount = Number.isInteger(initial.stableCount) ? initial.stableCount : 0;
  return {
    update(requests) {
      const next = requestFingerprint(requests);
      if (fingerprint === next) stableCount += 1;
      else {
        fingerprint = next;
        stableCount = 0;
      }
      return { stable: stableCount >= 2, stableCount, fingerprint };
    },
    snapshot() {
      return { fingerprint, stableCount };
    },
  };
}

export function planResume({ completedStates = [], added = false, fixtureAvailable = false, existingVariableAvailable = false, visibleMatches = 0 }) {
  if (!Number.isInteger(visibleMatches) || visibleMatches < 0) throw new Error('visibleMatches must be a non-negative integer');
  if (visibleMatches > 1) return { action: 'blocked', reason: 'blocked-existing-instance-ambiguous' };
  const missingStates = COMPONENT_STATES.filter((state) => !completedStates.includes(state));
  if (missingStates.length === 0) return { action: 'complete', missingStates: [] };
  if (visibleMatches === 0 && added) return { action: 'blocked', reason: 'blocked-existing-instance-ambiguous' };
  if (visibleMatches === 0) return { action: 'add-widget', missingStates };
  const result = { action: 'resume-existing', missingStates };
  if (missingStates.includes('data-bound') && !fixtureAvailable && !existingVariableAvailable) result.dataState = 'blocked-missing-fixture';
  return result;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const value = rest[++index];
    if (value === undefined) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
  }
  return { command, options };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function runAutomationPolicyCli(argv) {
  const { command, options } = parseArgs(argv);
  if (command === 'validate-scope') {
    const { normalizeScope } = await import('./capture-core.mjs');
    const scope = normalizeScope(JSON.parse(await readFile(resolve(options.scope), 'utf8')));
    return {
      valid: true,
      caseId: scope.caseId,
      automationEnabled: scope.automation.enabled,
      mode: scope.automation.mode || null,
      moduleId: scope.authorization?.moduleId || null,
    };
  }
  if (command === 'marker') return markerForWidget(options['widget-key'], options.state);
  if (command === 'catalog-update') {
    const statePath = resolve(options.state);
    const tracker = createCatalogCompletionTracker(await readJson(statePath, {}));
    const result = tracker.update(JSON.parse(options['entries-json']), options['at-bottom'] === 'true');
    await writeFile(statePath, `${JSON.stringify(tracker.snapshot(), null, 2)}\n`);
    return result;
  }
  if (command === 'network-update') {
    const statePath = resolve(options.state);
    const tracker = createNetworkStabilityTracker(await readJson(statePath, {}));
    const result = tracker.update(JSON.parse(options['requests-json']));
    await writeFile(statePath, `${JSON.stringify(tracker.snapshot(), null, 2)}\n`);
    return result;
  }
  if (command === 'resume') return planResume({ ...JSON.parse(options['component-json']), visibleMatches: Number(options['visible-matches']) });
  throw new Error(`Unknown automation-policy command: ${command || '(missing)'}`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runAutomationPolicyCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
