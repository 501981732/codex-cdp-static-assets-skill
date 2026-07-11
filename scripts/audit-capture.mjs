#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBody } from './capture-static-assets.mjs';

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
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
  const invalid = [];
  let validFiles = 0;

  for (const file of files) {
    const body = await readFile(file);
    const kind = kindForPath(file);
    const result = validateBody(kind, body);
    const relativeFile = relative(output, file);
    const name = file.split('/').at(-1).split('.')[0];
    const hasContentHashName = /^[a-f0-9]{64}$/i.test(name);
    const hashMatches = !hasContentHashName || createHash('sha256').update(body).digest('hex') === name;
    if (!result.accepted) invalid.push({ file: relativeFile, reason: result.reason });
    else if (!hashMatches) invalid.push({ file: relativeFile, reason: 'content-hash-mismatch' });
    else validFiles += 1;
  }

  return { output, totalFiles: files.length, validFiles, invalid };
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node audit-capture.mjs <capture-output-directory>');
  const report = await auditCapture(output);
  await writeFile(join(report.output, 'asset-audit.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
