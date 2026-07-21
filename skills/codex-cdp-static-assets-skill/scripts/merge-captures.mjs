#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildComponentCoverage } from './component-coverage.mjs';

async function readNdjson(path) {
  try {
    const content = await readFile(path, 'utf8');
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function ndjson(entries) {
  return entries.length ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '';
}

function validatePathSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error(`Invalid URL path encoding: ${segment}`);
  }
  if (!segment || decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/.test(decoded)) {
    throw new Error(`Unsafe URL path segment: ${segment}`);
  }
  return segment;
}

function fallbackExtension(entry) {
  const fromSource = extname(entry.file || '');
  if (fromSource) return fromSource;
  if (entry.kind === 'js') return '.js';
  if (entry.kind === 'css') return '.css';
  if (entry.kind === 'wasm') return '.wasm';
  if (entry.kind === 'font') return '.font';
  if (entry.kind === 'html') return '.html';
  return '.bin';
}

function deliveryBasePath(entry) {
  try {
    const parsed = new URL(entry.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported protocol');
    const host = validatePathSegment(parsed.host.toLowerCase());
    const segments = parsed.pathname.split('/').filter(Boolean).map(validatePathSegment);
    if (!segments.length || parsed.pathname.endsWith('/')) segments.push(`index${fallbackExtension(entry)}`);
    return join('assets', host, ...segments);
  } catch (error) {
    if (error.message?.startsWith('Unsafe URL path') || error.message?.startsWith('Invalid URL path')) throw error;
    const sourceName = validatePathSegment(basename(entry.file || `asset${fallbackExtension(entry)}`));
    return join('assets', '_unknown', sourceName);
  }
}

function addHashSuffix(path, sha256) {
  const extension = extname(path);
  return `${path.slice(0, path.length - extension.length)}.__${sha256.slice(0, 8)}${extension}`;
}

function readableSlug(value) {
  return String(value || 'component')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'component';
}

function componentViewFileName(component) {
  const suffix = createHash('sha256').update(`${component.capturePage}\n${component.widgetKey}`).digest('hex').slice(0, 8);
  return `${readableSlug(component.label)}--${suffix}.json`;
}

function componentEvidenceDirectory(component) {
  return validatePathSegment(component.marker.replaceAll(':', '--'));
}

async function listDirectory(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function copyComponentScreenshots(component, inputByRun, output) {
  const screenshots = [];
  const evidenceDirectory = componentEvidenceDirectory(component);
  const sourceRuns = [...new Set(component.attempts.map((attempt) => attempt.sourceRun).filter(Boolean))].sort();
  for (const sourceRun of sourceRuns) {
    const input = inputByRun.get(sourceRun);
    if (!input) continue;
    const sourceDirectory = join(input, 'evidence', 'components', evidenceDirectory);
    const entries = await listDirectory(sourceDirectory);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile()) continue;
      const match = /^(.*)--(\d+)\.png$/.exec(entry.name);
      if (!match || !Object.hasOwn(component.states, match[1])) continue;
      const relativePath = join('evidence', sourceRun, 'components', evidenceDirectory, entry.name);
      const destination = join(output, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceDirectory, entry.name), destination);
      screenshots.push({ state: match[1], sourceRun, file: relativePath });
    }
  }
  return screenshots;
}

function enrichedAsset(asset, mergedByIdentity) {
  const merged = mergedByIdentity.get(`${asset.sha256}\n${asset.url}`);
  if (!merged) throw new Error(`Component asset is missing from merged manifest: ${asset.sha256}`);
  return { ...asset, file: merged.file };
}

function mergeWidgetInventories(inventories, inputs, caseId, generatedAt) {
  const available = inventories.map((inventory, index) => ({ inventory, sourceRun: basename(inputs[index]) })).filter((item) => item.inventory);
  if (!available.length) return null;
  const entries = new Map();
  const sources = [];
  for (const { inventory, sourceRun } of available) {
    if (inventory.schemaVersion !== 1 || inventory.classification !== 'baseline-widget-registry'
      || !Array.isArray(inventory.entries) || !Array.isArray(inventory.sources)) {
      throw new Error(`Invalid Widget inventory: ${sourceRun}`);
    }
    if (inventory.caseId && inventory.caseId !== caseId) throw new Error(`Widget inventory caseId mismatch: ${sourceRun}`);
    sources.push(...inventory.sources.map((source) => ({ ...source, sourceRun })));
    for (const entry of inventory.entries) {
      const existing = entries.get(entry.typeId);
      if (existing) {
        const comparable = (value) => JSON.stringify({
          rendererName: value.rendererName,
          chunkIds: value.chunkIds,
          moduleIds: value.moduleIds,
        });
        if (comparable(existing) !== comparable(entry)) throw new Error(`Conflicting Widget inventory entry: ${entry.typeId}`);
        existing.sourceRuns = [...new Set([...existing.sourceRuns, sourceRun])].sort();
        continue;
      }
      entries.set(entry.typeId, { ...entry, sourceRuns: [sourceRun] });
    }
  }
  const mergedEntries = [...entries.values()].sort((left, right) => left.typeId.localeCompare(right.typeId));
  const mergedSources = sources.sort((left, right) => left.sourceRun.localeCompare(right.sourceRun) || left.file.localeCompare(right.file));
  return {
    schemaVersion: 1,
    caseId,
    generatedAt,
    classification: 'baseline-widget-registry',
    claim: 'registry-entry-not-interaction-evidence',
    summary: { registryEntries: mergedEntries.length, sourceAssets: mergedSources.length },
    sources: mergedSources,
    entries: mergedEntries,
  };
}

async function writeReverseEngineeringViews({ componentCoverage, mergedManifest, widgetInventory, inputs, output, metadata }) {
  const mergedByIdentity = new Map(mergedManifest.map((entry) => [`${entry.sha256}\n${entry.url}`, entry]));
  const inputByRun = new Map(inputs.map((input) => [basename(input), input]));
  const baseline = {
    schemaVersion: 1,
    caseId: componentCoverage.caseId,
    generatedAt: componentCoverage.generatedAt,
    attribution: 'baseline-shared-no-component-ownership',
    ...(widgetInventory ? { widgetInventoryFile: 'widget-inventory.json' } : {}),
    baseline: {
      ...componentCoverage.baseline,
      assets: componentCoverage.baseline.assets.map((asset) => enrichedAsset(asset, mergedByIdentity)),
    },
  };
  await writeFile(join(metadata, 'baseline-assets.json'), JSON.stringify(baseline, null, 2));

  const componentsDirectory = join(metadata, 'components');
  await mkdir(componentsDirectory, { recursive: true });
  for (const component of componentCoverage.components) {
    const { firstObservedAssets, ...componentDetails } = component;
    const screenshots = await copyComponentScreenshots(component, inputByRun, output);
    const view = {
      schemaVersion: 1,
      caseId: componentCoverage.caseId,
      generatedAt: componentCoverage.generatedAt,
      attribution: 'first-observed-not-exclusive-ownership',
      baselineAssetsFile: '../baseline-assets.json',
      ...(widgetInventory ? { widgetInventoryFile: '../widget-inventory.json' } : {}),
      component: {
        ...componentDetails,
        newlyObservedAssets: firstObservedAssets.map((asset) => enrichedAsset(asset, mergedByIdentity)),
        screenshots,
      },
    };
    await writeFile(join(componentsDirectory, componentViewFileName(component)), JSON.stringify(view, null, 2));
  }
}

export async function mergeCaptureDirectories(inputDirectories, outputDirectory) {
  if (!Array.isArray(inputDirectories) || inputDirectories.length < 1) throw new Error('Provide at least one capture directory');
  const inputs = inputDirectories.map((input) => resolve(input));
  const output = resolve(outputDirectory);
  const metadata = join(output, 'metadata');
  const inputSummaries = await Promise.all(inputs.map((input) => readJson(join(input, 'summary.json'))));
  const inputProvenance = await Promise.all(inputs.map((input) => readJson(join(input, 'provenance.json'))));
  const inputComponentEvents = await Promise.all(inputs.map((input) => readNdjson(join(input, 'component-events.ndjson'))));
  const inputWidgetInventories = await Promise.all(inputs.map((input) => readJson(join(input, 'widget-inventory.json'))));
  const caseIds = new Set();
  for (const [index, events] of inputComponentEvents.entries()) {
    if (events.some((event) => typeof event.caseId !== 'string' || !event.caseId.trim())) {
      throw new Error(`Capture run component event is missing caseId: ${basename(inputs[index])}`);
    }
    const runCaseIds = new Set([inputProvenance[index]?.caseId, inputWidgetInventories[index]?.caseId, ...events.map((event) => event.caseId)].filter(Boolean));
    if (runCaseIds.size > 1) throw new Error(`Capture run caseId mismatch: ${basename(inputs[index])}`);
    for (const caseId of runCaseIds) caseIds.add(caseId);
  }
  if (caseIds.size > 1) throw new Error(`Cannot merge different caseIds: ${[...caseIds].sort().join(', ')}`);
  const caseId = [...caseIds][0] || null;
  const knownWorkshopBuildIds = [...new Set(inputSummaries.flatMap((summary) => summary?.workshopBuildIds || []))].sort();
  if (knownWorkshopBuildIds.length > 1) throw new Error(`Workshop build mismatch: ${knownWorkshopBuildIds.join(', ')}`);

  await mkdir(output, { recursive: false });
  await mkdir(join(output, 'assets'), { recursive: true });
  await mkdir(metadata, { recursive: true });

  const records = new Map();
  const risks = [];
  const invalid = [];
  const markers = [];
  const summaries = [];
  const componentEvents = [];
  const sourceManifest = [];
  let savedEvents = 0;

  for (const [index, input] of inputs.entries()) {
    const sourceRun = basename(input);
    const manifest = await readNdjson(join(input, 'manifest.ndjson'));
    sourceManifest.push(...manifest.map((entry) => ({ ...entry, sourceRun })));
    componentEvents.push(...inputComponentEvents[index].map((entry) => ({ ...entry, sourceRun })));
    const summary = inputSummaries[index];
    if (summary) summaries.push({ sourceRun, ...summary });
    risks.push(...(await readNdjson(join(input, 'risk-events.ndjson'))).map((entry) => ({ ...entry, sourceRun })));
    invalid.push(...(await readNdjson(join(input, 'invalid-assets.ndjson'))).map((entry) => ({ ...entry, sourceRun })));
    markers.push(...(await readNdjson(join(input, 'markers.ndjson'))).map((entry) => ({ ...entry, sourceRun })));

    for (const entry of manifest.filter((item) => item.event === 'saved' && item.sha256 && item.file)) {
      savedEvents += 1;
      const basePath = deliveryBasePath(entry);
      const key = `${basePath}\n${entry.sha256}`;
      const existing = records.get(key);
      if (existing) {
        existing.occurrences += 1;
        existing.markers.add(entry.marker);
        existing.sourceRuns.add(sourceRun);
        continue;
      }
      records.set(key, {
        entry,
        basePath,
        occurrences: 1,
        markers: new Set([entry.marker]),
        sourceRuns: new Set([sourceRun]),
        sourcePath: join(input, entry.file),
      });
    }
  }

  const byBasePath = new Map();
  for (const item of records.values()) {
    const group = byBasePath.get(item.basePath) || [];
    group.push(item);
    byBasePath.set(item.basePath, group);
  }

  const mergedManifest = [];
  for (const [basePath, group] of [...byBasePath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    group.sort((left, right) => left.entry.sha256.localeCompare(right.entry.sha256));
    for (const item of group) {
      const relativePath = group.length === 1 ? basePath : addHashSuffix(basePath, item.entry.sha256);
      const destination = join(output, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(item.sourcePath, destination);
      mergedManifest.push({
        ...item.entry,
        file: relativePath,
        originPath: basePath,
        markers: [...item.markers].filter(Boolean).sort(),
        sourceRuns: [...item.sourceRuns].sort(),
        occurrences: item.occurrences,
      });
    }
  }

  const createdAt = new Date().toISOString();
  const componentCoverage = caseId ? buildComponentCoverage({ caseId, events: componentEvents, manifest: sourceManifest, generatedAt: createdAt }) : null;
  const widgetInventory = caseId ? mergeWidgetInventories(inputWidgetInventories, inputs, caseId, createdAt) : null;
  const componentSummary = componentCoverage?.summary || { total: 0, complete: 0, partial: 0 };
  const summary = {
    createdAt,
    sourceRuns: inputs.map((input) => basename(input)),
    runCount: inputs.length,
    savedEvents,
    uniqueFiles: mergedManifest.length,
    duplicateEvents: savedEvents - mergedManifest.length,
    uniqueBytes: mergedManifest.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
    capturedBytes: summaries.reduce((sum, entry) => sum + (Number(entry.totalBytes) || 0), 0),
    bodyFailures: summaries.reduce((sum, entry) => sum + (Number(entry.bodyFailures) || 0), 0),
    rejectedAssets: summaries.reduce((sum, entry) => sum + (Number(entry.rejectedAssets) || 0), 0),
    stopReasons: summaries.filter((entry) => entry.stopReason).map((entry) => ({ sourceRun: entry.sourceRun, reason: entry.stopReason })),
    riskEvents: risks.length,
    invalidEvents: invalid.length,
    workshopBuildIds: knownWorkshopBuildIds,
    ...(componentCoverage ? {
      componentCount: componentSummary.total,
      completeComponents: componentSummary.complete,
      partialComponents: componentSummary.partial,
    } : {}),
    ...(widgetInventory ? { widgetInventoryEntries: widgetInventory.summary.registryEntries } : {}),
  };

  await writeFile(join(metadata, 'manifest.ndjson'), ndjson(mergedManifest));
  await writeFile(join(metadata, 'risk-events.ndjson'), ndjson(risks));
  await writeFile(join(metadata, 'invalid-assets.ndjson'), ndjson(invalid));
  await writeFile(join(metadata, 'markers.ndjson'), ndjson(markers));
  await writeFile(join(metadata, 'source-manifest.ndjson'), ndjson(sourceManifest));
  await writeFile(join(metadata, 'component-events.ndjson'), ndjson(componentEvents));
  await writeFile(join(metadata, 'merge-summary.json'), JSON.stringify(summary, null, 2));
  if (widgetInventory) await writeFile(join(metadata, 'widget-inventory.json'), JSON.stringify(widgetInventory, null, 2));
  if (componentCoverage) {
    await writeFile(join(metadata, 'component-assets.json'), JSON.stringify(componentCoverage, null, 2));
    await writeReverseEngineeringViews({ componentCoverage, mergedManifest, widgetInventory, inputs, output, metadata });
  }
  return summary;
}

function usage() {
  return 'Usage: node merge-captures.mjs --output DELIVERY_DIR CAPTURE_DIR [CAPTURE_DIR ...]\n';
}

async function main(argv) {
  let output = null;
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      output = argv[++index];
      if (!output) throw new Error('Missing value for --output');
    } else if (argv[index] === '--help') {
      process.stdout.write(usage());
      return;
    } else {
      inputs.push(argv[index]);
    }
  }
  if (!output || !inputs.length) throw new Error(usage().trim());
  const summary = await mergeCaptureDirectories(inputs, output);
  process.stdout.write(`${JSON.stringify({ output: resolve(output), ...summary }, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
