import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCapture } from './audit-capture.mjs';

test('audits saved assets and flags an all-zero JavaScript file', async () => {
  const output = await mkdtemp(join(tmpdir(), 'cdp-audit-'));
  const jsDir = join(output, 'assets', 'js');
  await mkdir(jsDir, { recursive: true });
  await writeFile(join(jsDir, 'zero.js'), Buffer.alloc(8));
  await writeFile(join(jsDir, 'valid.js'), '(()=>{})();');

  const report = await auditCapture(output);
  assert.equal(report.totalFiles, 2);
  assert.equal(report.validFiles, 1);
  assert.deepEqual(report.invalid, [{ file: 'assets/js/zero.js', reason: 'all-zero-body' }]);
});
