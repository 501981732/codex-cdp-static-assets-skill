import { COMPONENT_STATES } from './automation-policy.mjs';

function compareEvidence(left, right) {
  return String(left.at || '').localeCompare(String(right.at || ''))
    || String(left.sourceRun || '').localeCompare(String(right.sourceRun || ''))
    || String(left.attemptId || '').localeCompare(String(right.attemptId || ''));
}

function assetIdentity(entry) {
  return entry.sha256 && entry.url ? `${entry.sha256}\n${entry.url}` : null;
}

function assetView(entry) {
  return {
    kind: entry.kind || null,
    sha256: entry.sha256,
    url: entry.url,
    size: Number(entry.size) || 0,
  };
}

function bodyUnavailableView(entry) {
  return {
    kind: entry.kind || null,
    url: entry.url,
    status: Number(entry.status) || null,
    requestId: entry.requestId || null,
    marker: entry.marker || null,
    sourceRun: entry.sourceRun || null,
    at: entry.at || null,
  };
}

function uniqueSorted(entries, identity, compare = compareEvidence) {
  const unique = new Map();
  for (const entry of entries) if (!unique.has(identity(entry))) unique.set(identity(entry), entry);
  return [...unique.values()].sort(compare);
}

function selectedStateStatus(attempts) {
  if (attempts.some((attempt) => attempt.status === 'captured')) return 'captured';
  const reversed = [...attempts].sort(compareEvidence).reverse();
  const terminal = reversed.find((attempt) => attempt.status === 'failed' || attempt.status.startsWith('blocked-'));
  if (terminal) return terminal.status;
  return reversed.find((attempt) => ['not-applicable', 'not-requested'].includes(attempt.status))?.status || 'missing';
}

function groupKey(event) {
  return `${event.capturePage}\n${event.widgetKey}`;
}

export function buildComponentCoverage({ componentEvents = [], manifestEvents = [], generatedAt = new Date().toISOString() }) {
  const sortedEvents = [...componentEvents].sort(compareEvidence);
  const groups = new Map();
  const markerGroups = new Map();
  for (const event of sortedEvents) {
    const key = groupKey(event);
    const group = groups.get(key) || { events: [], assets: [], bodyUnavailable: [] };
    group.events.push(event);
    groups.set(key, group);
    const markerKey = `${event.sourceRun || ''}\n${event.marker}`;
    const linkedGroups = markerGroups.get(markerKey) || new Set();
    linkedGroups.add(key);
    markerGroups.set(markerKey, linkedGroups);
  }

  const baselineManifest = manifestEvents.filter((entry) => entry.marker === 'baseline' || entry.marker?.startsWith('baseline:'));
  const baselineAssets = uniqueSorted(
    baselineManifest.filter((entry) => entry.event === 'saved' && assetIdentity(entry)).map(assetView),
    assetIdentity,
    (left, right) => String(left.kind).localeCompare(String(right.kind)) || left.url.localeCompare(right.url) || left.sha256.localeCompare(right.sha256),
  );
  const baselineIdentities = new Set(baselineAssets.map(assetIdentity));
  const baselineBodyUnavailable = uniqueSorted(
    baselineManifest.filter((entry) => entry.event === 'body-unavailable').map(bodyUnavailableView),
    (entry) => `${entry.url}\n${entry.requestId}\n${entry.sourceRun}`,
  );

  const globallyOwnedAssets = new Set();
  const sortedManifest = [...manifestEvents].sort(compareEvidence);
  for (const entry of sortedManifest) {
    if (entry.marker === 'baseline' || entry.marker?.startsWith('baseline:')) continue;
    const linkedGroups = markerGroups.get(`${entry.sourceRun || ''}\n${entry.marker}`);
    if (!linkedGroups || linkedGroups.size !== 1) continue;
    const group = groups.get([...linkedGroups][0]);
    if (entry.event === 'saved') {
      const identity = assetIdentity(entry);
      if (!identity || baselineIdentities.has(identity) || globallyOwnedAssets.has(identity)) continue;
      globallyOwnedAssets.add(identity);
      group.assets.push(assetView(entry));
    } else if (entry.event === 'body-unavailable') {
      group.bodyUnavailable.push(bodyUnavailableView(entry));
    }
  }

  const components = [...groups.values()].map((group) => {
    const first = group.events[0];
    const states = {};
    for (const state of COMPONENT_STATES) states[state] = selectedStateStatus(group.events.filter((event) => event.state === state));
    const requiredStates = COMPONENT_STATES.filter((state) => !['not-applicable', 'not-requested'].includes(states[state]));
    const coveredStates = COMPONENT_STATES.filter((state) => states[state] === 'captured');
    const blockedStates = COMPONENT_STATES.filter((state) => states[state] === 'failed' || states[state].startsWith('blocked-'));
    const failures = uniqueSorted(
      group.events.filter((event) => event.failure).map((event) => ({
        state: event.state,
        status: event.status,
        code: event.failure.code,
        message: event.failure.message,
        sourceRun: event.sourceRun,
        attemptId: event.attemptId,
        at: event.at,
      })),
      (failure) => `${failure.state}\n${failure.status}\n${failure.code}\n${failure.message}`,
    );
    const attempts = group.events.map((event) => ({
      sourceRun: event.sourceRun,
      attemptId: event.attemptId,
      at: event.at,
      state: event.state,
      status: event.status,
      required: event.required,
      failure: event.failure,
    })).sort(compareEvidence);
    const coverageStatus = requiredStates.every((state) => states[state] === 'captured') && blockedStates.length === 0 ? 'complete' : 'partial';
    return {
      widgetKey: first.widgetKey,
      label: first.label,
      category: first.category,
      capturePage: first.capturePage,
      visibleInstanceLabel: first.visibleInstanceLabel,
      marker: first.marker.replace(new RegExp(`:${first.state}$`), ''),
      coverageStatus,
      requiredStates,
      coveredStates,
      blockedStates,
      states,
      attempts,
      firstObservedAssets: uniqueSorted(
        group.assets,
        assetIdentity,
        (left, right) => String(left.kind).localeCompare(String(right.kind)) || left.url.localeCompare(right.url) || left.sha256.localeCompare(right.sha256),
      ),
      bodyUnavailable: uniqueSorted(group.bodyUnavailable, (entry) => `${entry.url}\n${entry.requestId}\n${entry.sourceRun}`),
      failures,
    };
  }).sort((left, right) => left.widgetKey.localeCompare(right.widgetKey) || left.capturePage.localeCompare(right.capturePage));

  const summary = {
    total: components.length,
    complete: components.filter((component) => component.coverageStatus === 'complete').length,
    partial: components.filter((component) => component.coverageStatus === 'partial').length,
  };
  return {
    schemaVersion: 1,
    generatedAt,
    summary,
    baseline: {
      marker: 'baseline',
      status: 'captured',
      assets: baselineAssets,
      bodyUnavailable: baselineBodyUnavailable,
      failures: [],
    },
    components,
  };
}
