#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBody } from './capture-core.mjs';

const COMPONENT_STATE_STATUSES = new Set([
  'captured', 'not-applicable', 'not-requested', 'failed', 'missing',
  'blocked-missing-fixture', 'blocked-page-capacity', 'blocked-existing-instance-ambiguous',
]);

async function walk(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

async function readNdjson(file) {
  if (!await exists(file)) return [];
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function sameValues(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

async function auditComponentAssets(output, manifestEntries) {
  const componentPath = join(output, 'component-assets.json');
  const mergeSummaryPath = join(output, 'metadata', 'merge-summary.json');
  if (!await exists(componentPath)) {
    return {
      file: null,
      invalid: await exists(mergeSummaryPath) ? [{ file: 'component-assets.json', reason: 'component-assets-missing' }] : [],
    };
  }
  let model;
  try {
    model = JSON.parse(await readFile(componentPath, 'utf8'));
  } catch {
    return { file: 'component-assets.json', invalid: [{ file: 'component-assets.json', reason: 'component-assets-invalid-json' }] };
  }
  const invalid = [];
  const add = (reason, detail) => invalid.push({ file: 'component-assets.json', reason, ...(detail ? { detail } : {}) });
  if (model.schemaVersion !== 1 || !Array.isArray(model.components) || !model.baseline || typeof model.summary !== 'object') {
    add('component-assets-invalid-schema');
    return { file: 'component-assets.json', invalid };
  }
  const manifestAssets = new Set(manifestEntries.filter((entry) => entry.event === 'saved').map((entry) => `${entry.sha256}\n${entry.url}`));
  const sourceManifest = await readNdjson(join(output, 'metadata', 'source-manifest.ndjson'));
  const unavailable = new Set(sourceManifest.filter((entry) => entry.event === 'body-unavailable').map((entry) => `${entry.sourceRun}\n${entry.requestId}\n${entry.url}`));
  const recordedAttempts = new Set((await readNdjson(join(output, 'metadata', 'component-events.ndjson'))).map((entry) => `${entry.sourceRun}\n${entry.attemptId}`));
  const identities = new Set();
  for (const component of model.components) {
    const identity = `${component.capturePage}\n${component.widgetKey}`;
    if (identities.has(identity)) add('component-identity-duplicate', identity);
    identities.add(identity);
    if (!['complete', 'partial'].includes(component.coverageStatus)
      || !Array.isArray(component.requiredStates) || !Array.isArray(component.coveredStates)
      || !Array.isArray(component.blockedStates) || !component.states || !Array.isArray(component.attempts)
      || !Array.isArray(component.firstObservedAssets) || !Array.isArray(component.bodyUnavailable)) {
      add('component-record-invalid-schema', identity);
      continue;
    }
    const stateEntries = Object.entries(component.states);
    if (stateEntries.some(([, status]) => !COMPONENT_STATE_STATUSES.has(status))) add('component-state-status-invalid', identity);
    const covered = stateEntries.filter(([, status]) => status === 'captured').map(([state]) => state);
    const blocked = stateEntries.filter(([, status]) => status === 'failed' || String(status).startsWith('blocked-')).map(([state]) => state);
    if (!sameValues(covered, component.coveredStates) || !sameValues(blocked, component.blockedStates)) add('component-state-index-inconsistent', identity);
    const shouldBeComplete = component.requiredStates.every((state) => component.states[state] === 'captured') && blocked.length === 0;
    if ((component.coverageStatus === 'complete') !== shouldBeComplete) add('component-coverage-status-inconsistent', identity);
    for (const asset of component.firstObservedAssets) {
      if (!manifestAssets.has(`${asset.sha256}\n${asset.url}`)) add('component-asset-not-in-manifest', `${identity}\n${asset.sha256}`);
    }
    for (const attempt of component.attempts) {
      if (!recordedAttempts.has(`${attempt.sourceRun}\n${attempt.attemptId}`)) add('component-attempt-not-in-events', `${identity}\n${attempt.attemptId}`);
    }
    for (const entry of component.bodyUnavailable) {
      if (!unavailable.has(`${entry.sourceRun}\n${entry.requestId}\n${entry.url}`)) add('component-body-unavailable-not-in-manifest', identity);
    }
  }
  for (const asset of model.baseline.assets || []) {
    if (!manifestAssets.has(`${asset.sha256}\n${asset.url}`)) add('baseline-asset-not-in-manifest', asset.sha256);
  }
  const expectedSummary = {
    total: model.components.length,
    complete: model.components.filter((component) => component.coverageStatus === 'complete').length,
    partial: model.components.filter((component) => component.coverageStatus === 'partial').length,
  };
  if (JSON.stringify(model.summary) !== JSON.stringify(expectedSummary)) add('component-summary-inconsistent');
  return { file: 'component-assets.json', invalid };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(output) {
  const candidates = [join(output, 'metadata', 'manifest.ndjson'), join(output, 'manifest.ndjson')];
  for (const file of candidates) {
    if (!await exists(file)) continue;
    const text = await readFile(file, 'utf8');
    const entries = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { file, entries };
  }
  return { file: null, entries: [] };
}

function kindForPath(file) {
  const parts = file.split('/');
  const assetsIndex = parts.lastIndexOf('assets');
  return assetsIndex >= 0 ? parts[assetsIndex + 1] : null;
}

export async function auditCapture(outputDirectory) {
  const output = resolve(outputDirectory);
  const assets = join(output, 'assets');
  const files = await walk(assets);
  const manifest = await readManifest(output);
  const manifestByFile = new Map(manifest.entries.map((entry) => [entry.file, entry]));
  const invalid = [];
  let validFiles = 0;

  for (const file of files) {
    const body = await readFile(file);
    const relativeFile = relative(output, file);
    const entry = manifestByFile.get(relativeFile);
    const kind = entry?.kind || kindForPath(file);
    const result = validateBody(kind, body);
    const name = file.split('/').at(-1).split('.')[0];
    const hasContentHashName = /^[a-f0-9]{64}$/i.test(name);
    const expectedHash = entry?.sha256 || (hasContentHashName ? name : null);
    const actualHash = createHash('sha256').update(body).digest('hex');
    const hashMatches = !expectedHash || actualHash === expectedHash;
    if (!result.accepted) invalid.push({ file: relativeFile, reason: result.reason });
    else if (!hashMatches) invalid.push({ file: relativeFile, reason: 'content-hash-mismatch' });
    else validFiles += 1;
  }

  const observed = new Set(files.map((file) => relative(output, file)));
  for (const entry of manifest.entries) {
    if (entry.file && !observed.has(entry.file)) invalid.push({ file: entry.file, reason: 'manifest-file-missing' });
  }

  const componentAudit = await auditComponentAssets(output, manifest.entries);
  invalid.push(...componentAudit.invalid);

  return {
    output,
    manifest: manifest.file ? relative(output, manifest.file) : null,
    componentAssets: componentAudit.file,
    totalFiles: files.length,
    validFiles,
    invalid,
  };
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node audit-capture.mjs <capture-output-directory>');
  const report = await auditCapture(output);
  const metadata = join(report.output, 'metadata');
  const reportDirectory = await exists(metadata) ? metadata : report.output;
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(join(reportDirectory, 'asset-audit.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
