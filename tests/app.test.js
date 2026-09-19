const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

class MockElement {
  constructor(id, ownerDocument) {
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.textContent = '';
    this.hidden = false;
    this.value = '70';
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.attributes = {};
    this.parentElement = { dataset: {} };
    this.listeners = new Map();
    this.className = '';
    this.classList = {
      values: new Set(),
      add: (...tokens) => tokens.forEach((token) => this.classList.values.add(token)),
      remove: (...tokens) => tokens.forEach((token) => this.classList.values.delete(token)),
      toggle: (token, force) => {
        if (force === undefined) {
          if (this.classList.values.has(token)) {
            this.classList.values.delete(token);
            return false;
          }
          this.classList.values.add(token);
          return true;
        }

        if (force) {
          this.classList.values.add(token);
          return true;
        }

        this.classList.values.delete(token);
        return false;
      },
      contains: (token) => this.classList.values.has(token)
    };
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  async dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      await listener({
        target: this,
        currentTarget: this,
        preventDefault() {},
        ...event
      });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  querySelectorAll(selector) {
    if (selector === 'i') {
      return this.children;
    }

    if (selector === 'a') {
      return this.children;
    }

    return [];
  }

  contains(target) {
    return this === target || this.children.includes(target);
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
  }

  select() {}

  focus() {}

  getBoundingClientRect() {
    return { top: 1200, bottom: 1400 };
  }
}

class MockAudioElement extends MockElement {
  constructor(id, ownerDocument) {
    super(id, ownerDocument);
    this.paused = true;
    this.ended = false;
    this.muted = false;
    this.volume = 0.7;
    this.loadCount = 0;
    this.playCount = 0;
    this._src = '';
  }

  set src(value) {
    this._src = String(value);
  }

  get src() {
    return this._src;
  }

  async play() {
    this.paused = false;
    this.playCount += 1;
  }

  pause() {
    this.paused = true;
    return this.dispatch('pause');
  }

  load() {
    this.loadCount += 1;
  }
}

function createEnvironment(options = {}) {
  const missingIds = new Set(options.missingIds || []);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let timerId = 1;

  const document = {
    title: 'jackdarckart',
    body: new MockElement('body'),
    createElement(tagName) {
      return new MockElement(tagName, document);
    },
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, []);
      }
      documentListeners.get(type).push(listener);
    },
    async dispatch(type, event = {}) {
      const listeners = documentListeners.get(type) || [];
      for (const listener of listeners) {
        await listener(event);
      }
    },
    execCommand(command) {
      return command === 'copy';
    }
  };

  const elements = {};
  const ids = [
    'audio',
    'play',
    'mute',
    'retry',
    'share',
    'volume',
    'volume-text',
    'status',
    'status-text',
    'message',
    'share-status',
    'equalizer',
    'menu-toggle',
    'site-nav',
    'back-to-top',
    'year',
    'network-status',
    'player-state-label',
    'retry-status',
    'sticky-player',
    'sticky-play'
  ];

  for (const id of ids) {
    if (missingIds.has(id)) {
      continue;
    }

    elements[id] = id === 'audio' ? new MockAudioElement(id, document) : new MockElement(id, document);
  }

  if (elements.equalizer) {
    for (let index = 0; index < 4; index += 1) {
      elements.equalizer.appendChild(new MockElement(`eq-${index}`, document));
    }
  }

  if (elements['site-nav']) {
    elements['site-nav'].appendChild(new MockElement('nav-link', document));
  }

  const localStorageState = new Map();
  const location = { href: 'https://stream-musik.space/' };
  const windowObject = {
    location,
    URL,
    localStorage: {
      getItem(key) {
        return localStorageState.has(key) ? localStorageState.get(key) : null;
      },
      setItem(key, value) {
        localStorageState.set(key, String(value));
      }
    },
    isSecureContext: true,
    innerHeight: 900,
    scrollY: 0,
    setTimeout(callback) {
      const id = timerId;
      timerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, []);
      }
      windowListeners.get(type).push(listener);
    },
    async dispatch(type, event = {}) {
      const listeners = windowListeners.get(type) || [];
      for (const listener of listeners) {
        await listener(event);
      }
    },
    scrollTo() {},
    MediaMetadata: function MediaMetadata(data) {
      Object.assign(this, data);
    }
  };
  windowObject.window = windowObject;
  windowObject.document = document;

  const navigator = {
    onLine: true,
    clipboard: {
      async writeText() {}
    },
    mediaSession: {
      playbackState: 'none',
      setActionHandler() {}
    }
  };

  const context = vm.createContext({
    window: windowObject,
    document,
    navigator,
    console,
    URL,
    Math,
    Number,
    String,
    Date,
    Promise,
    Error,
    Boolean,
    Array,
    Object,
    setTimeout: windowObject.setTimeout,
    clearTimeout: windowObject.clearTimeout
  });

  windowObject.navigator = navigator;

  vm.runInContext(appCode, context, { filename: 'app.js' });

  return {
    elements,
    document,
    window: windowObject
  };
}

async function testReusesExistingSourceWithoutForcedReload() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year']
  });
  const { elements } = env;

  await elements.play.dispatch('click');
  await elements.audio.dispatch('playing');

  assert.equal(elements.audio.loadCount, 1, 'first playback should perform exactly one initial load');
  assert.equal(elements.audio.playCount, 1, 'first playback should call play once');

  await elements.play.dispatch('click');
  assert.equal(elements.audio.paused, true, 'second click should pause playback');

  await elements.play.dispatch('click');
  await elements.audio.dispatch('playing');

  assert.equal(elements.audio.loadCount, 1, 'restarting after pause must not force a second reload when the stream source already exists');
  assert.equal(elements.audio.playCount, 2, 'resume should still call play again');
}

async function testMissingOptionalElementsDoNotCrashInitialization() {
  const env = createEnvironment({
    missingIds: [
      'equalizer',
      'site-nav',
      'menu-toggle',
      'sticky-player',
      'sticky-play',
      'back-to-top',
      'year',
      'share-status',
      'network-status',
      'player-state-label',
      'retry-status',
      'status',
      'status-text',
      'message'
    ]
  });
  const { elements } = env;

  await elements.play.dispatch('click');

  assert.equal(elements.audio.playCount, 1, 'playback should still be attempted when optional UI fragments are absent');
  assert.equal(elements.audio.src, 'https://stream.laut.fm/jackdarckart', 'the stream URL should still be assigned');
}

async function testMissingAudioElementShowsGuardedErrorState() {
  const env = createEnvironment({
    missingIds: ['audio', 'menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year']
  });
  const { elements } = env;

  await elements.play.dispatch('click');

  assert.equal(elements.status.dataset.state, 'error', 'missing audio should switch the player into an error state');
  assert.equal(elements.status.textContent, '', 'status container text should remain managed through the dedicated status label');
  assert.equal(elements['status-text'].textContent, 'Player nicht verfügbar.', 'missing audio should expose a clear failure headline');
  assert.match(
    elements.message.textContent,
    /Audio-Komponente fehlt/,
    'missing audio should produce a user-facing recovery hint instead of throwing'
  );
}

async function main() {
  await testReusesExistingSourceWithoutForcedReload();
  await testMissingOptionalElementsDoNotCrashInitialization();
  await testMissingAudioElementShowsGuardedErrorState();
  console.log('app.js player tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
