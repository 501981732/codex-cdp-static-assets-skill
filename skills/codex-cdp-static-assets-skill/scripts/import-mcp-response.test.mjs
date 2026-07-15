import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCapture } from './audit-capture.mjs';
import { importMcpResponse } from './import-mcp-response.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcp-static-assets-'));
  const scopePath = join(root, 'scope.json');
  const output = join(root, 'capture');
  const ledgerPath = join(root, 'ledger.ndjson');
  await writeFile(scopePath, JSON.stringify({
    caseId: 'CASE-MCP-1',
    pageHosts: ['workshop.example.com'],
    assetHosts: ['cdn.example.com'],
    approvedNetworkHosts: ['api.example.com'],
    types: ['js', 'css'],
    limits: { maxAssets: 10, maxTotalMiB: 10, maxAssetMiB: 1 },
    stopOnStatuses: [401, 403, 429],
  }));
  return { root, scopePath, output, ledgerPath };
}

async function ndjson(path) {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('imports an MCP response into the existing audited capture format', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, 'console.log("captured");\n');

  const result = await importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    ledgerPath: paths.ledgerPath,
    bodyPath,
    url: 'https://cdn.example.com/assets/widget.js?token=secret#fragment',
    status: 200,
    resourceType: 'script',
    mimeType: 'application/javascript',
    marker: 'P1:charts',
    requestId: '17',
  });

  assert.equal(result.event, 'saved');
  assert.equal(result.kind, 'js');
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const manifest = await ndjson(join(paths.output, 'manifest.ndjson'));
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].captureMethod, 'chrome-devtools-mcp-observed-response');
  assert.equal(manifest[0].url, 'https://cdn.example.com/assets/widget.js?token=%5BREDACTED%5D');
  assert.equal(manifest[0].marker, 'P1:charts');
  assert.equal((await ndjson(paths.ledgerPath)).length, 1);
  const saved = await readFile(join(paths.output, manifest[0].file), 'utf8');
  assert.equal(saved, 'console.log("captured");\n');
  assert.deepEqual(await auditCapture(paths.output), {
    output: paths.output,
    totalFiles: 1,
    validFiles: 1,
    invalid: [],
  });
});

test('rejects an MCP response from an unapproved host before saving the body', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, 'console.log("outside");\n');

  await assert.rejects(importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    bodyPath,
    url: 'https://outside.example.net/chunk.js',
    status: 200,
    resourceType: 'script',
    marker: 'P2:table',
  }), /not approved/);

  assert.equal((await ndjson(join(paths.output, 'manifest.ndjson'))).length, 0);
  assert.equal((await ndjson(join(paths.output, 'risk-events.ndjson')))[0].kind, 'unapproved-host');
});

test('records an HTML response masquerading as JavaScript as invalid', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, '<!doctype html><title>Login</title>');

  const result = await importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    bodyPath,
    url: 'https://cdn.example.com/chunk.js',
    status: 200,
    resourceType: 'script',
    mimeType: 'text/html',
    marker: 'P3:filter',
  });

  assert.equal(result.event, 'invalid-body');
  assert.equal(result.reason, 'html-body-for-js');
  assert.equal((await ndjson(join(paths.output, 'manifest.ndjson'))).length, 0);
  assert.equal((await ndjson(join(paths.output, 'invalid-assets.ndjson')))[0].reason, 'html-body-for-js');
});

test('deletes only explicitly staged MCP bodies when a scope check stops import', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.output, '.mcp-staging', 'outside.network-response');
  await mkdir(join(paths.output, '.mcp-staging'), { recursive: true });
  await writeFile(bodyPath, 'console.log("outside");\n');

  await assert.rejects(importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    bodyPath,
    url: 'https://outside.example.net/chunk.js',
    status: 200,
    resourceType: 'script',
    deleteBody: true,
  }), /not approved/);

  await assert.rejects(readFile(bodyPath), { code: 'ENOENT' });
});

test('MCP importer has no code path that retrieves a URL', async () => {
  const source = await readFile(new URL('./import-mcp-response.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'http.request', 'https.request', 'Network.loadNetworkResource']) {
    assert.equal(source.includes(forbidden), false, `forbidden retrieval method: ${forbidden}`);
  }
});
