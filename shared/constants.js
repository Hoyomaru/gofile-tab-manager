(() => {
  'use strict';

  const root = globalThis.GofileTabManager = globalThis.GofileTabManager || {};

  root.Constants = Object.freeze({
    VERSION: '1.0.0',
    STATES: Object.freeze({
      NORMAL: 'NORMAL',
      DEAD: 'DEAD',
      RATE_LIMITED: 'RATE_LIMITED',
      LOADING: 'LOADING',
      ATTENTION: 'ATTENTION',
      PROTECTED: 'PROTECTED'
    }),
    CLOSE_REASONS: Object.freeze({
      DEAD: 'DEAD',
      DUPLICATE: 'DUPLICATE'
    }),
    STORAGE_KEYS: Object.freeze({
      CLOSE_HISTORY: 'closeHistory',
      TAB_META: 'tabMeta',
      PENDING_CLOSES: 'pendingCloses',
      AUTO_CLOSE_PAUSED: 'autoClosePaused'
    }),
    HISTORY_LIMIT: 50,
    CLASSIFY_DEBOUNCE_MS: 800,
    CLASSIFY_SETTLE_MS: 12000,
    MESSAGE_TYPES: Object.freeze({
      TAB_CLASSIFICATION: 'TAB_CLASSIFICATION',
      TAB_ROUTE_CHANGED: 'TAB_ROUTE_CHANGED',
      REQUEST_CLASSIFICATION: 'REQUEST_CLASSIFICATION',
      REQUEST_RECLASSIFICATION: 'REQUEST_RECLASSIFICATION',
      GET_POPUP_STATE: 'GET_POPUP_STATE',
      SORT_CURRENT_WINDOW: 'SORT_CURRENT_WINDOW',
      REOPEN_HISTORY_ITEM: 'REOPEN_HISTORY_ITEM'
    })
  });
})();
