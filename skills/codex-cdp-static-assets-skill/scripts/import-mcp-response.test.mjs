import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditCapture } from './audit-capture.mjs';
import { classifyMcpResource, importMcpResponse } from './import-mcp-response.mjs';

const execFileAsync = promisify(execFile);

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
    types: ['js', 'css', 'html'],
    limits: { maxAssets: 10, maxTotalMiB: 10, maxAssetMiB: 1 },
    stopOnStatuses: [401, 403, 429],
  }));
  return { root, scopePath, output, ledgerPath };
}

test('classifies only document HTML and excludes fetch or xhr HTML', () => {
  assert.equal(classifyMcpResource({
    resourceType: 'document',
    mimeType: 'text/html; charset=utf-8',
    url: 'https://workshop.example.com/',
  }), 'html');
  assert.equal(classifyMcpResource({
    resourceType: 'fetch',
    mimeType: 'text/html',
    url: 'https://workshop.example.com/api',
  }), null);
  assert.equal(classifyMcpResource({
    resourceType: 'xhr',
    mimeType: 'application/xhtml+xml',
    url: 'https://workshop.example.com/api',
  }), null);
});

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
    manifest: 'manifest.ndjson',
    componentMap: { present: false, componentCount: 0, completeComponents: 0, partialComponents: 0 },
    totalFiles: 1,
    validFiles: 1,
    invalid: [],
  });
});

test('provenance records only non-sensitive automation policy and fixture names', async () => {
  const paths = await fixture();
  const scope = JSON.parse(await readFile(paths.scopePath, 'utf8'));
  scope.automation = {
    enabled: true,
    mode: 'single-page',
    allowAutosave: true,
    allowCreateCapturePages: false,
    allowModuleVariables: true,
    captureStateScreenshots: true,
    maxWidgetsPerPage: 5,
    states: ['editor-mounted', 'data-bound', 'preview-visible'],
  };
  scope.approvedPageUrl = 'https://workshop.example.com/module/edit/module-1';
  scope.moduleId = 'module-1';
  scope.testAccount = 'synthetic-tester';
  scope.authorizationWindow = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' };
  scope.stopContact = 'workshop-owner';
  scope.fixtureProfiles = {
    objects: { kind: 'synthetic-object-set', visibleOption: 'CDP Objects', secret: 'must-not-persist' },
  };
  scope.widgetFixtureMap = { 'tables/object-table/v1': 'objects' };
  await writeFile(paths.scopePath, JSON.stringify(scope));
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, 'console.log("automation");');

  await importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    bodyPath,
    url: 'https://cdn.example.com/widget.js',
    status: 200,
    resourceType: 'script',
    mimeType: 'application/javascript',
  });

  const provenanceText = await readFile(join(paths.output, 'provenance.json'), 'utf8');
  const provenance = JSON.parse(provenanceText);
  assert.deepEqual(provenance.automation.fixtureProfileNames, ['objects']);
  assert.deepEqual(provenance.automation.mappedWidgetKeys, ['tables/object-table/v1']);
  assert.equal(provenance.automation.captureStateScreenshots, true);
  assert.equal(provenance.automation.allowModuleVariables, true);
  assert.equal(provenanceText.includes('must-not-persist'), false);
  assert.equal(provenanceText.includes('CDP Objects'), false);
  assert.equal(provenanceText.includes('synthetic-tester'), false);
  assert.equal(provenanceText.includes('workshop-owner'), false);
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

test('imports naturally loaded approved top-level document HTML', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, '<!doctype html><title>Workshop</title>');

  const result = await importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    ledgerPath: paths.ledgerPath,
    bodyPath,
    url: 'https://workshop.example.com/module/edit/fallback.js?token=secret',
    status: 304,
    resourceType: 'document',
    mimeType: 'text/html',
    requestMethod: 'GET',
    requestHasBody: false,
    documentContext: 'top-level',
    marker: 'widget:workshop:12345678:editor-mounted',
    requestId: 'html-1',
  });

  assert.equal(result.event, 'saved');
  assert.equal(result.kind, 'html');
  assert.match(result.file, /^assets\/html\/[a-f0-9]{64}\.html$/);
  assert.equal(await readFile(join(paths.output, result.file), 'utf8'), '<!doctype html><title>Workshop</title>');
});

test('CLI parses and applies the strict HTML request metadata', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, '<!doctype html><title>CLI</title>');
  const scriptPath = new URL('./import-mcp-response.mjs', import.meta.url);

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath.pathname,
    '--scope', paths.scopePath,
    '--output', paths.output,
    '--body', bodyPath,
    '--url', 'https://workshop.example.com/cli',
    '--status', '200',
    '--resource-type', 'document',
    '--mime-type', 'text/html',
    '--request-method', 'GET',
    '--request-has-body', 'false',
    '--document-context', 'top-level',
  ]);
  assert.equal(JSON.parse(stdout).event, 'saved');

  await assert.rejects(execFileAsync(process.execPath, [
    scriptPath.pathname,
    '--scope', paths.scopePath,
    '--output', join(paths.root, 'invalid-cli'),
    '--url', 'https://workshop.example.com/cli',
    '--status', '200',
    '--resource-type', 'document',
    '--request-has-body', 'unknown',
  ]), /request-has-body must be true or false/);
});

test('imports approved widget iframe XHTML with an xhtml extension', async () => {
  const paths = await fixture();
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, '<html xmlns="http://www.w3.org/1999/xhtml"><body>Widget</body></html>');

  const result = await importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    bodyPath,
    url: 'https://workshop.example.com/widget.xhtml',
    status: 200,
    resourceType: 'Document',
    mimeType: 'application/xhtml+xml',
    requestMethod: 'GET',
    requestHasBody: false,
    documentContext: 'widget-iframe',
  });

  assert.equal(result.event, 'saved');
  assert.match(result.file, /\.xhtml$/);
});

test('fails closed for document HTML without complete safe request metadata', async () => {
  const cases = [
    { name: 'post', requestMethod: 'POST', requestHasBody: false, documentContext: 'top-level', status: 200 },
    { name: 'request body', requestMethod: 'GET', requestHasBody: true, documentContext: 'top-level', status: 200 },
    { name: 'unknown body state', requestMethod: 'GET', documentContext: 'top-level', status: 200 },
    { name: 'unknown context', requestMethod: 'GET', requestHasBody: false, documentContext: 'unknown', status: 200 },
    { name: 'client error', requestMethod: 'GET', requestHasBody: false, documentContext: 'top-level', status: 404 },
  ];

  for (const item of cases) {
    const paths = await fixture();
    const bodyPath = join(paths.root, `${item.name}.network-response`);
    await writeFile(bodyPath, '<!doctype html><title>Should not save</title>');
    const result = await importMcpResponse({
      scopePath: paths.scopePath,
      output: paths.output,
      bodyPath,
      url: 'https://workshop.example.com/',
      resourceType: 'document',
      mimeType: 'text/html',
      requestMethod: item.requestMethod,
      requestHasBody: item.requestHasBody,
      documentContext: item.documentContext,
      status: item.status,
    });
    assert.equal(result.event, 'ignored', item.name);
    assert.equal(result.reason, 'unsafe-document-html', item.name);
    assert.equal((await ndjson(join(paths.output, 'manifest.ndjson'))).length, 0, item.name);
  }
});

test('requires an exact approved host for document HTML', async () => {
  const paths = await fixture();
  const scope = JSON.parse(await readFile(paths.scopePath, 'utf8'));
  scope.approvedNetworkHosts.push('*.example.com');
  await writeFile(paths.scopePath, JSON.stringify(scope));
  const bodyPath = join(paths.root, 'response.network-response');
  await writeFile(bodyPath, '<!doctype html><title>Unlisted iframe</title>');

  await assert.rejects(importMcpResponse({
    scopePath: paths.scopePath,
    output: paths.output,
    bodyPath,
    url: 'https://unlisted.example.com/widget',
    status: 200,
    resourceType: 'document',
    mimeType: 'text/html',
    requestMethod: 'GET',
    requestHasBody: false,
    documentContext: 'widget-iframe',
  }), /exactly approved/);
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
