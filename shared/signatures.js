(() => {
  'use strict';

  const root = globalThis.GofileTabManager = globalThis.GofileTabManager || {};

  root.Signatures = Object.freeze({
    DEAD_STRONG_TEXT: Object.freeze([
      /\bcontent\s+does\s+not\s+exist\b/i,
      /\bcontent\s+not\s+found\b/i,
      /\bfile\s+not\s+found\b/i,
      /\bfolder\s+not\s+found\b/i,
      /\bthis\s+content\s+(?:has\s+been\s+)?deleted\b/i,
      /\bthis\s+content\s+(?:has\s+been\s+)?removed\b/i,
      /\bthe\s+requested\s+content\s+(?:does\s+not\s+exist|was\s+not\s+found)\b/i
    ]),
    DEAD_ERROR_CONTAINER_TEXT: Object.freeze([
      /^deleted\.?$/i,
      /^removed\.?$/i,
      /^not\s+found\.?$/i
    ]),
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
      /\bunknown\s+error\b/i
    ]),
    RATE_LIMIT_TEXT: Object.freeze([
      /\b429\b/,
      /\btoo\s+many\s+requests\b/i,
      /\brate\s+limit(?:ed|ing)?\b/i
    ]),
    ERROR_CONTAINER_SELECTORS: Object.freeze([
      '[role="alert"]',
      '[class*="error" i]',
      '[class*="not-found" i]',
      '[class*="notfound" i]',
      '[data-testid*="error" i]'
    ]),
    NORMAL_TITLE_SELECTORS: Object.freeze([
      'main h1',
      'main h2',
      '[data-testid*="title" i]',
      '[class*="content-title" i]',
      '[class*="contentTitle" i]'
    ]),
    NORMAL_FILE_AREA_SELECTORS: Object.freeze([
      '[class*="filemanager" i]',
      '[class*="file-manager" i]',
      '[data-testid*="file-manager" i]',
      '[data-testid*="file-list" i]',
      '[class*="file-list" i]',
      '[class*="fileList" i]'
    ]),
    NORMAL_CONTENT_SELECTORS: Object.freeze([
      'main',
      '[class*="content" i]',
      '[data-testid*="content" i]'
    ]),
    LOADING_SELECTORS: Object.freeze([
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[class*="loading" i]',
      '[class*="spinner" i]'
    ]),
    NORMAL_ACTION_TEXT: Object.freeze([
      /\bdownload\b/i,
      /\buploaded\b/i,
      /\bfile(?:s)?\b/i,
      /\bfolder(?:s)?\b/i
    ])
  });
})();
