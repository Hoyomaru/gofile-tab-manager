(() => {
  'use strict';

  const { MESSAGE_TYPES } = globalThis.GofileTabManager.Constants;
  const elements = {
    normal: document.querySelector('#normal-count'),
    other: document.querySelector('#other-count'),
    attention: document.querySelector('#attention-count'),
    protected: document.querySelector('#protected-count'),
    sortButton: document.querySelector('#sort-button'),
    status: document.querySelector('#status'),
    history: document.querySelector('#history')
  };

  let currentWindowId = null;

  function formatDate(timestamp) {
    try {
      return new Intl.DateTimeFormat('ja-JP', {
        dateStyle: 'short',
        timeStyle: 'medium'
      }).format(new Date(timestamp));
    } catch {
      return '';
    }
  }

  function historyRow(item) {
    const row = document.createElement('article');
    row.className = 'history-item';

    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = item.title || item.canonicalUrl || item.url;

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${item.reason} · ${formatDate(item.closedAt)}`;

    const reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.textContent = '再オープン';
    reopen.addEventListener('click', async () => {
      reopen.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.REOPEN_HISTORY_ITEM,
        url: item.url
      }).catch(() => ({ ok: false }));
      if (!response?.ok) {
        reopen.disabled = false;
        elements.status.textContent = '再オープンできませんでした。';
      }
    });

    row.append(title, meta, reopen);
    return row;
  }

  function renderHistory(history) {
    elements.history.replaceChildren();
    if (!history.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '履歴はありません。';
      elements.history.append(empty);
      return;
    }

    for (const item of history) {
      elements.history.append(historyRow(item));
    }
  }

  async function refresh() {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentWindowId = activeTabs[0]?.windowId ?? null;
    if (!Number.isInteger(currentWindowId)) {
      elements.status.textContent = '現在のウィンドウを取得できませんでした。';
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_POPUP_STATE,
      windowId: currentWindowId
    });

    if (!response?.ok) {
      elements.status.textContent = '状態を取得できませんでした。';
      return;
    }

    elements.normal.textContent = response.counts.normal;
    elements.other.textContent = response.counts.other;
    elements.attention.textContent = response.counts.attention;
    elements.protected.textContent = response.counts.protected;
    renderHistory(response.history || []);
  }

  elements.sortButton.addEventListener('click', async () => {
    if (!Number.isInteger(currentWindowId) || elements.sortButton.disabled) {
      return;
    }

    elements.sortButton.disabled = true;
    elements.status.textContent = '並び替え中…';

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SORT_CURRENT_WINDOW,
        windowId: currentWindowId
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Sort failed');
      }
      elements.status.textContent = response.changed
        ? '並び替えました。'
        : 'すでに安全な並びです。';
      await refresh();
    } catch {
      elements.status.textContent = '並び替えできませんでした。';
    } finally {
      elements.sortButton.disabled = false;
    }
  });

  refresh().catch(() => {
    elements.status.textContent = '状態を取得できませんでした。';
  });
})();
