#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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

export async function mergeCaptureDirectories(inputDirectories, outputDirectory) {
  if (!Array.isArray(inputDirectories) || inputDirectories.length < 1) throw new Error('Provide at least one capture directory');
  const inputs = inputDirectories.map((input) => resolve(input));
  const output = resolve(outputDirectory);
  const metadata = join(output, 'metadata');
  const inputSummaries = await Promise.all(inputs.map((input) => readJson(join(input, 'summary.json'))));
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
    sourceManifest.push(...manifest.map((entry) => ({ sourceRun, ...entry })));
    componentEvents.push(...(await readNdjson(join(input, 'component-events.ndjson'))).map((entry) => ({ sourceRun, ...entry })));
    const summary = inputSummaries[index];
    if (summary) summaries.push({ sourceRun, ...summary });
    risks.push(...(await readNdjson(join(input, 'risk-events.ndjson'))).map((entry) => ({ sourceRun, ...entry })));
    invalid.push(...(await readNdjson(join(input, 'invalid-assets.ndjson'))).map((entry) => ({ sourceRun, ...entry })));
    markers.push(...(await readNdjson(join(input, 'markers.ndjson'))).map((entry) => ({ sourceRun, ...entry })));

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
  const componentCoverage = buildComponentCoverage({ componentEvents, manifestEvents: sourceManifest, generatedAt: createdAt });
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
    components: componentCoverage.summary,
  };

  await writeFile(join(metadata, 'manifest.ndjson'), ndjson(mergedManifest));
  await writeFile(join(metadata, 'risk-events.ndjson'), ndjson(risks));
  await writeFile(join(metadata, 'invalid-assets.ndjson'), ndjson(invalid));
  await writeFile(join(metadata, 'markers.ndjson'), ndjson(markers));
  await writeFile(join(metadata, 'source-manifest.ndjson'), ndjson(sourceManifest));
  await writeFile(join(metadata, 'component-events.ndjson'), ndjson(componentEvents));
  await writeFile(join(metadata, 'merge-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(output, 'component-assets.json'), JSON.stringify(componentCoverage, null, 2));
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
