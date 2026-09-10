const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceRevision = process.env.GFTM_SOURCE === 'HEAD' ? 'HEAD' : null;

function source(file) {
  if (sourceRevision) {
    return execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, encoding: 'utf8' });
  }
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function settle(turns = 20) {
  return new Promise((resolve) => {
    let remaining = turns;
    const step = () => {
      if (remaining-- <= 0) {
        resolve();
        return;
      }
      setImmediate(step);
    };
    step();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class EventHook {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  dispatch(...args) {
    return this.listeners.map((listener) => listener(...args));
  }
}

class DomNode {
  constructor(document, tagName = 'div', attributes = {}, text = '') {
    this.ownerDocument = document;
    this.tagName = tagName.toLowerCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this._text = text;
  }

  get hidden() {
    return Object.prototype.hasOwnProperty.call(this.attributes, 'hidden');
  }

  set hidden(value) {
    if (value) {
      this.attributes.hidden = '';
    } else {
      delete this.attributes.hidden;
    }
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
    this.ownerDocument.notify({ type: 'characterData', target: this, addedNodes: [] });
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this.ownerDocument.notify({ type: 'attributes', target: this, addedNodes: [] });
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    this.ownerDocument.notify({ type: 'childList', target: this, addedNodes: [child] });
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
      this.ownerDocument.notify({ type: 'childList', target: this, addedNodes: [] });
    }
    return child;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  querySelectorAll(selector) {
    return allElements(this).filter((node) => node !== this && matchesSelector(node, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function allElements(root) {
  const result = [];
  const visit = (node) => {
    if (!(node instanceof DomNode)) {
      return;
    }
    result.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function matchesSimple(node, selector) {
  const trimmed = selector.trim();
  if (trimmed === '*') {
    return true;
  }
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed)) {
    return node.tagName === trimmed.toLowerCase();
  }
  const tagAndAttribute = /^([a-z][a-z0-9-]*)?(\[.+\])$/i.exec(trimmed);
  const attributePart = tagAndAttribute ? tagAndAttribute[2] : trimmed;
  if (tagAndAttribute?.[1] && node.tagName !== tagAndAttribute[1].toLowerCase()) {
    return false;
  }
  const match = /^\[([^\]=*]+)(\*=|=)"?([^"\]]+)"?(?:\s+i)?\]$/i.exec(attributePart);
  if (!match) {
    return false;
  }
  const value = node.getAttribute(match[1].trim());
  if (value === null) {
    return false;
  }
  return match[2] === '='
    ? value.toLowerCase() === match[3].toLowerCase()
    : value.toLowerCase().includes(match[3].toLowerCase());
}

function matchesSelector(node, selector) {
  const parts = selector.trim().match(/\[[^\]]+\]|[^\s]+/g) || [];
  if (!matchesSimple(node, parts[parts.length - 1])) {
    return false;
  }
  let ancestor = node.parentElement;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesSimple(ancestor, parts[index])) {
      ancestor = ancestor.parentElement;
    }
    if (!ancestor) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }
  return true;
}

class FakeDocument {
  constructor(url) {
    this._title = 'Gofile';
    this.titleNode = new DomNode(this, 'title');
    this.readyState = 'complete';
    this.listeners = new Map();
    this.mutationObservers = new Set();
    this.defaultView = { getComputedStyle: () => ({ display: '', visibility: '', opacity: '' }) };
    this.documentElement = new DomNode(this, 'html');
    this.body = new DomNode(this, 'body');
    this.documentElement.appendChild(this.body);
    this.locationHref = url;
  }

  get title() {
    return this._title;
  }

  set title(value) {
    this._title = String(value);
    if (this.mutationObservers) {
      this.notify({ type: 'characterData', target: this.titleNode, addedNodes: [] });
    }
  }

  createElement(tagName) {
    return new DomNode(this, tagName);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  notify(record) {
    for (const observer of this.mutationObservers) {
      observer.records.push(record);
      if (!observer.queued) {
        observer.queued = true;
        queueMicrotask(() => {
          observer.queued = false;
          const records = observer.takeRecords();
          if (records.length && observer.active) {
            observer.callback(records);
          }
        });
      }
    }
  }
}

function makeContentContext(url, configure = () => {}, sendMessage = () => Promise.resolve({ ok: true })) {
  const document = new FakeDocument(url);
  configure(document);
  const listeners = new Map();
  const intervalCallbacks = new Map();
  let nextIntervalId = 1;
  const location = {
    href: url,
    get origin() {
      return new URL(this.href).origin;
    }
  };
  const history = {
    pushState(_state, _title, nextUrl) {
      if (nextUrl !== undefined && nextUrl !== null) {
        location.href = new URL(nextUrl, location.href).href;
      }
    },
    replaceState(_state, _title, nextUrl) {
      if (nextUrl !== undefined && nextUrl !== null) {
        location.href = new URL(nextUrl, location.href).href;
      }
    }
  };
  const runtimeOnMessage = new EventHook();
  const chrome = {
    runtime: {
      onMessage: runtimeOnMessage,
      sendMessage
    }
  };
  class TestMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      this.active = false;
      this.queued = false;
    }

    observe() {
      this.active = true;
      document.mutationObservers.add(this);
    }

    disconnect() {
      this.active = false;
      document.mutationObservers.delete(this);
    }

    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }
  }
  const context = vm.createContext({
    console,
    URL,
    Promise,
    Map,
    Set,
    Date,
    Intl,
    queueMicrotask,
    setTimeout: (callback, ms) => {
      const handle = setTimeout(callback, ms);
      handle.unref?.();
      return handle;
    },
    clearTimeout,
    setInterval(callback) {
      const id = nextIntervalId++;
      intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervalCallbacks.delete(id);
    },
    location,
    history,
    document,
    chrome,
    MutationObserver: TestMutationObserver,
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    }
  });
  vm.runInContext(source('shared/constants.js'), context, { filename: 'shared/constants.js' });
  vm.runInContext(source('shared/url.js'), context, { filename: 'shared/url.js' });
  vm.runInContext(source('shared/signatures.js'), context, { filename: 'shared/signatures.js' });
  vm.runInContext(source('content.js'), context, { filename: 'content.js' });

  return {
    context,
    document,
    location,
    history,
    messages: [],
    runtimeOnMessage,
    dispatchWindowEvent(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
    runRoutePoll() {
      for (const callback of intervalCallbacks.values()) {
        callback();
      }
    },
    requestClassification() {
      return new Promise((resolve) => {
        runtimeOnMessage.dispatch(
          { type: 'REQUEST_CLASSIFICATION' },
          {},
          resolve
        );
      });
    }
  };
}

function contentOnly(url, configure) {
  const messages = [];
  const content = makeContentContext(url, configure, (message) => {
    messages.push(message);
    return Promise.resolve({ ok: true });
  });
  content.messages = messages;
  return content;
}

function appendGofilePage(document) {
  const page = new DomNode(document, 'main', { id: 'page' });
  const root = new DomNode(document, 'div', { id: 'fm-root' });
  page.appendChild(root);
  document.body.appendChild(page);
  return { page, root };
}

function appendNotFoundGate(document, { parent = false, title = 'Content not found · Gofile' } = {}) {
  document.title = title;
  const { page, root } = appendGofilePage(document);
  const gate = new DomNode(document, 'div', { class: 'mx-auto gate' });
  gate.appendChild(new DomNode(document, 'h1', {}, 'This content does not exist'));
  gate.appendChild(new DomNode(
    document,
    'div',
    { class: 'text-slate-400' },
    'The content you are looking for could not be found. It may have been removed after a period of inactivity, deleted by its owner, or the link may be incorrect.'
  ));
  if (parent) {
    gate.appendChild(new DomNode(document, 'a', { href: '/d/Parent' }, 'Back to parent folder'));
  }
  root.appendChild(gate);
  return { page, root, gate };
}

function appendNormalFolder(document, { name = 'Files', itemName = 'content not found.txt' } = {}) {
  document.title = name;
  const { page, root } = appendGofilePage(document);
  const header = new DomNode(document, 'div', { id: 'fm-header' });
  header.appendChild(new DomNode(document, 'h1', {}, name));
  const list = new DomNode(document, 'div', { id: 'fm-list' });
  list.appendChild(new DomNode(document, 'div', { class: 'fm-row' }, itemName));
  root.appendChild(header);
  root.appendChild(list);
  return { page, root, header, list };
}

function appendNormalFile(document, { name = 'report.pdf' } = {}) {
  document.title = name;
  const { page, root } = appendGofilePage(document);
  const file = new DomNode(document, 'section', { class: 'panel' });
  file.appendChild(new DomNode(document, 'h1', {}, name));
  file.appendChild(new DomNode(document, 'button', { 'data-action': 'download' }, 'Download'));
  file.appendChild(new DomNode(document, 'button', { 'data-action': 'properties' }, 'Properties'));
  root.appendChild(file);
  return { page, root, file };
}

function createStorage(initial = {}) {
  const data = {
    local: clone(initial.local || {}),
    session: clone(initial.session || {})
  };
  const failures = {
    localGet: 0,
    localSet: 0,
    sessionGet: 0,
    sessionSet: 0
  };
  let blockedSessionSet = null;

  function area(name) {
    return {
      async get(key) {
        const failureKey = `${name}Get`;
        if (failures[failureKey] > 0) {
          failures[failureKey] -= 1;
          throw new Error(`${name}.get failed`);
        }
        return { [key]: clone(data[name][key]) };
      },
      async set(values) {
        const failureKey = `${name}Set`;
        if (failures[failureKey] > 0) {
          failures[failureKey] -= 1;
          throw new Error(`${name}.set failed`);
        }
        if (name === 'session' && blockedSessionSet &&
            (!blockedSessionSet.key || Object.prototype.hasOwnProperty.call(values, blockedSessionSet.key))) {
          const gate = blockedSessionSet;
          blockedSessionSet = null;
          gate.reachedResolve();
          await gate.promise;
        }
        Object.assign(data[name], clone(values));
      }
    };
  }

  return {
    data,
    failures,
    local: area('local'),
    session: area('session'),
    blockNextSessionSet(key = null) {
      let release;
      let reachedResolve;
      const reached = new Promise((resolve) => { reachedResolve = resolve; });
      const promise = new Promise((resolve) => { release = resolve; });
      blockedSessionSet = { key, promise, reachedResolve };
      return { reached, release };
    }
  };
}

function createBrowser(initialTabs = [], storage = createStorage()) {
  const events = {
    onCreated: new EventHook(),
    onUpdated: new EventHook(),
    onRemoved: new EventHook(),
    onReplaced: new EventHook()
  };
  const tabs = new Map(initialTabs.map((tab) => [tab.id, clone(tab)]));
  const moveCalls = [];
  let getGate = null;
  let getGateReachedResolve = null;
  let moveHook = null;
  let removeHook = null;
  let removeFailure = false;
  const contentResponders = new Map();

  function reindex() {
    const windows = new Map();
    for (const tab of tabs.values()) {
      const list = windows.get(tab.windowId) || [];
      list.push(tab);
      windows.set(tab.windowId, list);
    }
    for (const list of windows.values()) {
      list.sort((a, b) => a.index - b.index);
      list.forEach((tab, index) => { tab.index = index; });
    }
  }

  function snapshot(id) {
    const tab = tabs.get(id);
    return tab ? clone(tab) : null;
  }

  const chrome = {
    runtime: {
      onMessage: new EventHook()
    },
    storage,
    tabs: {
      onCreated: events.onCreated,
      onUpdated: events.onUpdated,
      onRemoved: events.onRemoved,
      onReplaced: events.onReplaced,
      async query(queryInfo = {}) {
        let result = [...tabs.values()];
        if (Number.isInteger(queryInfo.windowId)) {
          result = result.filter((tab) => tab.windowId === queryInfo.windowId);
        }
        return result.map(clone);
      },
      async get(id) {
        if (getGate && id === getGate.id && !getGate.used) {
          getGate.used = true;
          getGateReachedResolve?.();
          await getGate.promise;
        }
        const tab = tabs.get(id);
        if (!tab) {
          throw new Error('tab not found');
        }
        return clone(tab);
      },
      async remove(id) {
        if (removeHook) {
          await removeHook(id);
        }
        if (removeFailure) {
          throw new Error('remove failed');
        }
        const tab = tabs.get(id);
        if (!tab) {
          throw new Error('tab not found');
        }
        tabs.delete(id);
        reindex();
        events.onRemoved.dispatch(id, { windowId: tab.windowId, isWindowClosing: false });
      },
      async move(ids, moveProperties) {
        moveCalls.push({ ids: [...ids], index: moveProperties.index });
        if (moveHook) {
          const hook = moveHook;
          moveHook = null;
          await hook({ ids: [...ids], index: moveProperties.index });
        }
        const moving = ids.map((id) => tabs.get(id)).filter(Boolean);
        if (moving.length !== ids.length) {
          throw new Error('move tab not found');
        }
        const windowId = moving[0].windowId;
        const list = [...tabs.values()].filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index);
        const movingIds = new Set(ids);
        const remaining = list.filter((tab) => !movingIds.has(tab.id));
        const insertionIndex = Math.max(0, Math.min(moveProperties.index, remaining.length));
        remaining.splice(insertionIndex, 0, ...moving);
        remaining.forEach((tab, index) => { tab.index = index; });
      }
    }
  };

  async function dispatchRuntime(message, sender = {}) {
    return new Promise((resolve) => {
      let settled = false;
      let keptOpen = false;
      const sendResponse = (response) => {
        if (!settled) {
          settled = true;
          resolve(response);
        }
      };
      for (const listener of chrome.runtime.onMessage.listeners) {
        const result = listener(message, sender, sendResponse);
        keptOpen ||= result === true;
      }
      if (!keptOpen && !settled) {
        settled = true;
        resolve(undefined);
      }
    });
  }

  chrome.tabs.sendMessage = async (id, message) => {
    const responder = contentResponders.get(id);
    if (!responder) {
      throw new Error('content script unavailable');
    }
    return responder(message);
  };

  function addTab(tab, emit = true) {
    tabs.set(tab.id, clone(tab));
    reindex();
    if (emit) {
      events.onCreated.dispatch(snapshot(tab.id));
    }
  }

  return {
    chrome,
    storage,
    events,
    tabs,
    moveCalls,
    snapshot,
    addTab,
    updateTab(id, updates) {
      Object.assign(tabs.get(id), updates);
      reindex();
    },
    emitUpdated(id, changeInfo = {}) {
      events.onUpdated.dispatch(id, changeInfo, snapshot(id));
    },
    deleteDirect(id) {
      tabs.delete(id);
      reindex();
    },
    setGetGate(id) {
      let release;
      let reachedResolve;
      const reached = new Promise((resolve) => { reachedResolve = resolve; });
      const promise = new Promise((resolve) => { release = resolve; });
      getGate = { id, promise, used: false };
      getGateReachedResolve = reachedResolve;
      return { reached, release };
    },
    setMoveHook(hook) {
      moveHook = hook;
    },
    setRemoveHook(hook) {
      removeHook = hook;
    },
    setRemoveFailure(value) {
      removeFailure = value;
    },
    setContentResponder(id, responder) {
      contentResponders.set(id, responder);
    },
    async dispatchTabMessage(id, message, documentId = null) {
      return dispatchRuntime(message, { tab: snapshot(id), documentId });
    },
    async dispatchMessage(message) {
      return dispatchRuntime(message, {});
    }
  };
}

async function createBackground(initialTabs = [], storage = createStorage()) {
  const browser = createBrowser(initialTabs, storage);
  const context = vm.createContext({
    console,
    URL,
    Promise,
    Map,
    Set,
    Date,
    Object,
    Number,
    Boolean,
    String,
    Math,
    JSON,
    Error,
    setTimeout,
    clearTimeout,
    chrome: browser.chrome,
    globalThis: undefined
  });
  context.globalThis = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(source(file), context, { filename: file });
    }
  };
  vm.runInContext(source('background.js'), context, { filename: 'background.js' });
  await settle(30);
  return { browser, context, storage };
}

function tab(id, url, options = {}) {
  return {
    id,
    windowId: options.windowId ?? 1,
    index: options.index ?? id - 1,
    url,
    title: options.title ?? `Tab ${id}`,
    status: options.status ?? 'complete',
    pinned: options.pinned ?? false,
    groupId: options.groupId ?? -1,
    ...options
  };
}

function classification(url, state, observedAt = Date.now(), documentGeneration = 0) {
  return {
    type: 'TAB_CLASSIFICATION',
    state,
    url,
    canonicalUrl: `https://gofile.io/d/${new URL(url).pathname.split('/')[2]}`,
    observedAt,
    documentGeneration
  };
}

function history(storage) {
  return storage.data.local.closeHistory || [];
}

test('manifest keeps host scope narrow while loading the whole Gofile origin', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.deepEqual(manifest.host_permissions, ['https://gofile.io/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://gofile.io/*']);
});

test('the current Gofile not-found gate is DEAD without role=alert, with or without a parent link', async () => {
  for (const title of ['Content not found', 'Content not found · Gofile']) {
    for (const parent of [false, true]) {
      const content = contentOnly(`https://gofile.io/d/CurrentGate${parent ? 'Parent' : 'Bare'}${title.includes('·') ? 'Suffix' : ''}`, (document) => {
        appendNotFoundGate(document, { parent, title });
      });
      const response = await content.requestClassification();
      assert.equal(response.state, 'DEAD', `${title}, parent link=${parent}`);
    }
  }
});

test('a newly confirmed not-found gate is classified without waiting for the debounce window', async () => {
  const content = contentOnly('https://gofile.io/d/FastClassification');
  content.document.title = 'Content not found · Gofile';
  appendNotFoundGate(content.document, { title: 'Content not found · Gofile' });
  await settle(10);

  assert.ok(
    content.messages.some((message) => message.type === 'TAB_CLASSIFICATION' && message.state === 'DEAD'),
    'fresh DEAD classification should be sent immediately after the gate mutation'
  );
});

test('the not-found gate is distinct from normal folder and file content', async () => {
  const folder = contentOnly('https://gofile.io/d/NormalFolder', (document) => {
    appendNormalFolder(document);
  });
  assert.equal((await folder.requestClassification()).state, 'NORMAL');

  const file = contentOnly('https://gofile.io/d/NormalFile', (document) => {
    appendNormalFile(document);
  });
  assert.equal((await file.requestClassification()).state, 'NORMAL');

  for (const [title, heading] of [
    ['Protected content', 'This content is password protected'],
    ['Content expired', 'This content has expired']
  ]) {
    const content = contentOnly(`https://gofile.io/d/Gate${heading.replace(/\W+/g, '')}`, (document) => {
      document.title = title;
      const { root } = appendGofilePage(document);
      root.appendChild(new DomNode(document, 'h1', {}, heading));
    });
    assert.notEqual((await content.requestClassification()).state, 'DEAD', title);
  }
});

test('a page-world SPA route change survives unrelated mutations until the new not-found gate appears', async () => {
  const urlA = 'https://gofile.io/d/StageA';
  const urlB = 'https://gofile.io/d/StageB';
  let oldDom;
  const content = contentOnly(urlA, (document) => {
    oldDom = appendNotFoundGate(document);
  });

  content.location.href = urlB;
  content.runRoutePoll();
  await settle(10);
  assert.ok(content.messages.some((message) => message.type === 'TAB_ROUTE_CHANGED'));

  const loading = new DomNode(content.document, 'div', { class: 'spinner' }, 'Loading');
  content.document.body.appendChild(loading);
  await settle(10);
  assert.notEqual((await content.requestClassification()).state, 'DEAD', 'old gate must not carry over');
  content.document.body.removeChild(loading);
  await settle(10);

  oldDom.page.removeChild(oldDom.root);
  await settle(10);
  const newRoot = new DomNode(content.document, 'div', { id: 'fm-root' });
  const newGate = new DomNode(content.document, 'div', { class: 'gate' });
  newGate.appendChild(new DomNode(content.document, 'h1', {}, 'This content does not exist'));
  newGate.appendChild(new DomNode(content.document, 'p', {}, 'The content you are looking for could not be found.'));
  newRoot.appendChild(newGate);
  oldDom.page.appendChild(newRoot);
  await settle(10);

  assert.equal((await content.requestClassification()).state, 'DEAD');
});

test('same-content query/hash navigation keeps the established DOM classification', async () => {
  const url = 'https://gofile.io/d/SameContent';
  const content = contentOnly(url, (document) => appendNotFoundGate(document));
  assert.equal((await content.requestClassification()).state, 'DEAD');

  content.location.href = `${url}?page=1#details`;
  content.runRoutePoll();
  await settle(10);
  assert.equal((await content.requestClassification()).state, 'DEAD');

  content.location.href = 'https://gofile.io/d/SameContent?page=2';
  content.dispatchWindowEvent('popstate');
  await settle(10);
  assert.equal((await content.requestClassification()).state, 'DEAD');
  content.dispatchWindowEvent('pageshow');
});

test('the confirmed not-found gate reaches removal and history, but never removes protected tabs', async () => {
  const url = 'https://gofile.io/d/ConnectedGate';
  const storage = createStorage();
  const state = await createBackground([tab(1, url)], storage);
  makeContentContext(url, (document) => appendNotFoundGate(document), (message) =>
    state.browser.dispatchTabMessage(1, message, 'gate-document')
  );
  await settle(50);
  assert.equal(state.browser.snapshot(1), null);
  assert.equal(history(storage).length, 1);
  assert.equal(history(storage)[0].reason, 'DEAD');

  for (const options of [{ pinned: true }, { groupId: 9 }]) {
    const protectedStorage = createStorage();
    const protectedState = await createBackground([tab(1, url, options)], protectedStorage);
    makeContentContext(url, (document) => appendNotFoundGate(document), (message) =>
      protectedState.browser.dispatchTabMessage(1, message, 'protected-gate-document')
    );
    await settle(50);
    assert.ok(protectedState.browser.snapshot(1), JSON.stringify(options));
    assert.equal(history(protectedStorage).length, 0, JSON.stringify(options));
  }
});

test('content classification requires a positive visible dedicated signal', async () => {
  const cases = [
    {
      name: 'filename is not a dead signal',
      configure(document) {
        appendNormalFolder(document, { itemName: 'file not found.txt' });
      },
      expected: 'NORMAL'
    },
    {
      name: 'hidden error DOM is ignored',
      configure(document) {
        document.body.appendChild(new DomNode(document, 'div', { role: 'alert', hidden: '' }, 'content not found'));
      },
      notExpected: 'DEAD'
    },
    {
      name: 'modal and toast text is ignored',
      configure(document) {
        document.body.appendChild(new DomNode(document, 'div', { role: 'dialog' }, 'content not found'));
        document.body.appendChild(new DomNode(document, 'div', { role: 'alert', class: 'toast' }, 'content not found'));
      },
      notExpected: 'DEAD'
    },
    {
      name: 'normal content wins over coexisting alert text',
      configure(document) {
        appendNormalFolder(document, { itemName: 'file.txt' });
        document.body.appendChild(new DomNode(document, 'div', { role: 'alert' }, 'content not found'));
      },
      expected: 'NORMAL'
    },
    {
      name: 'loading wins over error wording',
      configure(document) {
        document.body.appendChild(new DomNode(document, 'div', { 'aria-busy': 'true' }, 'content not found'));
      },
      expected: 'LOADING'
    },
    {
      name: 'status codes remain non-dead',
      configure(document) {
        document.body.appendChild(new DomNode(document, 'p', {}, '401 content not found 503'));
      },
      notExpected: 'DEAD'
    },
    {
      name: 'visible content absence alert is accepted',
      configure(document) {
        appendNotFoundGate(document);
      },
      expected: 'DEAD'
    }
  ];

  for (const item of cases) {
    const content = contentOnly('https://gofile.io/d/AbC123', item.configure);
    const response = await content.requestClassification();
    const state = response.state;
    if (item.expected) {
      assert.equal(state, item.expected, item.name);
    }
    if (item.notExpected) {
      assert.notEqual(state, item.notExpected, item.name);
    }
  }
});

test('content script stays on the Gofile origin and observes entry into a managed SPA route', async () => {
  const content = contentOnly('https://gofile.io/');
  content.history.pushState({}, '', 'https://gofile.io/d/Entered');
  await settle(10);
  assert.ok(content.messages.some((message) => message.type === 'TAB_ROUTE_CHANGED'));
  assert.ok(content.messages.some((message) => message.type === 'TAB_CLASSIFICATION' && message.state === 'LOADING'));
});

test('duplicate close revalidates the survivor and leaves the last tab', async () => {
  const urlA = 'https://gofile.io/d/Same?x=1';
  const browserState = await createBackground([tab(1, urlA)]);
  const gate = browserState.browser.setGetGate(2);
  browserState.browser.addTab(tab(2, 'https://gofile.io/d/Same#fragment'));
  await gate.reached;
  browserState.browser.deleteDirect(1);
  gate.release();
  await settle(40);
  assert.deepEqual([...browserState.browser.tabs.keys()], [2]);
});

test('PROTECTED duplicate tabs are never removed, while unprotected duplicates yield to them', async () => {
  const url = 'https://gofile.io/d/Protected';
  const state = await createBackground([tab(1, url, { pinned: true })]);
  state.browser.addTab(tab(2, `${url}?duplicate=1`, { groupId: 7 }));
  await settle(30);
  assert.deepEqual([...state.browser.tabs.keys()], [1, 2]);
  state.browser.addTab(tab(3, `${url}#ordinary`));
  await settle(40);
  assert.deepEqual([...state.browser.tabs.keys()], [1, 2]);
});

test('pending navigation blocks old DEAD classification and unmanaged commit clears metadata', async () => {
  const urlA = 'https://gofile.io/d/A';
  const urlB = 'https://gofile.io/d/B';
  const state = await createBackground([tab(1, urlA)]);
  await state.browser.dispatchTabMessage(1, classification(urlA, 'NORMAL', 10));

  state.browser.updateTab(1, { pendingUrl: urlB, status: 'loading' });
  state.browser.emitUpdated(1, { pendingUrl: urlB, status: 'loading' });
  await settle();
  await state.browser.dispatchTabMessage(1, classification(urlA, 'DEAD', 20));
  assert.ok(state.browser.snapshot(1), 'old URL remains while B is pending');

  state.browser.updateTab(1, { url: urlB, pendingUrl: '', status: 'complete' });
  state.browser.emitUpdated(1, { url: urlB, status: 'complete' });
  await settle();
  await state.browser.dispatchTabMessage(1, classification(urlB, 'NORMAL', 30));
  assert.equal(state.browser.snapshot(1).url, urlB);

  state.browser.updateTab(1, { url: 'https://gofile.io/', pendingUrl: '', status: 'complete' });
  state.browser.emitUpdated(1, { url: 'https://gofile.io/', status: 'complete' });
  await settle();
  assert.equal(state.browser.snapshot(1).url, 'https://gofile.io/');
});

test('DEAD removal starts before the pending close-history write completes', async () => {
  const url = 'https://gofile.io/d/FastClose';
  const storage = createStorage();
  const state = await createBackground([tab(1, url)], storage);
  const gate = storage.blockNextSessionSet('pendingCloses');
  const close = state.browser.dispatchTabMessage(1, classification(url, 'DEAD', 20));

  await gate.reached;
  await settle(5);
  assert.equal(state.browser.snapshot(1), null, 'tabs.remove must not wait for history intent storage');

  gate.release();
  await close;
  assert.equal(history(storage).length, 1, 'successful removal still reaches Close History');
});

test('DEAD removal starts before tab metadata persistence completes', async () => {
  const url = 'https://gofile.io/d/FastMetadata';
  const storage = createStorage();
  const state = await createBackground([tab(1, url)], storage);
  const gate = storage.blockNextSessionSet('tabMeta');
  const close = state.browser.dispatchTabMessage(1, classification(url, 'DEAD', 20));
  await gate.reached;
  await settle(5);
  assert.equal(state.browser.snapshot(1), null, 'tabs.remove must not wait for tab metadata persistence');
  gate.release();
  assert.equal((await close)?.ok, true);
  assert.equal(history(storage).length, 1, 'successful removal still reaches Close History');
});

test('a newer NORMAL classification invalidates an older waiting DEAD close', async () => {
  const url = 'https://gofile.io/d/Race';
  const state = await createBackground([tab(1, url)]);
  await state.browser.dispatchTabMessage(1, classification(url, 'NORMAL', 10, 0), 'doc-1');
  const gate = state.storage.blockNextSessionSet();
  const oldDead = state.browser.dispatchTabMessage(1, classification(url, 'DEAD', 20, 0), 'doc-1');
  await gate.reached;
  await state.browser.dispatchTabMessage(1, classification(url, 'NORMAL', 30, 0), 'doc-1');
  gate.release();
  await oldDead;
  await settle(40);
  assert.ok(state.browser.snapshot(1), 'stale DEAD must not remove a newer NORMAL tab');
});

test('DEAD waits are cancelled by ATTENTION/LOADING, reload, and A-B-A navigation', async () => {
  for (const replacementState of ['ATTENTION', 'LOADING']) {
    const url = `https://gofile.io/d/Cancel${replacementState}`;
    const state = await createBackground([tab(1, url)]);
    const gate = state.storage.blockNextSessionSet();
    const oldDead = state.browser.dispatchTabMessage(1, classification(url, 'DEAD', 20));
    await gate.reached;
    await state.browser.dispatchTabMessage(1, classification(url, replacementState, 30));
    gate.release();
    await oldDead;
    assert.ok(state.browser.snapshot(1), `${replacementState} cancels stale DEAD`);
  }

  const urlA = 'https://gofile.io/d/ReloadA';
  const urlB = 'https://gofile.io/d/ReloadB';
  const state = await createBackground([tab(1, urlA)]);
  await state.browser.dispatchTabMessage(1, classification(urlA, 'NORMAL', 10));
  state.browser.updateTab(1, { status: 'loading', pendingUrl: '' });
  state.browser.emitUpdated(1, { status: 'loading' });
  await state.browser.dispatchTabMessage(1, classification(urlA, 'DEAD', 20));
  assert.ok(state.browser.snapshot(1), 'reload blocks an old DEAD result');

  state.browser.updateTab(1, { url: urlB, status: 'complete', pendingUrl: '' });
  state.browser.emitUpdated(1, { url: urlB, status: 'complete' });
  await state.browser.dispatchTabMessage(1, classification(urlB, 'NORMAL', 30));
  state.browser.updateTab(1, { url: urlA, status: 'loading', pendingUrl: urlA });
  state.browser.emitUpdated(1, { pendingUrl: urlA, status: 'loading' });
  await state.browser.dispatchTabMessage(1, classification(urlB, 'DEAD', 40));
  state.browser.updateTab(1, { url: urlA, status: 'complete', pendingUrl: '' });
  state.browser.emitUpdated(1, { url: urlA, status: 'complete' });
  await state.browser.dispatchTabMessage(1, classification(urlA, 'NORMAL', 50));
  assert.equal(state.browser.snapshot(1).url, urlA);
});

test('SPA route invalidation prevents old error DOM from reaching background removal', async () => {
  const urlA = 'https://gofile.io/d/RouteA';
  const urlB = 'https://gofile.io/d/RouteB';
  const state = await createBackground([tab(1, urlA)]);
  const main = new DomNode(null, 'main');
  const sent = [];
  const content = makeContentContext(urlA, (document) => {
    main.ownerDocument = document;
    main.appendChild(new DomNode(document, 'h1', {}, 'Files'));
    main.appendChild(new DomNode(document, 'div', { class: 'file-list' }, 'file.txt'));
    document.body.appendChild(main);
  }, (message) => {
    sent.push(message);
    return state.browser.dispatchTabMessage(1, message, 'document-1');
  });
  state.browser.setContentResponder(1, (message) => content.runtimeOnMessage.dispatch(message, {}, (response) => response));
  await settle(20);

  main.removeChild(main.children[1]);
  main.removeChild(main.children[0]);
  content.document.body.appendChild(new DomNode(content.document, 'div', { role: 'alert' }, 'content not found'));
  state.browser.updateTab(1, { url: urlB, status: 'complete', pendingUrl: '' });
  content.history.pushState({}, '', urlB);
  await delay(850);
  await settle(30);

  assert.ok(sent.some((message) => message.type === 'TAB_ROUTE_CHANGED'));
  assert.equal(state.browser.snapshot(1).url, urlB);
  const response = await content.requestClassification();
  assert.notEqual(response.state, 'DEAD');
});

test('sort aborts after a protected structure change during a move', async () => {
  const tabs = [
    tab(1, 'https://gofile.io/d/Other1', { index: 0 }),
    tab(2, 'https://gofile.io/d/Normal1', { index: 1 }),
    tab(3, 'https://example.test/', { index: 2, pinned: true }),
    tab(4, 'https://gofile.io/d/Other2', { index: 3 }),
    tab(5, 'https://gofile.io/d/Normal2', { index: 4 })
  ];
  const state = await createBackground(tabs);
  await state.browser.dispatchTabMessage(1, classification(tabs[0].url, 'ATTENTION', 10));
  await state.browser.dispatchTabMessage(2, classification(tabs[1].url, 'NORMAL', 20));
  await state.browser.dispatchTabMessage(4, classification(tabs[3].url, 'ATTENTION', 30));
  await state.browser.dispatchTabMessage(5, classification(tabs[4].url, 'NORMAL', 40));
  let release;
  const moved = new Promise((resolve) => { release = resolve; });
  state.browser.setMoveHook(async () => {
    state.browser.updateTab(4, { groupId: 42 });
    release();
    await delay(0);
  });
  const sortPromise = state.browser.dispatchMessage({ type: 'SORT_CURRENT_WINDOW', windowId: 1 });
  await moved;
  const response = await sortPromise;
  await settle(20);
  assert.equal(response.aborted, true);
  assert.equal(state.browser.moveCalls.length, 1);
  assert.equal(state.browser.snapshot(4).groupId, 42);
  assert.equal(state.browser.snapshot(4).index, 3);
});

test('sort performs stable partition per protected segment and only in the requested window', async () => {
  const tabs = [
    tab(1, 'https://example.test/', { index: 0, windowId: 1 }),
    tab(2, 'https://gofile.io/d/SortOther1', { index: 1, windowId: 1 }),
    tab(3, 'https://gofile.io/d/SortNormal1', { index: 2, windowId: 1 }),
    tab(4, 'https://example.test/pinned', { index: 3, windowId: 1, pinned: true }),
    tab(5, 'https://gofile.io/d/SortOther2', { index: 4, windowId: 1 }),
    tab(6, 'https://gofile.io/d/SortNormal2', { index: 5, windowId: 1 }),
    tab(7, 'https://gofile.io/d/OtherWindow', { index: 0, windowId: 2 })
  ];
  const state = await createBackground(tabs);
  await state.browser.dispatchTabMessage(2, classification(tabs[1].url, 'ATTENTION', 10));
  await state.browser.dispatchTabMessage(3, classification(tabs[2].url, 'NORMAL', 20));
  await state.browser.dispatchTabMessage(5, classification(tabs[4].url, 'ATTENTION', 30));
  await state.browser.dispatchTabMessage(6, classification(tabs[5].url, 'NORMAL', 40));
  const firstPromise = state.browser.dispatchMessage({ type: 'SORT_CURRENT_WINDOW', windowId: 1 });
  const secondPromise = state.browser.dispatchMessage({ type: 'SORT_CURRENT_WINDOW', windowId: 1 });
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const order = [...state.browser.tabs.values()]
    .filter((item) => item.windowId === 1)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.id);
  assert.equal(first.aborted, false);
  assert.equal(second.changed, false);
  assert.deepEqual(order, [1, 3, 2, 4, 6, 5]);
  assert.equal(state.browser.snapshot(4).pinned, true);
  assert.deepEqual(
    [...state.browser.tabs.values()].filter((item) => item.windowId === 2).map((item) => item.id),
    [7]
  );
  const moves = state.browser.moveCalls.length;
  const third = await state.browser.dispatchMessage({ type: 'SORT_CURRENT_WINDOW', windowId: 1 });
  assert.equal(third.changed, false);
  assert.equal(state.browser.moveCalls.length, moves);
});

test('replacement inherits firstSeenAt while resetting classification state', async () => {
  const url = 'https://gofile.io/d/Replace';
  const storage = createStorage({
    session: { tabMeta: { 1: { canonicalUrl: url, firstSeenAt: 100 } } }
  });
  const state = await createBackground([tab(1, url)] , storage);
  state.browser.addTab(tab(3, url, { status: 'loading', index: 1 }));
  await settle(20);
  state.browser.deleteDirect(1);
  state.browser.addTab(tab(2, url, { status: 'complete', index: 0 }), false);
  state.browser.events.onReplaced.dispatch(2, 1);
  await settle(20);
  state.browser.updateTab(3, { status: 'complete' });
  state.browser.emitUpdated(3, { status: 'complete' });
  await settle(50);
  assert.ok(state.browser.snapshot(2), 'replacement with inherited age survives');
  assert.equal(state.browser.snapshot(3), null, 'newer duplicate is removed');
  assert.equal(storage.data.session.tabMeta['2'].firstSeenAt, 100);
  const restarted = await createBackground([state.browser.snapshot(2)], storage);
  assert.equal(restarted.storage.data.session.tabMeta['2'].firstSeenAt, 100);
});

test('close history survives local storage failures, restart recovery, concurrency, and limit', async () => {
  const storage = createStorage();
  const state = await createBackground([], storage);
  storage.failures.localGet = 1;

  for (const id of [1, 2, 3]) {
    const url = `https://gofile.io/d/History${id}`;
    state.browser.addTab(tab(id, url));
    if (id === 2) {
      storage.failures.localSet = 1;
    }
    const msg = classification(url, 'DEAD', id * 10);
    const response = await state.browser.dispatchTabMessage(id, msg);
  }
  assert.equal(history(storage).length, 3);
  assert.deepEqual(history(storage).map((entry) => entry.sourceTabId), [3, 2, 1]);

  const failedId = 4;
  const failedUrl = `https://gofile.io/d/History${failedId}`;
  state.browser.addTab(tab(failedId, failedUrl));
  state.browser.setRemoveFailure(true);
  await state.browser.dispatchTabMessage(failedId, classification(failedUrl, 'DEAD', 40));
  assert.equal(history(storage).length, 3, 'failed remove is not history');
  state.browser.setRemoveFailure(false);
  await state.browser.dispatchTabMessage(failedId, classification(failedUrl, 'DEAD', 41));
  assert.equal(history(storage).length, 4);

  const restartStorage = createStorage();
  const firstWorker = await createBackground([tab(100, 'https://gofile.io/d/Restart')], restartStorage);
  restartStorage.failures.localGet = 1;
  await firstWorker.browser.dispatchTabMessage(100, classification('https://gofile.io/d/Restart', 'DEAD', 100));
  assert.equal(history(restartStorage).length, 0);
  await createBackground([], restartStorage);
  await settle(30);
  assert.equal(history(restartStorage).length, 1, 'removed tab is recovered after worker restart');

  const concurrent = [101, 102].map((id) => {
    const url = `https://gofile.io/d/Concurrent${id}`;
    state.browser.addTab(tab(id, url));
    return state.browser.dispatchTabMessage(id, classification(url, 'DEAD', id));
  });
  await Promise.all(concurrent);

  for (let id = 5; id <= 54; id += 1) {
    const url = `https://gofile.io/d/Limit${id}`;
    state.browser.addTab(tab(id, url));
    await state.browser.dispatchTabMessage(id, classification(url, 'DEAD', id + 100));
  }
  assert.equal(history(storage).length, 50);
  assert.equal(history(storage)[0].sourceTabId, 54);
  assert.equal(history(storage).at(-1).sourceTabId, 5);
});
