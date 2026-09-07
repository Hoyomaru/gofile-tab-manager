(() => {
  'use strict';

  const { Constants, Url, Signatures } = globalThis.GofileTabManager;
  const { STATES, MESSAGE_TYPES, CLASSIFY_DEBOUNCE_MS, CLASSIFY_SETTLE_MS } = Constants;

  if (!Url.isManagedGofileUrl(location.href)) {
    return;
  }

  const startedAt = Date.now();
  let debounceHandle = null;
  let lastSentKey = '';
  let observer = null;

  function normalizedText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function anyPatternMatches(patterns, text) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function anySelectorExists(selectors) {
    return selectors.some((selector) => {
      try {
        return document.querySelector(selector) !== null;
      } catch {
        return false;
      }
    });
  }

  function hasDeadErrorContainerSignal() {
    for (const selector of Signatures.ERROR_CONTAINER_SELECTORS) {
      let nodes = [];
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        continue;
      }

      for (const node of nodes) {
        const text = normalizedText(node);
        if (Signatures.DEAD_ERROR_CONTAINER_TEXT.some((pattern) => pattern.test(text))) {
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
      let node = null;
      try {
        node = document.querySelector(selector);
      } catch {
        continue;
      }
      if (normalizedText(node).length >= 2) {
        return true;
      }
    }
    return false;
  }

  function classifyDocument() {
    if (!Url.isManagedGofileUrl(location.href)) {
      return null;
    }

    const bodyText = normalizedText(document.body);
    const elapsed = Date.now() - startedAt;

    if (!document.body || bodyText.length === 0) {
      return elapsed < CLASSIFY_SETTLE_MS ? STATES.LOADING : STATES.ATTENTION;
    }

    // Explicit access/server/network states always win over absence-like wording.
    if (anyPatternMatches(Signatures.NON_DEAD_ATTENTION_TEXT, bodyText)) {
      return STATES.ATTENTION;
    }

    if (anyPatternMatches(Signatures.RATE_LIMIT_TEXT, bodyText)) {
      return STATES.RATE_LIMITED;
    }

    if (anyPatternMatches(Signatures.DEAD_STRONG_TEXT, bodyText) || hasDeadErrorContainerSignal()) {
      return STATES.DEAD;
    }

    const normalSignals = [
      hasMeaningfulTitle(),
      anySelectorExists(Signatures.NORMAL_FILE_AREA_SELECTORS),
      anySelectorExists(Signatures.NORMAL_CONTENT_SELECTORS) &&
        anyPatternMatches(Signatures.NORMAL_ACTION_TEXT, bodyText)
    ].filter(Boolean).length;

    if (normalSignals >= 2) {
      return STATES.NORMAL;
    }

    if (elapsed < CLASSIFY_SETTLE_MS && anySelectorExists(Signatures.LOADING_SELECTORS)) {
      return STATES.LOADING;
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

    const key = `${parsed.canonicalUrl}|${state}`;
    if (key === lastSentKey) {
      return;
    }
    lastSentKey = key;

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.TAB_CLASSIFICATION,
      state,
      url: location.href,
      canonicalUrl: parsed.canonicalUrl,
      observedAt: Date.now()
    }).catch(() => {
      // The service worker may be restarting; the next DOM change or settle pass retries.
      lastSentKey = '';
    });
  }

  function scheduleClassification() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(sendClassification, CLASSIFY_DEBOUNCE_MS);
  }

  function startObserver() {
    observer = new MutationObserver(scheduleClassification);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-busy', 'role']
    });
  }

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
      observedAt: Date.now()
    });
    return false;
  });

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.TAB_CLASSIFICATION,
    state: STATES.LOADING,
    url: location.href,
    canonicalUrl: Url.canonicalizeGofileUrl(location.href),
    observedAt: Date.now()
  }).catch(() => {});

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleClassification, { once: true });
  } else {
    scheduleClassification();
  }

  setTimeout(() => {
    lastSentKey = '';
    sendClassification();
  }, CLASSIFY_SETTLE_MS + CLASSIFY_DEBOUNCE_MS);

  addEventListener('pagehide', () => observer?.disconnect(), { once: true });
})();
