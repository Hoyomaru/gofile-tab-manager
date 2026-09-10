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
  let routeAwaitingRender = false;
  let freshDeadSignalGeneration = -1;
  let debounceHandle = null;
  let routePollHandle = null;
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

  function allVisibleSelectorsExist(selectors) {
    return selectors.every((selector) => querySelectorAllSafe(selector).some(isVisible));
  }

  function matchesSelectorSafe(node, selector) {
    try {
      return node?.matches?.(selector) || false;
    } catch {
      return false;
    }
  }

  function isDescendantOf(node, ancestor) {
    for (let current = node; current; current = current.parentElement || current.parentNode) {
      if (current === ancestor) {
        return true;
      }
    }
    return false;
  }

  function isInsidePageRoot(node) {
    let root = null;
    for (let current = node; current; current = current.parentElement || current.parentNode) {
      if (matchesSelectorSafe(current, '[id="fm-root"]')) {
        root = current;
        break;
      }
    }
    if (!root) {
      return false;
    }

    for (let current = root; current; current = current.parentElement || current.parentNode) {
      if (matchesSelectorSafe(current, 'main[id="page"]')) {
        return true;
      }
    }
    return false;
  }

  function hasVisibleDeadHeading(root) {
    return Signatures.DEAD_HEADING_SELECTORS.some((selector) => {
      let headings = [];
      try {
        headings = [...document.querySelectorAll(selector)];
      } catch {
        headings = [];
      }
      return headings.some((heading) =>
        isDescendantOf(heading, root) &&
        isVisible(heading) &&
        Signatures.DEAD_HEADING_TEXT.test(normalizedText(heading))
      );
    });
  }

  function isDeadHeadingNode(node) {
    for (let current = node; current; current = current.parentElement || current.parentNode) {
      if (matchesSelectorSafe(current, 'h1') && isInsidePageRoot(current) && isVisible(current)) {
        return true;
      }
    }
    return false;
  }

  function isTitleNode(node) {
    for (let current = node; current; current = current.parentElement || current.parentNode) {
      if (matchesSelectorSafe(current, 'title')) {
        return true;
      }
    }
    return false;
  }

  function hasDeadErrorContainerSignal() {
    const pageTitle = (document.title || '').replace(/\s+/g, ' ').trim();
    if (!Signatures.DEAD_PAGE_TITLE.test(pageTitle)) {
      return false;
    }

    return Signatures.ERROR_CONTAINER_SELECTORS.some((selector) =>
      querySelectorAllSafe(selector).some((root) =>
        isVisible(root) && hasVisibleDeadHeading(root)
      )
    );
  }

  function mutationTouchesDeadSignal(record) {
    const addedNodes = [...(record.addedNodes || [])];
    const addedDeadStructure = addedNodes.some((node) => {
      const roots = [];
      if (matchesSelectorSafe(node, '[id="fm-root"]')) {
        roots.push(node);
      }
      try {
        roots.push(...node.querySelectorAll?.('[id="fm-root"]') || []);
      } catch {
        // An unusual DOM node may not implement querySelectorAll.
      }
      if (roots.some((root) => isInsidePageRoot(root) && hasVisibleDeadHeading(root))) {
        return true;
      }

      const headings = [];
      if (matchesSelectorSafe(node, 'h1')) {
        headings.push(node);
      }
      try {
        headings.push(...node.querySelectorAll?.('h1') || []);
      } catch {
        // An unusual DOM node may not implement querySelectorAll.
      }
      return headings.some((heading) =>
        isInsidePageRoot(heading) &&
        isVisible(heading) &&
        Signatures.DEAD_HEADING_TEXT.test(normalizedText(heading)) &&
        hasDeadErrorContainerSignal()
      );
    });
    if (addedDeadStructure && hasDeadErrorContainerSignal()) {
      return true;
    }

    // Text/visibility changes to the exact gate heading or page title can
    // complete a staged render. A mutation on body or an existing gate's
    // arbitrary child is not fresh evidence for the current route.
    if ((isDeadHeadingNode(record.target) || isTitleNode(record.target)) &&
        hasDeadErrorContainerSignal()) {
      return true;
    }
    return false;
  }

  function observeMutations(records) {
    if (records.length > 0) {
      routeAwaitingRender = false;
    }
    const freshDeadMutation = records.some(mutationTouchesDeadSignal);
    if (freshDeadMutation) {
      freshDeadSignalGeneration = routeGeneration;
    }

    // Once the complete, current-route gate is present, do not wait for the
    // normal 800ms debounce. classifyDocument() still applies loading,
    // attention, normal-content, and route-generation safety checks.
    if (freshDeadSignalGeneration === routeGeneration &&
        hasDeadErrorContainerSignal() &&
        classifyDocument() === STATES.DEAD) {
      clearTimeout(debounceHandle);
      debounceHandle = null;
      sendClassification();
      return;
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
    if (routeAwaitingRender) {
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
      allVisibleSelectorsExist(Signatures.NORMAL_FILE_AREA_SELECTORS),
      allVisibleSelectorsExist(Signatures.NORMAL_FILE_VIEW_SELECTORS)
    ].filter(Boolean).length;

    if (normalSignals >= 1) {
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
    if (location.href !== lastObservedHref) {
      invalidateRouteIfChanged();
      return;
    }

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

    const previousHref = lastObservedHref;
    const previousGeneration = routeGeneration;
    const previousCanonical = Url.canonicalizeGofileUrl(previousHref);
    const nextCanonical = Url.canonicalizeGofileUrl(location.href);
    const sameCanonical = Boolean(previousCanonical && nextCanonical && previousCanonical === nextCanonical);
    const hadFreshDeadSignal = freshDeadSignalGeneration === previousGeneration ||
      (previousGeneration === 0 && hasDeadErrorContainerSignal());

    lastObservedHref = location.href;
    routeGeneration += 1;
    routeStartedAt = Date.now();
    routeAwaitingRender = !sameCanonical;
    freshDeadSignalGeneration = sameCanonical && hadFreshDeadSignal
      ? routeGeneration
      : -1;
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
    clearInterval(routePollHandle);
    routePollHandle = null;
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPES.REQUEST_CLASSIFICATION) {
      return false;
    }

    invalidateRouteIfChanged();
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
  routePollHandle = setInterval(invalidateRouteIfChanged, 250);
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
