(() => {
  'use strict';

  const { Constants, Url } = globalThis.GofileTabManager;
  const { MESSAGE_TYPES } = Constants;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPES.REQUEST_RECLASSIFICATION) {
      return false;
    }

    if (!Url.isManagedGofileUrl(location.href)) {
      sendResponse({ ok: false });
      return false;
    }

    const parent = document.body || document.documentElement;
    if (!parent) {
      sendResponse({ ok: false });
      return false;
    }

    // Reuse content.js's existing MutationObserver/debounce path instead of
    // duplicating classification logic or bypassing its route-generation guards.
    const marker = document.createElement('span');
    marker.hidden = true;
    marker.setAttribute('aria-hidden', 'true');
    parent.appendChild(marker);
    marker.remove();

    sendResponse({ ok: true });
    return false;
  });
})();
