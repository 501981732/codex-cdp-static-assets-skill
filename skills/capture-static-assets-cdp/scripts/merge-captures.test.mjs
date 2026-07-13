import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('merges capture runs by SHA-256 and preserves aggregate evidence', async () => {
  const scriptPath = new URL('./merge-captures.mjs', import.meta.url);
  const exists = await access(scriptPath).then(() => true, () => false);
  assert.equal(exists, true, 'merge-captures.mjs must exist');
  const { mergeCaptureDirectories } = await import(pathToFileURL(scriptPath.pathname));

  const root = await mkdtemp(join(tmpdir(), 'merge-captures-'));
  const run1 = join(root, 'run-1');
  const run2 = join(root, 'run-2');
  const output = join(root, 'merged');
  await mkdir(join(run1, 'assets', 'js'), { recursive: true });
  await mkdir(join(run2, 'assets', 'js'), { recursive: true });
  await writeFile(join(run1, 'assets', 'js', 'same.js'), 'same');
  await writeFile(join(run2, 'assets', 'js', 'same.js'), 'same');
  await writeFile(join(run2, 'assets', 'js', 'unique.js'), 'unique');

  const shared = { event: 'saved', kind: 'js', sha256: 'same', size: 4, file: 'assets/js/same.js', marker: 'P0' };
  await writeFile(join(run1, 'manifest.ndjson'), `${JSON.stringify(shared)}\n`);
  await writeFile(join(run2, 'manifest.ndjson'), `${JSON.stringify({ ...shared, marker: 'P1' })}\n${JSON.stringify({ event: 'saved', kind: 'js', sha256: 'unique', size: 6, file: 'assets/js/unique.js', marker: 'P1' })}\n`);
  await writeFile(join(run1, 'summary.json'), JSON.stringify({ captured: 1, totalBytes: 4, bodyFailures: 0, stopReason: 'quit' }));
  await writeFile(join(run2, 'summary.json'), JSON.stringify({ captured: 2, totalBytes: 10, bodyFailures: 1, stopReason: 'unapproved host' }));
  await writeFile(join(run2, 'risk-events.ndjson'), `${JSON.stringify({ kind: 'unapproved-host', host: 'api.example.com' })}\n`);

  const summary = await mergeCaptureDirectories([run1, run2], output);
  assert.deepEqual({
    savedEvents: summary.savedEvents,
    uniqueFiles: summary.uniqueFiles,
    duplicateEvents: summary.duplicateEvents,
    uniqueBytes: summary.uniqueBytes,
    capturedBytes: summary.capturedBytes,
  }, {
    savedEvents: 3,
    uniqueFiles: 2,
    duplicateEvents: 1,
    uniqueBytes: 10,
    capturedBytes: 14,
  });

  const mergedManifest = (await readFile(join(output, 'manifest.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(mergedManifest.length, 2);
  assert.deepEqual(mergedManifest.find((item) => item.sha256 === 'same').markers, ['P0', 'P1']);
  assert.equal((await readFile(join(output, 'risk-events.ndjson'), 'utf8')).includes('api.example.com'), true);
});
