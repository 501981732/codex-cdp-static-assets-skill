import { normalizeAutomationPolicy } from './automation-policy.mjs';

const DEFAULT_TYPES = new Set(['js', 'css', 'wasm', 'font']);
const DEFAULT_LIMITS = { maxAssets: 0, maxTotalMiB: 0, maxAssetMiB: 50 };

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
  const validTypes = new Set(['js', 'css', 'wasm', 'font', 'image', 'html']);
  for (const type of types) if (!validTypes.has(type)) throw new Error(`Unsupported scope type: ${type}`);
  const automation = normalizeAutomationPolicy(input);
  let authorization = null;
  if (automation.enabled) {
    const requireText = (value, field) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Automation Scope requires ${field}`);
      return value.trim();
    };
    const approvedPageUrl = new URL(requireText(input.approvedPageUrl, 'approvedPageUrl'));
    if (!['http:', 'https:'].includes(approvedPageUrl.protocol) || approvedPageUrl.username || approvedPageUrl.password
      || approvedPageUrl.search || approvedPageUrl.hash) {
      throw new Error('approvedPageUrl must be an exact HTTP(S) URL without credentials, query, or fragment');
    }
    const exactPageHost = pageHosts.some((host) => !host.includes('*') && host.toLowerCase() === approvedPageUrl.hostname.toLowerCase());
    if (!exactPageHost) throw new Error('approvedPageUrl host must exactly match pageHosts');
    const moduleId = requireText(input.moduleId, 'moduleId');
    if (approvedPageUrl.pathname.split('/').filter(Boolean).at(-1) !== moduleId) throw new Error('approvedPageUrl must end with moduleId');
    const authorizationWindow = input.authorizationWindow;
    const startsAt = requireText(authorizationWindow?.startsAt, 'authorizationWindow.startsAt');
    const endsAt = requireText(authorizationWindow?.endsAt, 'authorizationWindow.endsAt');
    if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt)) || Date.parse(startsAt) >= Date.parse(endsAt)) {
      throw new Error('authorizationWindow must contain valid increasing timestamps');
    }
    authorization = Object.freeze({
      approvedPageUrl: approvedPageUrl.toString(),
      moduleId,
      testAccount: requireText(input.testAccount, 'testAccount'),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      stopContact: requireText(input.stopContact, 'stopContact'),
    });
  }
  return {
    caseId: typeof input.caseId === 'string' ? input.caseId : null,
    pageHosts,
    assetHosts: [...new Set([...pageHosts, ...configuredAssetHosts])],
    approvedNetworkHosts: [...new Set([...pageHosts, ...configuredAssetHosts, ...configuredNetworkHosts])],
    types,
    limits,
    stopStatuses: new Set(stopStatuses),
    automation,
    fixtureProfileNames: automation.fixtureProfileNames || [],
    fixtureProfiles: automation.fixtureProfiles || Object.freeze({}),
    widgetFixtureMap: automation.widgetFixtureMap || Object.freeze({}),
    authorization,
  };
}

export function validateBody(kind, body) {
  if (!body.length) return { accepted: false, reason: 'empty-body' };
  if (!body.some((byte) => byte !== 0)) return { accepted: false, reason: 'all-zero-body' };
  const textHead = body.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
  if ((kind === 'js' || kind === 'css') && (textHead.startsWith('<!doctype html') || textHead.startsWith('<html') || textHead.includes('<head'))) {
    return { accepted: false, reason: `html-body-for-${kind}` };
  }
  if (kind === 'html' && !/^(?:<!doctype\s+html\b|<html\b)/i.test(textHead)) {
    return { accepted: false, reason: 'invalid-html-body' };
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
      if (limits.maxAssets > 0 && captured >= limits.maxAssets) return { accepted: false, reason: 'asset-count-budget-exceeded' };
      if (maximumBytes !== null && totalBytes + size > maximumBytes) return { accepted: false, reason: 'total-byte-budget-exceeded' };
      captured += 1;
      totalBytes += size;
      return { accepted: true, reason: null };
    },
    snapshot,
  };
}

export function detectWorkshopBuildIds(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  return [...new Set([...text.matchAll(/\/(?:assets\/)?static\/foundry-frontend-workshop\/([^/"'\\\s]+)\//g)].map((match) => match[1]))].sort();
}
