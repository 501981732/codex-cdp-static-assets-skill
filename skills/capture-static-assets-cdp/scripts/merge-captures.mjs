#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export async function mergeCaptureDirectories(inputDirectories, outputDirectory) {
  if (!Array.isArray(inputDirectories) || inputDirectories.length < 1) throw new Error('Provide at least one capture directory');
  const inputs = inputDirectories.map((input) => resolve(input));
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: false });
  await mkdir(join(output, 'assets'), { recursive: true });

  const unique = new Map();
  const risks = [];
  const invalid = [];
  const markers = [];
  const summaries = [];
  let savedEvents = 0;

  for (const input of inputs) {
    const sourceRun = basename(input);
    const manifest = await readNdjson(join(input, 'manifest.ndjson'));
    const summary = await readJson(join(input, 'summary.json'));
    if (summary) summaries.push({ sourceRun, ...summary });
    risks.push(...(await readNdjson(join(input, 'risk-events.ndjson'))).map((entry) => ({ sourceRun, ...entry })));
    invalid.push(...(await readNdjson(join(input, 'invalid-assets.ndjson'))).map((entry) => ({ sourceRun, ...entry })));
    markers.push(...(await readNdjson(join(input, 'markers.ndjson'))).map((entry) => ({ sourceRun, ...entry })));

    for (const entry of manifest.filter((item) => item.event === 'saved' && item.sha256 && item.file)) {
      savedEvents += 1;
      const existing = unique.get(entry.sha256);
      if (existing) {
        existing.occurrences += 1;
        existing.markers.add(entry.marker);
        existing.sourceRuns.add(sourceRun);
        continue;
      }
      unique.set(entry.sha256, {
        entry,
        occurrences: 1,
        markers: new Set([entry.marker]),
        sourceRuns: new Set([sourceRun]),
        sourcePath: join(input, entry.file),
      });
    }
  }

  const mergedManifest = [];
  for (const item of [...unique.values()].sort((left, right) => left.entry.sha256.localeCompare(right.entry.sha256))) {
    const destination = join(output, item.entry.file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(item.sourcePath, destination);
    mergedManifest.push({
      ...item.entry,
      markers: [...item.markers].filter(Boolean).sort(),
      sourceRuns: [...item.sourceRuns].sort(),
      occurrences: item.occurrences,
    });
  }

  const summary = {
    createdAt: new Date().toISOString(),
    sourceRuns: inputs.map((input) => basename(input)),
    runCount: inputs.length,
    savedEvents,
    uniqueFiles: mergedManifest.length,
    duplicateEvents: savedEvents - mergedManifest.length,
    uniqueBytes: mergedManifest.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
    capturedBytes: summaries.reduce((sum, entry) => sum + (Number(entry.totalBytes) || 0), 0),
    bodyFailures: summaries.reduce((sum, entry) => sum + (Number(entry.bodyFailures) || 0), 0),
    rejectedAssets: summaries.reduce((sum, entry) => sum + (Number(entry.rejectedAssets) || 0), 0),
    stopReasons: summaries.map((entry) => ({ sourceRun: entry.sourceRun, reason: entry.stopReason })),
    riskEvents: risks.length,
    invalidEvents: invalid.length,
  };

  await writeFile(join(output, 'manifest.ndjson'), ndjson(mergedManifest));
  await writeFile(join(output, 'risk-events.ndjson'), ndjson(risks));
  await writeFile(join(output, 'invalid-assets.ndjson'), ndjson(invalid));
  await writeFile(join(output, 'markers.ndjson'), ndjson(markers));
  await writeFile(join(output, 'merge-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

function usage() {
  return 'Usage: node merge-captures.mjs --output MERGED_DIR CAPTURE_DIR [CAPTURE_DIR ...]\n';
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
