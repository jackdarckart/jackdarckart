const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const expectedStreamUrl = 'https://jackdarckart.stream.laut.fm/jackdarckart';

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
    'sticky-play',
    'now-playing-state',
    'now-playing-title',
    'now-playing-artist',
    'now-playing-updated-at'
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

  const localStorageState = new Map(Object.entries(options.localStorage || {}));
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
    },
    fetch: options.fetchImpl
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
  assert.equal(elements.audio.src, expectedStreamUrl, 'the stream URL should still be assigned');
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

async function testMuteButtonRestoresAudiblePlaybackFromZeroVolume() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year']
  });
  const { elements } = env;

  elements.volume.value = '0';
  await elements.volume.dispatch('input');
  assert.equal(elements.audio.muted, true, 'dragging volume to zero should mute the audio element');

  await elements.mute.dispatch('click');

  assert.equal(elements.audio.muted, false, 'mute toggle should unmute again when restoring from zero volume');
  assert.equal(elements.audio.volume, 0.7, 'mute toggle should restore the last audible volume level');
  assert.equal(elements['volume-text'].textContent, '70%', 'restoring audio should refresh the visible volume label');
}

async function testVolumeInitHydrationPreservesStoredMuteState() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year'],
    localStorage: {
      'jackdarckart-volume': '42',
      'jackdarckart-muted': 'true'
    }
  });
  const { elements, window } = env;

  assert.equal(elements.audio.volume, 0.42, 'initial hydration should apply stored volume');
  assert.equal(elements.audio.muted, true, 'initial hydration should keep stored mute state');
  assert.equal(window.localStorage.getItem('jackdarckart-muted'), 'true', 'initial hydration must not overwrite stored mute state');
}

async function testVolumeChangeEventUpdatesAudioAndStorage() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year']
  });
  const { elements, window } = env;

  elements.volume.value = '35';
  await elements.volume.dispatch('change');

  assert.equal(elements.audio.volume, 0.35, 'change event should update audio volume');
  assert.equal(elements.audio.muted, false, 'change event should keep mute status in sync');
  assert.equal(elements['volume-text'].textContent, '35%', 'change event should update visible percentage');
  assert.equal(window.localStorage.getItem('jackdarckart-volume'), '35', 'change event should persist volume');
}

async function testNowPlayingFallbackWhenMetadataUnavailable() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year'],
    fetchImpl: async () => {
      throw new Error('network-failure');
    }
  });
  const { elements } = env;

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements['now-playing-state'].textContent, 'Nicht verfügbar', 'metadata errors should keep an honest unavailable state');
  assert.match(
    elements['now-playing-title'].textContent,
    /Keine verlässlichen Live-Metadaten verfügbar/,
    'metadata errors should show a safe fallback title'
  );
}

async function testNowPlayingSuccessfulMetadataRendering() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year'],
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          title: 'Track A',
          artist: { name: 'Artist B' }
        };
      }
    })
  });
  const { elements } = env;

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements['now-playing-state'].textContent, 'Live-Daten aktiv', 'valid metadata should switch now-playing into active state');
  assert.equal(elements['now-playing-title'].textContent, 'Track A', 'valid metadata should render title');
  assert.equal(elements['now-playing-artist'].textContent, 'Artist B', 'valid metadata should render artist');
}

async function testNowPlayingAbortFallbackMessage() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year'],
    fetchImpl: async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
  });
  const { elements } = env;

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(
    elements['now-playing-artist'].textContent,
    /Zeitüberschreitung bei der Live-Abfrage/,
    'abort-like failures should show timeout-specific fallback detail'
  );
}

function testUsesStationSpecificHttpsStreamUrl() {
  assert.match(
    appCode,
    /const STREAM_URL = 'https:\/\/jackdarckart\.stream\.laut\.fm\/jackdarckart';/,
    'player code should target the station-specific laut.fm HTTPS stream URL'
  );
}

async function main() {
  testUsesStationSpecificHttpsStreamUrl();
  await testReusesExistingSourceWithoutForcedReload();
  await testMissingOptionalElementsDoNotCrashInitialization();
  await testMissingAudioElementShowsGuardedErrorState();
  await testMuteButtonRestoresAudiblePlaybackFromZeroVolume();
  await testVolumeInitHydrationPreservesStoredMuteState();
  await testVolumeChangeEventUpdatesAudioAndStorage();
  await testNowPlayingFallbackWhenMetadataUnavailable();
  await testNowPlayingSuccessfulMetadataRendering();
  await testNowPlayingAbortFallbackMessage();
  console.log('app.js player tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
