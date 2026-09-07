(() => {
  'use strict';

  const root = globalThis.GofileTabManager = globalThis.GofileTabManager || {};

  function parseManagedUrl(input) {
    if (typeof input !== 'string' || input.length === 0) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      return null;
    }

    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'gofile.io') {
      return null;
    }

    if (parsed.port && parsed.port !== '443') {
      return null;
    }

    const match = /^\/d\/([^/]+)\/?$/.exec(parsed.pathname);
    if (!match) {
      return null;
    }

    const contentId = match[1];
    if (!contentId) {
      return null;
    }

    return Object.freeze({
      contentId,
      canonicalUrl: `https://gofile.io/d/${contentId}`
    });
  }

  function canonicalizeGofileUrl(input) {
    return parseManagedUrl(input)?.canonicalUrl ?? null;
  }

  function isManagedGofileUrl(input) {
    return parseManagedUrl(input) !== null;
  }

  root.Url = Object.freeze({
    parseManagedUrl,
    canonicalizeGofileUrl,
    isManagedGofileUrl
  });
})();
