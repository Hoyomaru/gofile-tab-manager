(() => {
  'use strict';

  const root = globalThis.GofileTabManager = globalThis.GofileTabManager || {};

  root.Signatures = Object.freeze({
    NON_DEAD_ATTENTION_TEXT: Object.freeze([
      /\bpassword\s+(?:is\s+)?required\b/i,
      /\benter\s+(?:the\s+)?password\b/i,
      /\bprivate\s+(?:content|file|folder)\b/i,
      /\baccess\s+denied\b/i,
      /\bauthentication\s+required\b/i,
      /\bunauthorized\b/i,
      /\bforbidden\b/i,
      /\bnetwork\s+error\b/i,
      /\boffline\b/i,
      /\b(?:request\s+)?timed?\s*out\b/i,
      /\binternal\s+server\s+error\b/i,
      /\bbad\s+gateway\b/i,
      /\bservice\s+unavailable\b/i,
      /\bgateway\s+timeout\b/i,
      /\bunknown\s+error\b/i,
      /\b(?:401|403)\b/i,
      /\b5\d{2}\b/
    ]),
    RATE_LIMIT_TEXT: Object.freeze([
      /\b429\b/,
      /\btoo\s+many\s+requests\b/i,
      /\brate\s+limit(?:ed|ing)?\b/i
    ]),
    // The current Gofile gate is rendered inside the page outlet. The root,
    // exact not-found heading, and page title are required together; none of
    // them alone is a DEAD signal.
    ERROR_CONTAINER_SELECTORS: Object.freeze(['main[id="page"] [id="fm-root"]']),
    DEAD_HEADING_SELECTORS: Object.freeze(['main[id="page"] [id="fm-root"] h1']),
    DEAD_HEADING_TEXT: /^this\s+content\s+does\s+not\s+exist\.?$/i,
    // core/meta.js appends " · Gofile" when it applies GATE_META.title.
    DEAD_PAGE_TITLE: /^content\s+not\s+found(?:\s+·\s+gofile)?$/i,
    NORMAL_FILE_AREA_SELECTORS: Object.freeze([
      '[id="fm-header"]',
      '[id="fm-list"]'
    ]),
    NORMAL_FILE_VIEW_SELECTORS: Object.freeze([
      'button[data-action="download"]',
      'button[data-action="properties"]'
    ]),
    LOADING_SELECTORS: Object.freeze([
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[class*="loading" i]',
      '[class*="spinner" i]'
    ])
  });
})();
