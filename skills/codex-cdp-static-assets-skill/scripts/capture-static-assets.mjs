#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const TARGET_TYPES = new Set(['page', 'iframe', 'worker', 'shared_worker', 'service_worker']);
const DEFAULT_TYPES = new Set(['js', 'css', 'wasm', 'font']);
const DEFAULT_LIMITS = { maxAssets: 0, maxTotalMiB: 0, maxAssetMiB: 50 };

export function classifyResource({ type = '', mimeType = '', url = '' }) {
  const mime = mimeType.toLowerCase();
  const path = url.toLowerCase().split(/[?#]/, 1)[0];
  if (type === 'Script' || mime.includes('javascript') || mime.includes('ecmascript') || /\.m?js$/.test(path)) return 'js';
  if (type === 'Stylesheet' || mime === 'text/css' || path.endsWith('.css')) return 'css';
  if (mime === 'application/wasm' || path.endsWith('.wasm')) return 'wasm';
  if (type === 'Font' || mime.startsWith('font/') || /\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
  if (type === 'Image' || mime.startsWith('image/')) return 'image';
  return null;
}

export function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    url.hash = '';
    return url.toString();
  } catch {
    return '[INVALID_URL]';
  }
}

export function hostIsAllowed(hostname, patterns) {
  const host = hostname.toLowerCase();
  return patterns.some((rawPattern) => {
    const pattern = rawPattern.toLowerCase();
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) && host !== suffix.slice(1);
    }
    return host === pattern;
  });
}

export function scopeHost(value, patterns) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return { network: false, allowed: false, host: null };
    return {
      network: true,
      allowed: hostIsAllowed(url.hostname, patterns),
      host: url.hostname,
    };
  } catch {
    return { network: false, allowed: false, host: null };
  }
}

export function normalizeScope(input) {
  const requiredArray = (value, field) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`Scope field ${field} must be an array of host patterns`);
    }
    return [...new Set(value.map((item) => item.trim()))];
  };
  const pageHosts = requiredArray(input.pageHosts, 'pageHosts');
  const configuredAssetHosts = requiredArray(input.assetHosts || [], 'assetHosts');
  const configuredNetworkHosts = requiredArray(input.approvedNetworkHosts || [], 'approvedNetworkHosts');
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!Number.isFinite(limits[key]) || limits[key] < 0) throw new Error(`Scope limit ${key} must be >= 0`);
  }
  const stopStatuses = input.stopOnStatuses || [401, 403, 429];
  if (!Array.isArray(stopStatuses) || stopStatuses.some((status) => !Number.isInteger(status))) {
    throw new Error('Scope field stopOnStatuses must be an array of HTTP status codes');
  }
  const types = input.types ? new Set(requiredArray(input.types, 'types')) : new Set(DEFAULT_TYPES);
  const validTypes = new Set(['js', 'css', 'wasm', 'font', 'image']);
  for (const type of types) if (!validTypes.has(type)) throw new Error(`Unsupported scope type: ${type}`);
  return {
    caseId: typeof input.caseId === 'string' ? input.caseId : null,
    pageHosts,
    assetHosts: [...new Set([...pageHosts, ...configuredAssetHosts])],
    approvedNetworkHosts: [...new Set([...pageHosts, ...configuredAssetHosts, ...configuredNetworkHosts])],
    types,
    limits,
    stopStatuses: new Set(stopStatuses),
  };
}

export function validateBody(kind, body) {
  if (!body.length) return { accepted: false, reason: 'empty-body' };
  let hasNonZero = false;
  for (const byte of body) {
    if (byte !== 0) {
      hasNonZero = true;
      break;
    }
  }
  if (!hasNonZero) return { accepted: false, reason: 'all-zero-body' };
  const textHead = body.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if ((kind === 'js' || kind === 'css') && (textHead.startsWith('<!doctype html') || textHead.startsWith('<html') || textHead.includes('<head'))) {
    return { accepted: false, reason: `html-body-for-${kind}` };
  }
  if (kind === 'wasm' && !body.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
    return { accepted: false, reason: 'invalid-wasm-magic' };
  }
  if (kind === 'font') {
    const magic = body.subarray(0, 4).toString('latin1');
    const valid = ['wOFF', 'wOF2', 'OTTO'].includes(magic) || body.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]));
    if (!valid) return { accepted: false, reason: 'invalid-font-magic' };
  }
  return { accepted: true, reason: null };
}

export function summarizeHostObservations(observations) {
  const hosts = new Map();
  for (const observation of observations) {
    const current = hosts.get(observation.host) || { host: observation.host, requests: 0, kinds: new Set(), mimeTypes: new Set() };
    current.requests += 1;
    current.kinds.add(observation.kind);
    if (observation.mimeType) current.mimeTypes.add(observation.mimeType);
    hosts.set(observation.host, current);
  }
  return [...hosts.values()]
    .map((item) => ({ ...item, kinds: [...item.kinds].sort(), mimeTypes: [...item.mimeTypes].sort() }))
    .sort((left, right) => left.host.localeCompare(right.host));
}

export function summarizeNetworkObservations(observations, capturedTypes = DEFAULT_TYPES, pageHosts = []) {
  const hosts = new Map();
  for (const observation of observations) {
    const current = hosts.get(observation.host) || {
      host: observation.host,
      requests: 0,
      staticKinds: new Set(),
      resourceTypes: new Set(),
      mimeTypes: new Set(),
    };
    current.requests += 1;
    if (observation.kind && capturedTypes.has(observation.kind)) current.staticKinds.add(observation.kind);
    if (observation.resourceType) current.resourceTypes.add(observation.resourceType);
    if (observation.mimeType) current.mimeTypes.add(observation.mimeType);
    hosts.set(observation.host, current);
  }
  const pageHostSet = new Set(pageHosts);
  const summarizedHosts = [...hosts.values()]
    .map((item) => ({
      host: item.host,
      requests: item.requests,
      role: item.staticKinds.size ? 'asset' : 'network-only',
      staticKinds: [...item.staticKinds].sort(),
      resourceTypes: [...item.resourceTypes].sort(),
      mimeTypes: [...item.mimeTypes].sort(),
    }))
    .sort((left, right) => left.host.localeCompare(right.host));
  return {
    hosts: summarizedHosts,
    scopeCandidates: {
      assetHosts: summarizedHosts.filter((item) => item.role === 'asset' && !pageHostSet.has(item.host)).map((item) => item.host),
      approvedNetworkHosts: summarizedHosts.filter((item) => item.role === 'network-only' && !pageHostSet.has(item.host)).map((item) => item.host),
    },
  };
}

export function summarizeLedgerEntries(entries, limits, caseId) {
  let captured = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.caseId !== caseId) throw new Error(`Task ledger caseId mismatch: expected ${caseId || 'null'}`);
    if (entry.event !== 'saved') continue;
    captured += 1;
    totalBytes += Number(entry.size) || 0;
  }
  const maximumBytes = limits.maxTotalMiB > 0 ? limits.maxTotalMiB * 1024 * 1024 : null;
  return {
    captured,
    totalBytes,
    remainingAssets: limits.maxAssets > 0 ? Math.max(0, limits.maxAssets - captured) : null,
    remainingBytes: maximumBytes === null ? null : Math.max(0, maximumBytes - totalBytes),
  };
}

export function selectResourceMarker(requestRecord, currentMarker) {
  return requestRecord?.marker || currentMarker;
}

export function createBudgetTracker(initial, limits) {
  let captured = Number(initial?.captured) || 0;
  let totalBytes = Number(initial?.totalBytes) || 0;
  const maximumBytes = limits.maxTotalMiB > 0 ? limits.maxTotalMiB * 1024 * 1024 : null;
  const snapshot = () => ({
    captured,
    totalBytes,
    remainingAssets: limits.maxAssets > 0 ? Math.max(0, limits.maxAssets - captured) : null,
    remainingBytes: maximumBytes === null ? null : Math.max(0, maximumBytes - totalBytes),
  });
  return {
    reserve(size) {
      if (limits.maxAssets > 0 && captured >= limits.maxAssets) {
        return { accepted: false, reason: 'asset-count-budget-exceeded' };
      }
      if (maximumBytes !== null && totalBytes + size > maximumBytes) {
        return { accepted: false, reason: 'total-byte-budget-exceeded' };
      }
      captured += 1;
      totalBytes += size;
      return { accepted: true, reason: null };
    },
    rollback(size) {
      captured = Math.max(0, captured - 1);
      totalBytes = Math.max(0, totalBytes - size);
    },
    snapshot,
  };
}

export function detectWorkshopBuildIds(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  return [...new Set([...text.matchAll(/\/(?:assets\/)?static\/foundry-frontend-workshop\/([^/"'\\\s]+)\//g)].map((match) => match[1]))].sort();
}

export function isIgnorableTarget(info) {
  try {
    const protocol = new URL(info?.url || '').protocol;
    return ['chrome-extension:', 'devtools:', 'chrome:'].includes(protocol);
  } catch {
    return false;
  }
}

export function findPageTargetIssues(targetInfos, pageHosts) {
  const pages = targetInfos.filter((info) => info.type === 'page' && !isIgnorableTarget(info));
  const approvedPages = pages.filter((info) => scopeHost(info.url, pageHosts).allowed);
  const issues = [];
  if (approvedPages.length === 0) issues.push({ kind: 'approved-page-target-not-found' });
  if (approvedPages.length > 1) issues.push({ kind: 'multiple-approved-page-targets', count: approvedPages.length });
  return issues;
}

export function selectApprovedPageTarget(targetInfos, pageHosts) {
  const issues = findPageTargetIssues(targetInfos, pageHosts);
  if (issues.length) return { target: null, issues };
  return {
    target: targetInfos.find((info) => info.type === 'page' && !isIgnorableTarget(info) && scopeHost(info.url, pageHosts).allowed),
    issues: [],
  };
}

async function readLedgerEntries(path) {
  if (!path) return [];
  try {
    const content = await readFile(path, 'utf8');
    return content.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid task ledger JSON on line ${index + 1}`);
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function waitForPending(tasks, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (tasks.size) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'timed-out';
    let timer;
    const outcome = await Promise.race([
      Promise.allSettled([...tasks]).then(() => 'settled'),
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout('timed-out'), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (outcome === 'timed-out') return outcome;
  }
  return 'settled';
}

export async function closeAfterPending(client, tasks, timeoutMs = 2_000) {
  const outcome = await waitForPending(tasks, timeoutMs);
  client.close();
  return outcome;
}

function usage() {
  return `Usage:
  node capture-static-assets.mjs --scope scope.json [options]
  node capture-static-assets.mjs --mode discover --allow-host PAGE_HOST [options]

Scope:
  --scope FILE            Approved page, asset, and network hosts plus limits
  --mode MODE             discover or capture (default: capture)
  --allow-host HOST       Legacy host input; use only when no scope file is available

Options:
  --endpoint URL          Loopback DevTools endpoint (default: http://127.0.0.1:9222)
  --output DIR            Output directory (default: timestamped directory)
  --ledger FILE           Append-only task budget ledger shared across capture runs
  --types LIST            js,css,wasm,font,image (default: js,css,wasm,font)
  --duration-min N        Stop after N minutes; 0 waits for quit/Ctrl-C (default: 0)
  --max-resource-mb N     Maximum decoded body size per resource (default: 50)
  --max-assets N          Maximum accepted assets; 0 disables the limit (default: 0)
  --max-total-mb N        Maximum accepted bytes in MiB; 0 disables the limit (default: 0)
  --stop-status LIST      Stop on in-scope HTTP statuses (default: 401,403,429)
  --help                  Show this help

Interactive commands:
  mark LABEL              Attach a component/scenario marker to subsequent resources
  status                  Print capture counters
  quit                    Stop cleanly
`;
}

function parseArgs(argv) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const options = {
    endpoint: 'http://127.0.0.1:9222',
    output: resolve(`cdp-static-assets-${timestamp}`),
    types: new Set(DEFAULT_TYPES),
    allowHosts: [],
    mode: 'capture',
    scopePath: null,
    ledgerPath: null,
    durationMin: 0,
    maxResourceMb: 50,
    maxAssets: 0,
    maxTotalMiB: 0,
    stopStatuses: new Set([401, 403, 429]),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === '--help') options.help = true;
    else if (arg === '--mode') options.mode = next();
    else if (arg === '--scope') options.scopePath = resolve(next());
    else if (arg === '--endpoint') options.endpoint = next();
    else if (arg === '--output') options.output = resolve(next());
    else if (arg === '--ledger') options.ledgerPath = resolve(next());
    else if (arg === '--allow-host') options.allowHosts.push(next());
    else if (arg === '--types') options.types = new Set(next().split(',').map((item) => item.trim()).filter(Boolean));
    else if (arg === '--duration-min') options.durationMin = Number(next());
    else if (arg === '--max-resource-mb') options.maxResourceMb = Number(next());
    else if (arg === '--max-assets') options.maxAssets = Number(next());
    else if (arg === '--max-total-mb') options.maxTotalMiB = Number(next());
    else if (arg === '--stop-status') options.stopStatuses = new Set(next().split(',').map(Number));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.help) return options;
  if (!['discover', 'capture'].includes(options.mode)) throw new Error('--mode must be discover or capture');
  if (!options.scopePath && !options.allowHosts.length) throw new Error('Provide --scope or at least one --allow-host');
  const validTypes = new Set(['js', 'css', 'wasm', 'font', 'image']);
  for (const type of options.types) if (!validTypes.has(type)) throw new Error(`Unsupported type: ${type}`);
  if (!Number.isFinite(options.durationMin) || options.durationMin < 0) throw new Error('--duration-min must be >= 0');
  for (const key of ['maxResourceMb', 'maxAssets', 'maxTotalMiB']) {
    if (!Number.isFinite(options[key]) || options[key] < 0 || (key === 'maxResourceMb' && options[key] === 0)) {
      throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be ${key === 'maxResourceMb' ? '> 0' : '>= 0'}`);
    }
  }

  const endpoint = new URL(options.endpoint);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('--endpoint must use a loopback host');
  }
  return options;
}

async function applyScope(options) {
  if (!options.scopePath) {
    return {
      ...options,
      pageHosts: options.allowHosts,
      assetHosts: options.allowHosts,
      approvedNetworkHosts: options.allowHosts,
      limits: { maxAssets: options.maxAssets, maxTotalMiB: options.maxTotalMiB, maxAssetMiB: options.maxResourceMb },
      caseId: null,
    };
  }
  if (options.allowHosts.length) throw new Error('Do not combine --scope with --allow-host');
  const parsed = normalizeScope(JSON.parse(await readFile(options.scopePath, 'utf8')));
  return {
    ...options,
    pageHosts: parsed.pageHosts,
    assetHosts: parsed.assetHosts,
    approvedNetworkHosts: parsed.approvedNetworkHosts,
    types: parsed.types,
    stopStatuses: parsed.stopStatuses,
    maxResourceMb: parsed.limits.maxAssetMiB,
    maxAssets: parsed.limits.maxAssets,
    maxTotalMiB: parsed.limits.maxTotalMiB,
    limits: parsed.limits,
    caseId: parsed.caseId,
  };
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener('open', resolveOpen, { once: true });
      this.ws.addEventListener('error', rejectOpen, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const handlers = this.handlers.get(message.method) || [];
      for (const handler of handlers) handler(message.params || {}, message.sessionId);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.ws.send(JSON.stringify(message));
    return new Promise((resolveResult, rejectResult) => {
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult });
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  close() {
    for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'));
    this.pending.clear();
    this.ws.close();
  }
}

function extensionFor(kind, resourceUrl, mimeType) {
  const known = new Set(['.js', '.mjs', '.css', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
  try {
    const name = basename(new URL(resourceUrl).pathname).toLowerCase();
    const extension = [...known].find((candidate) => name.endsWith(candidate));
    if (extension) return extension;
  } catch {}
  if (kind === 'js') return '.js';
  if (kind === 'css') return '.css';
  if (kind === 'wasm') return '.wasm';
  if (kind === 'font') return mimeType.includes('woff2') ? '.woff2' : '.font';
  return '.bin';
}

async function main() {
  let options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  options = await applyScope(options);

  const ledgerEntries = await readLedgerEntries(options.ledgerPath);
  const priorTaskBudget = summarizeLedgerEntries(ledgerEntries, options.limits, options.caseId);
  if (priorTaskBudget.remainingAssets === 0 || priorTaskBudget.remainingBytes === 0) {
    throw new Error('Task budget is already exhausted');
  }

  const versionResponse = await fetch(new URL('/json/version', options.endpoint));
  if (!versionResponse.ok) throw new Error(`DevTools endpoint returned HTTP ${versionResponse.status}`);
  const version = await versionResponse.json();
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.open();
  const { targetInfos: initialTargetInfos } = await client.send('Target.getTargets');
  const { target: selectedPageTarget, issues: pageTargetIssues } = selectApprovedPageTarget(initialTargetInfos, options.pageHosts);
  if (pageTargetIssues.length) {
    client.close();
    throw new Error(`Page target preflight failed: ${JSON.stringify(pageTargetIssues)}`);
  }

  try {
    await mkdir(options.output, { recursive: false });
    await mkdir(join(options.output, 'assets'), { recursive: true });
    if (options.ledgerPath) await mkdir(dirname(options.ledgerPath), { recursive: true });
  } catch (error) {
    client.close();
    throw error;
  }
  const manifestPath = join(options.output, 'manifest.ndjson');
  const markerPath = join(options.output, 'markers.ndjson');
  const riskPath = join(options.output, 'risk-events.ndjson');
  const invalidPath = join(options.output, 'invalid-assets.ndjson');
  const observationPath = join(options.output, 'observed-hosts.ndjson');
  const networkObservationPath = join(options.output, 'observed-network-hosts.ndjson');
  const targetPath = join(options.output, 'targets.ndjson');
  const startedAt = new Date().toISOString();
  let currentMarker = 'unmarked';
  let captured = 0;
  let bodyFailures = 0;
  let rejectedAssets = 0;
  let totalBytes = 0;
  let networkEvents = 0;
  let lastNetworkEventAt = null;
  let writeChain = Promise.resolve();
  let stopping = false;
  const resources = new Map();
  const sessions = new Set();
  const attachedTargetIds = new Set();
  const targetInfo = new Map();
  const pendingTasks = new Set();
  const observations = [];
  const networkObservations = [];
  const targetEventCounts = new Map();
  const workshopBuildIds = new Set();
  const budgetTracker = createBudgetTracker(priorTaskBudget, options.limits);

  const enqueueLine = (path, value) => {
    writeChain = writeChain.then(() => appendFile(path, `${JSON.stringify(value)}\n`));
    return writeChain;
  };
  const taskBudgetSnapshot = () => budgetTracker.snapshot();

  await writeFile(join(options.output, 'provenance.json'), JSON.stringify({
    startedAt,
    endpoint: options.endpoint,
    browser: version.Browser,
    protocolVersion: version['Protocol-Version'],
    mode: options.mode,
    caseId: options.caseId,
    pageHosts: options.pageHosts,
    assetHosts: options.assetHosts,
    approvedNetworkHosts: options.approvedNetworkHosts,
    types: [...options.types],
    stopStatuses: [...options.stopStatuses],
    limits: options.limits,
    ledger: options.ledgerPath,
    priorTaskBudget,
    policy: 'natural-load-only',
  }, null, 2));

  let resolveStop;
  const stopped = new Promise((resolveStopped) => { resolveStop = resolveStopped; });
  const requestStop = (reason) => {
    if (stopping) return;
    stopping = true;
    resolveStop(reason);
  };

  const track = (promise) => {
    pendingTasks.add(promise);
    promise.finally(() => pendingTasks.delete(promise));
  };

  const setupSession = async (sessionId, info) => {
    if (!sessionId || sessions.has(sessionId) || !TARGET_TYPES.has(info.type) || isIgnorableTarget(info)) return;
    sessions.add(sessionId);
    attachedTargetIds.add(info.targetId);
    targetInfo.set(sessionId, info);
    targetEventCounts.set(sessionId, 0);
    await enqueueLine(targetPath, {
      at: new Date().toISOString(),
      event: 'attached',
      targetId: info.targetId,
      targetType: info.type,
      url: redactUrl(info.url || ''),
    });
    await client.send('Network.enable', {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: options.maxResourceMb * 1024 * 1024,
      enableDurableMessages: true,
    }, sessionId);
    await client.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    }, sessionId);
    await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  };

  client.on('Target.attachedToTarget', (params, parentSessionId) => {
    if (!parentSessionId || !sessions.has(parentSessionId)) return;
    if (isIgnorableTarget(params.targetInfo)) {
      track((async () => {
        await client.send('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {});
        await client.send('Target.detachFromTarget', { sessionId: params.sessionId }).catch(() => {});
      })());
      return;
    }
    track(setupSession(params.sessionId, params.targetInfo).catch((error) => {
      enqueueLine(riskPath, { at: new Date().toISOString(), kind: 'session-setup-failed', targetType: params.targetInfo?.type, error: error.message });
    }));
  });

  client.on('Target.targetInfoChanged', (params) => {
    for (const [sessionId, info] of targetInfo) {
      if (info.targetId !== params.targetInfo.targetId) continue;
      targetInfo.set(sessionId, params.targetInfo);
      enqueueLine(targetPath, {
        at: new Date().toISOString(),
        event: 'changed',
        targetId: params.targetInfo.targetId,
        targetType: params.targetInfo.type,
        url: redactUrl(params.targetInfo.url || ''),
      });
      if (params.targetInfo.type === 'page') {
        const pageScope = scopeHost(params.targetInfo.url, options.pageHosts);
        if (pageScope.network && !pageScope.allowed) {
          enqueueLine(riskPath, {
            at: new Date().toISOString(),
            kind: 'page-navigation-out-of-scope',
            host: pageScope.host,
            url: redactUrl(params.targetInfo.url),
          });
          requestStop(`Page navigated outside approved page hosts: ${pageScope.host}`);
        }
      }
    }
  });

  client.on('Network.requestWillBeSent', (params, sessionId) => {
    const key = `${sessionId}:${params.requestId}`;
    const prior = resources.get(key);
    resources.set(key, {
      requestId: params.requestId,
      sessionId,
      requestUrl: params.request.url,
      initiatorType: params.initiator?.type,
      marker: selectResourceMarker(prior, currentMarker),
    });
    const requestScope = scopeHost(params.request.url, options.approvedNetworkHosts);
    if (options.mode === 'capture' && requestScope.network && !requestScope.allowed) {
      enqueueLine(riskPath, {
        at: new Date().toISOString(),
        kind: 'unapproved-request-host',
        host: requestScope.host,
        url: redactUrl(params.request.url),
      });
      requestStop(`Unapproved request host observed: ${requestScope.host}`);
    }
  });

  client.on('Network.webSocketCreated', (params, sessionId) => {
    const socketScope = scopeHost(params.url, options.approvedNetworkHosts);
    if (!socketScope.network) return;
    networkEvents += 1;
    lastNetworkEventAt = new Date().toISOString();
    targetEventCounts.set(sessionId, (targetEventCounts.get(sessionId) || 0) + 1);
    if (options.mode === 'discover') {
      const observation = {
        at: new Date().toISOString(),
        host: socketScope.host,
        kind: null,
        mimeType: null,
        status: null,
        url: redactUrl(params.url),
        resourceType: 'WebSocket',
        targetType: targetInfo.get(sessionId)?.type,
      };
      networkObservations.push(observation);
      enqueueLine(networkObservationPath, observation);
      return;
    }
    if (!socketScope.allowed) {
      enqueueLine(riskPath, {
        at: new Date().toISOString(),
        kind: 'unapproved-websocket-host',
        host: socketScope.host,
        url: redactUrl(params.url),
      });
      requestStop(`Unapproved WebSocket host observed: ${socketScope.host}`);
    }
  });

  client.on('Network.responseReceived', (params, sessionId) => {
    const response = params.response;
    const kind = classifyResource({ type: params.type, mimeType: response.mimeType, url: response.url });
    const networkScope = scopeHost(response.url, options.approvedNetworkHosts);
    if (networkScope.network) {
      networkEvents += 1;
      lastNetworkEventAt = new Date().toISOString();
      targetEventCounts.set(sessionId, (targetEventCounts.get(sessionId) || 0) + 1);
    }

    if (options.mode === 'discover') {
      if (!networkScope.network) return;
      const networkObservation = {
        at: new Date().toISOString(),
        host: networkScope.host,
        kind,
        mimeType: response.mimeType,
        status: response.status,
        url: redactUrl(response.url),
        resourceType: params.type,
        targetType: targetInfo.get(sessionId)?.type,
      };
      networkObservations.push(networkObservation);
      enqueueLine(networkObservationPath, networkObservation);
      if (kind && options.types.has(kind)) {
        observations.push(networkObservation);
        enqueueLine(observationPath, networkObservation);
      }
      if (options.stopStatuses.has(Number(response.status))) {
        enqueueLine(riskPath, { ...networkObservation, kind: 'stop-status' });
        requestStop(`HTTP ${response.status} observed during discovery`);
      }
      return;
    }

    if (networkScope.network && !networkScope.allowed) {
      enqueueLine(riskPath, {
        at: new Date().toISOString(),
        kind: 'unapproved-host',
        host: networkScope.host,
        url: redactUrl(response.url),
      });
      requestStop(`Unapproved host observed: ${networkScope.host}`);
      return;
    }
    if (!networkScope.allowed) return;

    if (options.stopStatuses.has(Number(response.status))) {
      const event = {
        at: new Date().toISOString(),
        kind: 'stop-status',
        status: response.status,
        url: redactUrl(response.url),
      };
      enqueueLine(riskPath, event);
      requestStop(`HTTP ${response.status} observed on an approved host`);
      return;
    }

    if (!kind || !options.types.has(kind)) return;
    if (!hostIsAllowed(networkScope.host, options.assetHosts)) {
      enqueueLine(riskPath, {
        at: new Date().toISOString(),
        kind: 'static-host-not-approved-for-capture',
        host: networkScope.host,
        url: redactUrl(response.url),
      });
      requestStop(`Static asset host not approved for capture: ${networkScope.host}`);
      return;
    }
    const key = `${sessionId}:${params.requestId}`;
    const prior = resources.get(key) || {};
    resources.set(key, {
      ...prior,
      requestId: params.requestId,
      sessionId,
      url: response.url,
      host: networkScope.host,
      kind,
      resourceType: params.type,
      status: response.status,
      mimeType: response.mimeType,
      fromDiskCache: Boolean(response.fromDiskCache),
      fromPrefetchCache: Boolean(response.fromPrefetchCache),
      fromServiceWorker: Boolean(response.fromServiceWorker),
      protocol: response.protocol,
      marker: selectResourceMarker(prior, currentMarker),
      targetType: targetInfo.get(sessionId)?.type,
      targetUrl: targetInfo.get(sessionId)?.url,
    });
  });

  client.on('Network.loadingFailed', (params, sessionId) => {
    const key = `${sessionId}:${params.requestId}`;
    const resource = resources.get(key);
    resources.delete(key);
    if (!resource?.kind) return;
    bodyFailures += 1;
    enqueueLine(manifestPath, {
      at: new Date().toISOString(),
      event: 'load-failed',
      marker: resource.marker,
      kind: resource.kind,
      url: redactUrl(resource.url),
      errorText: params.errorText,
      canceled: Boolean(params.canceled),
    });
  });

  client.on('Network.loadingFinished', (params, sessionId) => {
    const key = `${sessionId}:${params.requestId}`;
    const resource = resources.get(key);
    resources.delete(key);
    if (!resource?.kind) return;
    const task = (async () => {
      try {
        const result = await client.send('Network.getResponseBody', { requestId: params.requestId }, sessionId);
        const body = result.base64Encoded ? Buffer.from(result.body, 'base64') : Buffer.from(result.body, 'utf8');
        const maxBytes = options.maxResourceMb * 1024 * 1024;
        const sha256 = createHash('sha256').update(body).digest('hex');
        let validation = validateBody(resource.kind, body);
        if (validation.accepted && body.length > maxBytes) validation = { accepted: false, reason: 'asset-budget-exceeded' };
        if (validation.accepted) validation = budgetTracker.reserve(body.length);
        if (!validation.accepted) {
          rejectedAssets += 1;
          await enqueueLine(invalidPath, {
            at: new Date().toISOString(),
            event: 'invalid-body',
            marker: resource.marker,
            kind: resource.kind,
            url: redactUrl(resource.url),
            status: resource.status,
            mimeType: resource.mimeType,
            size: body.length,
            sha256,
            reason: validation.reason,
          });
          if (validation.reason.endsWith('budget-exceeded')) requestStop(`Capture budget reached: ${validation.reason}`);
          return;
        }
        const extension = extensionFor(resource.kind, resource.url, resource.mimeType || '');
        const relativePath = join('assets', resource.kind, `${sha256}${extension}`);
        const absoluteDir = join(options.output, 'assets', resource.kind);
        const absolutePath = join(options.output, relativePath);
        try {
          await mkdir(absoluteDir, { recursive: true });
          await writeFile(absolutePath, body, { flag: 'wx' }).catch((error) => {
            if (error.code !== 'EEXIST') throw error;
          });
        } catch (error) {
          budgetTracker.rollback(body.length);
          throw error;
        }
        const detectedBuildIds = resource.kind === 'js' ? detectWorkshopBuildIds(body) : [];
        for (const buildId of detectedBuildIds) workshopBuildIds.add(buildId);
        if (workshopBuildIds.size > 1) {
          await enqueueLine(riskPath, {
            at: new Date().toISOString(),
            kind: 'workshop-build-mismatch',
            buildIds: [...workshopBuildIds].sort(),
            url: redactUrl(resource.url),
          });
          requestStop(`Workshop build mismatch observed: ${[...workshopBuildIds].sort().join(', ')}`);
        }
        captured += 1;
        totalBytes += body.length;
        await enqueueLine(manifestPath, {
          at: new Date().toISOString(),
          event: 'saved',
          marker: resource.marker,
          kind: resource.kind,
          url: redactUrl(resource.url),
          status: resource.status,
          mimeType: resource.mimeType,
          resourceType: resource.resourceType,
          size: body.length,
          encodedDataLength: params.encodedDataLength,
          sha256,
          file: relativePath,
          fromDiskCache: resource.fromDiskCache,
          fromPrefetchCache: resource.fromPrefetchCache,
          fromServiceWorker: resource.fromServiceWorker,
          protocol: resource.protocol,
          initiatorType: resource.initiatorType,
          targetType: resource.targetType,
          targetUrl: redactUrl(resource.targetUrl || ''),
          captureMethod: 'response-body-for-observed-request',
          validation: 'accepted',
          workshopBuildIds: detectedBuildIds,
        });
        if (options.ledgerPath) {
          await enqueueLine(options.ledgerPath, {
            at: new Date().toISOString(),
            event: 'saved',
            caseId: options.caseId,
            run: basename(options.output),
            marker: resource.marker,
            kind: resource.kind,
            sha256,
            size: body.length,
          });
        }
        const budget = taskBudgetSnapshot();
        if (budget.remainingAssets === 0 || budget.remainingBytes === 0) {
          requestStop('Capture budget reached');
        }
      } catch (error) {
        bodyFailures += 1;
        await enqueueLine(manifestPath, {
          at: new Date().toISOString(),
          event: 'body-unavailable',
          marker: resource.marker,
          kind: resource.kind,
          url: redactUrl(resource.url),
          status: resource.status,
          error: error.message,
        });
      }
    })();
    track(task);
  });

  await client.send('Target.setDiscoverTargets', { discover: true });
  try {
    const { sessionId } = await client.send('Target.attachToTarget', { targetId: selectedPageTarget.targetId, flatten: true });
    await setupSession(sessionId, selectedPageTarget);
  } catch (error) {
    await enqueueLine(riskPath, { at: new Date().toISOString(), kind: 'target-attach-failed', targetType: selectedPageTarget.type, error: error.message });
    requestStop('Approved page target could not be attached');
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  readline.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === 'quit') requestStop('interactive quit');
    else if (trimmed === 'status') {
      const targetEventCountSummary = [...targetInfo.entries()].map(([sessionId, info]) => ({
        targetId: info.targetId,
        targetType: info.type,
        url: redactUrl(info.url || ''),
        events: targetEventCounts.get(sessionId) || 0,
      }));
      process.stdout.write(`${JSON.stringify({
        mode: options.mode,
        captured,
        rejectedAssets,
        bodyFailures,
        totalBytes,
        observedHosts: observations.length,
        observedNetworkRequests: networkObservations.length,
        marker: currentMarker,
        attachedTargets: sessions.size,
        networkEvents,
        lastNetworkEventAt,
        targetEventCounts: targetEventCountSummary,
        taskBudget: taskBudgetSnapshot(),
        workshopBuildIds: [...workshopBuildIds].sort(),
      })}\n`);
    }
    else if (trimmed.startsWith('mark ')) {
      currentMarker = trimmed.slice(5).trim() || 'unmarked';
      enqueueLine(markerPath, { at: new Date().toISOString(), marker: currentMarker });
      process.stdout.write(`marker=${currentMarker}\n`);
    }
  });
  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));
  if (options.durationMin > 0) setTimeout(() => requestStop('duration reached'), options.durationMin * 60_000).unref();

  process.stdout.write(`${JSON.stringify({
    state: 'capturing',
    mode: options.mode,
    output: options.output,
    pageHosts: options.pageHosts,
    assetHosts: options.assetHosts,
    approvedNetworkHosts: options.approvedNetworkHosts,
    types: [...options.types],
    taskBudget: taskBudgetSnapshot(),
    note: 'Operate the browser normally; this collector does not navigate or refetch.',
  }, null, 2)}\n`);

  const stopReason = await stopped;
  readline.close();
  const pendingOutcome = await closeAfterPending(client, pendingTasks);
  await writeChain;
  if (options.mode === 'discover') {
    const networkSummary = summarizeNetworkObservations(networkObservations, options.types, options.pageHosts);
    await writeFile(join(options.output, 'observed-hosts.json'), JSON.stringify({
      observedAt: startedAt,
      hosts: summarizeHostObservations(observations),
    }, null, 2));
    await writeFile(join(options.output, 'observed-network-hosts.json'), JSON.stringify({
      observedAt: startedAt,
      hosts: networkSummary.hosts,
    }, null, 2));
    await writeFile(join(options.output, 'scope-candidates.json'), JSON.stringify({
      caseId: options.caseId,
      pageHosts: options.pageHosts,
      ...networkSummary.scopeCandidates,
      approvalStatus: 'candidate-only',
      note: 'Review ownership and purpose before copying candidates into an approved capture scope.',
    }, null, 2));
  }
  await writeFile(join(options.output, 'summary.json'), JSON.stringify({
    startedAt,
    stoppedAt: new Date().toISOString(),
    stopReason,
    captured,
    rejectedAssets,
    bodyFailures,
    totalBytes,
    observedHosts: observations.length,
    observedStaticRequests: observations.length,
    observedNetworkRequests: networkObservations.length,
    attachedTargets: sessions.size,
    networkEvents,
    lastNetworkEventAt,
    taskBudget: taskBudgetSnapshot(),
    workshopBuildIds: [...workshopBuildIds].sort(),
    finalMarker: currentMarker,
    pendingOutcome,
  }, null, 2));
  process.stdout.write(`${JSON.stringify({ state: 'stopped', stopReason, captured, rejectedAssets, bodyFailures, totalBytes, output: options.output }, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
