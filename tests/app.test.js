const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const converterJsCode = fs.readFileSync(path.join(__dirname, '..', 'converter.js'), 'utf8');
const bundledLameJsCode = fs.readFileSync(path.join(__dirname, '..', 'assets', 'vendor', 'lame.min.js'), 'utf8');
const converterHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'converter.html'), 'utf8');
const swCode = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const stylesCode = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const liveHtmlCode = fs.readFileSync(path.join(__dirname, '..', 'live.html'), 'utf8');
const expectedStreamUrl = 'https://jackdarckart.stream.laut.fm/jackdarckart';
const htmlPages = [
  'index.html',
  'live.html',
  'titel.html',
  'converter.html',
  'sendeplan.html',
  'events.html',
  'news.html',
  'archiv.html',
  'ueber-uns.html',
  'hilfe.html',
  'issue-hilfe.html',
  'kontakt.html',
  'datenschutz.html',
  'impressum.html'
];
const pageHrefByFile = Object.fromEntries(htmlPages.map((file) => [file, './' + file]));

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadBundledMp3Encoder(env) {
  vm.runInContext(bundledLameJsCode, env.context, { filename: 'assets/vendor/lame.min.js' });
}

function createValidMp3Blob(type = 'audio/mpeg', size = 128) {
  const bytes = new Uint8Array(Math.max(16, size));
  bytes[0] = 0x49;
  bytes[1] = 0x44;
  bytes[2] = 0x33;
  bytes[3] = 0x04;
  bytes[4] = 0x00;
  bytes[5] = 0x00;
  return new Blob([bytes], { type });
}

async function assertBlobStartsWithMp3Header(blob, message) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hasId3Header = bytes.length >= 3
    && bytes[0] === 0x49
    && bytes[1] === 0x44
    && bytes[2] === 0x33;
  const hasFrameSync = bytes.length >= 2
    && bytes[0] === 0xFF
    && (bytes[1] & 0xE0) === 0xE0;
  assert.ok(hasId3Header || hasFrameSync, message);
}

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
    this.href = '';
    this.target = '';
    this.rel = '';
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

  removeAttribute(name) {
    delete this.attributes[name];
  }

  querySelectorAll(selector) {
    if (selector === 'i' || selector === 'a') {
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
    return child;
  }

  select() {}

  focus() {}

  scrollIntoView() {}

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

function flushMicrotasks() {
  let chain = Promise.resolve();
  for (let index = 0; index < 20; index += 1) {
    chain = chain.then(() => Promise.resolve());
  }
  return chain;
}

function createCacheStorage(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries));

  function resolveKey(request) {
    if (typeof request === 'string') {
      return request;
    }
    if (request && typeof request.url === 'string') {
      return request.url;
    }
    return String(request);
  }

  return {
    async open() {
      return {
        async add() {},
        async put(request, response) {
          entries.set(resolveKey(request), response);
        },
        async match(request) {
          return entries.get(resolveKey(request)) || null;
        }
      };
    },
    async match(request) {
      return entries.get(resolveKey(request)) || null;
    },
    async keys() {
      return ['stream-musik-space-v3'];
    },
    async delete() {
      return true;
    }
  };
}

function createEnvironment(options = {}) {
  const missingIds = new Set(options.missingIds || []);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let timerId = 1;
  let shareCall = null;
  let clipboardText = '';
  let openedUrl = '';
  let scrollCall = null;
  let openedWindow = null;
  const cacheStorage = createCacheStorage(options.cacheMatches || {});
  const metaThemeColor = new MockElement('meta-theme-color');
  metaThemeColor.setAttribute('content', '#070b18');

  const document = {
    title: 'jackdarckart',
    body: new MockElement('body'),
    documentElement: new MockElement('html'),
    createElement(tagName) {
      return new MockElement(tagName, document);
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') {
        return metaThemeColor;
      }
      if (selector === 'nav.footer-nav') {
        return elements['footer-nav'] || null;
      }
      return null;
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
    'content',
    'audio',
    'play',
    'mute',
    'retry',
    'share',
    'share-website',
    'share-stream',
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
    'retry-counter',
    'connection-quality',
    'last-started',
    'last-error',
    'sticky-player',
    'sticky-play',
    'offline-notice',
    'offline-notice-text',
    'offline-retry',
    'theme-select',
    'theme-hint',
    'install-prompt',
    'install-app',
    'install-status',
    'sleep-timer-select',
    'sleep-custom-wrap',
    'sleep-custom-minutes',
    'sleep-apply',
    'sleep-cancel',
    'sleep-remaining',
    'now-playing-track',
    'now-playing-artist',
    'now-playing-source',
    'station-status',
    'favorite-track',
    'copy-track',
    'favorite-status',
    'favorites-list',
    'favorites-empty',
    'favorites-clear',
    'favorites-copy',
    'library-filter',
    'library-filter-clear',
    'library-summary',
    'history-list',
    'history-empty',
    'schedule-highlight',
    'schedule-list',
    'schedule-filter',
    'schedule-summary',
    'events-list',
    'news-list',
    'archive-list',
    'platform-links',
    'live-data-status',
    'live-data-updated',
    'live-data-source',
    'live-data-refresh',
    'history-source',
    'schedule-source',
    'now-playing-artwork',
    'now-playing-artwork-wrap',
    'now-playing-artwork-fallback',
    'station-profile-title',
    'station-profile-description',
    'station-profile-meta',
    'station-profile-link',
    'station-profile-listeners',
    'station-profile-next-artists',
    'station-profile-image',
    'station-profile-image-wrap',
    'station-profile-image-fallback',
    'feedback-kind',
    'feedback-name',
    'feedback-subject',
    'feedback-message',
    'feedback-email',
    'feedback-issue',
    'feedback-status',
    'feedback-email-hint',
    'footer-nav'
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

  if (elements.share) {
    elements.share.dataset.shareTarget = 'page';
  }
  if (elements['share-website']) {
    elements['share-website'].dataset.shareTarget = 'website';
  }
  if (elements['share-stream']) {
    elements['share-stream'].dataset.shareTarget = 'stream';
  }
  if (elements['theme-select']) {
    elements['theme-select'].value = 'auto';
  }
  if (elements['sleep-timer-select']) {
    elements['sleep-timer-select'].value = 'off';
  }
  if (elements['schedule-filter']) {
    elements['schedule-filter'].value = 'week';
  }
  if (elements['feedback-kind']) {
    elements['feedback-kind'].value = 'song';
  }

  const localStorageState = new Map();
  const RealDate = Date;
  const fixedNow = options.now ? new RealDate(options.now).getTime() : null;
  const MockDate = fixedNow === null
    ? RealDate
    : class MockDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }

        static now() {
          return fixedNow;
        }
      };
  const locationUrl = new URL('https://stream-musik.space/');
  const location = {
    href: locationUrl.href,
    origin: locationUrl.origin,
    protocol: locationUrl.protocol,
    hostname: locationUrl.hostname
  };

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
    scrollTo(options) {
      scrollCall = options;
    },
    open(url) {
      openedUrl = url;
      openedWindow = { opener: {} };
      return openedWindow;
    },
    MediaMetadata: function MediaMetadata(data) {
      Object.assign(this, data);
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        addListener() {}
      };
    },
    fetch: options.fetch,
    caches: cacheStorage,
    __JACKDARCKART_CONFIG__: options.appConfig || {},
    DOMParser: class MockDOMParser {
      parseFromString(html) {
        const source = String(html || '');
        const titleMatch = source.match(/<title>([\s\S]*?)<\/title>/i);
        const bodyMatch = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const langMatch = source.match(/<html[^>]*\slang="([^"]+)"/i);
        return {
          title: titleMatch ? titleMatch[1] : '',
          body: {
            innerHTML: bodyMatch ? bodyMatch[1] : ''
          },
          documentElement: {
            getAttribute(name) {
              return name === 'lang' && langMatch ? langMatch[1] : '';
            }
          },
          getElementById(id) {
            const pattern = new RegExp(`id="${escapeRegExp(id)}"`, 'i');
            return pattern.test(source) ? {} : null;
          },
          querySelector(selector) {
            if (selector === 'script[src$="./app.js"]' || selector === 'script[src$="app.js"]') {
              return /<script[^>]+src="\.\/app\.js"/i.test(source) ? {} : null;
            }
            return null;
          }
        };
      }
    }
  };
  windowObject.window = windowObject;
  windowObject.document = document;

  const navigator = {
    onLine: true,
    clipboard: {
      async writeText(text) {
        clipboardText = String(text);
      }
    },
    share: options.share
      ? async (data) => {
          shareCall = data;
          return options.share(data);
        }
      : undefined,
    mediaSession: {
      playbackState: 'none',
      metadata: null,
      setActionHandler() {}
    },
    serviceWorker: {
      register: async () => ({ scope: './' })
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
    Date: MockDate,
    Promise,
    Error,
    Boolean,
    Array,
    Object,
    Intl,
    AbortController,
    caches: cacheStorage,
    setTimeout: windowObject.setTimeout,
    clearTimeout: windowObject.clearTimeout
  });

  windowObject.navigator = navigator;

  vm.runInContext(appCode, context, { filename: 'app.js' });

  return {
    elements,
    document,
    navigator,
    window: windowObject,
    metaThemeColor,
    getShareCall() {
      return shareCall;
    },
    getClipboardText() {
      return clipboardText;
    },
    getOpenedUrl() {
      return openedUrl;
    },
    getScrollCall() {
      return scrollCall;
    },
    getOpenedWindow() {
      return openedWindow;
    },
    async runTimer(id) {
      const callback = timers.get(id);
      if (!callback) {
        return;
      }
      timers.delete(id);
      await callback();
    }
  };
}


function createCanvasContextStub() {
  return {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    createLinearGradient() {
      return {
        addColorStop() {}
      };
    }
  };
}

function createConverterEnvironment(options = {}) {
  const timers = new Map();
  let timerId = 1;
  let revokedUrl = '';
  let clickedDownloads = 0;
  let recorderMimeType = '';
  let closedAudioContexts = 0;
  const documentListeners = new Map();
  let elements = {};
  const document = {
    body: new MockElement('body'),
    documentElement: new MockElement('html'),
    createElement(tagName) {
      const element = new MockElement(tagName, document);
      element.click = () => {
        clickedDownloads += 1;
      };
      return element;
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector() {
      return null;
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, []);
      }
      documentListeners.get(type).push(listener);
    }
  };

  const ids = [
    'converter-file-input',
    'converter-browse-button',
    'converter-reset-button',
    'converter-dropzone-shell',
    'converter-import-status',
    'converter-file-name',
    'converter-file-duration',
    'converter-file-rate',
    'converter-file-size',
    'converter-file-format',
    'converter-file-channels',
    'converter-auto-enhance',
    'converter-preview-toggle',
    'converter-preview-stop',
    'converter-render-button',
    'converter-download-button',
    'converter-clear-render',
    'converter-format-select',
    'converter-bitrate-select',
    'converter-samplerate-select',
    'converter-format-note',
    'converter-render-state',
    'converter-render-state-text',
    'converter-render-status',
    'converter-cleanup-timer',
    'converter-cleanup-state',
    'converter-analysis-summary',
    'converter-waveform',
    'converter-spectrum',
    'converter-vault-button',
    'converter-vault-status',
    'converter-eq-low',
    'converter-eq-mid',
    'converter-eq-high',
    'converter-comp-threshold',
    'converter-comp-ratio',
    'converter-limiter-ceiling',
    'converter-stereo-width',
    'converter-target-lufs',
    'converter-eq-low-value',
    'converter-eq-mid-value',
    'converter-eq-high-value',
    'converter-comp-threshold-value',
    'converter-comp-ratio-value',
    'converter-limiter-ceiling-value',
    'converter-stereo-width-value',
    'converter-target-lufs-value'
  ];

  elements = Object.fromEntries(ids.map((id) => [id, new MockElement(id, document)]));
  for (const id of ['converter-waveform', 'converter-spectrum']) {
    elements[id].clientWidth = 480;
    elements[id].clientHeight = 180;
    elements[id].getContext = () => createCanvasContextStub();
  }
  elements['converter-format-select'].value = 'wav';
  elements['converter-bitrate-select'].value = '192000';
  elements['converter-samplerate-select'].value = 'source';
  elements['converter-eq-low'].value = '0';
  elements['converter-eq-mid'].value = '0';
  elements['converter-eq-high'].value = '0';
  elements['converter-comp-threshold'].value = '-18';
  elements['converter-comp-ratio'].value = '2.8';
  elements['converter-limiter-ceiling'].value = '-1';
  elements['converter-stereo-width'].value = '115';
  elements['converter-target-lufs'].value = '-12';
  elements['converter-render-state'].dataset = {};

  const windowObject = {
    document,
    devicePixelRatio: 1,
    navigator: {},
    location: {
      href: 'https://stream-musik.space/converter.html',
      pathname: '/converter.html'
    },
    AudioContext: options.AudioContext,
    webkitAudioContext: undefined,
    MediaRecorder: options.MediaRecorder,
    setTimeout(callback, delay) {
      const id = timerId++;
      timers.set(id, { callback, delay, repeat: false });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback, delay) {
      const id = timerId++;
      timers.set(id, { callback, delay, repeat: true });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const urlApi = {
    createObjectURL() {
      return 'blob:converter-test';
    },
    revokeObjectURL(url) {
      revokedUrl = url;
    }
  };

  const context = vm.createContext({
    window: windowObject,
    document,
    console,
    URL: urlApi,
    Blob,
    MediaRecorder: options.MediaRecorder,
    Math,
    Number,
    String,
    Date,
    Promise,
    Error,
    Boolean,
    Array,
    Object,
    globalThis: null,
    setTimeout: windowObject.setTimeout,
    clearTimeout: windowObject.clearTimeout,
    setInterval: windowObject.setInterval,
    clearInterval: windowObject.clearInterval,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}
  });
  context.globalThis = context;
  windowObject.URL = urlApi;

  return {
    context,
    window: windowObject,
    elements,
    getRevokedUrl() {
      return revokedUrl;
    },
    getClickedDownloads() {
      return clickedDownloads;
    },
    setRecorderMimeType(value) {
      recorderMimeType = value;
    },
    markAudioContextClosed() {
      closedAudioContexts += 1;
    },
    getRecorderMimeType() {
      return recorderMimeType;
    },
    getClosedAudioContexts() {
      return closedAudioContexts;
    },
    runTimersByDelay(delay) {
      const matchingIds = Array.from(timers.entries())
        .filter(([, timer]) => timer.delay === delay)
        .map(([id]) => id);
      for (const id of matchingIds) {
        const timer = timers.get(id);
        if (!timer) {
          continue;
        }
        if (!timer.repeat) {
          timers.delete(id);
        }
        timer.callback();
      }
    }
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
      'retry-counter',
      'connection-quality',
      'last-started',
      'last-error',
      'status',
      'status-text',
      'message',
      'offline-notice',
      'offline-notice-text',
      'offline-retry',
      'theme-select',
      'theme-hint',
      'install-prompt',
      'install-app',
      'install-status',
      'now-playing-track',
      'now-playing-artist',
      'now-playing-source',
      'station-status',
      'history-list',
      'history-empty',
      'events-list',
      'news-list',
      'archive-list',
      'platform-links'
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

async function testOfficialLautFmApiIsUsedForLiveMetadata() {
  const fetchedUrls = [];
  const env = createEnvironment({
    fetch: async (url) => {
      fetchedUrls.push(url);
      if (url.endsWith('/current_song')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Mitternacht',
            artist: { name: 'jackdarckart' },
            album: 'Night Signals',
            art: 'https://assets.laut.fm/current.jpg',
            started_at: '2026-09-19T12:00:00.000Z'
          })
        };
      }
      if (url.endsWith('/last_songs')) {
        return {
          ok: true,
          json: async () => ([
            { title: 'Mitternacht', artist: { name: 'jackdarckart' }, started_at: '2026-09-19T12:00:00.000Z' },
            { title: 'Mitternacht', artist: { name: 'jackdarckart' }, started_at: '2026-09-19T12:00:00.000Z' },
            { title: 'Wolkenlauf', artist: { name: 'jackdarckart' }, started_at: '2026-09-19T11:45:00.000Z' }
          ])
        };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 24 }) };
      }
      if (url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([{ name: 'M83' }, { name: 'Kavinsky' }]) };
      }
      if (url.endsWith('/schedule')) {
        return { ok: true, json: async () => ([]) };
      }
      return {
        ok: true,
        json: async () => ({
          name: 'jackdarckart',
          display_name: 'jackdarckart',
          description: 'Night radio',
          genres: ['Synthwave', 'Electronic'],
          page_url: 'https://laut.fm/jackdarckart',
          logo: 'https://assets.laut.fm/station.png'
        })
      };
    },
    share: async () => undefined
  });

  await flushMicrotasks();
  await flushMicrotasks();
  await env.elements.share.dispatch('click');

  const shareCall = env.getShareCall();
  assert.ok(shareCall, 'share callback should receive data');
  assert.equal(shareCall.text, 'Jetzt live: jackdarckart – Mitternacht', 'share payload should include the official live track details');
  assert.equal(env.elements['history-list'].children.length, 2, 'history should deduplicate repeated API entries');
  assert.equal(env.navigator.mediaSession.metadata.title, 'Mitternacht', 'media session metadata should reflect official current-song data');
  assert.equal(env.elements['now-playing-artwork'].src, 'https://assets.laut.fm/current.jpg', 'official artwork URLs should be applied to the cover image');
  assert.match(env.elements['station-profile-meta'].textContent, /Synthwave, Electronic/, 'station profile should render verified genres from the station endpoint');
  assert.match(env.elements['station-profile-listeners'].textContent, /24/, 'listener count should only render the verified API value');
  assert.ok(fetchedUrls.some((url) => url === 'https://api.laut.fm/station/jackdarckart/current_song'), 'default configuration should request the official current-song endpoint');
  assert.ok(fetchedUrls.some((url) => url === 'https://api.laut.fm/station/jackdarckart/last_songs'), 'default configuration should request the official last-songs endpoint');
  assert.ok(fetchedUrls.some((url) => url === 'https://api.laut.fm/station/jackdarckart/schedule'), 'default configuration should request the official schedule endpoint');
}

async function testThemeSelectionUpdatesDatasetAndThemeColor() {
  const env = createEnvironment();
  const { elements, document, metaThemeColor } = env;

  elements['theme-select'].value = 'light';
  await elements['theme-select'].dispatch('change');

  assert.equal(document.documentElement.dataset.theme, 'light', 'selecting light mode should update the resolved theme');
  assert.equal(document.documentElement.dataset.themePreference, 'light', 'theme preference should be stored on the document element');
  assert.equal(metaThemeColor.getAttribute('content'), '#edf4ff', 'theme-color meta should follow the active theme');
}

async function testOfflineRecoveryShowsDedicatedRetryAction() {
  const env = createEnvironment();
  env.navigator.onLine = false;
  await env.window.dispatch('offline');
  assert.equal(env.elements['offline-notice'].hidden, false, 'offline notice should become visible when the browser goes offline');
  assert.equal(env.elements['offline-retry'].hidden, true, 'offline retry should stay hidden while still offline');

  env.navigator.onLine = true;
  await env.window.dispatch('online');
  assert.equal(env.elements['offline-notice'].hidden, false, 'recovery notice should stay visible after reconnect');
  assert.equal(env.elements['offline-retry'].hidden, false, 'retry action should become visible once the connection returns');
}

async function testApiFailuresShowHonestFallbackState() {
  const env = createEnvironment({
    fetch: async () => {
      throw new Error('network down');
    }
  });

  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(env.elements['now-playing-track'].textContent, 'Titelinformationen derzeit nicht verfügbar');
  assert.match(env.elements['now-playing-artist'].textContent, /offiziellen Songdaten konnten gerade nicht geladen werden/i);
  assert.match(env.elements['live-data-status'].textContent, /nicht vollständig erreichbar/i);
  assert.match(env.elements['live-data-source'].textContent, /Same-Origin-Proxy/i, 'failure state should mention the optional real proxy path');
  assert.equal(env.elements['live-data-refresh'].disabled, false, 'manual refresh should remain available after an API failure');
}

async function testPreviousHistoryStaysVisibleAfterRefreshFailure() {
  let shouldFail = false;
  const env = createEnvironment({
    fetch: async (url) => {
      if (shouldFail) {
        throw new Error('network down');
      }
      if (url.endsWith('/current_song')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Mitternacht',
            artist: { name: 'jackdarckart' }
          })
        };
      }
      if (url.endsWith('/last_songs')) {
        return {
          ok: true,
          json: async () => ([
            { title: 'Mitternacht', artist: { name: 'jackdarckart' }, started_at: '2026-09-19T12:00:00.000Z' },
            { title: 'Wolkenlauf', artist: { name: 'jackdarckart' }, started_at: '2026-09-19T11:45:00.000Z' }
          ])
        };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 2 }) };
      }
      if (url.endsWith('/next_artists') || url.endsWith('/schedule')) {
        return { ok: true, json: async () => ([]) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(env.elements['history-list'].children.length, 2, 'successful initial load should render history entries');

  shouldFail = true;
  await env.elements['live-data-refresh'].dispatch('click');
  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(env.elements['history-list'].children.length, 2, 'last successful history should stay visible after a later refresh failure');
  assert.equal(env.elements['now-playing-track'].textContent, 'Titelinformationen derzeit nicht verfügbar', 'failed refresh should still clear the current-song headline');
  assert.match(env.elements['history-source'].textContent, /Letzter erfolgreicher Abruf/i, 'history state should explain that the visible data is from the last successful refresh');
}

async function testCurrentSongSurvivesAuxiliaryMetadataFailure() {
  const env = createEnvironment({
    fetch: async (url) => {
      if (url.endsWith('/current_song')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Mitternacht',
            artist: { name: 'jackdarckart' }
          })
        };
      }
      if (url.endsWith('/last_songs')) {
        return {
          ok: true,
          json: async () => ([{ title: 'Wolkenlauf', artist: { name: 'jackdarckart' }, started_at: '2026-09-19T11:45:00.000Z' }])
        };
      }
      if (url.endsWith('/listeners')) {
        throw new Error('listeners unavailable');
      }
      if (url.endsWith('/next_artists')) {
        throw new Error('next artists unavailable');
      }
      if (url.endsWith('/schedule')) {
        return { ok: true, json: async () => ([]) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  assert.equal(env.elements['now-playing-track'].textContent, 'Mitternacht', 'verified current-song data should remain visible even if auxiliary metadata fails');
  assert.match(env.elements['now-playing-source'].textContent, /Zusatzhinweis/i, 'now-playing UI should disclose partial auxiliary endpoint failures');
  assert.match(env.elements['live-data-status'].textContent, /nicht vollständig erreichbar/i, 'global live-data summary should reflect the degraded auxiliary state');
}

function testUsesStationSpecificHttpsStreamUrl() {
  assert.match(
    appCode,
    /const STREAM_URL = 'https:\/\/jackdarckart\.stream\.laut\.fm\/jackdarckart';/,
    'player code should target the station-specific laut.fm HTTPS stream URL'
  );
}

function testAppProvidesPersistentInternalNavigationShell() {
  assert.match(
    appCode,
    /const PERSISTENT_AUDIO_KEY = '__JACKDARCKART_PERSISTENT_AUDIO__';/,
    'app.js should keep a dedicated persistent-audio handoff key for internal page transitions'
  );
  assert.match(
    appCode,
    /const audio = resolveAudioElement\(\);/,
    'app.js should reattach an existing audio element instead of always constructing a fresh page-local player'
  );
  assert.match(
    appCode,
    /currentContent\.innerHTML = nextContentHtml;/,
    'internal navigation should swap only the content area so the persistent shell can keep long-lived media elements alive'
  );
  assert.doesNotMatch(
    appCode,
    /document\.body\.innerHTML = nextBodyHtml;/,
    'internal navigation must not replace the whole document body because that destroys the active audio pipeline'
  );
  assert.match(
    appCode,
    /window\.__JACKDARCKART_BOOTSTRAP__ = bootstrapApp;\s+bootstrapApp\(\);/,
    'app.js should expose a re-runnable bootstrap so the shell can rebind itself after internal navigation'
  );
  assert.match(
    appCode,
    /bindManagedEvent\(window, 'popstate',/,
    'persistent navigation should also handle browser back-forward transitions'
  );
}

async function testInternalNavigationPreservesAudioAcrossPages() {
  const pageHtml = '<!doctype html><html><head><title>Live hören | stream-musik.space</title></head><body><nav id="site-nav"><a href="./index.html">Start</a><a href="./live.html" aria-current="page" class="is-current">Live hören</a></nav><main id="content"><h1>Live hören</h1></main><nav class="footer-nav"><a href="./live.html" aria-current="page">Live</a></nav><audio id="audio" hidden></audio><script src="./app.js" defer></script></body></html>';
  const env = createEnvironment({
    fetch: async (url) => {
      if (String(url).endsWith('.html')) {
        return { ok: true, text: async () => pageHtml };
      }
      if (String(url).endsWith('/current_song')) {
        return { ok: true, json: async () => ({ title: 'Mitternacht', artist: { name: 'jackdarckart' } }) };
      }
      if (String(url).endsWith('/last_songs') || String(url).endsWith('/schedule') || String(url).endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (String(url).endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 1 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  env.window.history = {
    pushed: null,
    replaced: null,
    pushState(_state, _title, url) {
      this.pushed = url;
      env.window.location.href = url;
    },
    replaceState(_state, _title, url) {
      this.replaced = url;
      env.window.location.href = url;
    }
  };

  await env.elements.play.dispatch('click');
  await env.elements.audio.dispatch('playing');

  const link = env.document.createElement('a');
  link.tagName = 'A';
  link.href = 'https://stream-musik.space/live.html';

  await env.document.dispatch('click', {
    target: link,
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  });
  await flushMicrotasks();
  await flushMicrotasks();

  assert.match(env.elements.content.innerHTML, /<h1>Live hören<\/h1>/, 'same-origin page clicks should swap the current content area without forcing a full browser navigation');
  assert.doesNotMatch(
    String(env.document.body.innerHTML || ''),
    /<main id="content"><h1>Live hören<\/h1><\/main>/,
    'internal navigation should keep the existing shell document instead of replacing the body'
  );
  assert.match(env.elements['site-nav'].innerHTML, /aria-current="page"/, 'site navigation should be refreshed from the destination page so active links stay accurate');
  assert.equal(env.window.history.pushed, 'https://stream-musik.space/live.html', 'internal navigation should push the requested HTML page into history');
  assert.ok(env.window.__JACKDARCKART_PERSISTENT_AUDIO__ == null, 'persistent audio handoff should be consumed again after the shell finishes re-initializing');
  assert.equal(env.elements.audio.paused, false, 'the original audio element instance should still be playing after internal navigation');
  assert.equal(env.elements.status.dataset.state, 'playing', 'the player UI should rehydrate the active playback state after internal navigation');
}

async function testInternalNavigationAcceptsValidShellPagesWithoutDomParser() {
  const pageHtml = '<!doctype html><html lang="de"><head><title>Live hören | stream-musik.space</title></head><body><nav id="site-nav"><a href="./index.html">Start</a><a href="./live.html" aria-current="page" class="is-current">Live hören</a></nav><main id="content"><h1>Live hören</h1><p>Stream bleibt aktiv.</p></main><nav class="footer-nav"><a href="./live.html" aria-current="page">Live</a></nav><audio id="audio" hidden></audio><script src="./app.js" defer></script></body></html>';
  const env = createEnvironment({
    fetch: async (url) => {
      if (String(url).endsWith('.html')) {
        return { ok: true, text: async () => pageHtml };
      }
      if (String(url).endsWith('/current_song')) {
        return { ok: true, json: async () => ({ title: 'Mitternacht', artist: { name: 'jackdarckart' } }) };
      }
      if (String(url).endsWith('/last_songs') || String(url).endsWith('/schedule') || String(url).endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (String(url).endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 1 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  env.window.DOMParser = undefined;
  env.window.history = {
    pushed: null,
    replaced: null,
    pushState(_state, _title, url) {
      this.pushed = url;
      env.window.location.href = url;
    },
    replaceState(_state, _title, url) {
      this.replaced = url;
      env.window.location.href = url;
    }
  };

  const originalAudio = env.elements.audio;
  await env.elements.play.dispatch('click');
  await env.elements.audio.dispatch('playing');

  await env.window.__JACKDARCKART_APP__.navigateWithinPersistentShell('https://stream-musik.space/live.html');
  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(env.window.history.pushed, 'https://stream-musik.space/live.html', 'valid shell pages should stay on persistent-shell navigation even when DOMParser is unavailable');
  assert.equal(env.document.documentElement.getAttribute('lang'), 'de', 'source-based shell parsing should preserve the destination document language');
  assert.match(env.elements.content.innerHTML, /Stream bleibt aktiv\./, 'source-based shell parsing should still replace the content fragment');
  assert.match(env.elements['site-nav'].innerHTML, /aria-current="page"/, 'source-based shell parsing should still refresh the site navigation fragment');
  assert.match(env.elements['footer-nav'].innerHTML, /aria-current="page"/, 'source-based shell parsing should still refresh the footer navigation fragment');
  assert.equal(env.elements.audio, originalAudio, 'persistent-shell navigation should keep reusing the same audio element instance');
  assert.equal(env.elements.audio.paused, false, 'the preserved audio element should remain in its active playback state');
}

async function testInternalNavigationFallsBackToCachedPageWhenOffline() {
  const pageHtml = '<!doctype html><html><head><title>Live hören | stream-musik.space</title></head><body><nav id="site-nav"><a href="./index.html">Start</a><a href="./live.html" aria-current="page" class="is-current">Live hören</a></nav><main id="content"><h1>Live hören</h1><p>Offline aus dem Cache.</p></main><nav class="footer-nav"><a href="./live.html" aria-current="page">Live</a></nav><audio id="audio" hidden></audio><script src="./app.js" defer></script></body></html>';
  const env = createEnvironment({
    fetch: async (url) => {
      if (String(url).includes('api.laut.fm')) {
        return { ok: true, json: async () => ({}) };
      }
      throw new Error('offline');
    },
    cacheMatches: {
      'https://stream-musik.space/live.html': { ok: true, text: async () => pageHtml }
    }
  });

  env.window.history = {
    pushed: null,
    replaced: null,
    pushState(_state, _title, url) {
      this.pushed = url;
      env.window.location.href = url;
    },
    replaceState(_state, _title, url) {
      this.replaced = url;
      env.window.location.href = url;
    }
  };

  await env.elements.play.dispatch('click');
  await env.elements.audio.dispatch('playing');
  await env.window.__JACKDARCKART_APP__.navigateWithinPersistentShell('https://stream-musik.space/live.html');
  await flushMicrotasks();
  await flushMicrotasks();

  assert.equal(env.window.history.pushed, 'https://stream-musik.space/live.html', 'cached internal navigation should still update history inside the persistent shell');
  assert.match(env.elements.content.innerHTML, /Offline aus dem Cache\./, 'cached page markup should be applied when the network fetch fails');
  assert.equal(env.elements.audio.paused, false, 'cached internal navigation should keep the existing audio instance alive');
  assert.equal(env.elements.status.dataset.state, 'playing', 'player state should stay hydrated after cached internal navigation');
}

async function testNavigateHelperUsesHistoryPushStateByDefault() {
  const pageHtml = '<!doctype html><html><head><title>Live hören | stream-musik.space</title></head><body><nav id="site-nav"><a href="./index.html">Start</a><a href="./live.html" aria-current="page" class="is-current">Live hören</a></nav><main id="content"><h1>Live hören</h1></main><nav class="footer-nav"><a href="./live.html" aria-current="page">Live</a></nav><audio id="audio" hidden></audio><script src="./app.js" defer></script></body></html>';
  const env = createEnvironment({
    fetch: async (url) => {
      if (String(url).endsWith('.html')) {
        return { ok: true, text: async () => pageHtml };
      }
      if (String(url).endsWith('/current_song')) {
        return { ok: true, json: async () => ({ title: 'Mitternacht', artist: { name: 'jackdarckart' } }) };
      }
      if (String(url).endsWith('/last_songs') || String(url).endsWith('/schedule') || String(url).endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (String(url).endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 1 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  env.window.history = {
    pushed: null,
    replaced: null,
    pushState(_state, _title, url) {
      this.pushed = url;
      env.window.location.href = url;
    },
    replaceState(_state, _title, url) {
      this.replaced = url;
      env.window.location.href = url;
    }
  };

  await env.window.__JACKDARCKART_APP__.navigateWithinPersistentShell('https://stream-musik.space/live.html');
  await flushMicrotasks();
  await flushMicrotasks();

  assert.match(env.elements.content.innerHTML, /<h1>Live hören<\/h1>/, 'default helper navigation should replace the shell content in place');
  assert.equal(env.window.history.pushed, 'https://stream-musik.space/live.html', 'default helper navigation should push a new history entry');
  assert.equal(env.window.history.replaced, null, 'default helper navigation should not replace history unless requested');
}

async function testPopstateNavigationRewritesDocumentWithoutPushingHistory() {
  const pageHtml = '<!doctype html><html><head><title>Live hören | stream-musik.space</title></head><body><nav id="site-nav"><a href="./index.html">Start</a><a href="./live.html" aria-current="page" class="is-current">Live hören</a></nav><main id="content"><h1>Live hören</h1></main><nav class="footer-nav"><a href="./live.html" aria-current="page">Live</a></nav><audio id="audio" hidden></audio><script src="./app.js" defer></script></body></html>';
  const env = createEnvironment({
    fetch: async (url) => {
      if (String(url).endsWith('.html')) {
        return { ok: true, text: async () => pageHtml };
      }
      if (String(url).endsWith('/current_song')) {
        return { ok: true, json: async () => ({ title: 'Mitternacht', artist: { name: 'jackdarckart' } }) };
      }
      if (String(url).endsWith('/last_songs') || String(url).endsWith('/schedule') || String(url).endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (String(url).endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 1 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  env.window.history = {
    pushed: null,
    replaced: null,
    pushState(_state, _title, url) {
      this.pushed = url;
      env.window.location.href = url;
    },
    replaceState(_state, _title, url) {
      this.replaced = url;
      env.window.location.href = url;
    }
  };
  env.window.location.href = 'https://stream-musik.space/live.html';

  await env.window.dispatch('popstate');
  await flushMicrotasks();
  await flushMicrotasks();

  assert.match(env.elements.content.innerHTML, /<h1>Live hören<\/h1>/, 'popstate navigation should also refresh the current shell content in place');
  assert.equal(env.window.history.pushed, null, 'popstate handling should not push a new history entry');
  assert.equal(env.window.history.replaced, null, 'popstate handling should not replace the browser-managed history entry');
}

async function testReplaceNavigationUsesHistoryReplaceState() {
  const pageHtml = '<!doctype html><html><head><title>Titel | stream-musik.space</title></head><body><nav id="site-nav"><a href="./index.html">Start</a><a href="./titel.html" aria-current="page" class="is-current">Titel</a></nav><main id="content"><h1>Titel</h1></main><nav class="footer-nav"><a href="./titel.html" aria-current="page">Titel</a></nav><audio id="audio" hidden></audio><script src="./app.js" defer></script></body></html>';
  const env = createEnvironment({
    fetch: async (url) => {
      if (String(url).endsWith('.html')) {
        return { ok: true, text: async () => pageHtml };
      }
      if (String(url).endsWith('/current_song')) {
        return { ok: true, json: async () => ({ title: 'Mitternacht', artist: { name: 'jackdarckart' } }) };
      }
      if (String(url).endsWith('/last_songs') || String(url).endsWith('/schedule') || String(url).endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (String(url).endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 1 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  env.window.history = {
    pushed: null,
    replaced: null,
    pushState(_state, _title, url) {
      this.pushed = url;
      env.window.location.href = url;
    },
    replaceState(_state, _title, url) {
      this.replaced = url;
      env.window.location.href = url;
    }
  };

  await env.window.__JACKDARCKART_APP__.navigateWithinPersistentShell('https://stream-musik.space/titel.html', { replace: true });
  await flushMicrotasks();
  await flushMicrotasks();

  assert.match(env.elements.content.innerHTML, /<h1>Titel<\/h1>/, 'replace-mode navigation should refresh the shell content in place');
  assert.equal(env.window.history.pushed, null, 'replace-mode navigation should not push a new history entry');
  assert.equal(env.window.history.replaced, 'https://stream-musik.space/titel.html', 'replace-mode navigation should update the current history entry');
}

async function testScheduleUsesOfficialApiEntriesForLiveAndNext() {
  const env = createEnvironment({
    now: '2026-09-21T00:30:00+02:00',
    fetch: async (url) => {
      if (url.endsWith('/schedule')) {
        return {
          ok: true,
          json: async () => ([
            {
              starts: '2026-09-20T23:00:00+02:00',
              ends: '2026-09-21T01:00:00+02:00',
              playlist: { name: 'Late Night' },
              type: 'playlist'
            },
            {
              starts: '2026-09-21T02:00:00+02:00',
              ends: '2026-09-21T03:00:00+02:00',
              playlist: { name: 'Morgenmix' },
              type: 'playlist'
            }
          ])
        };
      }
      if (url.endsWith('/current_song')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith('/last_songs')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 0 }) };
      }
      if (url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  const highlightCards = env.elements['schedule-highlight'].children;
  assert.equal(highlightCards.length, 2, 'official schedule entries should still yield live and next highlight cards');
  assert.match(highlightCards[0].children[0].textContent, /Late Night/, 'official schedule should detect the currently live entry after midnight');
  assert.match(highlightCards[1].children[0].textContent, /Morgenmix/, 'official schedule should detect the next API entry');
  assert.match(env.elements['schedule-source'].textContent, /Letzter erfolgreicher Abruf|bereit/, 'schedule source text should expose refresh state and timing');
}

async function testScheduleFilterCanLimitUpcomingAgenda() {
  const env = createEnvironment({
    now: '2026-09-21T00:30:00+02:00',
    fetch: async (url) => {
      if (url.endsWith('/schedule')) {
        return {
          ok: true,
          json: async () => ([
            {
              starts: '2026-09-21T02:00:00+02:00',
              ends: '2026-09-21T03:00:00+02:00',
              playlist: { name: 'Morgenmix' },
              type: 'playlist'
            },
            {
              starts: '2026-09-22T02:00:00+02:00',
              ends: '2026-09-22T03:00:00+02:00',
              playlist: { name: 'Dienstag Set' },
              type: 'playlist'
            },
            {
              starts: '2026-09-28T02:00:00+02:00',
              ends: '2026-09-28T03:00:00+02:00',
              playlist: { name: 'Nächste Woche' },
              type: 'playlist'
            }
          ])
        };
      }
      if (url.endsWith('/current_song')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith('/last_songs')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 0 }) };
      }
      if (url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  assert.equal(env.elements['schedule-list'].children.length, 2, 'default week filter should exclude entries from the next calendar week');
  assert.match(env.elements['schedule-summary'].textContent, /2 kommende Einträge für diese Woche/i, 'schedule summary should describe the current-week result set');

  env.elements['schedule-filter'].value = 'tomorrow';
  await env.elements['schedule-filter'].dispatch('change');

  assert.equal(env.elements['schedule-list'].children.length, 1, 'schedule filter should reduce the upcoming agenda to the selected range');
  assert.match(env.elements['schedule-list'].children[0].children[0].textContent, /Dienstag Set/, 'schedule filter should retain only entries that match the selected day');
  assert.match(env.elements['schedule-summary'].textContent, /1 kommende Einträge für morgen/i, 'schedule summary should describe the active filter result');
}

async function testScheduleWeekFilterTreatsSundayAsWeekEnd() {
  const env = createEnvironment({
    now: '2026-09-27T10:00:00+02:00',
    fetch: async (url) => {
      if (url.endsWith('/schedule')) {
        return {
          ok: true,
          json: async () => ([
            {
              starts: '2026-09-27T19:00:00+02:00',
              ends: '2026-09-27T21:00:00+02:00',
              playlist: { name: 'Sunday Closing' },
              type: 'playlist'
            },
            {
              starts: '2026-09-28T08:00:00+02:00',
              ends: '2026-09-28T09:00:00+02:00',
              playlist: { name: 'Next Monday' },
              type: 'playlist'
            }
          ])
        };
      }
      if (url.endsWith('/current_song')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith('/last_songs')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 0 }) };
      }
      if (url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  assert.equal(env.elements['schedule-list'].children.length, 1, 'week filter should stop at Sunday instead of including the next Monday');
  assert.match(env.elements['schedule-list'].children[0].children[0].textContent, /Sunday Closing/, 'week filter should keep the remaining entry from the current Sunday');
}

async function testKeyboardShortcutsRespectInteractiveTargets() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year'],
    share: async () => undefined
  });
  const { elements, document } = env;

  await document.dispatch('keydown', {
    key: ' ',
    target: { tagName: 'DIV' },
    preventDefault() {}
  });
  assert.equal(elements.audio.playCount, 1, 'space outside interactive fields should toggle playback');

  await elements.audio.dispatch('playing');

  await document.dispatch('keydown', {
    key: 'ArrowUp',
    target: { tagName: 'DIV' },
    preventDefault() {}
  });
  assert.equal(elements['volume-text'].textContent, '75%', 'arrow up shortcut should raise the volume');

  await document.dispatch('keydown', {
    key: 'M',
    target: { tagName: 'DIV' },
    preventDefault() {}
  });
  assert.equal(elements.audio.muted, true, 'M shortcut should toggle mute');

  await document.dispatch('keydown', {
    key: 'S',
    target: { tagName: 'DIV' },
    preventDefault() {}
  });
  await flushMicrotasks();
  assert.ok(env.getShareCall(), 'S shortcut should trigger the share flow');

  await document.dispatch('keydown', {
    key: 'T',
    target: { tagName: 'DIV' },
    preventDefault() {}
  });
  assert.equal(env.getScrollCall().top, 0, 'T shortcut should scroll back to the top');
  assert.equal(env.getScrollCall().behavior, 'smooth', 'T shortcut should use smooth scrolling by default');

  await document.dispatch('keydown', {
    key: ' ',
    target: { tagName: 'INPUT' },
    preventDefault() {}
  });
  assert.equal(elements.audio.playCount, 1, 'shortcuts should stay inactive while typing in inputs');

  await document.dispatch('keydown', {
    key: 'S',
    target: { tagName: 'DIV' },
    defaultPrevented: true,
    preventDefault() {}
  });
  assert.equal(env.getShareCall().url, 'https://stream-musik.space/', 'already prevented keyboard events should not trigger a second shortcut action');
}

async function testSleepTimerResetsOnManualStop() {
  const env = createEnvironment({
    missingIds: ['menu-toggle', 'site-nav', 'sticky-player', 'sticky-play', 'back-to-top', 'year']
  });
  const { elements } = env;

  elements['sleep-timer-select'].value = '15';
  await elements['sleep-apply'].dispatch('click');
  assert.match(elements['sleep-remaining'].textContent, /Sleep-Timer aktiv/, 'applying a sleep timer should show a visible countdown state');

  await elements.play.dispatch('click');
  await elements.audio.dispatch('playing');
  await elements.play.dispatch('click');

  assert.equal(elements.audio.paused, true, 'manual stop should still pause the audio');
  assert.equal(elements['sleep-remaining'].textContent, 'Sleep-Timer zurückgesetzt.', 'manual stop should reset the active sleep timer');
}

async function testFavoritesCanBeAddedAndRemovedLocally() {
  const env = createEnvironment({
    fetch: async (url) => {
      if (url.endsWith('/current_song')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Mitternacht',
            artist: { name: 'jackdarckart' }
          })
        };
      }
      if (url.endsWith('/last_songs')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 0 }) };
      }
      if (url.endsWith('/next_artists') || url.endsWith('/schedule')) {
        return { ok: true, json: async () => ([]) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  await env.elements['favorite-track'].dispatch('click');
  assert.equal(env.elements['favorites-list'].children.length, 1, 'current track should be storable as a local favorite');
  assert.match(env.window.localStorage.getItem('jackdarckart-favorites'), /Mitternacht/, 'favorites should be persisted in localStorage');

  await env.elements['favorite-track'].dispatch('click');
  assert.equal(env.elements['favorites-list'].children.length, 0, 'clicking the favorite action again should remove the current favorite');
  assert.equal(env.elements['favorites-empty'].hidden, false, 'empty state should return once all favorites are removed');
}

async function testCurrentTrackCanBeCopiedToClipboard() {
  const env = createEnvironment({
    fetch: async (url) => {
      if (url.endsWith('/current_song')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Mitternacht',
            artist: { name: 'jackdarckart' },
            album: 'Night Tape'
          })
        };
      }
      if (url.endsWith('/last_songs') || url.endsWith('/schedule') || url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 0 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  await env.elements['copy-track'].dispatch('click');
  assert.equal(env.getClipboardText(), 'jackdarckart – Mitternacht · Night Tape', 'copy current track should include artist, title and album when available');
  assert.match(env.elements['share-status'].textContent, /Zwischenablage kopiert/i, 'copy current track should confirm a successful copy');
}

async function testLibraryFilterAndFavoritesCopyStayInSync() {
  const env = createEnvironment({
    fetch: async (url) => {
      if (url.endsWith('/current_song')) {
        return {
          ok: true,
          json: async () => ({
            title: 'Mitternacht',
            artist: { name: 'jackdarckart' },
            album: 'Night Tape'
          })
        };
      }
      if (url.endsWith('/last_songs')) {
        return {
          ok: true,
          json: async () => ([
            {
              title: 'Mitternacht',
              artist: { name: 'jackdarckart' },
              album: 'Night Tape',
              started_at: '2026-09-20T23:55:00+02:00'
            },
            {
              title: 'Sunrise',
              artist: { name: 'Morning Guest' },
              album: 'Daybreak',
              started_at: '2026-09-20T22:55:00+02:00'
            }
          ])
        };
      }
      if (url.endsWith('/schedule') || url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 0 }) };
      }
      return { ok: true, json: async () => ({ name: 'jackdarckart' }) };
    }
  });

  await flushMicrotasks();

  await env.elements['favorite-track'].dispatch('click');
  env.elements['library-filter'].value = 'sunrise';
  await env.elements['library-filter'].dispatch('input');

  assert.equal(env.elements['history-list'].children.length, 1, 'library filter should narrow the visible history list');
  assert.equal(env.elements['favorites-list'].children.length, 0, 'library filter should hide favorites that do not match');
  assert.equal(env.elements['favorites-copy'].disabled, true, 'favorites copy should disable itself when the active filter hides all favorites');
  assert.match(env.elements['library-summary'].textContent, /Filter aktiv: 0 Favoriten · 1 Historieneinträge/, 'library summary should reflect the filtered result counts');

  await env.elements['favorites-copy'].dispatch('click');
  assert.match(env.elements['favorite-status'].textContent, /keine Favoriten/i, 'copying favorites with a non-matching filter should explain the empty result');

  await env.elements['library-filter-clear'].dispatch('click');
  assert.equal(env.elements['history-list'].children.length, 2, 'clearing the filter should restore the full history list');
  assert.equal(env.elements['favorites-list'].children.length, 1, 'clearing the filter should restore visible favorites');

  await env.elements['favorites-copy'].dispatch('click');
  assert.match(env.getClipboardText(), /jackdarckart – Mitternacht · Night Tape/, 'favorites copy should export the visible favorite list as plain text');
}

async function testSameOriginProxyConfigurationIsUsedWhenProvided() {
  const fetchedUrls = [];
  const env = createEnvironment({
    appConfig: {
      lautFm: {
        proxyBase: './api/lautfm/station/jackdarckart'
      }
    },
    fetch: async (url) => {
      fetchedUrls.push(url);
      if (url.endsWith('/schedule') || url.endsWith('/last_songs') || url.endsWith('/next_artists')) {
        return { ok: true, json: async () => ([]) };
      }
      if (url.endsWith('/listeners')) {
        return { ok: true, json: async () => ({ listeners: 4 }) };
      }
      return { ok: true, json: async () => ({ title: 'Proxy Song', artist: { name: 'Proxy Artist' } }) };
    }
  });

  await flushMicrotasks();

  assert.ok(fetchedUrls.some((url) => url === 'https://stream-musik.space/api/lautfm/station/jackdarckart/current_song'), 'same-origin proxy base should be used for API requests when configured');
  assert.match(env.elements['live-data-source'].textContent, /Same-Origin-Proxy/i, 'UI should disclose when a real proxy path is configured');
}

async function testEmptyStatesExplainHowSectionsAreMaintained() {
  const env = createEnvironment();

  const eventsEmpty = env.elements['events-list'].children[0];
  const archiveEmpty = env.elements['archive-list'].children[0];

  assert.equal(eventsEmpty.children[0].textContent, 'Derzeit sind keine kommenden Live-Events eingetragen.', 'events empty state should start with a clear title');
  assert.match(eventsEmpty.children[2].textContent, /APP_CONFIG\.content\.events/, 'events empty state should explain where entries are configured');
  assert.equal(archiveEmpty.children[4].className, 'empty-state-details', 'archive empty state should include a collapsible preparation hint');
}

async function testFeedbackUsesHonestFallbacksAndValidation() {
  const env = createEnvironment();

  assert.equal(env.elements['feedback-email'].disabled, true, 'email action should stay disabled without configured address');

  env.elements['feedback-subject'].value = 'Songwunsch';
  env.elements['feedback-message'].value = 'Bitte spiele einen ruhigen Night-Track.';
  await env.elements['feedback-email'].dispatch('click');
  assert.match(env.elements['feedback-status'].textContent, /keine Mailadresse/i, 'UI should honestly explain when no email target is configured');

  env.elements['feedback-kind'].value = 'feedback';
  env.elements['feedback-subject'].value = 'Kurzes Feedback';
  env.elements['feedback-message'].value = 'Bitte mehr nächtliche Sets.';
  await env.elements['feedback-issue'].dispatch('click');

  assert.match(env.getOpenedUrl(), /title=Feedback%3A%20Kurzes%20Feedback/, 'issue fallback should prepare a GitHub issue with encoded content');
  assert.equal(env.getOpenedWindow().opener, null, 'issue fallback should defensively clear opener on returned window handles');
}

async function testFeedbackUsesConfiguredMailtoTarget() {
  const env = createEnvironment({
    appConfig: {
      content: {
        contact: {
          email: 'radio@example.com'
        }
      }
    }
  });

  env.elements['feedback-kind'].value = 'song';
  env.elements['feedback-subject'].value = 'Night Track';
  env.elements['feedback-message'].value = 'Bitte spiele Night Track im nächsten Set.';
  await env.elements['feedback-email'].dispatch('click');

  assert.equal(env.elements['feedback-email'].disabled, false, 'email action should become available when a configured address exists');
  assert.match(env.window.location.href, /^mailto:radio@example\.com\?subject=/, 'mailto flow should keep the mailbox path readable and encode only query values');
}

function testAllHtmlPagesExposeSharedNavigationAndMetadata() {
  for (const file of htmlPages) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const siteNavMatch = html.match(/<nav class="site-nav" id="site-nav" aria-label="Hauptnavigation">([\s\S]*?)<\/nav>/);
    const footerNavMatch = html.match(/<nav class="footer-nav" aria-label="Footer-Navigation">([\s\S]*?)<\/nav>/);
    const expectedHref = pageHrefByFile[file];
    assert.match(html, /<nav class="site-nav" id="site-nav" aria-label="Hauptnavigation">/, `${file} should include the shared main navigation`);
    assert.match(html, /<nav class="footer-nav" aria-label="Footer-Navigation">/, `${file} should include the shared footer navigation`);
    assert.match(html, /<meta name="description" content="[^"]+"/, `${file} should define its own meta description`);
    assert.match(html, /<link rel="canonical" href="https:\/\/stream-musik\.space\//, `${file} should include a canonical URL`);
    assert.match(html, /<meta property="og:image" content="https:\/\/stream-musik\.space\/assets\/social-preview\.png">/, `${file} should keep the shared social preview image`);
    assert.ok(siteNavMatch, `${file} should expose a parsable main navigation section`);
    assert.ok(footerNavMatch, `${file} should expose a parsable footer navigation section`);
    assert.match(siteNavMatch[1], /href="\.\/issue-hilfe\.html"/, `${file} should expose the shared issue-help entry in the main navigation`);
    assert.match(siteNavMatch[1], /href="\.\/converter\.html"/, `${file} should expose the shared converter-studio entry in the main navigation`);
    assert.match(footerNavMatch[1], /href="\.\/issue-hilfe\.html"/, `${file} should expose the shared issue-help entry in the footer navigation`);
    assert.match(footerNavMatch[1], /href="\.\/converter\.html"/, `${file} should expose the shared converter-studio entry in the footer navigation`);
    assert.equal((siteNavMatch[1].match(/aria-current="page"/g) || []).length, 1, `${file} should mark exactly one active link in the main navigation`);
    assert.equal((footerNavMatch[1].match(/aria-current="page"/g) || []).length, 1, `${file} should mark exactly one active link in the footer navigation`);
    assert.match(siteNavMatch[1], new RegExp(`<a href="${escapeRegExp(expectedHref)}"[^>]*aria-current="page"`), `${file} should mark its own page link as active in the main navigation`);
    assert.match(footerNavMatch[1], new RegExp(`<a href="${escapeRegExp(expectedHref)}"[^>]*aria-current="page"`), `${file} should mark its own page link as active in the footer navigation`);
    if (file !== 'index.html') {
      assert.match(html, /<nav class="breadcrumbs" aria-label="Breadcrumb">/, `${file} should include breadcrumbs`);
    }
  }
}

function testStickyPlayerCssKeepsPlayerWithinViewport() {
  assert.match(
    stylesCode,
    /:root\s*\{[\s\S]*--sticky-bottom-space:\s*clamp\(/,
    'layout should reserve a responsive sticky-player bottom safe area via CSS variable'
  );
  assert.match(
    stylesCode,
    /body\s*\{[\s\S]*padding-bottom:\s*var\(--sticky-bottom-space\);/,
    'page body should reserve sticky-player space so controls are not clipped by viewport bottom overlays'
  );
  assert.match(
    stylesCode,
    /\.sticky-player\s*\{[\s\S]*--sticky-edge:\s*max\([^;]*safe-area-inset-left[^;]*safe-area-inset-right[^;]*\);[\s\S]*left:\s*var\(--sticky-edge\);[\s\S]*right:\s*var\(--sticky-edge\);[\s\S]*width:\s*min\(36rem,\s*calc\(100vw - \(var\(--sticky-edge\) \* 2\)\)\);/,
    'sticky player should compute viewport-safe insets and width from safe-area edges to stay fully visible'
  );
  assert.match(
    stylesCode,
    /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.sticky-player\s*\{[\s\S]*width:\s*calc\(100vw - \(var\(--sticky-edge\) \* 2\)\);[\s\S]*max-width:\s*calc\(100vw - \(var\(--sticky-edge\) \* 2\)\);[\s\S]*\}[\s\S]*\.sticky-player-actions\s*\{[\s\S]*grid-template-columns:\s*1fr;/,
    'mobile sticky player should use full safe viewport width and stack quick actions into one column'
  );
  assert.match(
    stylesCode,
    /@media \(max-height:\s*540px\)\s*\{[\s\S]*\.sticky-player\s*\{[\s\S]*bottom:\s*max\(0\.45rem,\s*env\(safe-area-inset-bottom,\s*0px\)\);[\s\S]*min-height:\s*3\.4rem;/,
    'short viewports should tighten sticky-player bottom spacing and height to keep actions visible'
  );
  assert.match(
    stylesCode,
    /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.subpanel-head,\s*\.compact-head\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*\}[\s\S]*\.subpanel-label\s*\{[\s\S]*max-width:\s*100%;/,
    'mobile live subpanel headings should wrap endpoint labels instead of overflowing narrow viewports'
  );
  assert.match(
    stylesCode,
    /\.subpanel-label code\s*\{[\s\S]*overflow-wrap:\s*anywhere;/,
    'inline endpoint labels should be allowed to wrap instead of forcing horizontal overflow'
  );
}

async function testStickyPlayerUsesPrimaryControlsForVisibility() {
  const env = createEnvironment();
  env.window.scrollY = 320;
  env.window.innerHeight = 780;
  env.elements.status.getBoundingClientRect = () => ({ top: 80, bottom: 140 });
  env.elements.play.getBoundingClientRect = () => ({ top: -120, bottom: -40 });

  await env.window.dispatch('scroll');

  assert.equal(
    env.elements['sticky-player'].classList.contains('is-visible'),
    true,
    'sticky player should appear once the main play control has scrolled out of view, even if the status block is still visible'
  );
}

function testLivePageExposesEnhancedModulesAndHooks() {
  for (const hook of [
    'favorite-track',
    'copy-track',
    'favorite-status',
    'favorites-list',
    'favorites-empty',
    'favorites-clear',
    'favorites-copy',
    'history-list',
    'history-empty',
    'history-source',
    'schedule-highlight',
    'schedule-list',
    'schedule-source',
    'platform-links',
    'station-profile-title',
    'station-profile-description',
    'station-profile-meta',
    'station-profile-link',
    'station-profile-listeners',
    'station-profile-next-artists',
    'station-profile-image',
    'station-profile-image-wrap',
    'station-profile-image-fallback'
  ]) {
    const escapedHook = hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      liveHtmlCode,
      new RegExp(`id\\s*=\\s*["']${escapedHook}["']`),
      `live page should expose ${hook} for the redesigned live modules`
    );
  }

  assert.match(
    liveHtmlCode,
    /class\s*=\s*["'](?=[^"']*\bcontent-columns\b)(?=[^"']*\blive-insights-grid\b)[^"']*["']/,
    'live page should include the responsive insights grid layout'
  );
}

function testConverterPageExposesStudioHooksAndLoader() {
  for (const hook of [
    'converter-file-input',
    'converter-auto-enhance',
    'converter-preview-toggle',
    'converter-render-button',
    'converter-download-button',
    'converter-cleanup-timer',
    'converter-waveform',
    'converter-spectrum',
    'converter-vault-button',
    'converter-vault-status'
  ]) {
    const escapedHook = hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      converterHtmlCode,
      new RegExp(`id\\s*=\\s*["']${escapedHook}["']`),
      `converter page should expose ${hook} for the studio workflow`
    );
  }

  assert.match(
    converterHtmlCode,
    /2-Minuten-Cleanup|2:00-Cleanup|2-Minuten-Cleanup-Phase/,
    'converter page should explain the explicit 2-minute privacy cleanup flow'
  );
  assert.match(
    converterHtmlCode,
    /MP3 steht standardmäßig lokal im Browser bereit[\s\S]*browserabhängig[\s\S]*nativer Unterstützung/i,
    'converter page should describe available, browser-dependent and unavailable export paths'
  );
  assert.equal(
    (converterHtmlCode.match(/id="converter-format-select"/g) || []).length,
    1,
    'converter page should expose exactly one export-format select control'
  );
  assert.doesNotMatch(
    converterHtmlCode,
    /<option value="mp3">/i,
    'converter page should not hardcode MP3 export options in static HTML because native support is detected at runtime'
  );
  assert.match(
    converterHtmlCode,
    /Phase 27\.3/i,
    'converter page should clearly label the vault integration as a Phase 27.3 dependency'
  );
  assert.match(
    converterJsCode,
    /CLEANUP_WINDOW_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/,
    'converter studio should retain rendered files for exactly two minutes before automatic cleanup'
  );
  assert.match(
    converterJsCode,
    /class VaultSyncAdapterStub/,
    'converter studio should keep the vault sync integration as an explicit stub instead of faking storage'
  );
  assert.match(
    appCode,
    /converter\.html[\s\S]*assets\/vendor\/lame\.min\.js[\s\S]*converter\.js|converter\.js[\s\S]*assets\/vendor\/lame\.min\.js[\s\S]*converter\.html/,
    'app.js should preload the bundled local MP3 encoder before lazily loading converter.js for converter.html'
  );
  assert.match(
    appCode,
    /delete promises\[(?:config\.src|src)\][\s\S]*optional-page-module-load-failed/,
    'app.js should clear failed optional page-module script loads so later navigations can retry them'
  );
  assert.match(
    appCode,
    /OPTIONAL_PAGE_MODULE_STATUS_KEY[\s\S]*status\[src\]\s*=\s*\{\s*loaded:\s*true,\s*error:\s*''\s*\}[\s\S]*status\[src\]\s*=\s*\{\s*loaded:\s*false,\s*error:\s*'optional-page-module-load-failed'\s*\}/,
    'app.js should track optional page-module preload success and failure so converter.js can distinguish a missing bundled MP3 encoder asset from a working load'
  );
  assert.match(
    swCode,
    /['"]\.\/converter\.js['"]/,
    'service worker should precache converter.js for the studio page'
  );
  assert.match(
    swCode,
    /['"]\.\/assets\/vendor\/lame\.min\.js['"]/,
    'service worker should precache the bundled local MP3 encoder for the studio page'
  );
  assert.match(
    converterJsCode,
    /leftDirect\.gain\.value = \(1 \+ width\) \* 0\.5[\s\S]*leftCross\.gain\.value = \(1 - width\) \* 0\.5/,
    'converter studio should keep a stereo-width mapping where 100 percent preserves the original stereo image'
  );
}


async function testConverterMp3FormatExposureAndDefaults() {
  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === 'audio/mpeg' || mimeType === 'audio/webm;codecs=opus';
    }
  }

  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: FakeMediaRecorder
  });
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should expose MP3 when the browser reports native MP3 encoder support');
  assert.match(env.elements['converter-format-select'].innerHTML, /value="wav"/, 'converter studio should keep WAV export available alongside MP3');

  env.elements['converter-format-select'].value = 'mp3';
  await env.elements['converter-format-select'].dispatch('change');

  assert.equal(env.elements['converter-bitrate-select'].value, '192000', 'MP3 export should default to the standard compressed export bitrate in the browser UI');
  assert.equal(env.elements['converter-bitrate-select'].disabled, false, 'MP3 export should keep bitrate selection enabled');
  assert.match(env.elements['converter-format-note'].textContent, /192 kbps/i, 'MP3 helper text should disclose the standard compressed export default');

  env.elements['converter-format-select'].value = 'webm-opus';
  await env.elements['converter-format-select'].dispatch('change');

  assert.equal(env.elements['converter-bitrate-select'].value, '192000', 'switching away from MP3 should restore the standard compressed export bitrate');
}

function testConverterOpusFormatExposureMatchesMimeSupport() {
  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === 'audio/ogg;codecs=opus';
    }
  }

  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: FakeMediaRecorder
  });
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(env.elements['converter-format-select'].innerHTML, /value="wav"/, 'converter studio should always expose WAV');
  assert.doesNotMatch(env.elements['converter-format-select'].innerHTML, /value="webm-opus"/, 'converter studio should hide unsupported WebM/Opus export');
  assert.match(env.elements['converter-format-select'].innerHTML, /value="ogg-opus"/, 'converter studio should expose Ogg/Opus only when the browser supports that mime type');
}

async function testConverterMp3FormatExposureWithBundledLocalEncoder() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  loadBundledMp3Encoder(env);
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(env.elements['converter-format-select'].innerHTML, /value="wav"/, 'converter studio should still expose WAV when the bundled MP3 encoder is available');
  assert.match(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should expose MP3 by default when the bundled local encoder is loaded');

  env.elements['converter-format-select'].value = 'mp3';
  await env.elements['converter-format-select'].dispatch('change');

  assert.match(env.elements['converter-format-note'].textContent, /MP3 ist lokal verfügbar/i, 'converter studio should explain that MP3 is locally available when the bundled encoder is loaded');
  assert.match(env.elements['converter-format-note'].textContent, /lokaler MP3-Encoder im App-Bundle/i, 'converter studio should disclose that the bundled local encoder powers MP3 export');
}

async function testConverterMp3BundledLocalEncoderRenderFallbackWithoutNativeMimeSupport() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  loadBundledMp3Encoder(env);
  const OriginalMp3Encoder = env.context.lamejs.Mp3Encoder;
  let encoderSetup = null;
  env.context.lamejs.Mp3Encoder = function WrappedMp3Encoder(channels, sampleRate, bitrateKbps) {
    encoderSetup = { channels, sampleRate, bitrateKbps };
    return new OriginalMp3Encoder(channels, sampleRate, bitrateKbps);
  };
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  const blob = await studio._renderMp3ExportForTest({
    sampleRate: 44100,
    numberOfChannels: 2,
    length: 1152,
    getChannelData(channelIndex) {
      const samples = new Float32Array(1152);
      samples[1] = channelIndex === 0 ? 0.5 : -0.5;
      samples[2] = channelIndex === 0 ? -0.25 : 0.25;
      return samples;
    }
  }, 200000);

  assert.equal(blob.type, 'audio/mpeg', 'converter studio should render a real MP3 blob through the bundled local encoder when native MP3 mime support is absent');
  assert.ok(blob.size > 0, 'converter studio should emit non-empty MP3 output through the bundled local encoder');
  await assertBlobStartsWithMp3Header(blob, 'converter studio should validate that bundled local encoder output begins with a real MP3 header');
  assert.deepEqual(encoderSetup, { channels: 2, sampleRate: 44100, bitrateKbps: 192 }, 'converter studio should keep using normalizeMp3BitrateKbps for bundled local MP3 rendering');
  assert.equal(env.getRecorderMimeType(), '', 'converter studio should fall back to the bundled local encoder instead of MediaRecorder when native MP3 support is unavailable');
}

async function testConverterMp3FormatExposureWithLocalEncoderAdapter() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  const encodedCalls = [];
  env.window.__JACKDARCKART_MP3_ENCODER__ = {
    async encode(options) {
      encodedCalls.push(options);
      return createValidMp3Blob(options.mimeType, 96);
    }
  };
  env.context.__JACKDARCKART_MP3_ENCODER__ = env.window.__JACKDARCKART_MP3_ENCODER__;
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should expose MP3 when a local encoder adapter is registered');
  env.elements['converter-format-select'].value = 'mp3';
  await env.elements['converter-format-select'].dispatch('change');
  assert.match(env.elements['converter-format-note'].textContent, /lokaler MP3-Encoder/i, 'converter studio should disclose the local encoder route in the helper text');

  const blob = await studio._renderMp3ExportForTest({
    sampleRate: 44100,
    numberOfChannels: 1,
    length: 4,
    getChannelData() {
      return new Float32Array([0, 0.25, -0.25, 0]);
    }
  }, 256000);

  assert.equal(blob.type, 'audio/mpeg', 'converter studio should normalize local adapter output to an MP3 blob');
  await assertBlobStartsWithMp3Header(blob, 'converter studio should reject invalid adapter output and keep only MP3-shaped blobs');
  assert.equal(encodedCalls.length, 1, 'converter studio should call the registered local MP3 encoder once');
  assert.equal(encodedCalls[0].bitrate, 256000, 'converter studio should forward the selected bitrate to the local MP3 encoder');
}

function testConverterMp3FilenameUsesMp3Extension() {
  const env = createConverterEnvironment();
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();

  assert.equal(
    studio._buildRenderedFilenameForTest(
      { name: 'Mein Sommer Mix.final.wav' },
      { id: 'mp3', extension: 'mp3' }
    ),
    'Mein-Sommer-Mix-final-master.mp3',
    'converter studio should build rendered MP3 downloads with a sanitized base name and mp3 extension'
  );
}

async function testConverterMp3FormatExposureWithSameOriginConverter() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  const fetchCalls = [];
  env.window.__JACKDARCKART_CONFIG__ = {
    converter: {
      mp3Export: {
        serverEndpoint: '/api/converter/mp3'
      }
    }
  };
  env.context.__JACKDARCKART_CONFIG__ = env.window.__JACKDARCKART_CONFIG__;
  env.window.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async blob() {
        return createValidMp3Blob('audio/mpeg', 96);
      }
    };
  };
  env.context.fetch = env.window.fetch;
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should expose MP3 when a same-origin converter is configured');
  env.elements['converter-format-select'].value = 'mp3';
  await env.elements['converter-format-select'].dispatch('change');
  assert.match(env.elements['converter-format-note'].textContent, /Same-Origin-Konverter/i, 'converter studio should disclose the same-origin converter route in the helper text');

  const blob = await studio._renderMp3ExportForTest({
    sampleRate: 48000,
    numberOfChannels: 2,
    length: 4,
    getChannelData(channelIndex) {
      return channelIndex === 0
        ? new Float32Array([0, 0.25, -0.25, 0])
        : new Float32Array([0, -0.25, 0.25, 0]);
    }
  }, 224000);

  assert.equal(blob.type, 'audio/mpeg', 'converter studio should accept MP3 blobs from the same-origin converter');
  await assertBlobStartsWithMp3Header(blob, 'converter studio should validate same-origin MP3 responses before treating them as downloadable output');
  assert.equal(fetchCalls.length, 1, 'converter studio should perform one same-origin conversion request per MP3 render');
  assert.equal(fetchCalls[0].url, '/api/converter/mp3', 'converter studio should post rendered WAV data to the configured same-origin endpoint');
  assert.equal(fetchCalls[0].options.headers['X-Converter-Bitrate'], '224000', 'converter studio should send the requested MP3 bitrate to the same-origin converter');
}

async function testConverterMp3BundledEncoderFailureStaysUnavailable() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  env.window.__JACKDARCKART_OPTIONAL_PAGE_MODULE_STATUS__ = {
    './assets/vendor/lame.min.js': { loaded: false, error: 'optional-page-module-load-failed' }
  };
  env.context.__JACKDARCKART_OPTIONAL_PAGE_MODULE_STATUS__ = env.window.__JACKDARCKART_OPTIONAL_PAGE_MODULE_STATUS__;
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.doesNotMatch(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should keep MP3 hidden when the bundled encoder asset failed to load');
  assert.match(env.elements['converter-format-note'].textContent, /lame\.min\.js fehlt oder ist nicht erreichbar/i, 'converter studio should explain that MP3 is unavailable because the bundled encoder asset could not be loaded');
  await assert.rejects(
    studio._renderMp3ExportForTest(
      {
        sampleRate: 44100,
        numberOfChannels: 1,
        length: 44100,
        getChannelData() {
          return new Float32Array(44100);
        }
      },
      192000
    ),
    /MP3-Export ist derzeit nicht verfügbar[\s\S]*Bitte nutze WAV oder warte auf nativen MP3-Support/i,
    'converter studio should fail loudly with a user-facing fallback message when the bundled encoder asset is missing'
  );
}

async function testConverterRejectsBrokenBundledEncoderOutput() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  env.window.__JACKDARCKART_OPTIONAL_PAGE_MODULE_STATUS__ = {
    './assets/vendor/lame.min.js': { loaded: true, error: '' }
  };
  env.context.__JACKDARCKART_OPTIONAL_PAGE_MODULE_STATUS__ = env.window.__JACKDARCKART_OPTIONAL_PAGE_MODULE_STATUS__;
  env.window.lamejs = {
    Mp3Encoder: function BrokenMp3Encoder() {
      return {
        encodeBuffer() {
          return new Uint8Array([0x00, 0x01, 0x02, 0x03]);
        },
        flush() {
          return new Uint8Array();
        }
      };
    }
  };
  env.context.lamejs = env.window.lamejs;
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.doesNotMatch(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should hide MP3 when the bundled encoder probe cannot produce a valid MP3 header');
  assert.match(env.elements['converter-format-note'].textContent, /erzeugt aber keine gültigen MP3-Daten/i, 'converter studio should explain when the bundled encoder loads but fails validation');
}

async function testConverterMp3FallbackMessageWhenNativeSupportMissing() {
  class FakeMediaRecorder {
    static isTypeSupported() {
      return false;
    }
  }

  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: FakeMediaRecorder
  });
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.doesNotMatch(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should hide MP3 when the browser cannot produce native MP3 output');
  assert.match(
    env.elements['converter-format-note'].textContent,
    /MP3 ist derzeit nicht verfügbar, weil weder ein nativer Browser-Encoder noch ein lokaler MP3-Encoder oder Same-Origin-Konverter erkannt wurde/i,
    'converter studio should explain clearly why MP3 is currently unavailable while WAV remains available'
  );
  await assert.rejects(
    studio._recordCompressedExportForTest(
      { sampleRate: 44100 },
      { id: 'mp3', mimeType: 'audio/mpeg', extension: 'mp3' },
      320000
    ),
    /MP3-Export ist in diesem Browser nicht nativ verfügbar/,
    'converter studio should surface a clear MP3-specific fallback message when native support is unavailable'
  );
}

async function testConverterNativeMp3MimeDetectionSupportsAlternateMimeTypes() {
  const env = createConverterEnvironment();

  class FakeSource {
    constructor() {
      this.listeners = new Map();
    }

    connect() {}

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      const endedListener = this.listeners.get('ended');
      if (endedListener) {
        endedListener();
      }
    }
  }

  class FakeAudioContext {
    createBufferSource() {
      return new FakeSource();
    }

    createMediaStreamDestination() {
      return { stream: {} };
    }

    async resume() {}

    async close() {
      env.markAudioContextClosed();
    }
  }

  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === 'audio/mp3';
    }

    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      this.listeners = new Map();
      env.setRecorderMimeType(options.mimeType);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      const dataListener = this.listeners.get('dataavailable');
      if (dataListener) {
        dataListener({ data: createValidMp3Blob(this.options.mimeType, 128) });
      }
      const stopListener = this.listeners.get('stop');
      if (stopListener) {
        stopListener();
      }
    }
  }

  env.window.AudioContext = FakeAudioContext;
  env.window.MediaRecorder = FakeMediaRecorder;
  env.context.MediaRecorder = FakeMediaRecorder;

  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should expose MP3 when an alternate native MP3 mime type is supported');

  const blob = await studio._renderMp3ExportForTest(
    { sampleRate: 44100 },
    192000
  );

  assert.equal(blob.type, 'audio/mp3', 'converter studio should render native MP3 exports with the detected supported mime type');
  await assertBlobStartsWithMp3Header(blob, 'converter studio should validate alternate native MP3 mime outputs before returning them');
  assert.equal(env.getRecorderMimeType(), 'audio/mp3', 'converter studio should pass the detected alternate MP3 mime type into MediaRecorder');
}

async function testConverterFormatRefreshClearsUnavailableSelection() {
  let supportedMimeTypes = new Set(['audio/mpeg', 'audio/webm;codecs=opus']);

  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return supportedMimeTypes.has(mimeType);
    }
  }

  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: FakeMediaRecorder
  });
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  env.elements['converter-format-select'].value = 'mp3';
  await env.elements['converter-format-select'].dispatch('change');
  assert.equal(env.elements['converter-bitrate-select'].disabled, false, 'converter studio should keep bitrate selection active while MP3 is available');

  supportedMimeTypes = new Set();
  studio._refreshExportFormatsForTest();

  assert.equal(env.elements['converter-format-select'].value, 'wav', 'converter studio should fall back to WAV when the previous compressed format is no longer available');
  assert.doesNotMatch(env.elements['converter-format-select'].innerHTML, /value="mp3"/, 'converter studio should remove MP3 from the format list after support disappears');
  assert.equal(env.elements['converter-bitrate-select'].disabled, true, 'converter studio should disable bitrate selection after falling back to WAV');
  assert.match(
    env.elements['converter-format-note'].textContent,
    /MP3 ist derzeit nicht verfügbar, weil weder ein nativer Browser-Encoder noch ein lokaler MP3-Encoder oder Same-Origin-Konverter erkannt wurde/i,
    'converter studio should explain the missing MP3 prerequisite after capability refresh'
  );
  assert.match(
    env.elements['converter-format-note'].textContent,
    /WebM \/ Opus ist browserabhängig und in diesem Browser derzeit nicht verfügbar/i,
    'converter studio should explain browser-dependent Opus availability after capability refresh'
  );
}

async function testConverterMp3CompressedExportPath() {
  const env = createConverterEnvironment();

  class FakeSource {
    constructor() {
      this.listeners = new Map();
    }

    connect() {}

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      const endedListener = this.listeners.get('ended');
      if (endedListener) {
        endedListener();
      }
    }
  }

  class FakeAudioContext {
    createBufferSource() {
      return new FakeSource();
    }

    createMediaStreamDestination() {
      return { stream: {} };
    }

    async resume() {}

    async close() {
      env.markAudioContextClosed();
    }
  }

  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === 'audio/mpeg';
    }

    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      this.listeners = new Map();
      env.setRecorderMimeType(options.mimeType);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      const dataListener = this.listeners.get('dataavailable');
      if (dataListener) {
        dataListener({ data: createValidMp3Blob(this.options.mimeType, 128) });
      }
      const stopListener = this.listeners.get('stop');
      if (stopListener) {
        stopListener();
      }
    }
  }

  env.window.AudioContext = FakeAudioContext;
  env.window.MediaRecorder = FakeMediaRecorder;
  env.context.MediaRecorder = FakeMediaRecorder;

  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  const blob = await studio._recordCompressedExportForTest(
    { sampleRate: 44100 },
    { id: 'mp3', mimeType: 'audio/mpeg', extension: 'mp3' },
    320000
  );

  assert.equal(blob.type, 'audio/mpeg', 'MP3 export should resolve an MP3 blob when native browser encoding is available');
  await assertBlobStartsWithMp3Header(blob, 'MP3 export should only resolve blobs that begin with a valid MP3 header');
  assert.equal(env.getRecorderMimeType(), 'audio/mpeg', 'MP3 export should initialize MediaRecorder with the detected MP3 mime type');
  assert.equal(env.getClosedAudioContexts(), 1, 'MP3 export should close its temporary audio context after recording completes');
}

function testConverterDownloadClearsTemporaryAsset() {
  const env = createConverterEnvironment();
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();
  studio._seedRenderedAssetForTest({
    blob: new Blob(['demo'], { type: 'audio/wav' }),
    filename: 'demo-master.wav',
    report: {
      outputApproxLufs: -12,
      peakAfter: 0.5
    },
    format: {
      id: 'wav',
      extension: 'wav'
    },
    sampleRate: 44100
  });

  assert.equal(studio._hasRenderedAssetForTest(), true, 'converter studio should keep a rendered asset in temporary memory before download');

  studio._downloadRenderedFileForTest();
  env.runTimersByDelay(250);

  assert.equal(env.getClickedDownloads(), 1, 'converter studio should trigger one local download click for the rendered asset');
  assert.equal(studio._hasRenderedAssetForTest(), false, 'converter studio should clear the temporary rendered asset immediately after download starts');
  assert.equal(env.getRevokedUrl(), 'blob:converter-test', 'converter studio should revoke the generated blob URL after cleanup');
}

async function testConverterCompressedExportPath() {
  const env = createConverterEnvironment();

  class FakeSource {
    constructor() {
      this.listeners = new Map();
    }

    connect() {}

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      const endedListener = this.listeners.get('ended');
      if (endedListener) {
        endedListener();
      }
    }
  }

  class FakeAudioContext {
    createBufferSource() {
      return new FakeSource();
    }

    createMediaStreamDestination() {
      return { stream: {} };
    }

    async resume() {}

    async close() {
      env.markAudioContextClosed();
    }
  }

  class FakeMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === 'audio/webm;codecs=opus';
    }

    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      this.listeners = new Map();
      env.setRecorderMimeType(options.mimeType);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';
      const dataListener = this.listeners.get('dataavailable');
      if (dataListener) {
        dataListener({ data: new Blob(['encoded'], { type: this.options.mimeType }) });
      }
      const stopListener = this.listeners.get('stop');
      if (stopListener) {
        stopListener();
      }
    }
  }

  env.window.AudioContext = FakeAudioContext;
  env.window.MediaRecorder = FakeMediaRecorder;
  env.context.MediaRecorder = FakeMediaRecorder;

  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  const blob = await studio._recordCompressedExportForTest(
    { sampleRate: 44100 },
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    192000
  );

  assert.equal(blob.type, 'audio/webm;codecs=opus', 'compressed export should resolve a blob using the requested codec mime type');
  assert.equal(env.getRecorderMimeType(), 'audio/webm;codecs=opus', 'compressed export should initialize MediaRecorder with the selected codec');
  assert.equal(env.getClosedAudioContexts(), 1, 'compressed export should close its temporary audio context after recording completes');
}

async function testConverterCompressedExportFailureClosesAudioContext() {
  const env = createConverterEnvironment();

  class FakeSource {
    connect() {}
    addEventListener() {}
    start() {}
  }

  class FakeAudioContext {
    createBufferSource() {
      return new FakeSource();
    }

    createMediaStreamDestination() {
      return { stream: {} };
    }

    async resume() {}

    async close() {
      env.markAudioContextClosed();
    }
  }

  class FailingMediaRecorder {
    static isTypeSupported(mimeType) {
      return mimeType === 'audio/webm;codecs=opus';
    }

    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      env.setRecorderMimeType(options.mimeType);
    }

    addEventListener() {}

    start() {
      throw new Error('encoder failed');
    }
  }

  env.window.AudioContext = FakeAudioContext;
  env.window.MediaRecorder = FailingMediaRecorder;
  env.context.MediaRecorder = FailingMediaRecorder;

  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  await assert.rejects(
    studio._recordCompressedExportForTest(
      { sampleRate: 44100 },
      { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
      192000
    ),
    /Encoder nicht starten/,
    'compressed export should reject when the encoder start path throws synchronously'
  );
  assert.equal(env.getClosedAudioContexts(), 1, 'compressed export should still close the temporary audio context when encoder startup fails');
}

function testServiceWorkerCachesAllHtmlPages() {
  for (const file of htmlPages) {
    assert.match(swCode, new RegExp(`['"]${escapeRegExp('./' + file)}['"]`), `service worker should precache ${file}`);
  }
  assert.match(swCode, /function isStaticPageRequest\(request, url\)/, 'service worker should centralize app-shell page detection');
  assert.match(swCode, /request\.mode === 'navigate'/, 'service worker should handle navigations explicitly');
  assert.match(swCode, /STATIC_PAGE_PATHS\.has\(url\.pathname\)/, 'service worker should also recognize static page fetches beyond browser navigation mode');
  assert.match(swCode, /scheduleCachePut\(event, normalizedPageUrl, responseClone\)/, 'navigation responses should be cached under a stable page key');
  assert.match(swCode, /caches\.match\(normalizedPageUrl\)/, 'offline navigation should try the normalized cached page first');
  assert.match(swCode, /OFFLINE_FALLBACK_URL/, 'service worker should keep an explicit offline fallback entry point');
}

async function testServiceWorkerServesCachedStaticPageRequestsOffline() {
  const cacheStorage = createCacheStorage({
    'https://stream-musik.space/live.html': { status: 200, type: 'basic', text: async () => '<main id="content">offline</main>' }
  });
  const listeners = new Map();
  const selfObject = {
    location: new URL('https://stream-musik.space/sw.js'),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    skipWaiting() {},
    clients: {
      claim() {}
    }
  };
  const context = vm.createContext({
    self: selfObject,
    caches: cacheStorage,
    fetch: async () => {
      throw new Error('offline');
    },
    URL,
    Promise,
    console
  });

  vm.runInContext(swCode, context, { filename: 'sw.js' });

  let responsePromise = null;
  listeners.get('fetch')({
    request: {
      method: 'GET',
      url: 'https://stream-musik.space/live.html',
      mode: 'same-origin',
      destination: ''
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    }
  });

  const response = await responsePromise;
  assert.ok(response, 'service worker should answer page-like requests while offline');
  assert.equal(await response.text(), '<main id="content">offline</main>', 'service worker should return the cached static page response when the network is unavailable');
}

async function testServiceWorkerExtendsFetchLifetimeForCacheWrites() {
  const listeners = new Map();
  let putCalls = 0;
  const waitUntilPromises = [];
  const selfObject = {
    location: new URL('https://stream-musik.space/sw.js'),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    skipWaiting() {},
    clients: {
      claim() {}
    }
  };
  const context = vm.createContext({
    self: selfObject,
    caches: {
      async open() {
        return {
          async add() {},
          async put() {
            putCalls += 1;
          }
        };
      },
      async match() {
        return null;
      },
      async keys() {
        return ['stream-musik-space-v3'];
      },
      async delete() {
        return true;
      }
    },
    fetch: async () => ({
      status: 200,
      type: 'basic',
      clone() {
        return this;
      }
    }),
    URL,
    Promise,
    console
  });

  vm.runInContext(swCode, context, { filename: 'sw.js' });

  let responsePromise = null;
  listeners.get('fetch')({
    request: {
      method: 'GET',
      url: 'https://stream-musik.space/live.html?utm=autotest',
      mode: 'navigate',
      destination: 'document'
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
    waitUntil(promise) {
      waitUntilPromises.push(Promise.resolve(promise));
    }
  });

  const response = await responsePromise;
  assert.ok(response, 'service worker should still return the network response while scheduling cache writes');
  assert.equal(waitUntilPromises.length, 1, 'service worker should extend fetch lifetime while writing navigation responses to cache');
  await Promise.all(waitUntilPromises);
  assert.equal(putCalls, 1, 'service worker should persist exactly one cache write for a successful page response');
}

async function testServiceWorkerIgnoresCacheWriteFailures() {
  const listeners = new Map();
  const waitUntilPromises = [];
  const selfObject = {
    location: new URL('https://stream-musik.space/sw.js'),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    skipWaiting() {},
    clients: {
      claim() {}
    }
  };
  const context = vm.createContext({
    self: selfObject,
    caches: {
      async open() {
        return {
          async add() {},
          async put() {
            throw new Error('quota-exceeded');
          }
        };
      },
      async match() {
        return null;
      },
      async keys() {
        return ['stream-musik-space-v3'];
      },
      async delete() {
        return true;
      }
    },
    fetch: async () => ({
      status: 200,
      type: 'basic',
      clone() {
        return this;
      }
    }),
    URL,
    Promise,
    console
  });

  vm.runInContext(swCode, context, { filename: 'sw.js' });

  let responsePromise = null;
  listeners.get('fetch')({
    request: {
      method: 'GET',
      url: 'https://stream-musik.space/live.html?utm=quota',
      mode: 'navigate',
      destination: 'document'
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
    waitUntil(promise) {
      waitUntilPromises.push(Promise.resolve(promise));
    }
  });

  const response = await responsePromise;
  assert.ok(response, 'cache write failures should not prevent the service worker from returning the successful network response');
  await Promise.all(waitUntilPromises);
}

function testIssueHelpPageAndTemplatesArePresent() {
  const issueHelpHtml = fs.readFileSync(path.join(__dirname, '..', 'issue-hilfe.html'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const templateDir = path.join(__dirname, '..', '.github', 'ISSUE_TEMPLATE');
  const templateConfig = fs.readFileSync(path.join(templateDir, 'config.yml'), 'utf8');

  assert.match(issueHelpHtml, /<link rel="canonical" href="https:\/\/stream-musik\.space\/issue-hilfe\.html">/, 'issue help page should define its canonical URL');
  assert.match(issueHelpHtml, /issues\/new\?template=bug_report\.md/, 'issue help page should link to the bug template');
  assert.match(issueHelpHtml, /issues\/new\?template=feature_request\.md/, 'issue help page should link to the feature template');
  assert.match(issueHelpHtml, /issues\/new\?template=content_request\.md/, 'issue help page should link to the content template');
  assert.match(issueHelpHtml, /issues\/new\?template=design_ux_improvement\.md/, 'issue help page should link to the design and UX template');
  assert.match(issueHelpHtml, /issues\/new\?template=api_realtime_problem\.md/, 'issue help page should link to the API template');
  assert.match(issueHelpHtml, /\.\/issue-hilfe\.html" aria-current="page" class="is-current"/, 'issue help page should mark its own navigation link as current');
  for (const hook of ['live-data-status', 'live-data-updated', 'live-data-source', 'live-data-refresh']) {
    assert.match(issueHelpHtml, new RegExp(`id=\"${escapeRegExp(hook)}\"`), `issue help page should keep the shared app.js hook ${hook}`);
  }
  assert.match(readme, /Mitwirken über GitHub Issues/, 'README should document the GitHub issue workflow');

  assert.match(templateConfig, /blank_issues_enabled:\s*false/, 'issue template config should disable blank issues');
  assert.match(templateConfig, /name:\s*GitHub-Issue-Hilfe auf stream-musik\.space/, 'issue template config should link to the website issue help');
  assert.match(templateConfig, /url:\s*https:\/\/stream-musik\.space\/issue-hilfe\.html/, 'issue template config should point to the issue help page');

  for (const file of ['bug_report.md', 'feature_request.md', 'content_request.md', 'design_ux_improvement.md', 'api_realtime_problem.md']) {
    const template = fs.readFileSync(path.join(templateDir, file), 'utf8');
    assert.match(template, /^---[\s\S]*?name:\s+/m, `${file} should define a template name in front matter`);
    assert.match(template, /^---[\s\S]*?description:\s+/m, `${file} should define a template description in front matter`);
    assert.match(template, /^---[\s\S]*?title:\s+/m, `${file} should define a default title in front matter`);
    assert.match(template, /## /, `${file} should contain structured markdown sections`);
    assert.match(template, /verifiz/i, `${file} should emphasize verified information`);
  }
}

async function main() {
  testStickyPlayerCssKeepsPlayerWithinViewport();
  testLivePageExposesEnhancedModulesAndHooks();
  testConverterPageExposesStudioHooksAndLoader();
  await testConverterMp3FormatExposureAndDefaults();
  testConverterOpusFormatExposureMatchesMimeSupport();
  await testConverterMp3FormatExposureWithBundledLocalEncoder();
  await testConverterMp3FormatExposureWithLocalEncoderAdapter();
  testConverterMp3FilenameUsesMp3Extension();
  await testConverterMp3FormatExposureWithSameOriginConverter();
  await testConverterMp3BundledEncoderFailureStaysUnavailable();
  await testConverterRejectsBrokenBundledEncoderOutput();
  await testConverterMp3FallbackMessageWhenNativeSupportMissing();
  await testConverterMp3BundledLocalEncoderRenderFallbackWithoutNativeMimeSupport();
  await testConverterNativeMp3MimeDetectionSupportsAlternateMimeTypes();
  await testConverterFormatRefreshClearsUnavailableSelection();
  await testConverterMp3CompressedExportPath();
  testConverterDownloadClearsTemporaryAsset();
  await testConverterCompressedExportPath();
  await testConverterCompressedExportFailureClosesAudioContext();
  testAllHtmlPagesExposeSharedNavigationAndMetadata();
  testServiceWorkerCachesAllHtmlPages();
  await testServiceWorkerServesCachedStaticPageRequestsOffline();
  await testServiceWorkerExtendsFetchLifetimeForCacheWrites();
  await testServiceWorkerIgnoresCacheWriteFailures();
  testIssueHelpPageAndTemplatesArePresent();
  testUsesStationSpecificHttpsStreamUrl();
  testAppProvidesPersistentInternalNavigationShell();
  await testInternalNavigationPreservesAudioAcrossPages();
  await testInternalNavigationAcceptsValidShellPagesWithoutDomParser();
  await testInternalNavigationFallsBackToCachedPageWhenOffline();
  await testNavigateHelperUsesHistoryPushStateByDefault();
  await testPopstateNavigationRewritesDocumentWithoutPushingHistory();
  await testReplaceNavigationUsesHistoryReplaceState();
  await testReusesExistingSourceWithoutForcedReload();
  await testMissingOptionalElementsDoNotCrashInitialization();
  await testMissingAudioElementShowsGuardedErrorState();
  await testMuteButtonRestoresAudiblePlaybackFromZeroVolume();
  await testOfficialLautFmApiIsUsedForLiveMetadata();
  await testThemeSelectionUpdatesDatasetAndThemeColor();
  await testOfflineRecoveryShowsDedicatedRetryAction();
  await testApiFailuresShowHonestFallbackState();
  await testPreviousHistoryStaysVisibleAfterRefreshFailure();
  await testCurrentSongSurvivesAuxiliaryMetadataFailure();
  await testKeyboardShortcutsRespectInteractiveTargets();
  await testSleepTimerResetsOnManualStop();
  await testFavoritesCanBeAddedAndRemovedLocally();
  await testCurrentTrackCanBeCopiedToClipboard();
  await testLibraryFilterAndFavoritesCopyStayInSync();
  await testSameOriginProxyConfigurationIsUsedWhenProvided();
  await testScheduleUsesOfficialApiEntriesForLiveAndNext();
  await testScheduleFilterCanLimitUpcomingAgenda();
  await testScheduleWeekFilterTreatsSundayAsWeekEnd();
  await testEmptyStatesExplainHowSectionsAreMaintained();
  await testFeedbackUsesHonestFallbacksAndValidation();
  await testFeedbackUsesConfiguredMailtoTarget();
  await testStickyPlayerUsesPrimaryControlsForVisibility();
  console.log('app.js player tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
