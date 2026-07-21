#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  createBudgetTracker,
  detectWorkshopBuildIds,
  hostIsAllowed,
  normalizeScope,
  redactUrl,
  scopeHost,
  summarizeLedgerEntries,
  validateBody,
} from './capture-core.mjs';

function normalizeResourceType(value = '') {
  const normalized = value.toLowerCase();
  if (normalized === 'script') return 'Script';
  if (normalized === 'stylesheet') return 'Stylesheet';
  if (normalized === 'font') return 'Font';
  if (normalized === 'image') return 'Image';
  if (normalized === 'document') return 'Document';
  if (normalized === 'fetch') return 'Fetch';
  if (normalized === 'xhr') return 'XHR';
  return value;
}

export function classifyMcpResource({ resourceType = '', mimeType = '', url = '' }) {
  const type = normalizeResourceType(resourceType);
  const mime = mimeType.toLowerCase();
  const essence = mime.split(';', 1)[0].trim();
  const path = url.toLowerCase().split(/[?#]/, 1)[0];
  const htmlMime = essence === 'text/html' || essence === 'application/xhtml+xml';
  if (type === 'Document') return htmlMime ? 'html' : null;
  if ((type === 'Fetch' || type === 'XHR') && htmlMime) return null;
  if (type === 'Script' || mime.includes('javascript') || mime.includes('ecmascript') || /\.m?js$/.test(path)) return 'js';
  if (type === 'Stylesheet' || mime === 'text/css' || path.endsWith('.css')) return 'css';
  if (mime === 'application/wasm' || path.endsWith('.wasm')) return 'wasm';
  if (type === 'Font' || mime.startsWith('font/') || /\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
  if (type === 'Image' || mime.startsWith('image/')) return 'image';
  return null;
}

function extensionFor(kind, resourceUrl, mimeType = '') {
  const known = new Set(['.js', '.mjs', '.css', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.html', '.xhtml']);
  if (kind === 'html') return mimeType.toLowerCase().split(';', 1)[0].trim() === 'application/xhtml+xml' ? '.xhtml' : '.html';
  try {
    const path = new URL(resourceUrl).pathname.toLowerCase();
    const extension = [...known].find((candidate) => path.endsWith(candidate));
    if (extension) return extension;
  } catch {}
  if (kind === 'js') return '.js';
  if (kind === 'css') return '.css';
  if (kind === 'wasm') return '.wasm';
  if (kind === 'font') return mimeType.includes('woff2') ? '.woff2' : '.font';
  return '.bin';
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readNdjson(path) {
  if (!path) return [];
  try {
    const content = await readFile(path, 'utf8');
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendNdjson(path, value) {
  await appendFile(path, `${JSON.stringify(value)}\n`);
}

async function initializeOutput(output, scope, ledgerPath) {
  await mkdir(join(output, 'assets'), { recursive: true });
  const provenancePath = join(output, 'provenance.json');
  await writeFile(provenancePath, JSON.stringify({
    startedAt: new Date().toISOString(),
    backend: 'chrome-devtools-mcp-autoconnect',
    mode: 'capture',
    caseId: scope.caseId,
    pageHosts: scope.pageHosts,
    assetHosts: scope.assetHosts,
    approvedNetworkHosts: scope.approvedNetworkHosts,
    types: [...scope.types],
    stopStatuses: [...scope.stopStatuses],
    limits: scope.limits,
    automation: scope.automation.enabled ? {
      enabled: true,
      mode: scope.automation.mode,
      allowAutosave: scope.automation.allowAutosave,
      allowCreateCapturePages: scope.automation.allowCreateCapturePages,
      allowExistingModuleVariables: scope.automation.allowExistingModuleVariables,
      captureStateScreenshots: scope.automation.captureStateScreenshots,
      maxWidgetsPerPage: scope.automation.maxWidgetsPerPage,
      states: scope.automation.states,
      fixtureProfileNames: scope.fixtureProfileNames,
      mappedWidgetKeys: Object.keys(scope.widgetFixtureMap).sort(),
      approvedPageUrl: scope.authorization.approvedPageUrl,
      moduleId: scope.authorization.moduleId,
      authorizationWindow: { startsAt: scope.authorization.startsAt, endsAt: scope.authorization.endsAt },
    } : { enabled: false },
    ledger: ledgerPath || null,
    policy: 'natural-load-only',
    note: 'Bodies were read from completed requests already observed by the selected Chrome page. No resource URL was replayed.',
  }, null, 2), { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

async function updateSummary(output, patch) {
  const summaryPath = join(output, 'summary.json');
  const prior = await readJson(summaryPath, {
    startedAt: new Date().toISOString(),
    backend: 'chrome-devtools-mcp-autoconnect',
    captured: 0,
    rejectedAssets: 0,
    bodyFailures: 0,
    totalBytes: 0,
    workshopBuildIds: [],
    finalMarker: 'unmarked',
  });
  const next = {
    ...prior,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(summaryPath, JSON.stringify(next, null, 2));
  return next;
}

export async function importMcpResponse(input) {
  const scopePath = resolve(input.scopePath);
  const output = resolve(input.output);
  const ledgerPath = input.ledgerPath ? resolve(input.ledgerPath) : null;
  const bodyPath = input.bodyPath ? resolve(input.bodyPath) : null;
  const stagingRoot = resolve(input.stagingRoot || tmpdir());
  const scope = normalizeScope(JSON.parse(await readFile(scopePath, 'utf8')));
  await initializeOutput(output, scope, ledgerPath);

  const status = Number(input.status);
  const marker = input.marker || 'unmarked';
  const urlScope = scopeHost(input.url, scope.approvedNetworkHosts);
  const riskPath = join(output, 'risk-events.ndjson');
  const invalidPath = join(output, 'invalid-assets.ndjson');
  const manifestPath = join(output, 'manifest.ndjson');
  const cleanupStagedBody = async () => {
    if (!input.deleteBody || !bodyPath) return;
    const [canonicalRoot, canonicalBody] = await Promise.all([
      realpath(stagingRoot),
      realpath(bodyPath),
    ]);
    const stagedRelativePath = relative(canonicalRoot, canonicalBody);
    if (!stagedRelativePath || stagedRelativePath.startsWith('..') || isAbsolute(stagedRelativePath)) {
      throw new Error(`Refusing to delete body outside staging root: ${bodyPath}`);
    }
    await unlink(canonicalBody);
  };

  if (!urlScope.network || !urlScope.allowed) {
    await appendNdjson(riskPath, {
      at: new Date().toISOString(),
      kind: 'unapproved-host',
      host: urlScope.host,
      url: redactUrl(input.url),
      backend: 'chrome-devtools-mcp-autoconnect',
    });
    await cleanupStagedBody();
    throw new Error(`Response host is not approved: ${urlScope.host || 'invalid URL'}`);
  }
  if (scope.stopStatuses.has(status)) {
    await appendNdjson(riskPath, {
      at: new Date().toISOString(),
      kind: 'stop-status',
      status,
      url: redactUrl(input.url),
      backend: 'chrome-devtools-mcp-autoconnect',
    });
    await cleanupStagedBody();
    throw new Error(`Stop status observed: HTTP ${status}`);
  }

  const kind = classifyMcpResource(input);
  if (!kind || !scope.types.has(kind)) {
    await cleanupStagedBody();
    return { event: 'ignored', kind };
  }
  if (kind === 'html') {
    const exactlyApproved = scope.approvedNetworkHosts.some((pattern) => (
      !pattern.includes('*') && pattern.toLowerCase() === urlScope.host.toLowerCase()
    ));
    if (!exactlyApproved) {
      await appendNdjson(riskPath, {
        at: new Date().toISOString(),
        kind: 'document-host-not-exactly-approved',
        host: urlScope.host,
        url: redactUrl(input.url),
        backend: 'chrome-devtools-mcp-autoconnect',
      });
      await cleanupStagedBody();
      throw new Error(`Document HTML host is not exactly approved: ${urlScope.host}`);
    }
    const safeDocumentRequest = input.requestMethod === 'GET'
      && input.requestHasBody === false
      && ['top-level', 'widget-iframe'].includes(input.documentContext)
      && status >= 200
      && status <= 399;
    if (!safeDocumentRequest) {
      await cleanupStagedBody();
      return { event: 'ignored', kind, reason: 'unsafe-document-html' };
    }
  }
  if (!hostIsAllowed(urlScope.host, scope.assetHosts)) {
    await appendNdjson(riskPath, {
      at: new Date().toISOString(),
      kind: 'static-host-not-approved-for-capture',
      host: urlScope.host,
      url: redactUrl(input.url),
      backend: 'chrome-devtools-mcp-autoconnect',
    });
    await cleanupStagedBody();
    throw new Error(`Static response host is not approved for capture: ${urlScope.host}`);
  }

  if (!bodyPath) {
    const entry = {
      at: new Date().toISOString(),
      event: 'body-unavailable',
      marker,
      kind,
      url: redactUrl(input.url),
      status,
      requestId: input.requestId || null,
      captureMethod: 'chrome-devtools-mcp-observed-response',
    };
    await appendNdjson(manifestPath, entry);
    const prior = await readJson(join(output, 'summary.json'), {});
    await updateSummary(output, { bodyFailures: (prior.bodyFailures || 0) + 1, finalMarker: marker });
    return entry;
  }

  const body = await readFile(bodyPath);
  const sha256 = createHash('sha256').update(body).digest('hex');
  let validation = validateBody(kind, body);
  if (validation.accepted && body.length > scope.limits.maxAssetMiB * 1024 * 1024) {
    validation = { accepted: false, reason: 'asset-budget-exceeded' };
  }

  const ledgerEntries = await readNdjson(ledgerPath);
  const priorBudget = summarizeLedgerEntries(ledgerEntries, scope.limits, scope.caseId);
  const budget = createBudgetTracker(priorBudget, scope.limits);
  if (validation.accepted) validation = budget.reserve(body.length);

  if (!validation.accepted) {
    const entry = {
      at: new Date().toISOString(),
      event: 'invalid-body',
      marker,
      kind,
      url: redactUrl(input.url),
      status,
      mimeType: input.mimeType || null,
      size: body.length,
      sha256,
      reason: validation.reason,
      requestId: input.requestId || null,
      captureMethod: 'chrome-devtools-mcp-observed-response',
    };
    await appendNdjson(invalidPath, entry);
    const prior = await readJson(join(output, 'summary.json'), {});
    await updateSummary(output, { rejectedAssets: (prior.rejectedAssets || 0) + 1, finalMarker: marker });
    await cleanupStagedBody();
    if (validation.reason.endsWith('budget-exceeded')) {
      await appendNdjson(riskPath, {
        at: new Date().toISOString(),
        kind: 'capture-budget-reached',
        reason: validation.reason,
      });
      throw new Error(`Capture budget reached: ${validation.reason}`);
    }
    return entry;
  }

  const extension = extensionFor(kind, input.url, input.mimeType || '');
  const relativePath = join('assets', kind, `${sha256}${extension}`);
  const absolutePath = join(output, relativePath);
  await mkdir(join(output, 'assets', kind), { recursive: true });
  await writeFile(absolutePath, body, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });

  const detectedBuildIds = kind === 'js' ? detectWorkshopBuildIds(body) : [];
  const priorSummary = await readJson(join(output, 'summary.json'), {});
  const workshopBuildIds = [...new Set([...(priorSummary.workshopBuildIds || []), ...detectedBuildIds])].sort();
  const entry = {
    at: new Date().toISOString(),
    event: 'saved',
    marker,
    kind,
    url: redactUrl(input.url),
    status,
    mimeType: input.mimeType || null,
    resourceType: input.resourceType || null,
    size: body.length,
    sha256,
    file: relativePath,
    requestId: input.requestId || null,
    captureMethod: 'chrome-devtools-mcp-observed-response',
    validation: 'accepted',
    workshopBuildIds: detectedBuildIds,
  };
  await appendNdjson(manifestPath, entry);
  await appendNdjson(join(output, 'markers.ndjson'), { at: entry.at, marker });
  if (ledgerPath) {
    await appendNdjson(ledgerPath, {
      at: entry.at,
      event: 'saved',
      caseId: scope.caseId,
      run: basename(output),
      marker,
      kind,
      sha256,
      size: body.length,
    });
  }
  await updateSummary(output, {
    captured: (priorSummary.captured || 0) + 1,
    totalBytes: (priorSummary.totalBytes || 0) + body.length,
    workshopBuildIds,
    finalMarker: marker,
    taskBudget: budget.snapshot(),
  });
  if (workshopBuildIds.length > 1) {
    await appendNdjson(riskPath, {
      at: new Date().toISOString(),
      kind: 'workshop-build-mismatch',
      buildIds: workshopBuildIds,
      url: redactUrl(input.url),
    });
    await cleanupStagedBody();
    throw new Error(`Workshop build mismatch observed: ${workshopBuildIds.join(', ')}`);
  }
  await cleanupStagedBody();
  return entry;
}

function usage() {
  return `Usage:
  node import-mcp-response.mjs --scope FILE --output DIR --url URL --status CODE \\
    --resource-type TYPE [--mime-type MIME] [--body FILE] [--request-id ID] \\
    [--request-method METHOD] [--request-has-body true|false] \\
    [--document-context top-level|widget-iframe] [--marker LABEL] [--ledger FILE] \\
    [--staging-root DIR] [--delete-body]

Omit --body to record body-unavailable. This command never fetches a URL.
`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === '--help') options.help = true;
    else if (arg === '--scope') options.scopePath = next();
    else if (arg === '--output') options.output = next();
    else if (arg === '--ledger') options.ledgerPath = next();
    else if (arg === '--body') options.bodyPath = next();
    else if (arg === '--url') options.url = next();
    else if (arg === '--status') options.status = next();
    else if (arg === '--resource-type') options.resourceType = next();
    else if (arg === '--mime-type') options.mimeType = next();
    else if (arg === '--request-method') options.requestMethod = next();
    else if (arg === '--request-has-body') {
      const value = next();
      if (!['true', 'false'].includes(value)) throw new Error('--request-has-body must be true or false');
      options.requestHasBody = value === 'true';
    }
    else if (arg === '--document-context') options.documentContext = next();
    else if (arg === '--marker') options.marker = next();
    else if (arg === '--request-id') options.requestId = next();
    else if (arg === '--staging-root') options.stagingRoot = next();
    else if (arg === '--delete-body') options.deleteBody = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const key of ['scopePath', 'output', 'url', 'status', 'resourceType']) {
      if (options[key] === undefined) throw new Error(`Missing required option: ${key}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await importMcpResponse(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
