#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBody } from './capture-core.mjs';

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
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

  return { output, manifest: manifest.file ? relative(output, manifest.file) : null, totalFiles: files.length, validFiles, invalid };
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
