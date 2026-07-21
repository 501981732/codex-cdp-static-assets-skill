import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractWidgetInventory } from './widget-inventory.mjs';

test('extracts the baseline Widget registry without reading non-baseline assets', async () => {
  const capture = await mkdtemp(join(tmpdir(), 'widget-inventory-'));
  await mkdir(join(capture, 'assets', 'js'), { recursive: true });
  const registry = [
    'const registry={',
    '"hubble.object-set-section.v1.oa-header-text-section":b(()=>Promise.all([r.e("80072"),r.e("18618")]).then(r.bind(r,501987)),"HeaderTextSection"),',
    '"hubble.object-set-section.v1.oa-string-input":b(()=>r.e("12345").then(r.bind(r,678901)),"StringInputSection")',
    '};',
    'const metadata={"hubble.object-set-section.v1.oa-header-text-section":{title:"Header",configType:"HEADER_TEXT_V1"}};',
  ].join('');
  await writeFile(join(capture, 'assets', 'js', 'registry.js'), registry);
  await writeFile(join(capture, 'assets', 'js', 'later.js'), '"hubble.object-set-section.v1.oa-later":b(()=>r.e("9"),"LaterSection")');
  await writeFile(join(capture, 'manifest.ndjson'), [
    {
      event: 'saved', marker: 'P0:baseline', kind: 'js', sha256: 'registry-sha',
      url: 'https://cdn.example/registry.js', file: 'assets\\js\\registry.js',
    },
    {
      event: 'saved', marker: 'widget:later:deadbeef:editor-mounted', kind: 'js', sha256: 'later-sha',
      url: 'https://cdn.example/later.js', file: 'assets/js/later.js',
    },
  ].map(JSON.stringify).join('\n'));
  await writeFile(join(capture, 'provenance.json'), JSON.stringify({ caseId: 'SEC-1' }));

  const inventory = await extractWidgetInventory(capture, { generatedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(inventory.classification, 'baseline-widget-registry');
  assert.equal(inventory.caseId, 'SEC-1');
  assert.deepEqual(inventory.summary, { registryEntries: 2, sourceAssets: 1 });
  assert.deepEqual(inventory.entries, [
    {
      typeId: 'hubble.object-set-section.v1.oa-header-text-section', rendererName: 'HeaderTextSection',
      chunkIds: ['18618', '80072'], moduleIds: ['501987'], sourceSha256: 'registry-sha',
    },
    {
      typeId: 'hubble.object-set-section.v1.oa-string-input', rendererName: 'StringInputSection',
      chunkIds: ['12345'], moduleIds: ['678901'], sourceSha256: 'registry-sha',
    },
  ]);
});
