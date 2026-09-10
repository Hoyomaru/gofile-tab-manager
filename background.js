'use strict';

importScripts('shared/constants.js', 'shared/url.js');

const { Constants, Url } = globalThis.GofileTabManager;
const { STATES, CLOSE_REASONS, STORAGE_KEYS, HISTORY_LIMIT, MESSAGE_TYPES } = Constants;

const TAB_GROUP_NONE = -1;
const tabMeta = new Map();
const closingTabIds = new Set();
const pendingCloseOperations = new Map();
const unsavedHistoryEntries = new Map();
const navigationVersions = new Map();
const classificationRevisions = new Map();
const latestRouteGenerations = new Map();
const sortChains = new Map();
let historyWriteChain = Promise.resolve();
let historyRetryHandle = null;
let reconciliationChain = Promise.resolve();
let initialized = false;
let initializationPromise = null;
let closeSequence = 0;

function isProtected(tab) {
  return Boolean(tab?.pinned) || (Number.isInteger(tab?.groupId) && tab.groupId !== TAB_GROUP_NONE);
}

function sanitizeState(state) {
  return Object.values(STATES).includes(state) && state !== STATES.PROTECTED ? state : STATES.ATTENTION;
}

function nextNavigationVersion(tabId) {
  const version = (navigationVersions.get(tabId) || 0) + 1;
  navigationVersions.set(tabId, version);
  return version;
}

function nextClassificationRevision(tabId) {
  const revision = (classificationRevisions.get(tabId) || 0) + 1;
  classificationRevisions.set(tabId, revision);
  return revision;
}

function routeGenerationKey(tabId, documentId = null) {
  return `${tabId}|${documentId || ''}`;
}

function clearRouteGenerations(tabId) {
  const prefix = `${tabId}|`;
  for (const key of latestRouteGenerations.keys()) {
    if (key.startsWith(prefix)) {
      latestRouteGenerations.delete(key);
    }
  }
}

function rememberRouteGeneration(tabId, documentId, generation) {
  if (!Number.isInteger(tabId) || !Number.isInteger(generation)) {
    return;
  }
  const key = routeGenerationKey(tabId, documentId);
  latestRouteGenerations.set(key, Math.max(latestRouteGenerations.get(key) || 0, generation));
}

function deleteTabMeta(tabId) {
  tabMeta.delete(tabId);
  navigationVersions.delete(tabId);
  classificationRevisions.delete(tabId);
  clearRouteGenerations(tabId);
}

function isTabNavigationInProgress(tab) {
  return Boolean(typeof tab?.pendingUrl === 'string' && tab.pendingUrl.length > 0) || tab?.status === 'loading';
}

function metaForTab(tab, previous = null, fallbackSeenAt = Date.now()) {
  const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
  if (!canonicalUrl) {
    return null;
  }

  const sameUrl = previous?.canonicalUrl === canonicalUrl;
  return {
    tabId: tab.id,
    canonicalUrl,
    state: sameUrl ? sanitizeState(previous.state) : STATES.LOADING,
    firstSeenAt: sameUrl && Number.isFinite(previous.firstSeenAt)
      ? previous.firstSeenAt
      : fallbackSeenAt,
    observedAt: sameUrl ? (previous.observedAt || 0) : 0,
    navigationVersion: sameUrl && Number.isInteger(previous.navigationVersion)
      ? previous.navigationVersion
      : nextNavigationVersion(tab.id),
    documentId: sameUrl ? (previous.documentId || null) : null,
    routeGeneration: sameUrl && Number.isInteger(previous.routeGeneration)
      ? previous.routeGeneration
      : 0,
    classificationRevision: sameUrl && Number.isInteger(previous.classificationRevision)
      ? previous.classificationRevision
      : nextClassificationRevision(tab.id),
    pendingNavigation: isTabNavigationInProgress(tab)
  };
}

function loadingMetaForTab(tab, previous, canonicalUrl, pendingNavigation, firstSeenAt = Date.now()) {
  if (!canonicalUrl) {
    return null;
  }

  const sameUrl = previous?.canonicalUrl === canonicalUrl;
  return {
    tabId: tab.id,
    canonicalUrl,
    state: STATES.LOADING,
    firstSeenAt: sameUrl && Number.isFinite(previous.firstSeenAt) ? previous.firstSeenAt : firstSeenAt,
    observedAt: 0,
    navigationVersion: nextNavigationVersion(tab.id),
    documentId: null,
    routeGeneration: 0,
    classificationRevision: nextClassificationRevision(tab.id),
    pendingNavigation
  };
}

async function loadSessionMeta() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEYS.TAB_META);
    return result?.[STORAGE_KEYS.TAB_META] || {};
  } catch {
    return {};
  }
}

async function persistSessionMeta() {
  const compact = {};
  for (const [tabId, meta] of tabMeta) {
    compact[tabId] = {
      canonicalUrl: meta.canonicalUrl,
      firstSeenAt: meta.firstSeenAt
    };
  }
  try {
    await chrome.storage.session.set({ [STORAGE_KEYS.TAB_META]: compact });
  } catch {
    // Session persistence is an optimization only; live tabs remain authoritative.
  }
}

function pendingCloseObject() {
  const result = {};
  for (const [operationId, operation] of pendingCloseOperations) {
    result[operationId] = operation;
  }
  return result;
}

async function persistPendingCloseOperations() {
  try {
    if (!chrome.storage.session?.set) {
      return false;
    }
    await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_CLOSES]: pendingCloseObject() });
    return true;
  } catch {
    return false;
  }
}

async function loadPendingCloseOperations() {
  try {
    if (!chrome.storage.session?.get) {
      return {};
    }
    const result = await chrome.storage.session.get(STORAGE_KEYS.PENDING_CLOSES);
    return result?.[STORAGE_KEYS.PENDING_CLOSES] || {};
  } catch {
    return {};
  }
}

function historyEntryKey(entry, operationId = null) {
  return operationId || entry?.closeId || `${entry?.sourceTabId}|${entry?.closedAt}|${entry?.reason}|${entry?.canonicalUrl}`;
}

function scheduleHistoryRetry() {
  if (historyRetryHandle !== null || unsavedHistoryEntries.size === 0) {
    return;
  }
  historyRetryHandle = setTimeout(() => {
    historyRetryHandle = null;
    flushCloseHistory().catch(() => {});
  }, 1000);
}

function queueUnsavedHistory(entry, operationId = null) {
  const key = historyEntryKey(entry, operationId);
  unsavedHistoryEntries.set(key, { ...entry, closeId: entry.closeId || key });
  scheduleHistoryRetry();
}

async function flushCloseHistory() {
  historyWriteChain = historyWriteChain.then(async () => {
    if (unsavedHistoryEntries.size === 0) {
      return;
    }

    const stored = await chrome.storage.local.get(STORAGE_KEYS.CLOSE_HISTORY);
    const history = Array.isArray(stored?.[STORAGE_KEYS.CLOSE_HISTORY])
      ? [...stored[STORAGE_KEYS.CLOSE_HISTORY]]
      : [];
    const existingIds = new Set(history.map((entry) => entry?.closeId).filter(Boolean));
    const toPersist = [...unsavedHistoryEntries.entries()];

    for (const [key, entry] of toPersist) {
      if (!existingIds.has(entry.closeId)) {
        history.unshift(entry);
        existingIds.add(entry.closeId);
      }
    }
    if (history.length > HISTORY_LIMIT) {
      history.length = HISTORY_LIMIT;
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.CLOSE_HISTORY]: history });

    for (const [key] of toPersist) {
      unsavedHistoryEntries.delete(key);
      pendingCloseOperations.delete(key);
    }
    await persistPendingCloseOperations();
  }).catch(() => {
    scheduleHistoryRetry();
  });

  return historyWriteChain;
}

async function appendCloseHistory(entry, operationId = null) {
  queueUnsavedHistory(entry, operationId);
  await flushCloseHistory();
}

async function recoverPendingCloseOperations(tabs) {
  const stored = await loadPendingCloseOperations();
  for (const [operationId, operation] of Object.entries(stored)) {
    const live = tabs.find((tab) => tab.id === operation?.entry?.sourceTabId);
    if (live) {
      // The remove did not complete before the worker stopped. Do not record it.
      continue;
    }

    // Only a durably recorded 'removed' phase proves that this worker observed
    // a successful remove. A pending/remove-issued operation may instead have
    // failed and then been closed by something else while the worker was down.
    // Do not turn that ambiguity into a successful auto-close history entry.
    if (operation?.phase === 'removed' && operation.entry) {
      pendingCloseOperations.set(operationId, operation);
      queueUnsavedHistory(operation.entry, operationId);
    }
  }
  await persistPendingCloseOperations();
  await flushCloseHistory();
}

async function setCloseOperationPhase(operationId, phase) {
  const operation = pendingCloseOperations.get(operationId);
  if (!operation) {
    return false;
  }
  operation.phase = phase;
  return persistPendingCloseOperations();
}

async function cancelCloseOperation(operationId) {
  pendingCloseOperations.delete(operationId);
  await persistPendingCloseOperations();
}

function startCloseOperation(entry) {
  const operationId = `${entry.sourceTabId}:${entry.closedAt}:${++closeSequence}`;
  pendingCloseOperations.set(operationId, {
    tabId: entry.sourceTabId,
    phase: 'remove-issued',
    entry: { ...entry, closeId: operationId }
  });
  return operationId;
}

async function initializeFromLiveTabs() {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({}),
    loadSessionMeta()
  ]);

  tabMeta.clear();
  navigationVersions.clear();
  classificationRevisions.clear();
  latestRouteGenerations.clear();

  const ordered = [...tabs].filter((tab) => Number.isInteger(tab.id)).sort((a, b) => a.id - b.id);
  const base = Date.now();

  ordered.forEach((tab, index) => {
    const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
    if (!canonicalUrl) {
      return;
    }

    const saved = stored[String(tab.id)];
    const sameUrl = saved?.canonicalUrl === canonicalUrl;
    const meta = metaForTab(tab, null, sameUrl && Number.isFinite(saved.firstSeenAt) ? saved.firstSeenAt : base + index);
    meta.state = STATES.LOADING;
    meta.observedAt = 0;
    meta.pendingNavigation = isTabNavigationInProgress(tab);
    tabMeta.set(tab.id, meta);
  });

  initialized = true;
  await recoverPendingCloseOperations(tabs);
  await persistSessionMeta();
  await synchronizeClassifications(tabs);
  await reconcileDuplicates();
}

function startInitialization() {
  if (!initializationPromise) {
    initializationPromise = initializeFromLiveTabs().finally(() => {
      initializationPromise = null;
    });
  }
  return initializationPromise;
}

async function ensureInitialized() {
  if (!initialized) {
    await startInitialization();
  }
}

function enqueueReconciliation() {
  reconciliationChain = reconciliationChain
    .then(() => reconcileDuplicates())
    .catch(() => {});
  return reconciliationChain;
}

function sameMetaIdentity(actual, expected) {
  return Boolean(actual && expected) &&
    actual.canonicalUrl === expected.canonicalUrl &&
    actual.navigationVersion === expected.navigationVersion &&
    actual.classificationRevision === expected.classificationRevision &&
    (actual.documentId || null) === (expected.documentId || null) &&
    actual.routeGeneration === expected.routeGeneration;
}

function isStableLiveTab(tab, expectedCanonicalUrl) {
  return Boolean(tab) &&
    Url.canonicalizeGofileUrl(tab.url || '') === expectedCanonicalUrl &&
    !isProtected(tab) &&
    !isTabNavigationInProgress(tab);
}

async function validateDuplicatePlan(plan, liveVictim) {
  if (!plan?.survivor?.tab || !plan?.survivor?.meta || !plan?.victim?.meta) {
    return false;
  }

  let liveSurvivor;
  try {
    liveSurvivor = await chrome.tabs.get(plan.survivor.tab.id);
  } catch {
    return false;
  }

  const canonicalUrl = plan.canonicalUrl;
  if (!isStableLiveTab(liveVictim, canonicalUrl) ||
      Url.canonicalizeGofileUrl(liveSurvivor.url || '') !== canonicalUrl ||
      isTabNavigationInProgress(liveSurvivor) ||
      closingTabIds.has(liveSurvivor.id) ||
      liveVictim.id === liveSurvivor.id) {
    return false;
  }

  const victimMeta = tabMeta.get(liveVictim.id);
  const survivorMeta = tabMeta.get(liveSurvivor.id);
  if (!sameMetaIdentity(victimMeta, plan.victim.meta) ||
      !sameMetaIdentity(survivorMeta, plan.survivor.meta)) {
    return false;
  }

  // An unprotected survivor that is already being classified DEAD is not a
  // valid anchor. Otherwise a concurrent DEAD close could remove the last tab.
  if (!isProtected(liveSurvivor) && survivorMeta.state === STATES.DEAD) {
    return false;
  }

  if (Boolean(liveSurvivor.pinned) !== Boolean(plan.survivor.tab.pinned) ||
      (liveSurvivor.groupId ?? TAB_GROUP_NONE) !== (plan.survivor.tab.groupId ?? TAB_GROUP_NONE) ||
      Boolean(liveVictim.pinned) !== Boolean(plan.victim.tab.pinned) ||
      (liveVictim.groupId ?? TAB_GROUP_NONE) !== (plan.victim.tab.groupId ?? TAB_GROUP_NONE)) {
    return false;
  }

  return true;
}

async function closeTabSafely(tab, reason, expectedCanonicalUrl, guard = null) {
  if (!Number.isInteger(tab?.id) || closingTabIds.has(tab.id)) {
    return false;
  }

  closingTabIds.add(tab.id);
  let operationId = null;
  let removed = false;
  let historyEntry = null;
  let intentPersistence = null;
  try {
    let live = await chrome.tabs.get(tab.id);
    if (!isStableLiveTab(live, expectedCanonicalUrl)) {
      return false;
    }

    if (guard?.classification && !isCurrentDeadCandidate(guard.classification, live, true)) {
      return false;
    }
    if (guard?.duplicate && !await validateDuplicatePlan(guard.duplicate, live)) {
      return false;
    }

    // Re-fetch after validating the other side of a duplicate plan. The
    // browser has no conditional remove primitive, so this is the last
    // available non-atomic check before tabs.remove().
    live = await chrome.tabs.get(tab.id);
    if (!isStableLiveTab(live, expectedCanonicalUrl) ||
        (guard?.classification && !isCurrentDeadCandidate(guard.classification, live, true)) ||
        (guard?.duplicate && !await validateDuplicatePlan(guard.duplicate, live))) {
      return false;
    }

    historyEntry = {
      url: live.url,
      canonicalUrl: expectedCanonicalUrl,
      reason,
      closedAt: Date.now(),
      title: live.title || '',
      sourceTabId: live.id
    };

    // Start persisting the remove intent, but do not make the visible tab
    // wait for storage. The final live-tab/guard validation above is the last
    // check before the non-atomic tabs.remove call.
    operationId = startCloseOperation(historyEntry);
    intentPersistence = persistPendingCloseOperations();
    await chrome.tabs.remove(live.id);
    removed = true;
    deleteTabMeta(live.id);

    // The tab is already closed. Finish the durable bookkeeping afterwards;
    // this preserves restart recovery and retryable history without delaying
    // the user-visible close operation.
    await intentPersistence;
    await setCloseOperationPhase(operationId, 'removed');

    const savedEntry = { ...historyEntry, closeId: operationId };
    await appendCloseHistory(savedEntry, operationId);
    await persistSessionMeta();
    return true;
  } catch {
    if (removed && operationId && historyEntry) {
      // tabs.remove succeeded but a later bookkeeping step failed. Keep the
      // successful entry for retry; it must not be silently discarded.
      queueUnsavedHistory({ ...historyEntry, closeId: operationId }, operationId);
      await flushCloseHistory();
      return true;
    }
    if (intentPersistence) {
      await intentPersistence;
    }
    if (operationId) {
      await cancelCloseOperation(operationId);
    }
    return false;
  } finally {
    closingTabIds.delete(tab.id);
  }
}

function isCurrentDeadCandidate(candidate, live, allowCurrentClose = false) {
  if (!candidate || !isStableLiveTab(live, candidate.canonicalUrl) ||
      (!allowCurrentClose && closingTabIds.has(live.id))) {
    return false;
  }

  const current = tabMeta.get(live.id);
  return current?.state === STATES.DEAD &&
    current.canonicalUrl === candidate.canonicalUrl &&
    current.navigationVersion === candidate.navigationVersion &&
    current.classificationRevision === candidate.classificationRevision &&
    current.routeGeneration === candidate.routeGeneration &&
    (current.documentId || null) === (candidate.documentId || null);
}

async function handleDeadClassification(candidate) {
  try {
    const tab = await chrome.tabs.get(candidate.tabId);
    if (!isCurrentDeadCandidate(candidate, tab)) {
      return false;
    }
    return closeTabSafely(tab, CLOSE_REASONS.DEAD, candidate.canonicalUrl, { classification: candidate });
  } catch {
    // Tab disappeared or navigated while being checked.
    return false;
  }
}

async function applyClassification(tab, message, sender = null, reconcileAfter = true) {
  if (!Number.isInteger(tab?.id)) {
    return false;
  }

  const messageCanonical = Url.canonicalizeGofileUrl(message?.url || '');
  if (!messageCanonical || messageCanonical !== message?.canonicalUrl) {
    return false;
  }

  let live;
  try {
    live = await chrome.tabs.get(tab.id);
  } catch {
    return false;
  }

  const liveCanonical = Url.canonicalizeGofileUrl(live.url || '');
  if (!liveCanonical || liveCanonical !== messageCanonical || isTabNavigationInProgress(live)) {
    return false;
  }

  const documentId = typeof sender?.documentId === 'string' ? sender.documentId : null;
  const routeGeneration = Number.isInteger(message.documentGeneration) ? message.documentGeneration : 0;
  const routeKey = routeGenerationKey(live.id, documentId);
  if (routeGeneration < (latestRouteGenerations.get(routeKey) || 0)) {
    return false;
  }

  const previous = tabMeta.get(live.id);
  if (previous?.documentId && documentId && previous.documentId !== documentId) {
    return false;
  }
  if (previous?.navigationVersion && previous.canonicalUrl === liveCanonical &&
      routeGeneration < (previous.routeGeneration || 0)) {
    return false;
  }

  const observedAt = Number.isFinite(message.observedAt) ? message.observedAt : Date.now();
  if (previous?.canonicalUrl === liveCanonical &&
      routeGeneration === (previous.routeGeneration || 0) &&
      Number.isFinite(previous.observedAt) && observedAt < previous.observedAt) {
    return false;
  }

  const state = sanitizeState(message.state);
  if (live.status === 'loading' && state !== STATES.LOADING) {
    return false;
  }

  const revision = nextClassificationRevision(live.id);
  const navigationVersion = previous?.canonicalUrl === liveCanonical && Number.isInteger(previous.navigationVersion)
    ? previous.navigationVersion
    : nextNavigationVersion(live.id);
  const next = {
    tabId: live.id,
    canonicalUrl: liveCanonical,
    state,
    firstSeenAt: previous?.canonicalUrl === liveCanonical && Number.isFinite(previous.firstSeenAt)
      ? previous.firstSeenAt
      : Date.now(),
    observedAt,
    navigationVersion,
    documentId: documentId || previous?.documentId || null,
    routeGeneration,
    classificationRevision: revision,
    pendingNavigation: false
  };
  tabMeta.set(live.id, next);
  rememberRouteGeneration(live.id, documentId || previous?.documentId || null, routeGeneration);
  // A confirmed DEAD result must reach the final live-tab checks without
  // waiting for session storage. The write is still awaited before the
  // message completes, but it must not delay tabs.remove().
  const sessionPersistence = persistSessionMeta();

  if (state === STATES.DEAD) {
    const removed = await handleDeadClassification({
      tabId: live.id,
      canonicalUrl: liveCanonical,
      navigationVersion,
      classificationRevision: revision,
      documentId: next.documentId,
      routeGeneration
    });
    await sessionPersistence;
    return removed;
  }
  await sessionPersistence;
  if (reconcileAfter) {
    await enqueueReconciliation();
  }
  return true;
}

async function synchronizeClassifications(tabs) {
  const managedTabs = tabs.filter((tab) =>
    Number.isInteger(tab.id) && Url.isManagedGofileUrl(tab.url || '')
  );

  const responses = await Promise.all(managedTabs.map(async (tab) => {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.REQUEST_CLASSIFICATION
      });
      return { tab, response };
    } catch {
      return { tab, response: null };
    }
  }));

  for (const { tab, response } of responses) {
    if (response?.ok && response.state) {
      await applyClassification(tab, response, null, false);
    }
  }
}

function chooseDuplicateVictims(group, canonicalUrl) {
  const protectedTabs = group.filter(({ tab }) => isProtected(tab));
  const unprotectedTabs = group.filter(({ tab }) => !isProtected(tab));

  if (protectedTabs.length > 0) {
    const survivor = protectedTabs[0];
    return unprotectedTabs.map((victim) => ({
      victim,
      survivor,
      canonicalUrl
    }));
  }

  if (unprotectedTabs.length <= 1) {
    return [];
  }

  const sorted = [...unprotectedTabs].sort((a, b) => {
    const aSeen = a.meta?.firstSeenAt ?? Number.MAX_SAFE_INTEGER;
    const bSeen = b.meta?.firstSeenAt ?? Number.MAX_SAFE_INTEGER;
    return aSeen - bSeen || a.tab.id - b.tab.id;
  });
  const survivor = sorted[0];
  return sorted.slice(1).map((victim) => ({ victim, survivor, canonicalUrl }));
}

async function reconcileDuplicates() {
  if (!initialized) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const groups = new Map();

  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) {
      continue;
    }

    const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
    if (!canonicalUrl) {
      continue;
    }

    const currentMeta = tabMeta.get(tab.id);
    const meta = metaForTab(tab, currentMeta, Date.now() + tab.id);
    tabMeta.set(tab.id, meta);

    if (!groups.has(canonicalUrl)) {
      groups.set(canonicalUrl, []);
    }
    groups.get(canonicalUrl).push({ tab, meta });
  }

  for (const [canonicalUrl, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    for (const plan of chooseDuplicateVictims(group, canonicalUrl)) {
      await closeTabSafely(
        plan.victim.tab,
        CLOSE_REASONS.DUPLICATE,
        canonicalUrl,
        { duplicate: plan }
      );
    }
  }

  await persistSessionMeta();
}

function categoryForSort(tab) {
  const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
  if (!canonicalUrl) {
    return 0;
  }

  const state = tabMeta.get(tab.id)?.state;
  return state === STATES.NORMAL ? 1 : 2;
}

function stablePartitionTabs(tabs) {
  const buckets = [[], [], []];
  for (const tab of tabs) {
    buckets[categoryForSort(tab)].push(tab);
  }
  return buckets.flat();
}

function splitIntoMovableSegments(tabs) {
  const segments = [];
  let start = 0;

  for (let index = 0; index <= tabs.length; index += 1) {
    const atEnd = index === tabs.length;
    const protectedHere = !atEnd && isProtected(tabs[index]);

    if (atEnd || protectedHere) {
      if (index > start) {
        segments.push({ startIndex: start, tabs: tabs.slice(start, index) });
      }
      start = index + 1;
    }
  }

  return segments;
}

async function querySortedWindowTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return [...tabs].sort((a, b) => a.index - b.index);
}

function sameSortSnapshot(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((tab, index) => {
    const other = b[index];
    return tab.id === other.id &&
      tab.windowId === other.windowId &&
      Boolean(tab.pinned) === Boolean(other.pinned) &&
      (tab.groupId ?? TAB_GROUP_NONE) === (other.groupId ?? TAB_GROUP_NONE);
  });
}

function sameTabSet(a, b) {
  return a.length === b.length && new Set(a.map((tab) => tab.id)).size === new Set(b.map((tab) => tab.id)).size &&
    a.every((tab) => b.some((other) => other.id === tab.id));
}

function sameProtectedStructure(a, b) {
  const protectedShape = (tabs) => tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab }) => isProtected(tab))
    .map(({ tab, index }) => `${index}:${tab.id}:${Boolean(tab.pinned)}:${tab.groupId ?? TAB_GROUP_NONE}:${tab.windowId}`);
  return protectedShape(a).join('|') === protectedShape(b).join('|');
}

function segmentMatchesPlan(tabs, plan) {
  const segment = tabs.slice(plan.startIndex, plan.startIndex + plan.segmentIds.length);
  return segment.length === plan.segmentIds.length &&
    segment.every((tab) => !isProtected(tab)) &&
    segment.every((tab) => plan.segmentIds.includes(tab.id));
}

async function runSortWindow(windowId) {
  let changedSegments = 0;
  const countedSegments = new Set();
  let expectedSnapshot = null;

  while (true) {
    const tabs = await querySortedWindowTabs(windowId);
    if (expectedSnapshot && !sameSortSnapshot(expectedSnapshot, tabs)) {
      return { changed: changedSegments > 0, changedSegments, aborted: true };
    }

    const segment = splitIntoMovableSegments(tabs).find((candidate) => {
      const desiredIds = stablePartitionTabs(candidate.tabs).map((tab) => tab.id);
      return candidate.tabs.some((tab, index) => tab.id !== desiredIds[index]);
    });

    if (!segment) {
      return { changed: changedSegments > 0, changedSegments, aborted: false };
    }

    const desiredIds = stablePartitionTabs(segment.tabs).map((tab) => tab.id);
    const mismatchIndex = desiredIds.findIndex((id, index) => id !== segment.tabs[index].id);
    const plan = {
      startIndex: segment.startIndex,
      segmentIds: segment.tabs.map((tab) => tab.id),
      desiredIds
    };
    const planSegmentKey = plan.segmentIds.join(',');

    const beforeMove = await querySortedWindowTabs(windowId);
    if (!sameSortSnapshot(tabs, beforeMove) ||
        !sameTabSet(tabs, beforeMove) ||
        !sameProtectedStructure(tabs, beforeMove) ||
        !segmentMatchesPlan(beforeMove, plan)) {
      return { changed: changedSegments > 0, changedSegments, aborted: true };
    }

    const moveId = desiredIds[mismatchIndex];
    const moveTab = beforeMove.find((tab) => tab.id === moveId);
    if (!moveTab || isProtected(moveTab)) {
      return { changed: changedSegments > 0, changedSegments, aborted: true };
    }

    // Move one tab to a current absolute index. Re-querying before every move
    // follows Chromium's sequential index semantics and never relies on an
    // array-replacement mock or a stale multi-tab plan.
    await chrome.tabs.move([moveId], { index: plan.startIndex + mismatchIndex });
    if (!countedSegments.has(planSegmentKey)) {
      countedSegments.add(planSegmentKey);
      changedSegments += 1;
    }

    const afterMove = await querySortedWindowTabs(windowId);
    if (!sameTabSet(beforeMove, afterMove) || !sameProtectedStructure(beforeMove, afterMove)) {
      return { changed: true, changedSegments, aborted: true };
    }
    expectedSnapshot = afterMove;
  }
}

function sortWindowOnce(windowId) {
  const previous = sortChains.get(windowId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => runSortWindow(windowId));
  const tracked = next.finally(() => {
    if (sortChains.get(windowId) === tracked) {
      sortChains.delete(windowId);
    }
  });
  sortChains.set(windowId, tracked);
  return next;
}

async function handleRouteChanged(tab, message, sender) {
  if (!Number.isInteger(tab?.id) || typeof message?.url !== 'string') {
    return false;
  }

  const canonicalUrl = Url.canonicalizeGofileUrl(message.url);
  const declaredCanonical = message.canonicalUrl || null;
  if (canonicalUrl !== declaredCanonical) {
    return false;
  }

  const live = await chrome.tabs.get(tab.id);
  const liveCanonical = Url.canonicalizeGofileUrl(live.url || '');
  if (liveCanonical !== canonicalUrl) {
    return false;
  }

  const documentId = typeof sender?.documentId === 'string' ? sender.documentId : null;
  const generation = Number.isInteger(message.documentGeneration) ? message.documentGeneration : 0;
  rememberRouteGeneration(tab.id, documentId, generation);

  if (!canonicalUrl) {
    deleteTabMeta(tab.id);
    await persistSessionMeta();
    return true;
  }

  const next = loadingMetaForTab(live, tabMeta.get(tab.id), canonicalUrl, isTabNavigationInProgress(live));
  next.routeGeneration = generation;
  next.documentId = documentId;
  tabMeta.set(tab.id, next);
  await persistSessionMeta();
  await enqueueReconciliation();
  return true;
}

async function getPopupState(windowId) {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.storage.local.get(STORAGE_KEYS.CLOSE_HISTORY)
  ]);

  const counts = { normal: 0, other: 0, attention: 0, protected: 0 };
  for (const tab of tabs) {
    const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
    if (!canonicalUrl) {
      continue;
    }

    if (isProtected(tab)) {
      counts.protected += 1;
      continue;
    }

    const state = tabMeta.get(tab.id)?.state || STATES.LOADING;
    if (state === STATES.NORMAL) {
      counts.normal += 1;
    } else {
      counts.other += 1;
      if (state === STATES.ATTENTION) {
        counts.attention += 1;
      }
    }
  }

  return {
    counts,
    history: Array.isArray(stored?.[STORAGE_KEYS.CLOSE_HISTORY])
      ? stored[STORAGE_KEYS.CLOSE_HISTORY]
      : []
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.TAB_ROUTE_CHANGED && Number.isInteger(sender?.tab?.id)) {
    rememberRouteGeneration(
      sender.tab.id,
      typeof sender.documentId === 'string' ? sender.documentId : null,
      Number.isInteger(message.documentGeneration) ? message.documentGeneration : 0
    );
  }

  (async () => {
    await ensureInitialized();

    if (message?.type === MESSAGE_TYPES.TAB_ROUTE_CHANGED) {
      sendResponse({ ok: await handleRouteChanged(sender.tab, message, sender) });
      return;
    }

    if (message?.type === MESSAGE_TYPES.TAB_CLASSIFICATION) {
      const accepted = await applyClassification(sender.tab, message, sender, true);
      sendResponse({ ok: accepted });
      return;
    }

    if (message?.type === MESSAGE_TYPES.GET_POPUP_STATE) {
      sendResponse({ ok: true, ...(await getPopupState(message.windowId)) });
      return;
    }

    if (message?.type === MESSAGE_TYPES.SORT_CURRENT_WINDOW) {
      sendResponse({ ok: true, ...(await sortWindowOnce(message.windowId)) });
      return;
    }

    if (message?.type === MESSAGE_TYPES.REOPEN_HISTORY_ITEM) {
      const url = typeof message.url === 'string' ? message.url : '';
      if (!Url.isManagedGofileUrl(url)) {
        sendResponse({ ok: false, error: 'Invalid history URL' });
        return;
      }
      await chrome.tabs.create({ url });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || 'Unexpected error' });
  });

  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  (async () => {
    await ensureInitialized();
    if (!Number.isInteger(tab.id)) {
      return;
    }
    const meta = metaForTab(tab, tabMeta.get(tab.id));
    if (meta) {
      tabMeta.set(tab.id, meta);
      await persistSessionMeta();
      await enqueueReconciliation();
    }
  })().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  (async () => {
    await ensureInitialized();

    const previous = tabMeta.get(tabId);
    const pendingUrl = typeof changeInfo.pendingUrl === 'string' && changeInfo.pendingUrl.length > 0
      ? changeInfo.pendingUrl
      : (typeof tab.pendingUrl === 'string' && tab.pendingUrl.length > 0 ? tab.pendingUrl : '');
    const pending = Boolean(pendingUrl);

    // A pendingUrl is the last committed tab.url plus a future navigation.
    // Invalidate the old classification immediately and do no close/reconcile
    // until the committed URL arrives.
    if (pending || (changeInfo.status === 'loading' && typeof changeInfo.url !== 'string')) {
      clearRouteGenerations(tabId);
      const currentCanonical = Url.canonicalizeGofileUrl(tab.url || '') || previous?.canonicalUrl || null;
      const next = loadingMetaForTab(tab, previous, currentCanonical, true);
      if (next) {
        tabMeta.set(tabId, next);
        await persistSessionMeta();
      }
      return;
    }

    const effectiveUrl = typeof changeInfo.url === 'string' ? changeInfo.url : (tab.url || '');
    const canonicalUrl = Url.canonicalizeGofileUrl(effectiveUrl);
    if (!canonicalUrl) {
      if (!pending && tabMeta.has(tabId)) {
        deleteTabMeta(tabId);
        await persistSessionMeta();
      }
      return;
    }

    const urlChanged = previous?.canonicalUrl !== canonicalUrl;
    let next;
    if (urlChanged || changeInfo.status === 'loading') {
      clearRouteGenerations(tabId);
      next = loadingMetaForTab(tab, urlChanged ? previous : previous, canonicalUrl, tab.status === 'loading');
    } else {
      next = metaForTab(tab, previous);
      next.pendingNavigation = false;
    }
    tabMeta.set(tabId, next);
    await persistSessionMeta();

    if (changeInfo.status === 'complete' && !isTabNavigationInProgress(tab)) {
      await synchronizeClassifications([tab]);
    }

    const current = tabMeta.get(tabId);
    if (current?.state === STATES.DEAD && !isProtected(tab)) {
      await handleDeadClassification({
        tabId,
        canonicalUrl,
        navigationVersion: current.navigationVersion,
        classificationRevision: current.classificationRevision,
        documentId: current.documentId,
        routeGeneration: current.routeGeneration
      });
    } else {
      await enqueueReconciliation();
    }
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  deleteTabMeta(tabId);
  persistSessionMeta().catch(() => {});
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  (async () => {
    await ensureInitialized();
    const previous = tabMeta.get(removedTabId);
    deleteTabMeta(removedTabId);
    try {
      const tab = await chrome.tabs.get(addedTabId);
      const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
      if (canonicalUrl) {
        const meta = loadingMetaForTab(tab, null, canonicalUrl, isTabNavigationInProgress(tab));
        if (previous?.canonicalUrl === canonicalUrl && Number.isFinite(previous.firstSeenAt)) {
          meta.firstSeenAt = previous.firstSeenAt;
        }
        tabMeta.set(addedTabId, meta);
      }
    } catch {
      // Replacement vanished before inspection.
    }
    await persistSessionMeta();
    await enqueueReconciliation();
  })().catch(() => {});
});

startInitialization().catch(() => {});
