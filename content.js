(() => {
  'use strict';

  const { Constants, Url, Signatures } = globalThis.GofileTabManager;
  const { STATES, MESSAGE_TYPES, CLASSIFY_DEBOUNCE_MS, CLASSIFY_SETTLE_MS } = Constants;

  // The script waits on the Gofile origin so that same-document navigation can
  // enter and leave /d/<contentId> without requiring a broader host permission.
  if (location.origin !== 'https://gofile.io') {
    return;
  }

  let routeGeneration = 0;
  let lastObservedHref = location.href;
  let routeStartedAt = Date.now();
  let routeNeedsFreshDom = false;
  let freshDeadSignalGeneration = -1;
  let debounceHandle = null;
  let lastSentKey = '';
  let observer = null;

  function isManagedRoute() {
    return Url.isManagedGofileUrl(location.href);
  }

  function normalizedText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function anyPatternMatches(patterns, text) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function querySelectorAllSafe(selector) {
    try {
      return [...document.querySelectorAll(selector)];
    } catch {
      return [];
    }
  }

  function isHiddenByAttributesOrStyle(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') {
        return true;
      }

      const role = current.getAttribute?.('role') || '';
      const className = current.getAttribute?.('class') || '';
      if (role.toLowerCase() === 'dialog' || /\b(?:modal|toast|snackbar|notification)\b/i.test(className)) {
        return true;
      }

      const inlineStyle = current.getAttribute?.('style') || '';
      if (/\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden\b|\bopacity\s*:\s*0(?:[;\s]|$)/i.test(inlineStyle)) {
        return true;
      }
    }

    try {
      const view = document.defaultView || globalThis;
      const style = view.getComputedStyle?.(node);
      if (style && (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      )) {
        return true;
      }
    } catch {
      // A DOM shim or an unusual page may not expose computed styles.
    }

    return false;
  }

  function isVisible(node) {
    return Boolean(node) && !isHiddenByAttributesOrStyle(node);
  }

  function anyVisibleSelectorExists(selectors) {
    return selectors.some((selector) => querySelectorAllSafe(selector).some(isVisible));
  }

  function matchesSelectorSafe(node, selector) {
    try {
      return node?.matches?.(selector) || false;
    } catch {
      return false;
    }
  }

  function containsErrorContainer(node) {
    const selector = Signatures.ERROR_CONTAINER_SELECTORS[0];
    for (let current = node; current; current = current.parentElement) {
      if (matchesSelectorSafe(current, selector)) {
        return true;
      }
    }

    try {
      return Boolean(node?.querySelector?.(selector));
    } catch {
      return false;
    }
  }

  function hasDeadErrorContainerSignal() {
    for (const selector of Signatures.ERROR_CONTAINER_SELECTORS) {
      for (const node of querySelectorAllSafe(selector)) {
        if (!isVisible(node)) {
          continue;
        }

        const text = normalizedText(node);
        const exactDeadText = Signatures.DEAD_ERROR_CONTAINER_TEXT.some((pattern) => pattern.test(text));
        const explicitDeadText = text.length <= 180 && anyPatternMatches(Signatures.DEAD_STRONG_TEXT, text);
        if (exactDeadText || explicitDeadText) {
          return true;
        }
      }
    }
    return false;
  }

  function hasMeaningfulTitle() {
    const documentTitle = (document.title || '').trim();
    if (documentTitle && !/^gofile(?:\s*[-|].*)?$/i.test(documentTitle)) {
      return true;
    }

    for (const selector of Signatures.NORMAL_TITLE_SELECTORS) {
      const node = querySelectorAllSafe(selector).find(isVisible);
      if (normalizedText(node).length >= 2) {
        return true;
      }
    }
    return false;
  }

  function mutationTouchesDeadSignal(record) {
    if (containsErrorContainer(record.target)) {
      return true;
    }

    for (const node of record.addedNodes || []) {
      if (containsErrorContainer(node)) {
        return true;
      }
    }
    return false;
  }

  function observeMutations(records) {
    if (routeNeedsFreshDom && records.some(mutationTouchesDeadSignal)) {
      freshDeadSignalGeneration = routeGeneration;
    }
    if (routeNeedsFreshDom && records.length > 0) {
      routeNeedsFreshDom = false;
    }
    scheduleClassification();
  }

  function classifyDocument() {
    const parsed = Url.parseManagedUrl(location.href);
    if (!parsed) {
      return null;
    }

    const body = document.body;
    const bodyText = normalizedText(body);
    const elapsed = Date.now() - routeStartedAt;

    if (!body || bodyText.length === 0) {
      return elapsed < CLASSIFY_SETTLE_MS ? STATES.LOADING : STATES.ATTENTION;
    }

    // A route change invalidates all old DOM evidence until a new render has
    // happened. This is deliberately not a timer-based readiness check.
    if (routeNeedsFreshDom) {
      return STATES.LOADING;
    }

    if (anyPatternMatches(Signatures.NON_DEAD_ATTENTION_TEXT, bodyText)) {
      return STATES.ATTENTION;
    }

    if (anyPatternMatches(Signatures.RATE_LIMIT_TEXT, bodyText)) {
      return STATES.RATE_LIMITED;
    }

    const loading = elapsed < CLASSIFY_SETTLE_MS && anyVisibleSelectorExists(Signatures.LOADING_SELECTORS);
    if (loading) {
      return STATES.LOADING;
    }

    const normalSignals = [
      hasMeaningfulTitle(),
      anyVisibleSelectorExists(Signatures.NORMAL_FILE_AREA_SELECTORS),
      anyVisibleSelectorExists(Signatures.NORMAL_CONTENT_SELECTORS) &&
        anyPatternMatches(Signatures.NORMAL_ACTION_TEXT, bodyText)
    ].filter(Boolean).length;

    if (normalSignals >= 2) {
      return STATES.NORMAL;
    }

    // On an SPA route, an old alert that remained mounted is not evidence for
    // the new URL. A DEAD result is possible only for an alert added/changed
    // after this route generation began. Initial page loads may use existing DOM.
    const freshDeadSignal = routeGeneration === 0 || freshDeadSignalGeneration === routeGeneration;
    if (freshDeadSignal && hasDeadErrorContainerSignal()) {
      return STATES.DEAD;
    }

    if (elapsed < CLASSIFY_SETTLE_MS) {
      return STATES.LOADING;
    }

    return STATES.ATTENTION;
  }

  function sendClassification() {
    const parsed = Url.parseManagedUrl(location.href);
    if (!parsed) {
      return;
    }

    const state = classifyDocument();
    if (!state) {
      return;
    }

    const key = `${parsed.canonicalUrl}|${state}|${routeGeneration}`;
    if (key === lastSentKey) {
      return;
    }
    lastSentKey = key;

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.TAB_CLASSIFICATION,
      state,
      url: location.href,
      canonicalUrl: parsed.canonicalUrl,
      documentGeneration: routeGeneration,
      observedAt: Date.now()
    }).then((response) => {
      if (response && response.ok === false) {
        lastSentKey = '';
      }
    }).catch(() => {
      // The service worker may be restarting; the next DOM change or settle pass retries.
      lastSentKey = '';
    });
  }

  function sendRouteChanged() {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.TAB_ROUTE_CHANGED,
      url: location.href,
      canonicalUrl: Url.canonicalizeGofileUrl(location.href),
      documentGeneration: routeGeneration,
      observedAt: Date.now()
    }).catch(() => {});
  }

  function invalidateRouteIfChanged() {
    if (location.href === lastObservedHref) {
      return false;
    }

    // MutationObserver callbacks are microtask-delivered. Drain records that
    // belong to the old route before advancing the generation; otherwise an
    // alert inserted for A immediately before pushState(A -> B) could be
    // misattributed to B.
    const pendingMutations = observer?.takeRecords?.() || [];
    if (pendingMutations.length > 0) {
      observeMutations(pendingMutations);
    }

    lastObservedHref = location.href;
    routeGeneration += 1;
    routeStartedAt = Date.now();
    routeNeedsFreshDom = true;
    freshDeadSignalGeneration = -1;
    lastSentKey = '';
    clearTimeout(debounceHandle);
    debounceHandle = null;
    sendRouteChanged();

    if (isManagedRoute()) {
      sendClassification();
    }
    return true;
  }

  function scheduleClassification() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(sendClassification, CLASSIFY_DEBOUNCE_MS);
  }

  function startObserver() {
    if (observer || !document.documentElement) {
      return;
    }
    observer = new MutationObserver(observeMutations);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-busy', 'role', 'hidden', 'style']
    });
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    invalidateRouteIfChanged();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    invalidateRouteIfChanged();
    return result;
  };

  addEventListener('popstate', invalidateRouteIfChanged);
  addEventListener('hashchange', invalidateRouteIfChanged);
  addEventListener('pageshow', () => {
    startObserver();
    invalidateRouteIfChanged();
    if (isManagedRoute()) {
      scheduleClassification();
    }
  });
  addEventListener('pagehide', () => {
    observer?.disconnect();
    observer = null;
    clearTimeout(debounceHandle);
    debounceHandle = null;
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPES.REQUEST_CLASSIFICATION) {
      return false;
    }

    const parsed = Url.parseManagedUrl(location.href);
    if (!parsed) {
      sendResponse({ ok: false });
      return false;
    }

    sendResponse({
      ok: true,
      state: classifyDocument(),
      url: location.href,
      canonicalUrl: parsed.canonicalUrl,
      documentGeneration: routeGeneration,
      observedAt: Date.now()
    });
    return false;
  });

  if (isManagedRoute()) {
    sendClassification();
  }

  startObserver();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleClassification, { once: true });
  } else if (isManagedRoute()) {
    scheduleClassification();
  }

  setTimeout(() => {
    if (isManagedRoute()) {
      lastSentKey = '';
      sendClassification();
    }
  }, CLASSIFY_SETTLE_MS + CLASSIFY_DEBOUNCE_MS);
})();
