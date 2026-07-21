#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPE_ID_PATTERN = /(["'])(hubble\.object-set-section\.v1\.[^"'\\]+)\1\s*:\s*[A-Za-z_$][\w$]*\(/g;

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function extractWidgetRegistryEntries(source, sourceSha256) {
  const matches = [...source.matchAll(TYPE_ID_PATTERN)];
  return matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? source.length;
    const entrySource = source.slice(match.index, end);
    const rendererMatches = [...entrySource.matchAll(/,\s*(["'])([^"'\\]+)\1\s*\)/g)];
    const rendererName = rendererMatches.at(-1)?.[2] || null;
    const chunkIds = uniqueSorted([...entrySource.matchAll(/\.e\(\s*["'](\d+)["']\s*\)/g)].map((item) => item[1]));
    const moduleIds = uniqueSorted([...entrySource.matchAll(/\.bind\(\s*[^,()]+\s*,\s*(\d+)\s*\)/g)].map((item) => item[1]));
    return {
      typeId: match[2],
      rendererName,
      chunkIds,
      moduleIds,
      sourceSha256,
    };
  });
}

function isBaselineMarker(marker) {
  return marker === 'baseline' || marker?.startsWith('baseline:') || marker?.endsWith(':baseline');
}

function captureFile(captureDirectory, file) {
  if (typeof file !== 'string' || !file) throw new Error('Widget inventory manifest entry requires file');
  const normalized = file.replaceAll('\\', '/');
  const resolvedCapture = resolve(captureDirectory);
  const resolvedFile = resolve(resolvedCapture, normalized);
  const fromCapture = relative(resolvedCapture, resolvedFile);
  if (!fromCapture || fromCapture.startsWith('..') || isAbsolute(fromCapture)) throw new Error(`Unsafe capture file path: ${file}`);
  return { path: resolvedFile, file: fromCapture.replaceAll('\\', '/') };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readNdjson(path) {
  const content = await readFile(path, 'utf8');
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function sameRegistryEntry(left, right) {
  return left.rendererName === right.rendererName
    && JSON.stringify(left.chunkIds) === JSON.stringify(right.chunkIds)
    && JSON.stringify(left.moduleIds) === JSON.stringify(right.moduleIds);
}

export async function extractWidgetInventory(captureDirectory, { generatedAt = new Date().toISOString() } = {}) {
  const capture = resolve(captureDirectory);
  const manifest = await readNdjson(resolve(capture, 'manifest.ndjson'));
  const provenance = await readJson(resolve(capture, 'provenance.json'));
  const sources = [];
  const entries = new Map();
  for (const item of manifest.filter((entry) => entry.event === 'saved' && entry.kind === 'js' && isBaselineMarker(entry.marker))) {
    const resolved = captureFile(capture, item.file);
    const extracted = extractWidgetRegistryEntries(await readFile(resolved.path, 'utf8'), item.sha256);
    if (!extracted.length) continue;
    sources.push({ file: resolved.file, sha256: item.sha256, url: item.url, marker: item.marker });
    for (const entry of extracted) {
      const existing = entries.get(entry.typeId);
      if (existing && !sameRegistryEntry(existing, entry)) throw new Error(`Conflicting Widget registry entry: ${entry.typeId}`);
      if (!existing) entries.set(entry.typeId, entry);
    }
  }
  const sortedEntries = [...entries.values()].sort((left, right) => left.typeId.localeCompare(right.typeId));
  const sortedSources = sources.sort((left, right) => left.file.localeCompare(right.file));
  return {
    schemaVersion: 1,
    caseId: provenance?.caseId || null,
    generatedAt,
    classification: 'baseline-widget-registry',
    claim: 'registry-entry-not-interaction-evidence',
    summary: { registryEntries: sortedEntries.length, sourceAssets: sortedSources.length },
    sources: sortedSources,
    entries: sortedEntries,
  };
}

async function main(argv) {
  let capture = null;
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--capture') capture = argv[++index];
    else if (argv[index] === '--output') output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!capture || !output) throw new Error('Usage: node widget-inventory.mjs --capture CAPTURE_DIR --output OUTPUT_JSON');
  const inventory = await extractWidgetInventory(capture);
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(inventory, null, 2));
  process.stdout.write(`${JSON.stringify({ output: outputPath, ...inventory.summary }, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
