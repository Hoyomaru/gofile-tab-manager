'use strict';

importScripts('shared/constants.js', 'shared/url.js');

const { Constants, Url } = globalThis.GofileTabManager;
const { STATES, CLOSE_REASONS, STORAGE_KEYS, HISTORY_LIMIT, MESSAGE_TYPES } = Constants;

const TAB_GROUP_NONE = -1;
const tabMeta = new Map();
const closingTabIds = new Set();
let historyWriteChain = Promise.resolve();
let reconciliationChain = Promise.resolve();
let initialized = false;
let initializationPromise = null;

function isProtected(tab) {
  return Boolean(tab?.pinned) || (Number.isInteger(tab?.groupId) && tab.groupId !== TAB_GROUP_NONE);
}

function sanitizeState(state) {
  return Object.values(STATES).includes(state) && state !== STATES.PROTECTED ? state : STATES.ATTENTION;
}

function metaForTab(tab, previous = null, fallbackSeenAt = Date.now()) {
  const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
  if (!canonicalUrl) {
    return null;
  }

  return {
    tabId: tab.id,
    canonicalUrl,
    state: previous?.canonicalUrl === canonicalUrl ? sanitizeState(previous.state) : STATES.LOADING,
    firstSeenAt: previous?.canonicalUrl === canonicalUrl && Number.isFinite(previous.firstSeenAt)
      ? previous.firstSeenAt
      : fallbackSeenAt,
    observedAt: previous?.canonicalUrl === canonicalUrl ? (previous.observedAt || 0) : 0
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

async function initializeFromLiveTabs() {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({}),
    loadSessionMeta()
  ]);

  tabMeta.clear();
  const ordered = [...tabs].filter((tab) => Number.isInteger(tab.id)).sort((a, b) => a.id - b.id);
  const base = Date.now();

  ordered.forEach((tab, index) => {
    const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
    if (!canonicalUrl) {
      return;
    }

    const saved = stored[String(tab.id)];
    const sameUrl = saved?.canonicalUrl === canonicalUrl;
    tabMeta.set(tab.id, {
      tabId: tab.id,
      canonicalUrl,
      // Re-classification by the content script is required after worker start.
      state: STATES.LOADING,
      firstSeenAt: sameUrl && Number.isFinite(saved.firstSeenAt) ? saved.firstSeenAt : base + index,
      observedAt: 0
    });
  });

  initialized = true;
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
  if (initialized) {
    return;
  }
  await startInitialization();
}

function enqueueReconciliation() {
  reconciliationChain = reconciliationChain
    .then(() => reconcileDuplicates())
    .catch(() => {});
  return reconciliationChain;
}

async function appendCloseHistory(entry) {
  historyWriteChain = historyWriteChain.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.CLOSE_HISTORY);
    const history = Array.isArray(stored?.[STORAGE_KEYS.CLOSE_HISTORY])
      ? stored[STORAGE_KEYS.CLOSE_HISTORY]
      : [];
    history.unshift(entry);
    if (history.length > HISTORY_LIMIT) {
      history.length = HISTORY_LIMIT;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.CLOSE_HISTORY]: history });
  }).catch(() => {});

  return historyWriteChain;
}

async function closeTabSafely(tab, reason, expectedCanonicalUrl) {
  if (!Number.isInteger(tab?.id) || closingTabIds.has(tab.id)) {
    return false;
  }

  closingTabIds.add(tab.id);
  try {
    const live = await chrome.tabs.get(tab.id);
    const liveCanonical = Url.canonicalizeGofileUrl(live.url || '');
    if (!liveCanonical || liveCanonical !== expectedCanonicalUrl || isProtected(live)) {
      return false;
    }

    const historyEntry = {
      url: live.url,
      canonicalUrl: liveCanonical,
      reason,
      closedAt: Date.now(),
      title: live.title || '',
      sourceTabId: live.id
    };

    await chrome.tabs.remove(live.id);
    tabMeta.delete(live.id);
    await appendCloseHistory(historyEntry);
    await persistSessionMeta();
    return true;
  } catch {
    return false;
  } finally {
    closingTabIds.delete(tab.id);
  }
}

async function handleDeadClassification(tabId, canonicalUrl) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (Url.canonicalizeGofileUrl(tab.url || '') !== canonicalUrl || isProtected(tab)) {
      return;
    }

    await closeTabSafely(tab, CLOSE_REASONS.DEAD, canonicalUrl);
  } catch {
    // Tab disappeared or navigated while being checked.
  }
}

async function applyClassification(tab, message, reconcileAfter = true) {
  if (!Number.isInteger(tab?.id) || !Url.isManagedGofileUrl(tab.url || '')) {
    return false;
  }

  let live;
  try {
    live = await chrome.tabs.get(tab.id);
  } catch {
    return false;
  }

  const liveCanonical = Url.canonicalizeGofileUrl(live.url || '');
  if (!liveCanonical || liveCanonical !== message?.canonicalUrl) {
    return false;
  }

  const previous = tabMeta.get(live.id);
  const state = sanitizeState(message.state);
  tabMeta.set(live.id, {
    tabId: live.id,
    canonicalUrl: liveCanonical,
    state,
    firstSeenAt: previous?.canonicalUrl === liveCanonical && Number.isFinite(previous.firstSeenAt)
      ? previous.firstSeenAt
      : Date.now(),
    observedAt: Number.isFinite(message.observedAt) ? message.observedAt : Date.now()
  });
  await persistSessionMeta();

  if (state === STATES.DEAD) {
    await handleDeadClassification(live.id, liveCanonical);
  } else if (reconcileAfter) {
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
      await applyClassification(tab, response, false);
    }
  }
}

function chooseDuplicateVictims(group) {
  const protectedTabs = group.filter(({ tab }) => isProtected(tab));
  const unprotectedTabs = group.filter(({ tab }) => !isProtected(tab));

  if (protectedTabs.length > 0) {
    return unprotectedTabs;
  }

  if (unprotectedTabs.length <= 1) {
    return [];
  }

  const sorted = [...unprotectedTabs].sort((a, b) => {
    const aSeen = a.meta?.firstSeenAt ?? Number.MAX_SAFE_INTEGER;
    const bSeen = b.meta?.firstSeenAt ?? Number.MAX_SAFE_INTEGER;
    return aSeen - bSeen || a.tab.id - b.tab.id;
  });

  return sorted.slice(1);
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

    const victims = chooseDuplicateVictims(group);
    for (const victim of victims) {
      await closeTabSafely(victim.tab, CLOSE_REASONS.DUPLICATE, canonicalUrl);
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

async function sortWindowOnce(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  tabs.sort((a, b) => a.index - b.index);

  let changedSegments = 0;
  for (const segment of splitIntoMovableSegments(tabs)) {
    const desired = stablePartitionTabs(segment.tabs);
    const currentIds = segment.tabs.map((tab) => tab.id);
    const desiredIds = desired.map((tab) => tab.id);
    const alreadyCorrect = currentIds.every((id, index) => id === desiredIds[index]);

    if (alreadyCorrect || desiredIds.length < 2) {
      continue;
    }

    await chrome.tabs.move(desiredIds, { index: segment.startIndex });
    changedSegments += 1;
  }

  return { changed: changedSegments > 0, changedSegments };
}

async function getPopupState(windowId) {
  const [tabs, stored] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.storage.local.get(STORAGE_KEYS.CLOSE_HISTORY)
  ]);

  const counts = {
    normal: 0,
    other: 0,
    attention: 0,
    protected: 0
  };

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
  (async () => {
    await ensureInitialized();

    if (message?.type === MESSAGE_TYPES.TAB_CLASSIFICATION) {
      const accepted = await applyClassification(sender.tab, message, true);
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

    const canonicalUrl = Url.canonicalizeGofileUrl(tab.url || '');
    if (!canonicalUrl) {
      if (tabMeta.delete(tabId)) {
        await persistSessionMeta();
      }
      return;
    }

    const previous = tabMeta.get(tabId);
    const urlChanged = typeof changeInfo.url === 'string' && previous?.canonicalUrl !== canonicalUrl;
    tabMeta.set(tabId, metaForTab(tab, previous));

    if (urlChanged) {
      const next = tabMeta.get(tabId);
      next.state = STATES.LOADING;
      next.observedAt = 0;
      next.firstSeenAt = Date.now();
    }

    await persistSessionMeta();
    if (tabMeta.get(tabId)?.state === STATES.DEAD && !isProtected(tab)) {
      await handleDeadClassification(tabId, canonicalUrl);
    } else {
      await enqueueReconciliation();
    }
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabMeta.delete(tabId)) {
    persistSessionMeta().catch(() => {});
  }
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  (async () => {
    await ensureInitialized();
    tabMeta.delete(removedTabId);
    try {
      const tab = await chrome.tabs.get(addedTabId);
      const meta = metaForTab(tab, null);
      if (meta) {
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
