const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

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

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
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

  focus() {}

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

  const allIds = [...ids, ...(options.extraIds || [])];
  for (const id of allIds) {
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
  if (elements['endpoint-input']) {
    elements['endpoint-input'].value = '';
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
    'converter-auto-enhance-undo',
    'converter-auto-enhance-toggle',
    'converter-auto-enhance-strength',
    'converter-auto-enhance-strength-hint',
    'converter-enhance-status',
    'converter-enhance-findings',
    'converter-enhance-steps',
    'converter-enhance-score',
    'converter-enhance-score-bar',
    'converter-enhance-score-note',
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
    'converter-render-progress',
    'converter-cleanup-timer',
    'converter-cleanup-state',
    'converter-analysis-summary',
    'converter-waveform',
    'converter-spectrum',
    'converter-cloud-auth-form',
    'converter-cloud-handle',
    'converter-cloud-password',
    'converter-cloud-register',
    'converter-cloud-logout',
    'converter-cloud-account',
    'converter-cloud-save',
    'converter-cloud-load',
    'converter-cloud-status',
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
  elements['converter-auto-enhance-toggle'].checked = true;
  elements['converter-auto-enhance-strength'].value = 'balanced';
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
    fetch: options.fetch,
    __JACKDARCKART_CONFIG__: options.config,
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
    if (file === 'index.html') {
      assert.match(html, /href=["']\.\/game\.html["']/, 'homepage should expose the dedicated Quantum Vault entry point');
    } else {
      assert.doesNotMatch(html, /href=["']\.\/game\.html["']|Singularity Arcade|Arcade Game/i,
        `${file} should remain independent from the dedicated game`);
    }
    assert.equal((siteNavMatch[1].match(/aria-current="page"/g) || []).length, 1, `${file} should mark exactly one active link in the main navigation`);
    assert.equal((footerNavMatch[1].match(/aria-current="page"/g) || []).length, 1, `${file} should mark exactly one active link in the footer navigation`);
    assert.match(siteNavMatch[1], new RegExp(`<a href="${escapeRegExp(expectedHref)}"[^>]*aria-current="page"`), `${file} should mark its own page link as active in the main navigation`);
    assert.match(footerNavMatch[1], new RegExp(`<a href="${escapeRegExp(expectedHref)}"[^>]*aria-current="page"`), `${file} should mark its own page link as active in the footer navigation`);
    if (file !== 'index.html') {
      assert.match(html, /<nav class="breadcrumbs" aria-label="Breadcrumb">/, `${file} should include breadcrumbs`);
    }
  }
}

function testQuantumVaultGameIntegration() {
  const gameHtml = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');
  const gameJs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(gameHtml, /<title>Singularity Arcade — Quantum Vault<\/title>/);
  assert.match(gameHtml, /id="login-form"/);
  assert.match(gameHtml, /id="register-form"/);
  assert.match(gameHtml, /id="save-button"/);
  assert.match(gameHtml, /id="leaderboard"/);
  assert.match(gameHtml, /data-action="harvest"/);
  assert.match(gameHtml, /data-upgrade="resonator"/);
  assert.match(gameHtml, /data-node="singularity"/);
  assert.match(gameHtml, /data-track="zero-point"/);
  assert.match(gameHtml, /<script src="\.\/game\.js" defer><\/script>/);
  assert.doesNotMatch(gameHtml, /<script[^>]*src="\.\/app\.js"/, 'game page should remain isolated from the radio shell');
  assert.doesNotMatch(gameJs, /localStorage|sessionStorage|userId|accountId/,
    'game client must not use browser persistence or submit account identifiers');
  assert.match(gameJs, /credentials:\s*'include'/);
  assert.match(gameHtml, /connect-src 'self' https:\/\/vault\.stream-musik\.space/);
  assert.match(swCode, /stream-musik-space-v9/, 'cache version bump must invalidate cached game and converter scripts');
  assert.match(gameHtml, /Cloudflare-Cookie/);
  assert.match(gameHtml, /Passwort-Hash \(PBKDF2\)/);
  assert.match(gameJs, /error\.status\s*=\s*response\.status/);
  assert.match(gameJs, /generation\s*!==\s*authGeneration/);
  assert.match(gameJs, /error\.status\s*===\s*401/);
  assert.match(gameJs, /if\s*\(authPending\)\s*return/);
  ['INVALID_CREDENTIALS', 'HANDLE_TAKEN', 'HANDLE_INVALID', 'PASSWORD_INVALID', 'RATE_LIMITED',
    'SESSION_REQUIRED', 'VAULT_OFFLINE', 'NETWORK', 'INTERNAL_ERROR'].forEach((code) => {
    assert.match(gameJs, new RegExp(`\\b${code}:\\s*('|SESSION_EXPIRED)`), `game client should map ${code} to a German message`);
  });
  assert.doesNotMatch(gameJs, /Vault ist nicht erreichbar\./,
    'game client should replace the generic vault error with actionable guidance');
  assert.match(gameJs, /payload\.code/, 'game client should read structured server error codes');
  assert.match(gameJs, /application\\\/json/, 'non-JSON responses should be treated as an offline vault server');
  ['register-handle-hint', 'register-password-hint'].forEach((id) => {
    assert.match(gameHtml, new RegExp(`aria-describedby="${id}"`), `${id} should describe its register input`);
    assert.match(gameHtml, new RegExp(`id="${id}"`), `${id} should exist`);
  });
  ['login-handle', 'login-password', 'register-handle', 'register-password'].forEach((id) => {
    assert.match(gameHtml, new RegExp(`<label for="${id}">`), `${id} should have an explicit label`);
  });
  assert.match(gameHtml, /id="auth-message" role="status" aria-live="polite"/);
  assert.match(swCode, /'\.\/game\.html'/);
  assert.match(swCode, /'\.\/game\.js'/);
  assert.match(swCode, /'\.\/game\.css'/);
  assert.match(swCode, /url\.pathname\.startsWith\(new URL\('\.\/api\/quantum-vault'/,
    'service worker must bypass private vault APIs');
  assert.doesNotMatch(appCode, /initGameGateway|APP_CONFIG\.game|game\.stream-musik\.space/i,
    'shared radio app should not contain a parallel game implementation');
  assert.doesNotMatch(stylesCode, /Arcade|game-hero|endpoint-launcher/i,
    'shared styles should remain isolated from the dedicated game');
  assert.match(readme, /server\/quantum-vault\.js/);
}

async function testGameCloudflareCookieFlow() {
  const gameJs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const state = {
    vibeScore: 0, fragments: 0, alloys: 0, revision: 0,
    upgrades: {}, stats: { harvests: 0, forges: 0, upgrades: 0, nodes: 0, manualSaves: 0, autosaves: 0 },
    treeNodes: [], jukebox: []
  };
  for (const [configuredBase, hostname] of [
    [null, 'stream-musik.space'],
    ['https://example.org/api/quantum-vault/', 'stream-musik.space'],
    ['http://example.org/api/quantum-vault', 'stream-musik.space'],
    [null, 'localhost']
  ]) {
    const base = configuredBase?.startsWith('https://')
      ? configuredBase.slice(0, -1)
      : hostname === 'localhost' ? './api/quantum-vault' : 'https://vault.stream-musik.space/api/quantum-vault';
    const calls = [];
    const elements = new Map();
    const getElement = (id) => {
      if (!elements.has(id)) elements.set(id, new MockElement(id));
      return elements.get(id);
    };
    getElement('connection-status').lastChild = { textContent: '' };
    getElement('leaderboard').replaceChildren = () => {};
    getElement('leaderboard').append = () => {};
    for (const id of ['login-form', 'register-form']) {
      const form = getElement(id);
      form.elements = { namedItem: () => null };
      form.reset = () => {};
    }
    const action = getElement('action-harvest');
    action.dataset.action = 'harvest';
    const document = {
      getElementById: getElement,
      createElement: (tag) => new MockElement(tag),
      querySelectorAll(selector) {
        if (selector === '[data-action]') return [action];
        if (selector === '.auth-form') return [getElement('login-form'), getElement('register-form')];
        return [];
      }
    };
    let signedIn = false;
    const fetch = async (url, options) => {
      calls.push({ url, options });
      const route = url.slice(base.length);
      let status = 200;
      let payload = { handle: 'Pilot_One', state };
      if (route === '/session' && !signedIn) {
        status = 401;
        payload = { code: 'SESSION_REQUIRED' };
      } else if (route === '/register' || route === '/login') {
        signedIn = true;
      } else if (route === '/logout') {
        signedIn = false;
        payload = { ok: true };
      } else if (route === '/leaderboard') {
        payload = { leaders: [] };
      }
      return {
        ok: status === 200, status,
        headers: { get: () => 'application/json' },
        json: async () => payload
      };
    };
    const context = vm.createContext({
      window: { location: { hostname }, __JACKDARCKART_CONFIG__: configuredBase ? { game: { apiBase: configuredBase } } : undefined,
        setInterval: () => 1, clearInterval: () => {}, setTimeout: (callback) => callback() },
      document, fetch,
      FormData: class {
        get(field) { return field === 'handle' ? 'Pilot_One' : 'correct-horse-vault'; }
      }
    });
    vm.runInContext(gameJs, context, { filename: 'game.js' });
    await flushStudioTasks();
    assert.equal(calls[0].url, `${base}/session`);
    assert.equal(calls[1].url, `${base}/leaderboard`);
    await getElement('register-form').dispatch('submit');
    await flushStudioTasks();
    assert.equal(getElement('game-shell').hidden, false, 'registration must restore authenticated game state');
    assert.equal((action.listeners.get('click') || []).length, 1, 'game action should be wired');
    await getElement('leaderboard-refresh').dispatch('click');
    await flushStudioTasks();
    assert.equal(calls.filter(({ url }) => url.endsWith('/leaderboard')).length, 3,
      'manual leaderboard refresh should bypass the short-lived cache');
    assert.equal(calls[4].options.cache, 'no-store');
    await getElement('logout-button').dispatch('click');
    await getElement('login-form').dispatch('submit');
    await flushStudioTasks();
    assert.equal(calls.filter(({ url }) => url.endsWith('/leaderboard')).length, 3,
      'login should reuse a fresh public leaderboard response');
    await action.dispatch('click');
    await getElement('save-button').dispatch('click');
    await getElement('logout-button').dispatch('click');
    assert.deepEqual(calls.map(({ url }) => url.slice(base.length)),
      ['/session', '/leaderboard', '/register', '/leaderboard', '/leaderboard', '/logout', '/login', '/action', '/save', '/logout']);
    for (const { options } of calls) {
      assert.equal(options.credentials, 'include', 'every game request must carry the Worker session cookie');
    }
    assert.deepEqual(JSON.parse(calls[2].options.body), { handle: 'Pilot_One', password: 'correct-horse-vault' });
    assert.deepEqual(JSON.parse(calls[7].options.body), { action: 'harvest' });
    assert.deepEqual(JSON.parse(calls[8].options.body), { kind: 'manual' });
    assert.equal(getElement('auth-shell').hidden, false, 'logout should return to the login page');
    await getElement('login-form').dispatch('submit');
    await flushStudioTasks();
    assert.equal(calls[10].url, `${base}/login`);
    assert.equal(calls[10].options.credentials, 'include');
    assert.equal(getElement('game-shell').hidden, false, 'login should restore the game from server state');
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
    'converter-cloud-auth-form',
    'converter-cloud-handle',
    'converter-cloud-password',
    'converter-cloud-register',
    'converter-cloud-logout',
    'converter-cloud-account',
    'converter-cloud-save',
    'converter-cloud-load',
    'converter-cloud-status',
    'converter-auto-enhance-undo',
    'converter-auto-enhance-toggle',
    'converter-auto-enhance-strength',
    'converter-auto-enhance-strength-hint',
    'converter-enhance-status',
    'converter-enhance-findings',
    'converter-enhance-steps',
    'converter-enhance-score',
    'converter-enhance-score-bar',
    'converter-enhance-score-note'
  ]) {
    const escapedHook = hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      converterHtmlCode,
      new RegExp(`id\\s*=\\s*["']${escapedHook}["']`),
      `converter page should expose ${hook} for the studio workflow`
    );
  }

  for (const removedHook of [
    'converter-remote-url',
    'converter-remote-import',
    'converter-suno-download'
  ]) {
    const escaped = removedHook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(
      converterHtmlCode,
      new RegExp(`id\\s*=\\s*["']${escaped}["']`),
      `converter page should not expose removed hook ${removedHook}`
    );
  }

  assert.doesNotMatch(
    converterHtmlCode,
    /Suno|URL importieren|Proxy|CORS|Downloader/i,
    'converter page should not mention Suno, URL import, Proxy, CORS, or Downloader in HTML'
  );

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
  for (const outdated of [/Phase[ -]?27\.3/i, /Vault-Sync/i, /Placeholder/, /\bStub\b/i, /E2EE/i, /converter-vault-/]) {
    assert.doesNotMatch(
      converterHtmlCode,
      outdated,
      `converter page should no longer contain the outdated vault placeholder wording ${outdated}`
    );
    assert.doesNotMatch(
      converterJsCode,
      outdated,
      `converter studio script should no longer contain the outdated vault placeholder wording ${outdated}`
    );
  }
  assert.match(
    converterHtmlCode,
    /Cloud-Sync für Studio-Presets[\s\S]*Cloudflare[\s\S]*Audiodateien und fertigen Renders bleiben immer lokal/,
    'converter page should describe the Cloudflare preset sync honestly and state that audio never leaves the browser'
  );
  assert.match(
    converterHtmlCode,
    /Qualitäts-Check und automatische Verbesserung/,
    'converter page should present the automatic song quality improvement as its own prominent section'
  );
  assert.match(
    converterHtmlCode,
    /id="converter-auto-enhance-toggle"[\s\S]*Automatisch nach dem Laden anwenden/,
    'converter page should explain and expose the automatic-on-import control'
  );
  assert.match(
    converterJsCode,
    /ENHANCE_STRENGTHS\s*=\s*\{[\s\S]*subtle[\s\S]*gentle[\s\S]*balanced[\s\S]*strong[\s\S]*intense[\s\S]*maximum/,
    'converter studio should offer six documented strengths for the automatic quality improvement'
  );
  for (const [value, label] of [
    ['subtle', 'Dezent'], ['gentle', 'Sanft'], ['balanced', 'Ausgewogen'],
    ['strong', 'Kräftig'], ['intense', 'Intensiv'], ['maximum', 'Maximal']
  ]) {
    assert.match(
      converterHtmlCode,
      new RegExp('<option value="' + value + '"[^>]*>' + label + ' – '),
      'converter page should offer the "' + label + '" enhancement strength with a short explanation'
    );
  }
  assert.match(
    converterHtmlCode,
    /id="converter-auto-enhance-strength-hint"/,
    'converter page should explain the selected enhancement strength'
  );
  assert.match(
    converterJsCode,
    /describeProfile\(profile\)/,
    'converter studio should translate the source analysis into readable findings'
  );
  assert.match(
    stylesCode,
    /\.enhance-score-track\[data-tone="alert"\]/,
    'studio styles should visualise the quality score state'
  );
  assert.doesNotMatch(
    converterHtmlCode,
    /\sstyle="/,
    'converter page must not use inline style attributes because the page CSP does not allow unsafe-inline styles'
  );
  assert.match(
    converterJsCode,
    /CLEANUP_WINDOW_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/,
    'converter studio should retain rendered files for exactly two minutes before automatic cleanup'
  );
  assert.match(
    converterJsCode,
    /class CloudflareStudioSyncAdapter[\s\S]*credentials: 'include'/,
    'converter studio should sync presets through the Cloudflare Worker with the HttpOnly session cookie'
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
      return new Blob(['adapter-mp3'], { type: options.mimeType });
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
        return new Blob(['server-mp3'], { type: 'audio/mpeg' });
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
  assert.equal(fetchCalls.length, 1, 'converter studio should perform one same-origin conversion request per MP3 render');
  assert.equal(fetchCalls[0].url, '/api/converter/mp3', 'converter studio should post rendered WAV data to the configured same-origin endpoint');
  assert.equal(fetchCalls[0].options.headers['X-Converter-Bitrate'], '224000', 'converter studio should send the requested MP3 bitrate to the same-origin converter');
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
        dataListener({ data: new Blob(['encoded-alt-mp3'], { type: this.options.mimeType }) });
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
        dataListener({ data: new Blob(['encoded-mp3'], { type: this.options.mimeType }) });
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

async function testConverterLocalFileWorkflowAndAbsenceOfRemoteControls() {
  const env = createConverterEnvironment();
  const wav = Uint8Array.from(Buffer.from('RIFF0000WAVEfmt '));
  const audioBuffer = {
    length: 44100,
    duration: 1,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData() { return new Float32Array([0.2, -0.2]); }
  };
  class FakeSource {
    constructor() {
      this.listeners = new Map();
    }
    connect() {}
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    start() {}
    stop() {}
  }
  class FakeAudioContext {
    createBufferSource() {
      return new FakeSource();
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteFrequencyData() {},
        connect() {}
      };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    createBiquadFilter() {
      return { type: 'lowshelf', frequency: { value: 100 }, gain: { value: 0 }, connect() {} };
    }
    createDynamicsCompressor() {
      return {
        threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 },
        attack: { value: 0.003 }, release: { value: 0.25 }, connect() {}
      };
    }
    decodeAudioData(buffer, resolve) {
      resolve(audioBuffer);
    }
    async resume() {}
    async close() {
      env.markAudioContextClosed();
    }
  }

  env.window.URL = URL;
  env.window.AudioContext = FakeAudioContext;

  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  // Verify remote controls are not present in elements
  assert.equal(env.elements['converter-remote-url'], undefined, 'remote URL input must not exist');
  assert.equal(env.elements['converter-remote-import'], undefined, 'remote import button must not exist');
  assert.equal(env.elements['converter-suno-download'], undefined, 'Suno download button must not exist');

  // Verify initial buttons state
  assert.equal(env.elements['converter-reset-button'].disabled, true);
  assert.equal(env.elements['converter-render-button'].disabled, true);
  assert.equal(env.elements['converter-preview-toggle'].disabled, true);
  assert.equal(env.elements['converter-download-button'].disabled, true);

  // Local file import
  const file = {
    name: 'test-track.wav',
    size: wav.length,
    type: 'audio/wav',
    async arrayBuffer() { return wav.buffer; }
  };
  env.elements['converter-file-input'].files = [file];
  await env.elements['converter-file-input'].dispatch('change');

  assert.equal(env.elements['converter-file-name'].textContent, 'test-track.wav');
  assert.equal(env.elements['converter-file-size'].textContent, `${wav.length} B`);
  assert.equal(env.elements['converter-render-button'].disabled, false);
  assert.equal(env.elements['converter-reset-button'].disabled, false);
  assert.equal(env.elements['converter-preview-toggle'].disabled, false);
  assert.match(env.elements['converter-import-status'].textContent, /lokal/i);
  assert.doesNotMatch(env.elements['converter-import-status'].textContent, /Suno|Proxy|CORS|Downloader|Remote/i);

  // WAV export from decoded audio buffer
  const wavBlob = studio._encodeWavForTest(audioBuffer);
  const wavBytes = Buffer.from(await wavBlob.arrayBuffer());
  assert.equal(wavBytes.toString('ascii', 0, 4), 'RIFF', 'WAV export must generate a valid RIFF file');

  // Store rendered master asset
  studio._seedRenderedAssetForTest({
    blob: wavBlob,
    filename: 'test-track-master.wav',
    report: { outputApproxLufs: -12, peakAfter: 0.5 },
    format: { id: 'wav', extension: 'wav' },
    sampleRate: 44100
  });
  assert.equal(studio._hasRenderedAssetForTest(), true, 'rendering must store a temporary master asset');
  assert.equal(env.elements['converter-download-button'].disabled, false);
  assert.equal(env.elements['converter-clear-render'].disabled, false);

  // Download rendered master
  studio._downloadRenderedFileForTest();
  env.runTimersByDelay(250);
  assert.equal(env.getClickedDownloads(), 1, 'downloading should trigger one click');
  assert.equal(studio._hasRenderedAssetForTest(), false, 'downloading should immediately clear temporary asset');
  assert.equal(env.getRevokedUrl(), 'blob:converter-test', 'downloading should revoke the object URL');

  // Reset studio
  await env.elements['converter-file-input'].dispatch('change');
  assert.equal(env.elements['converter-file-name'].textContent, 'test-track.wav');
  await env.elements['converter-reset-button'].dispatch('click');
  assert.equal(env.elements['converter-file-name'].textContent, '–');
  assert.equal(env.elements['converter-render-button'].disabled, true);
  assert.equal(env.elements['converter-reset-button'].disabled, true);
  assert.equal(env.elements['converter-preview-toggle'].disabled, true);
  assert.equal(studio._hasRenderedAssetForTest(), false);
  assert.match(env.elements['converter-import-status'].textContent, /zurückgesetzt/i);

  // 2-minute cleanup timer regression check
  studio._seedRenderedAssetForTest({
    blob: wavBlob,
    filename: 'test-track-master.wav',
    report: { outputApproxLufs: -12, peakAfter: 0.5 },
    format: { id: 'wav', extension: 'wav' },
    sampleRate: 44100
  });
  assert.equal(studio._hasRenderedAssetForTest(), true);
  env.runTimersByDelay(120000);
  assert.equal(studio._hasRenderedAssetForTest(), false, 'cleanup timer must discard rendered asset after 2 minutes');

  studio.destroy();
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

function createFakeHttps(responder) {
  const requests = [];
  return {
    requests,
    request(options, callback) {
      const request = new EventEmitter();
      const index = requests.length;
      requests.push(options);
      request.end = () => {
        const response = responder(options, index);
        if (!response) return;
        setImmediate(() => callback(response));
      };
      request.destroy = (error) => {
        request.emit('close');
        if (error) request.emit('error', error);
      };
      return request;
    }
  };
}

function createFakeProxyResponse(statusCode, headers, body) {
  const response = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

async function assertProxyError(promise, status, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

async function testRemoteAudioProxyValidatesAndFetchesAudio() {
  const proxy = require('../server/remote-audio-proxy.js');
  const target = 'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp4';
  const mp4 = '0000ftypM4A 0000';
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (typeof options === 'object' && options && options.all) done(null, [{ address: '203.0.113.10', family: 4 }]);
    else done(null, '203.0.113.10', 4);
  };

  for (const unsafe of [
    'http://cdn1.suno.ai/a.mp4', 'data:audio/mp4,abc', 'javascript:alert(1)',
    'blob:https://cdn1.suno.ai/a.mp4', 'https://cdn1.suno.ai:8443/a.mp4',
    'https://localhost/a.mp4', 'https://127.0.0.1/a.mp4', 'https://192.168.1.5/a.mp4',
    'https://[::1]/a.mp4', 'https://router.local/a.mp4',
    'https://cdn1.suno.ai/payload.exe', 'https://evil.example/song.mp4'
  ]) {
    assert.throws(() => proxy.validateTargetUrl(unsafe), /erlaubt|Ungültige|freigegeben/,
      `${unsafe} must be rejected by the proxy allow-list`);
  }
  assert.equal(proxy.validateTargetUrl(target + '#fragment').href, target, 'fragments must be stripped');
  assert.throws(() => proxy.validateTargetUrl('https://' + 'user:secret@' + 'cdn1.suno.ai/a.mp4'),
    /Zugangsdaten/, 'credentialed URLs must be rejected');
  assert.throws(() => proxy.validateTargetUrl('https://evil.example/song.mp3', {
    allowTarget: () => true
  }), /freigegeben/, 'the Suno-only proxy allow-list must not be extensible');

  for (const blocked of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '172.16.4.4', '192.168.0.1',
    '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', 'not-an-ip']) {
    assert.equal(proxy.isBlockedAddress(blocked), true, `${blocked} must be treated as an internal target`);
  }
  assert.equal(proxy.isBlockedAddress('203.0.113.10'), false);
  await assert.rejects(new Promise((resolve, reject) => {
    proxy.safeLookup('localhost', {}, (error, address) => (error ? reject(error) : resolve(address)));
  }), /Interne Netzwerkziele/);

  const audio = await proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4))
  });
  assert.equal(audio.contentType, 'video/mp4');
  assert.equal(audio.body.toString('latin1'), mp4);
  const forwarded = createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4));
  await proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), { lookup, httpsModule: forwarded });
  assert.deepEqual(Object.keys(forwarded.requests[0].headers).sort(), ['accept', 'user-agent'],
    'the proxy must not forward credentials or client headers');

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, 'not-a-real-mp4'))
  }), 502, /MIME\/Dateisignatur/);

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'text/html' }, mp4))
  }), 502, /MIME\/Dateisignatur/);

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, {
      'content-type': 'video/mp4', 'content-length': String(proxy.DEFAULT_MAX_BYTES + 1)
    }, mp4))
  }), 413, /zu groß/);

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup, maxBytes: 4,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4))
  }), 413, /zu groß/);

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup, timeoutMs: 20, httpsModule: createFakeHttps(() => null)
  }), 504, /Zeitlimit/);

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(302, { location: 'https://evil.example/song.mp4' }))
  }), 403, /nicht freigegeben/);

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup, maxRedirects: 0,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(302, { location: 'https://cdn2.suno.ai/other.mp4' }))
  }), 502, /Weiterleitung/);

  const redirected = await proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps((options, index) => (index === 0
      ? createFakeProxyResponse(302, { location: 'https://cdn2.suno.ai/other.mp4' })
      : createFakeProxyResponse(200, { 'content-type': 'audio/mp4' }, mp4)))
  });
  assert.equal(redirected.url, 'https://cdn2.suno.ai/other.mp4', 'allowed redirects must be re-validated and followed');

  await assertProxyError(proxy.fetchRemoteAudio(proxy.validateTargetUrl(target), {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(404, { 'content-type': 'text/plain' }, 'missing'))
  }), 502, /nicht erreichbar/);
}

async function testRemoteAudioProxyHandlerResponses() {
  const proxy = require('../server/remote-audio-proxy.js');
  const target = 'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp4';
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    done(null, '203.0.113.10', 4);
  };
  const handler = proxy.createRemoteAudioProxyHandler({
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, '0000ftypM4A 0000'))
  });
  const call = async (url, method) => {
    const result = { headers: null, status: 0, body: null };
    await handler({ method: method || 'GET', url }, {
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
      },
      end(body) {
        result.body = body;
      }
    });
    return result;
  };

  const success = await call('/api/remote-audio?url=' + encodeURIComponent(target));
  assert.equal(success.status, 200);
  assert.equal(success.headers['Content-Type'], 'video/mp4');
  assert.equal(success.headers['Cache-Control'], 'no-store');
  assert.equal(success.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(success.body.toString('latin1'), '0000ftypM4A 0000');

  assert.equal((await call('/api/remote-audio?url=' + encodeURIComponent(target), 'POST')).status, 405);
  assert.equal((await call('/api/remote-audio')).status, 400);
  assert.equal((await call('/api/remote-audio?url=' + encodeURIComponent('http://cdn1.suno.ai/a.mp4'))).status, 400);
  assert.equal((await call('/api/remote-audio?url=' + encodeURIComponent('https://127.0.0.1/a.mp4'))).status, 403);
  const blocked = await call('/api/remote-audio?url=' + encodeURIComponent('https://evil.example/a.mp4'));
  assert.equal(blocked.status, 403);
  assert.match(JSON.parse(blocked.body).error, /nicht freigegeben/);
}

async function assertDownloaderError(promise, status, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

async function testSunoDownloaderBackendValidationAndFetch() {
  const downloader = require('../server/suno-downloader.js');
  const targetMp4 = 'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp4';
  const targetM4a = 'https://cdn2.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.m4a';
  const targetMp3 = 'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp3';
  const targetSong = 'https://suno.com/song/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c';
  const targetWwwSong = 'https://www.suno.com/song/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c';
  const mp4Bytes = '0000ftypM4A 0000';
  const mp3Bytes = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0, 1, 2]);

  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (typeof options === 'object' && options && options.all) done(null, [{ address: '203.0.113.10', family: 4 }]);
    else done(null, '203.0.113.10', 4);
  };

  // Accepted URLs
  for (const valid of [targetMp4, targetM4a, targetMp3, targetSong, targetWwwSong]) {
    const parsed = downloader.validateSunoUrl(valid);
    assert.equal(parsed.protocol, 'https:');
  }
  assert.equal(downloader.validateSunoUrl(targetMp4 + '#preview').href, targetMp4, 'fragments must be stripped');

  // Candidate resolution
  assert.deepEqual(
    downloader.resolveSunoMediaCandidates(targetMp4).map((u) => u.href),
    [targetMp4],
    'direct CDN media candidates must resolve directly'
  );
  assert.deepEqual(
    downloader.resolveSunoMediaCandidates(targetSong).map((u) => u.href),
    [
      'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp3',
      'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp4'
    ],
    'song share links must resolve to mp3 and mp4 candidate media URLs'
  );

  // Rejected URLs
  for (const unsafe of [
    'http://cdn1.suno.ai/a.mp4', 'data:audio/mp4,abc', 'javascript:alert(1)',
    'blob:https://cdn1.suno.ai/a.mp4', 'https://cdn1.suno.ai:8443/a.mp4',
    'https://localhost/a.mp4', 'https://127.0.0.1/a.mp4', 'https://192.168.1.5/a.mp4',
    'https://[::1]/a.mp4', 'https://router.local/a.mp4',
    'https://cdn1.suno.ai/payload.exe', 'https://evil.example/song.mp4',
    'https://suno.com/explore', 'https://suno.com/s/short-code'
  ]) {
    assert.throws(() => downloader.validateSunoUrl(unsafe), /erlaubt|Ungültige|freigegeben|müssen/,
      `${unsafe} must be rejected by the Suno downloader allow-list`);
  }
  assert.throws(() => downloader.validateSunoUrl('https://' + 'user:secret@' + 'cdn1.suno.ai/a.mp4'),
    /Zugangsdaten/, 'credentialed URLs must be rejected');
  assert.throws(() => downloader.validateSunoUrl('https://evil.example/song.mp3', {
    allowTarget: () => true
  }), /freigegeben/, 'the Suno downloader allow-list must not be extensible');

  // IP Address blocking
  for (const blocked of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '172.16.4.4', '192.168.0.1',
    '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', 'not-an-ip']) {
    assert.equal(downloader.isBlockedAddress(blocked), true, `${blocked} must be treated as an internal target`);
  }
  assert.equal(downloader.isBlockedAddress('203.0.113.10'), false);
  await assert.rejects(new Promise((resolve, reject) => {
    downloader.safeLookup('localhost', {}, (error, address) => (error ? reject(error) : resolve(address)));
  }), /Interne Netzwerkziele/);

  // Successful downloads
  const downloadedMp4 = await downloader.downloadSunoAudio(targetMp4, {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4Bytes))
  });
  assert.equal(downloadedMp4.contentType, 'video/mp4');
  assert.equal(downloadedMp4.body.toString('latin1'), mp4Bytes);

  const downloadedMp3 = await downloader.downloadSunoAudio(targetMp3, {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'audio/mpeg' }, mp3Bytes))
  });
  assert.equal(downloadedMp3.contentType, 'audio/mpeg');

  // Song link resolution: first candidate (mp3) 404, second candidate (mp4) 200
  const downloadedFromSong = await downloader.downloadSunoAudio(targetSong, {
    lookup,
    httpsModule: createFakeHttps((options) => {
      if (options.path.endsWith('.mp3')) return createFakeProxyResponse(404, { 'content-type': 'text/plain' }, 'not found');
      return createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4Bytes);
    })
  });
  assert.equal(downloadedFromSong.contentType, 'video/mp4');
  assert.equal(downloadedFromSong.url, 'https://cdn1.suno.ai/4c1f8738-f62e-4fa4-bd86-afe9d24b4d7c.mp4');

  // Headers check (no credentials forwarded)
  const forwarded = createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4Bytes));
  await downloader.downloadSunoAudio(targetMp4, { lookup, httpsModule: forwarded });
  assert.deepEqual(Object.keys(forwarded.requests[0].headers).sort(), ['accept', 'user-agent'],
    'the downloader must not forward credentials or arbitrary client headers');

  // Validation failures: MIME / signature
  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, 'not-real-mp4'))
  }), 502, /MIME\/Dateisignatur/);

  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'text/html' }, mp4Bytes))
  }), 502, /MIME\/Dateisignatur/);

  // Size limit enforcement
  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, {
      'content-type': 'video/mp4', 'content-length': String(downloader.DEFAULT_MAX_BYTES + 1)
    }, mp4Bytes))
  }), 413, /zu groß/);

  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup, maxBytes: 4,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4Bytes))
  }), 413, /zu groß/);

  // Timeout enforcement
  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup, timeoutMs: 20, httpsModule: createFakeHttps(() => null)
  }), 504, /Zeitlimit/);

  // Redirect to non-Suno target
  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(302, { location: 'https://evil.example/song.mp4' }))
  }), 403, /nicht freigegeben/);

  // Max redirects limit
  await assertDownloaderError(downloader.downloadSunoAudio(targetMp4, {
    lookup, maxRedirects: 0,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(302, { location: 'https://cdn2.suno.ai/other.mp4' }))
  }), 502, /Weiterleitung/);

  // Valid redirect followed
  const redirected = await downloader.downloadSunoAudio(targetMp4, {
    lookup,
    httpsModule: createFakeHttps((options, index) => (index === 0
      ? createFakeProxyResponse(302, { location: 'https://cdn2.suno.ai/other.mp4' })
      : createFakeProxyResponse(200, { 'content-type': 'audio/mp4' }, mp4Bytes)))
  });
  assert.equal(redirected.url, 'https://cdn2.suno.ai/other.mp4');

  // HTTP Handler
  const handler = downloader.createSunoDownloaderHandler({
    lookup,
    httpsModule: createFakeHttps(() => createFakeProxyResponse(200, { 'content-type': 'video/mp4' }, mp4Bytes))
  });
  const call = async (url, method) => {
    const result = { headers: null, status: 0, body: null };
    await handler({ method: method || 'GET', url }, {
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
      },
      end(body) {
        result.body = body;
      }
    });
    return result;
  };

  const handlerSuccess = await call('/api/suno-downloader?url=' + encodeURIComponent(targetMp4));
  assert.equal(handlerSuccess.status, 200);
  assert.equal(handlerSuccess.headers['Content-Type'], 'video/mp4');
  assert.equal(handlerSuccess.headers['Cache-Control'], 'no-store');
  assert.equal(handlerSuccess.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(handlerSuccess.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(handlerSuccess.body.toString('latin1'), mp4Bytes);

  assert.equal((await call('/api/suno-downloader?url=' + encodeURIComponent(targetMp4), 'POST')).status, 405);
  assert.equal((await call('/api/suno-downloader')).status, 400);
  assert.equal((await call('/api/suno-downloader?url=' + encodeURIComponent('http://cdn1.suno.ai/a.mp4'))).status, 400);
  assert.equal((await call('/api/suno-downloader?url=' + encodeURIComponent('https://127.0.0.1/a.mp4'))).status, 403);
  assert.equal((await call('/api/suno-downloader?url=' + encodeURIComponent('https://evil.example/a.mp4'))).status, 403);

  const probeGet = await call('/api/suno-downloader?probe=1');
  assert.equal(probeGet.status, 200);
  assert.match(probeGet.headers['Content-Type'], /^application\/json/);
  assert.deepEqual(JSON.parse(probeGet.body.toString()), { status: 'ok', service: 'suno-downloader' });

  const probeHead = await call('/api/suno-downloader', 'HEAD');
  assert.equal(probeHead.status, 200);
  assert.match(probeHead.headers['Content-Type'], /^application\/json/);
}

async function testConverterAdaptiveEnhance() {
  const env = createConverterEnvironment();
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();
  const core = studio._coreForTest;
  const sampleRate = 44100;
  const length = sampleRate;
  const tone = (frequency, amplitude) => Float32Array.from({ length }, (_, i) =>
    Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude);
  const buffer = (left, right) => ({
    length, sampleRate, duration: 1, numberOfChannels: right ? 2 : 1,
    getChannelData(index) { return index ? right : left; }
  });
  const bass = core.analyzeSource(buffer(tone(120, 0.4)));
  const bright = core.analyzeSource(buffer(tone(5000, 0.4)));
  assert.ok(bass.bassTiltDb > bright.bassTiltDb, 'bass and bright material need different spectral profiles');
  assert.ok(bright.brightnessDb > bass.brightnessDb);
  assert.ok(bright.harshness, 'upper-mid energy should trigger artifact cleaning');
  assert.ok(core.chooseEnhancement(bright).artifactCleaner.presenceCut < 0);
  assert.ok(core.chooseEnhancement(bright).eqHigh < core.chooseEnhancement(bass).eqHigh);
  assert.ok(core.chooseEnhancement(bright).eqLow > core.chooseEnhancement(bass).eqLow);
  const clipping = core.analyzeSource(buffer(tone(120, 1)));
  assert.ok(clipping.clippingRatio > 0.001);
  const clippingSettings = core.chooseEnhancement(clipping);
  assert.ok(clippingSettings.compRatio <= 1.6, 'clipped sources must only be compressed gently');
  assert.ok(clippingSettings.limiterCeiling <= -2, 'heavy clipping should lower the limiter ceiling noticeably');
  const left = tone(5000, 0.4);
  const phasey = core.analyzeSource(buffer(left, left.map((value) => -value)));
  assert.ok(phasey.phasey);
  const phaseyWidth = core.chooseEnhancement(phasey).stereoWidth;
  assert.ok(phaseyWidth < 70 && phaseyWidth >= 40, 'phase problems should narrow the stereo image clearly but not collapse it');
  const brittle = core.chooseEnhancement({ ...bright, brittle: true, crestDb: 18 });
  assert.equal(brittle.artifactCleaner.softenTransients, true);
  const silent = core.analyzeSource(buffer(new Float32Array(length)));
  assert.equal(silent.harshness, false);
  assert.equal(silent.clippingRatio, 0);
  assert.equal(silent.rumble, false);
  assert.throws(() => core.analyzeSource(buffer(Float32Array.from({ length }, (_, i) => (i === 10 ? NaN : 0.1)))), /Ungültige/);

  // Smarter weighting: clean material is scored high and only nudged,
  // poor material is scored low and corrected noticeably harder.
  const cleanMix = Float32Array.from({ length }, (_, i) => (
    Math.sin(2 * Math.PI * 90 * i / sampleRate) * 0.12
    + Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.1
    + Math.sin(2 * Math.PI * 1200 * i / sampleRate) * 0.06
    + Math.sin(2 * Math.PI * 3000 * i / sampleRate) * 0.02
    + Math.sin(2 * Math.PI * 9000 * i / sampleRate) * 0.006
  ) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * i / sampleRate)));
  const cleanRight = Float32Array.from(cleanMix, (value, i) => value * 0.9 + 0.02 * Math.sin(2 * Math.PI * 660 * i / sampleRate));
  const clean = core.analyzeSource(buffer(cleanMix, cleanRight));
  assert.equal(clean.channelCount, 2);
  assert.ok(Number.isFinite(clean.gatedLoudnessDb) && Number.isFinite(clean.loudnessRangeDb));
  const cleanScore = core.scoreProfile(clean);
  assert.ok(cleanScore >= 80, 'a clean mix should score as good (got ' + cleanScore + ')');
  assert.ok(cleanScore > core.scoreProfile(bright) && core.scoreProfile(bright) > core.scoreProfile(clipping),
    'score must rank clean > harsh > clipped');
  assert.ok(core.scoreProfile(phasey) < core.scoreProfile(bright), 'phase problems must lower the score further');
  assert.strictEqual(core.assessProfile(clean), core.assessProfile(clean), 'assessment must be cached per profile');
  const cleanSettings = core.chooseEnhancement(clean);
  assert.equal(cleanSettings.artifactCleaner, null, 'clean material must not trigger artifact cleaning');
  assert.ok(cleanSettings.insight.intensity < clippingSettings.insight.intensity,
    'correction intensity must adapt to the source quality');
  assert.ok(cleanSettings.insight.intensity < 0.8, 'clean sources should be processed conservatively');
  assert.ok(clippingSettings.insight.intensity > 1.1, 'poor sources should be processed more strongly');
  assert.ok(clippingSettings.insight.projectedScore > clippingSettings.insight.score,
    'the projected score must show a visible improvement for poor sources');
  const brightSettings = core.chooseEnhancement(bright);
  const strongBright = core.chooseEnhancement(bright, { strength: 1.4 });
  assert.ok(strongBright.artifactCleaner.presenceCut < brightSettings.artifactCleaner.presenceCut,
    'a higher strength should deepen the ringing cut');
  assert.ok(brightSettings.artifactCleaner.presenceCut <= -2.5, 'harsh sources need a clearly audible ringing cut');
  // Finer and stronger strengths: weak sources scale up to "maximal", clean
  // sources stay conservative even at the highest setting.
  const strengthFactors = [0.35, 0.6, 1, 1.4, 1.75, 2.1];
  const brightAmounts = strengthFactors.map((factor) => core.chooseEnhancement(bright, { strength: factor }).insight.intensity);
  brightAmounts.slice(1).forEach((value, index) => {
    assert.ok(value > brightAmounts[index], 'every higher strength must correct a weak source more strongly');
  });
  const maxBright = core.chooseEnhancement(bright, { strength: 2.1 });
  assert.ok(maxBright.artifactCleaner.presenceCut <= -7, 'maximal strength must apply a deep ringing cut on harsh sources');
  assert.ok(maxBright.insight.intensity >= 2, 'maximal strength must clearly exceed the balanced correction on weak sources');
  const maxClean = core.chooseEnhancement(clean, { strength: 2.1 });
  assert.ok(maxClean.insight.intensity < 1, 'even maximal strength must stay conservative on clean sources');
  assert.ok(maxClean.insight.intensity - cleanSettings.insight.intensity
    < maxBright.insight.intensity - brightSettings.insight.intensity,
  'the extra push of high strengths must depend on how much the source needs it');
  assert.equal(maxClean.artifactCleaner, null, 'clean sources must not get artifact cleaning at any strength');
  assert.ok(brightSettings.insight.intensity > 1.1, 'balanced must correct harsh sources noticeably');
  assert.ok(clippingSettings.insight.intensity > 1.3, 'balanced must correct clipped sources clearly');
  assert.ok(clippingSettings.artifactCleaner && clippingSettings.artifactCleaner.highCut < 0,
    'heavy clipping should smooth the distorted top end');
  assert.ok(clippingSettings.eqHigh < core.chooseEnhancement(bass).eqHigh,
    'clipped sources must not receive the full air lift');
  assert.deepEqual(core.chooseEnhancement(bright), brightSettings, 'enhancements must be deterministic and cached');
  assert.notStrictEqual(core.chooseEnhancement(bright), brightSettings, 'cached enhancements must be returned as copies');
  const mutated = core.chooseEnhancement(bright);
  mutated.artifactCleaner.presenceCut = 0;
  assert.ok(core.chooseEnhancement(bright).artifactCleaner.presenceCut < 0, 'callers must not be able to corrupt the cache');
  const dynamic = core.chooseEnhancement({ ...clean, loudnessRangeDb: 22 });
  assert.ok(dynamic.compRatio > cleanSettings.compRatio, 'very dynamic sources should be compressed harder');
  assert.ok(core.describeProfile({ ...clean, loudnessRangeDb: 22 }).some((finding) => finding.label === 'Sehr große Dynamik'));
  const quietRight = Float32Array.from(cleanMix, (value) => value * 0.3);
  const unbalanced = core.analyzeSource(buffer(cleanMix, quietRight));
  assert.ok(unbalanced.balanceDb > 9, 'channel imbalance should be measured');
  assert.ok(core.scoreProfile(unbalanced) < core.scoreProfile(clean));
  assert.equal(core.describeProfile(unbalanced).find((finding) => finding.id === 'balance').tone, 'alert');
  const unbalancedSettings = core.chooseEnhancement(unbalanced);
  assert.ok(unbalancedSettings.artifactCleaner.balanceTrim > 3, 'a louder left channel must be trimmed towards the right');
  assert.ok(unbalancedSettings.insight.projectedScore > core.scoreProfile(unbalanced), 'balance correction should improve the projection');
  assert.match(core.summarizeEnhancement(unbalancedSettings).join(' '), /Kanalausgleich \d+\.\d dB zugunsten rechts/);
  const widthGains = [];
  const gainNode = () => { const item = { gain: {}, connect() {} }; widthGains.push(item); return item; };
  core.createStereoWidthStage({ createChannelSplitter: gainNode, createChannelMerger: gainNode, createGain: gainNode }, 100, 2, 6);
  const [, , leftDirect, rightDirect] = widthGains;
  assert.ok(leftDirect.gain.value < 1 && rightDirect.gain.value > 1, 'balance trim must be applied inside the width stage');
  const rumbling = core.analyzeSource(buffer(Float32Array.from(cleanMix, (value, i) => value + 0.08 + 0.2 * Math.sin(2 * Math.PI * 15 * i / sampleRate))));
  assert.equal(rumbling.rumble, true, 'DC offset and sub-sonic energy should be detected');
  assert.equal(core.chooseEnhancement(rumbling).artifactCleaner.rumbleCut, 30);
  const maxRumble = core.chooseEnhancement(rumbling, { strength: 2.1 }).artifactCleaner.rumbleCut;
  assert.ok(maxRumble > 30 && maxRumble <= 40, 'higher strengths should tighten the rumble filter within safe limits');
  assert.ok(core.describeProfile(rumbling).some((finding) => finding.id === 'rumble'));
  assert.match(core.summarizeEnhancement(core.chooseEnhancement(rumbling)).join(' '), /Rumpel-Filter unter 30 Hz/);

  const created = [];
  const node = () => {
    const item = { frequency: {}, gain: {}, Q: {}, threshold: {}, knee: {}, ratio: {},
      attack: {}, release: {}, connect() {} };
    created.push(item);
    return item;
  };
  const context = {
    createGain: node, createBiquadFilter: node, createDynamicsCompressor: node,
    createWaveShaper: node, createAnalyser: node
  };
  core.createPreviewChain(context, core.chooseEnhancement(bright), node(), 1);
  assert.ok(created.some((item) => item.type === 'peaking' && item.frequency.value === 4400 && item.gain.value < 0),
    'preview/render chain should insert a distinct ringing cut when indicated');
  created.length = 0;
  core.createPreviewChain(context, brittle, node(), 1);
  assert.ok(created.some((item) => item.attack.value === 0.003),
    'brittle transients should receive faster compression');
  created.length = 0;
  core.createPreviewChain(context, core.chooseEnhancement(bass), node(), 1);
  assert.equal(created.some((item) => item.frequency.value === 4400), false);
  assert.equal(created.some((item) => item.type === 'highpass'), false);
  created.length = 0;
  core.createPreviewChain(context, core.chooseEnhancement(rumbling), node(), 1);
  assert.ok(created.some((item) => item.type === 'highpass' && item.frequency.value === 30),
    'rumble cleaning should insert a high-pass filter into preview/render');

  const source = buffer(left);
  env.window.AudioContext = class FakeAudioContext {
    decodeAudioData(data, resolve) { resolve(source); }
    async close() {}
  };
  const file = { name: 'bright.wav', size: 10, type: 'audio/wav', async arrayBuffer() { return new ArrayBuffer(10); } };
  env.elements['converter-file-input'].files = [file];
  await env.elements['converter-file-input'].dispatch('change');
  await env.elements['converter-auto-enhance'].dispatch('click');
  assert.match(env.elements['converter-render-status'].textContent, /quellenabhängig.*Artefakt/);
  assert.ok(studio._settingsForTest().artifactCleaner, 'cleaner must be shared by preview and render');
  assert.match(env.elements['converter-analysis-summary'].innerHTML, /Quellenprofil/);
  core.createOfflineContext = () => ({
    ...context,
    destination: node(),
    createBufferSource() { return { connect() {}, start() {} }; },
    createBuffer(channels, size, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(size));
      return {
        numberOfChannels: channels, length: size, sampleRate: rate,
        getChannelData(index) { return data[index]; },
        copyToChannel(values, index) { data[index].set(values); }
      };
    },
    async startRendering() { return source; }
  });
  created.length = 0;
  await env.elements['converter-render-button'].dispatch('click');
  assert.ok(studio._hasRenderedAssetForTest(), 'adaptive render should produce a WAV asset');
  assert.ok(created.some((item) => item.frequency.value === 4400),
    'offline render must use the same artifact cleaner as preview');
  await env.elements['converter-clear-render'].dispatch('click');
  assert.equal(studio._hasRenderedAssetForTest(), false);
  core.analyzeSource = () => { throw new Error('analysis failed'); };
  await env.elements['converter-file-input'].dispatch('change');
  await env.elements['converter-auto-enhance'].dispatch('click');
  assert.match(env.elements['converter-render-status'].textContent, /klassisches/);
  assert.equal(studio._settingsForTest().artifactCleaner, null);
  assert.equal(env.elements['converter-eq-low'].value, '1.5');
  assert.equal(env.elements['converter-render-button'].disabled, false, 'analysis errors must not disable import/render');
  await env.elements['converter-reset-button'].dispatch('click');
  assert.equal(studio._settingsForTest().artifactCleaner, null);
}

async function testConverterAutomaticQualityWorkflow() {
  const env = createConverterEnvironment();
  const storedPreferences = new Map();
  env.window.localStorage = {
    getItem(key) { return storedPreferences.has(key) ? storedPreferences.get(key) : null; },
    setItem(key, value) { storedPreferences.set(key, String(value)); }
  };
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  assert.match(
    env.elements['converter-enhance-status'].textContent,
    /Automatik ist aktiv/,
    'idle status should explain that the improvement runs automatically after loading'
  );
  assert.equal(env.elements['converter-auto-enhance-undo'].disabled, true, 'undo must stay disabled before any enhancement');
  assert.equal(env.elements['converter-enhance-score'].textContent, '–');

  const sampleRate = 44100;
  const length = sampleRate;
  const harsh = Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * 5000 * i / sampleRate) * 0.4);
  const source = {
    length,
    sampleRate,
    duration: 1,
    numberOfChannels: 1,
    getChannelData() { return harsh; }
  };
  env.window.AudioContext = class FakeAudioContext {
    decodeAudioData(data, resolve) { resolve(source); }
    async close() {}
  };

  assert.match(
    env.elements['converter-auto-enhance-strength-hint'].textContent,
    /Stärke „ausgewogen“: Empfohlen/,
    'the selected strength should be explained before any import'
  );

  const core = studio._coreForTest;
  const originalDescribeProfile = core.describeProfile;
  let describeRuns = 0;
  core.describeProfile = function (...args) {
    describeRuns += 1;
    return originalDescribeProfile.apply(this, args);
  };
  const originalAnalyzeSource = core.analyzeSource;
  let analysisRuns = 0;
  core.analyzeSource = function (...args) {
    analysisRuns += 1;
    return originalAnalyzeSource.apply(this, args);
  };

  const file = { name: 'harsh.wav', size: 10, type: 'audio/wav', async arrayBuffer() { return new ArrayBuffer(10); } };
  env.elements['converter-file-input'].files = [file];
  await env.elements['converter-file-input'].dispatch('change');

  assert.equal(analysisRuns, 1, 'import should analyse the source exactly once');
  assert.equal(studio._enhanceStateForTest(), 'applied', 'import should trigger the automatic quality improvement');
  assert.match(
    env.elements['converter-enhance-status'].textContent,
    /Automatisch nach dem Import angewendet/,
    'status should state that the improvement ran automatically after import'
  );
  assert.match(env.elements['converter-enhance-findings'].innerHTML, /Clipping|Höhen|Stereobild/);
  assert.match(env.elements['converter-enhance-steps'].innerHTML, /Limiter-Ceiling/);
  assert.match(env.elements['converter-enhance-steps'].innerHTML, /Artefakt-Reinigung: Ringing-Cut/);
  assert.match(env.elements['converter-enhance-steps'].innerHTML, /Korrekturintensität \d+ % · Score \d+ → Prognose approx\. \d+/);
  assert.match(env.elements['converter-enhance-score-note'].textContent, /Auto-Enhance/);
  const projection = env.elements['converter-enhance-score-note'].textContent.match(/Prognose nach Auto-Enhance: approx\. (\d+) \(\+(\d+)\)/);
  assert.ok(projection, 'the score note should report the projected improvement');
  const score = Number(env.elements['converter-enhance-score'].textContent);
  assert.ok(Number.isFinite(score) && score >= 0 && score <= 100, 'quality score should be reported as a value between 0 and 100');
  assert.ok(score < 80, 'a harsh, squashed test tone must not be rated as clean');
  assert.ok(Number(projection[1]) > score, 'the projection must exceed the source score');
  assert.ok(
    Math.abs(Number(env.elements['converter-eq-mid'].value)) + Math.abs(Number(env.elements['converter-eq-high'].value)) >= 1.5,
    'a harsh source must receive a clearly audible tonal correction'
  );
  assert.equal(env.elements['converter-auto-enhance-undo'].disabled, false, 'undo must be available after an automatic enhancement');

  const balancedLow = Number(env.elements['converter-eq-low'].value);
  for (const controlId of [
    'converter-eq-low',
    'converter-eq-mid',
    'converter-eq-high',
    'converter-comp-ratio',
    'converter-stereo-width',
    'converter-target-lufs'
  ]) {
    const value = Number(env.elements[controlId].value);
    assert.ok(Number.isFinite(value), controlId + ' should receive a finite value');
    assert.equal(value, Math.round(value * 100) / 100, controlId + ' should be snapped to a representable slider value');
  }

  env.elements['converter-auto-enhance-strength'].value = 'strong';
  await env.elements['converter-auto-enhance-strength'].dispatch('change');
  assert.match(
    env.elements['converter-enhance-status'].textContent,
    /Mit neuer Stärke neu berechnet.*kräftig/,
    'changing the strength should recompute and explain the new setting'
  );
  assert.ok(
    Math.abs(Number(env.elements['converter-eq-low'].value)) >= Math.abs(balancedLow),
    'a stronger setting should not reduce the corrective EQ move'
  );
  assert.equal(analysisRuns, 1, 'changing the strength must reuse the cached source analysis');

  const strongIntensity = Number(env.elements['converter-enhance-steps'].innerHTML.match(/Korrekturintensität (\d+) %/)[1]);
  env.elements['converter-auto-enhance-strength'].value = 'maximum';
  await env.elements['converter-auto-enhance-strength'].dispatch('change');
  assert.match(env.elements['converter-enhance-status'].textContent, /Mit neuer Stärke neu berechnet.*maximal/);
  assert.match(env.elements['converter-auto-enhance-strength-hint'].textContent, /Stärke „maximal“: Stärkste Rettung/);
  const maximumIntensity = Number(env.elements['converter-enhance-steps'].innerHTML.match(/Korrekturintensität (\d+) %/)[1]);
  assert.ok(maximumIntensity > strongIntensity, 'maximal must correct a weak source more strongly than kräftig');
  assert.ok(Number(env.elements['converter-eq-high'].value) <= -3, 'maximal must apply a clearly audible high-frequency correction on a harsh source');
  assert.equal(JSON.parse(env.window.localStorage.getItem('jackdarckart:studio:enhance')).strength, 'maximum',
    'the new strength choices must be remembered locally');
  env.elements['converter-auto-enhance-strength'].value = 'subtle';
  await env.elements['converter-auto-enhance-strength'].dispatch('change');
  const subtleIntensity = Number(env.elements['converter-enhance-steps'].innerHTML.match(/Korrekturintensität (\d+) %/)[1]);
  assert.ok(subtleIntensity < strongIntensity, 'dezent must stay well below kräftig');
  assert.match(env.elements['converter-enhance-status'].textContent, /dezent/);
  env.elements['converter-auto-enhance-strength'].value = 'strong';
  await env.elements['converter-auto-enhance-strength'].dispatch('change');
  assert.equal(analysisRuns, 1, 'all strength changes must reuse the cached source analysis');
  assert.equal(describeRuns, 1, 'the findings list must be built once per import and reused on strength changes');

  studio._undoAutoEnhanceForTest();
  assert.equal(studio._enhanceStateForTest(), 'reverted');
  assert.doesNotMatch(env.elements['converter-enhance-score-note'].textContent, /Prognose/, 'undo should drop the projection');
  assert.equal(env.elements['converter-eq-low'].value, '0', 'undo should restore the slider values from before the enhancement');
  assert.equal(studio._settingsForTest().artifactCleaner, null, 'undo should also drop the artifact cleaner');
  assert.equal(env.elements['converter-auto-enhance-undo'].disabled, true, 'undo should disable itself after restoring');
  assert.match(env.elements['converter-enhance-status'].textContent, /zurückgenommen/);

  env.elements['converter-auto-enhance-toggle'].checked = false;
  await env.elements['converter-auto-enhance-toggle'].dispatch('change');
  await env.elements['converter-file-input'].dispatch('change');
  assert.equal(studio._enhanceStateForTest(), 'idle', 'disabling the automation must keep the sliders untouched after import');
  assert.match(env.elements['converter-enhance-status'].textContent, /Analyse abgeschlossen/);

  await env.elements['converter-auto-enhance'].dispatch('click');
  assert.equal(studio._enhanceStateForTest(), 'applied');
  assert.match(env.elements['converter-enhance-status'].textContent, /Manuell angewendet/);
  assert.equal(analysisRuns, 2, 'manual application must reuse the analysis from the latest import');

  await env.elements['converter-eq-low'].dispatch('input');
  assert.equal(studio._enhanceStateForTest(), 'manual', 'manual slider changes should be reflected in the enhancement state');
  assert.match(env.elements['converter-enhance-status'].textContent, /manuell angepasst/i);

  studio.destroy();
}

function createCloudflareWorkerFetchDouble() {
  const calls = [];
  let signedIn = false;
  let storedPreset = null;
  function respond(status, payload) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (/content-type/i.test(name) ? 'application/json; charset=utf-8' : null) },
      async json() { return payload; }
    };
  }
  async function fetchDouble(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method, credentials: options.credentials, body });
    const route = url.replace('https://vault.stream-musik.space/api/quantum-vault', '');
    if (route === '/session') {
      return signedIn ? respond(200, { handle: 'Pilot_One' }) : respond(401, { code: 'SESSION_REQUIRED' });
    }
    if (route === '/login') {
      if (body.password !== 'correct-horse-vault') {
        return respond(401, { code: 'INVALID_CREDENTIALS' });
      }
      signedIn = true;
      return respond(200, { handle: 'Pilot_One' });
    }
    if (route === '/logout') {
      signedIn = false;
      return respond(200, { ok: true });
    }
    if (route === '/studio-preset' && options.method === 'POST') {
      storedPreset = body.preset;
      return respond(200, { handle: 'Pilot_One', preset: storedPreset });
    }
    if (route === '/studio-preset') {
      return signedIn ? respond(200, { handle: 'Pilot_One', preset: storedPreset }) : respond(401, { code: 'SESSION_REQUIRED' });
    }
    return respond(404, { code: 'NOT_FOUND' });
  }
  return { fetchDouble, calls };
}

async function flushStudioTasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function testConverterCloudSyncWithoutConfigurationIsHonest() {
  let fetchCalls = 0;
  const env = createConverterEnvironment({ fetch: async () => { fetchCalls += 1; throw new Error('unexpected'); } });
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();
  await flushStudioTasks();

  assert.equal(fetchCalls, 0, 'studio must not contact any backend when Cloud-Sync is not configured');
  assert.match(env.elements['converter-cloud-status'].textContent, /noch nicht eingerichtet[\s\S]*lokal/,
    'unconfigured Cloud-Sync should explain that settings stay local');
  assert.equal(env.elements['converter-cloud-account'].textContent, 'nicht eingerichtet');
  assert.equal(env.elements['converter-cloud-auth-form'].hidden, true, 'login form should be hidden without a configured backend');
  assert.equal(env.elements['converter-cloud-save'].disabled, true);
  assert.equal(env.elements['converter-cloud-load'].disabled, true);

  await env.elements['converter-cloud-save'].dispatch('click');
  assert.equal(fetchCalls, 0, 'saving must not pretend to persist anything without a backend');

  const insecure = createConverterEnvironment({
    fetch: async () => { fetchCalls += 1; throw new Error('unexpected'); },
    config: { converter: { cloudSync: { apiBase: 'http://vault.example/api/quantum-vault' } } }
  });
  vm.runInContext(converterJsCode, insecure.context, { filename: 'converter.js' });
  insecure.window.__JACKDARCKART_CONVERTER__._createStudioForTest().init();
  await flushStudioTasks();
  assert.equal(fetchCalls, 0, 'non-HTTPS cross-origin Cloud-Sync endpoints must be rejected');
  studio.destroy();
}

async function testConverterCloudSyncUsesCloudflareWorker() {
  const worker = createCloudflareWorkerFetchDouble();
  const env = createConverterEnvironment({
    fetch: worker.fetchDouble,
    config: { converter: { cloudSync: { apiBase: 'https://vault.stream-musik.space/api/quantum-vault/' } } }
  });
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();
  await flushStudioTasks();

  assert.equal(worker.calls[0].url, 'https://vault.stream-musik.space/api/quantum-vault/session');
  assert.equal(env.elements['converter-cloud-account'].textContent, 'nicht angemeldet');
  assert.equal(env.elements['converter-cloud-auth-form'].hidden, false);
  assert.equal(env.elements['converter-cloud-save'].disabled, true, 'saving requires a Cloudflare session');

  env.elements['converter-cloud-handle'].value = 'Pilot_One';
  env.elements['converter-cloud-password'].value = 'wrong-password-123';
  await env.elements['converter-cloud-auth-form'].dispatch('submit');
  assert.match(env.elements['converter-cloud-status'].textContent, /Handle oder Passwort ist falsch/);

  env.elements['converter-cloud-password'].value = 'correct-horse-vault';
  await env.elements['converter-cloud-auth-form'].dispatch('submit');
  assert.equal(env.elements['converter-cloud-account'].textContent, 'angemeldet als Pilot_One');
  assert.equal(env.elements['converter-cloud-password'].value, '', 'password field should be cleared after login');
  assert.equal(env.elements['converter-cloud-save'].disabled, false);
  assert.equal(env.elements['converter-cloud-logout'].hidden, false);

  env.elements['converter-eq-low'].value = '3';
  env.elements['converter-auto-enhance-strength'].value = 'strong';
  await env.elements['converter-cloud-save'].dispatch('click');
  const saveCall = worker.calls.find((call) => call.method === 'POST' && call.url.endsWith('/studio-preset'));
  assert.ok(saveCall, 'saving should POST the preset to the Cloudflare Worker');
  assert.equal(saveCall.credentials, 'include', 'Cloudflare requests must include the HttpOnly session cookie');
  assert.deepEqual(Object.keys(saveCall.body.preset).sort(), ['enhance', 'settings']);
  assert.equal(saveCall.body.preset.settings.eqLow, 3);
  assert.equal(saveCall.body.preset.enhance.strength, 'strong');
  assert.ok(!JSON.stringify(saveCall.body).includes('artifactCleaner'), 'only slider values and enhance preferences are synced');
  assert.match(env.elements['converter-cloud-status'].textContent, /Audiodateien wurden nicht hochgeladen/);

  env.elements['converter-eq-low'].value = '0';
  env.elements['converter-auto-enhance-strength'].value = 'gentle';
  await env.elements['converter-cloud-load'].dispatch('click');
  assert.equal(env.elements['converter-eq-low'].value, '3', 'loading should apply the stored slider values');
  assert.equal(env.elements['converter-auto-enhance-strength'].value, 'strong', 'loading should apply the stored enhance strength');
  assert.match(env.elements['converter-cloud-status'].textContent, /Cloud-Preset geladen/);

  await env.elements['converter-cloud-logout'].dispatch('click');
  assert.equal(env.elements['converter-cloud-account'].textContent, 'nicht angemeldet');
  assert.equal(env.elements['converter-cloud-save'].disabled, true);
  studio.destroy();
}

function createTestAudioBuffer(channels, sampleRate) {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData(index) {
      return channels[index];
    }
  };
}

function testConverterRenderFinishMatchesPreviewAndLimitsCleanly() {
  const env = createConverterEnvironment();
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  const core = studio._coreForTest;
  const sampleRate = 44100;
  const length = sampleRate;
  const left = Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * 220 * i / sampleRate) * 0.2);
  const right = Float32Array.from(left, (value) => value * 0.5);
  const settings = { limiterCeiling: -1, targetLufs: -20, stereoWidth: 200 };
  const result = core.finalizeRenderedBuffer(createTestAudioBuffer([left, right], sampleRate), settings);
  const outLeft = result.buffer.getChannelData(0);
  const outRight = result.buffer.getChannelData(1);
  for (const index of [100, 5000, 30000]) {
    assert.ok(Math.abs(outRight[index] - outLeft[index] * 0.5) < 1e-6,
      'the finish stage must not apply stereo width a second time – the export has to match the preview chain');
  }
  assert.ok(Math.abs(result.report.outputApproxLufs - -20) < 0.2, 'quiet material should be normalised exactly to the loudness target');
  assert.equal(result.report.limiterReductionDb, 0, 'no limiting should happen when the peaks stay below the ceiling');

  // Sparse transients: the old static gain dropped the whole song to fit the
  // spike, the lookahead limiter catches the spike and keeps the target.
  const ceiling = Math.pow(10, -1 / 20);
  const spiky = Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * 330 * i / sampleRate) * 0.1);
  spiky[20000] = 0.4;
  spiky[20001] = -0.4;
  spiky[100] = Number.NaN;
  const loud = core.finalizeRenderedBuffer(createTestAudioBuffer([spiky], sampleRate), { limiterCeiling: -1, targetLufs: -10, stereoWidth: 100 });
  const output = loud.buffer.getChannelData(0);
  let peak = 0;
  let finite = true;
  for (const value of output) {
    finite = finite && Number.isFinite(value);
    peak = Math.max(peak, Math.abs(value));
  }
  assert.ok(finite, 'non-finite DSP samples must be sanitised before export');
  assert.equal(loud.report.sanitizedSamples, 1, 'the finish report should count sanitised samples');
  assert.ok(peak <= ceiling + 1e-6, 'the lookahead limiter must keep every sample at or below the ceiling');
  assert.ok(loud.report.limiterReductionDb > 0.5 && loud.report.limiterReductionDb <= 4.01,
    'the limiter should reduce spikes by at most the configured 4 dB');
  const legacyStaticLoudness = 20 * Math.log10(0.1 / Math.sqrt(2) * ceiling / 0.4);
  assert.ok(loud.report.outputApproxLufs > legacyStaticLoudness + 3,
    'the limiter should keep the master clearly louder than a static peak-normalisation');
  const windowPeak = (from, to) => output.slice(from, to).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(Math.abs(windowPeak(5000, 19500) - windowPeak(40000, 43000)) < 1e-3 && windowPeak(5000, 19500) > 0.25,
    'material away from the spike must not be ducked');
  assert.equal(Math.abs(output[length - 1]), 0, 'the anti-click fade must bring the last sample to silence');

  const silent = core.finalizeRenderedBuffer(createTestAudioBuffer([new Float32Array(4096)], sampleRate), settings);
  assert.equal(silent.report.loudnessShortfallDb, 0, 'silent renders must not report a loudness shortfall');
  assert.ok(silent.buffer.getChannelData(0).every((value) => value === 0), 'silence must stay silent');
}

async function testConverterWavEncoderWritesDitheredPcm() {
  const env = createConverterEnvironment();
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  const left = new Float32Array([0, 0.5, -0.5, 1.2, -1.2, 0]);
  const right = new Float32Array([0, -0.25, 0.25, 0, 0, 0]);
  const blob = studio._encodeWavForTest(createTestAudioBuffer([left, right], 48000));
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(bytes.length, 44 + 6 * 2 * 2, 'the WAV file should contain exactly header plus 16-bit stereo frames');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), 36 + 24);
  assert.equal(bytes.readUInt16LE(20), 1, 'WAV export must be PCM');
  assert.equal(bytes.readUInt16LE(22), 2);
  assert.equal(bytes.readUInt32LE(24), 48000, 'the WAV header must carry the rendered sample rate');
  assert.equal(bytes.readUInt32LE(28), 48000 * 4);
  assert.equal(bytes.readUInt16LE(32), 4);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), 24);
  const samples = Array.from({ length: 12 }, (_, i) => bytes.readInt16LE(44 + i * 2));
  assert.equal(samples[0], 0, 'digital silence must stay exactly zero (no dither noise floor)');
  assert.equal(samples[1], 0);
  assert.ok(Math.abs(samples[2] - 16384) <= 1, 'dithered samples should stay within one LSB of the exact value');
  assert.ok(Math.abs(samples[3] - -8192) <= 1, 'channels must be interleaved left/right');
  assert.ok(Math.abs(samples[4] - -16384) <= 1);
  assert.ok(Math.abs(samples[5] - 8192) <= 1);
  assert.equal(samples[6], 32767, 'overs must clamp to full scale instead of wrapping');
  assert.equal(samples[8], -32768);
  assert.equal(samples[11], 0);
}

async function testConverterLocalMp3EncodesInChunksWithProgress() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
    }
  });
  loadBundledMp3Encoder(env);
  let encodeCalls = 0;
  const OriginalMp3Encoder = env.context.lamejs.Mp3Encoder;
  env.context.lamejs.Mp3Encoder = function CountingMp3Encoder(...args) {
    const encoder = new OriginalMp3Encoder(...args);
    const encodeBuffer = encoder.encodeBuffer.bind(encoder);
    encoder.encodeBuffer = (...buffers) => {
      encodeCalls += 1;
      return encodeBuffer(...buffers);
    };
    return encoder;
  };
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();
  const sampleRate = 44100;
  const length = 1152 * 80;
  const tone = Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.3);
  const progress = [];
  const blob = await studio._renderMp3ExportForTest(createTestAudioBuffer([tone, tone], sampleRate), 192000, {
    onProgress(fraction) {
      progress.push(fraction);
    }
  });
  assert.equal(blob.type, 'audio/mpeg');
  assert.ok(blob.size > 1000, 'chunked local MP3 encoding should produce a complete file');
  assert.equal(encodeCalls, 3, 'local MP3 encoding should use large chunks instead of one call per 1152-sample frame');
  assert.ok(progress.length >= 2, 'local MP3 encoding should report progress');
  assert.equal(progress[progress.length - 1], 1, 'progress must end at 100 %');
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]), 'progress must be monotonic');
}

async function testConverterRealtimeExportWatchdogAndEmptyOutput() {
  const env = createConverterEnvironment();
  class SilentSource {
    connect() {}
    addEventListener() {}
    start() {}
  }
  class FakeAudioContext {
    constructor() { this.currentTime = 0; }
    createBufferSource() { return new SilentSource(); }
    createMediaStreamDestination() { return { stream: {} }; }
    async resume() {}
    async close() { env.markAudioContextClosed(); }
  }
  class StalledMediaRecorder {
    static isTypeSupported(mimeType) { return mimeType === 'audio/webm;codecs=opus'; }
    constructor(stream, options) {
      this.state = 'inactive';
      this.options = options;
      this.listeners = new Map();
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    start(timeslice) {
      this.timeslice = timeslice;
      this.state = 'recording';
      env.startedRecorder = this;
    }
    stop() { this.state = 'inactive'; }
  }
  env.window.AudioContext = FakeAudioContext;
  env.window.MediaRecorder = StalledMediaRecorder;
  env.context.MediaRecorder = StalledMediaRecorder;
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();

  const format = { id: 'webm-opus', mimeType: 'audio/webm;codecs=opus', extension: 'webm' };
  const pending = studio._recordCompressedExportForTest({ sampleRate: 48000, duration: 2, length: 96000 }, format, 192000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.startedRecorder.timeslice, 1000, 'realtime exports should collect data in 1 s slices');
  env.runTimersByDelay(2 * 1500 + 15000);
  await assert.rejects(pending, /nicht rechtzeitig/, 'a stalled realtime encoder must fail with a clear message instead of hanging');
  assert.equal(env.getClosedAudioContexts(), 1, 'the watchdog must close the temporary audio context');

  class EmptyMediaRecorder extends StalledMediaRecorder {
    stop() {
      this.state = 'inactive';
      this.listeners.get('stop')();
    }
  }
  class EndingSource {
    addEventListener(type, listener) { this.listener = listener; }
    connect() {}
    start() { this.listener(); }
  }
  FakeAudioContext.prototype.createBufferSource = () => new EndingSource();
  env.window.MediaRecorder = EmptyMediaRecorder;
  env.context.MediaRecorder = EmptyMediaRecorder;
  await assert.rejects(
    studio._recordCompressedExportForTest({ sampleRate: 48000 }, format, 192000),
    /leere Datei/,
    'an empty recording must be reported instead of offering a broken download'
  );
}

async function testConverterServerMp3ErrorsAreExplicit() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder { static isTypeSupported() { return false; } },
    config: { converter: { mp3Export: { serverEndpoint: '/api/converter/mp3' } } }
  });
  env.context.__JACKDARCKART_CONFIG__ = env.window.__JACKDARCKART_CONFIG__;
  let mode = 'status';
  env.window.fetch = async () => {
    if (mode === 'network') {
      throw new Error('offline');
    }
    if (mode === 'empty') {
      return { ok: true, async blob() { return new Blob([], { type: 'audio/mpeg' }); } };
    }
    return { ok: false, status: 503 };
  };
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  const buffer = createTestAudioBuffer([new Float32Array([0, 0.1, -0.1, 0])], 44100);
  await assert.rejects(studio._renderMp3ExportForTest(buffer, 192000), /HTTP 503/, 'server errors should include the HTTP status');
  mode = 'network';
  await assert.rejects(studio._renderMp3ExportForTest(buffer, 192000), /nicht erreichbar/, 'network failures should be explained');
  mode = 'empty';
  await assert.rejects(studio._renderMp3ExportForTest(buffer, 192000), /leere Datei/, 'empty MP3 responses must be rejected');
}

async function testConverterRenderFlowProgressGuardsAndSummary() {
  const env = createConverterEnvironment({
    AudioContext: function FakeAudioContext() {},
    MediaRecorder: class FakeMediaRecorder { static isTypeSupported() { return false; } }
  });
  loadBundledMp3Encoder(env);
  vm.runInContext(converterJsCode, env.context, { filename: 'converter.js' });
  const studio = env.window.__JACKDARCKART_CONVERTER__._createStudioForTest();
  studio.init();
  const sampleRate = 44100;
  const tone = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.3);
  const source = createTestAudioBuffer([tone, tone], sampleRate);
  env.window.AudioContext = class FakeAudioContext {
    decodeAudioData(data, resolve) { resolve(source); }
    async close() {}
  };
  env.elements['converter-auto-enhance-toggle'].checked = false;
  const file = { name: 'Song Final.wav', size: 10, type: 'audio/wav', async arrayBuffer() { return new ArrayBuffer(10); } };
  env.elements['converter-file-input'].files = [file];
  await env.elements['converter-file-input'].dispatch('change');

  const core = studio._coreForTest;
  const renderCalls = [];
  const statusDuringRender = [];
  let releaseRender = null;
  core.render = async function (buffer, settings, rate, options) {
    renderCalls.push({ rate, settings });
    statusDuringRender.push(env.elements['converter-render-status'].textContent);
    assert.equal(env.elements['converter-render-button'].disabled, true, 'the render button must be locked while rendering');
    assert.equal(env.elements['converter-render-button'].textContent, 'Rendert …');
    assert.equal(env.elements['converter-format-select'].disabled, true, 'export settings must be locked during a render');
    assert.equal(env.elements['converter-render-progress'].hidden, false, 'the progress bar should be visible while rendering');
    await new Promise((resolve) => { releaseRender = resolve; });
    await options.onStage('finish');
    statusDuringRender.push(env.elements['converter-render-status'].textContent);
    const rendered = createTestAudioBuffer([new Float32Array(tone), new Float32Array(tone)], rate);
    return this.finalizeRenderedBuffer(rendered, settings);
  };

  // WAV: two clicks during one render must start exactly one render.
  const first = env.elements['converter-render-button'].dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  await env.elements['converter-render-button'].dispatch('click');
  assert.equal(renderCalls.length, 1, 'double clicks must not start parallel renders');
  releaseRender();
  await first;
  assert.match(statusDuringRender[0], /^Schritt 1\/3: Mastering-Kette/, 'the first step should be explained to the user');
  assert.match(statusDuringRender[1], /^Schritt 2\/3: Mastering-Finish.*Lookahead-Limiter/, 'the finish step should be explained');
  const status = env.elements['converter-render-status'].textContent;
  assert.match(status, /^Render erfolgreich in .*: WAV · 16 Bit PCM · 44\.1 kHz · Stereo · 0:01 · \d+ KB\./, 'success text should summarise the export');
  assert.match(status, /maximal 2:00/);
  assert.equal(studio._hasRenderedAssetForTest(), true);
  assert.match(env.elements['converter-download-button'].textContent, /^Master herunterladen \(WAV · \d+ KB\)$/, 'download button should show format and size');
  assert.match(env.elements['converter-analysis-summary'].innerHTML, /<strong>Export:<\/strong> WAV · 16 Bit PCM/);
  assert.equal(env.elements['converter-render-progress'].hidden, true, 'the progress bar should hide after rendering');
  assert.equal(env.elements['converter-render-button'].textContent, 'Master rendern');
  assert.equal(env.elements['converter-render-button'].disabled, false);
  assert.equal(env.elements['converter-format-select'].disabled, false);

  // MP3 at 96 kHz renders at an MP3-compatible rate and keeps the chosen bitrate.
  env.elements['converter-format-select'].value = 'mp3';
  await env.elements['converter-format-select'].dispatch('change');
  env.elements['converter-bitrate-select'].value = '320000';
  studio._refreshExportFormatsForTest();
  assert.equal(env.elements['converter-bitrate-select'].value, '320000', 'capability refreshes must keep the user-selected bitrate');
  env.elements['converter-samplerate-select'].value = '96000';
  const mp3Render = env.elements['converter-render-button'].dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  releaseRender();
  await mp3Render;
  assert.equal(renderCalls[1].rate, 48000, 'MP3 renders must target an MP3-compatible sample rate');
  assert.match(env.elements['converter-render-status'].textContent, /MP3 · 320 kbps · 48\.0 kHz/, 'the summary should show the effective MP3 settings');
  assert.match(env.elements['converter-render-status'].textContent, /Samplerate für MP3 auf 48\.0 kHz angepasst/, 'the rate adaptation should be disclosed');
  assert.match(env.elements['converter-download-button'].textContent, /^Master herunterladen \(MP3 · /);

  // A reset during a render must discard the stale result.
  env.elements['converter-samplerate-select'].value = 'source';
  const staleRender = env.elements['converter-render-button'].dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  await env.elements['converter-reset-button'].dispatch('click');
  releaseRender();
  await staleRender;
  assert.equal(studio._hasRenderedAssetForTest(), false, 'renders finished after a reset must not store an asset');
  assert.match(env.elements['converter-import-status'].textContent, /zurückgesetzt/);
  assert.equal(env.elements['converter-render-button'].disabled, true, 'without a source the render button stays disabled');

  // Errors are mapped to actionable messages.
  await env.elements['converter-file-input'].dispatch('change');
  core.render = async () => {
    throw new RangeError('Array buffer allocation failed');
  };
  await env.elements['converter-render-button'].dispatch('click');
  assert.equal(env.elements['converter-render-state'].dataset.state, 'error');
  assert.match(env.elements['converter-render-status'].textContent, /Nicht genug Arbeitsspeicher.*niedrigere Samplerate/);
  assert.equal(env.elements['converter-render-button'].disabled, false, 'the render button must be usable again after an error');
}

async function main() {
  testStickyPlayerCssKeepsPlayerWithinViewport();
  testLivePageExposesEnhancedModulesAndHooks();
  testConverterPageExposesStudioHooksAndLoader();
  testQuantumVaultGameIntegration();
  await testGameCloudflareCookieFlow();
  await testConverterMp3FormatExposureAndDefaults();
  testConverterOpusFormatExposureMatchesMimeSupport();
  await testConverterMp3FormatExposureWithBundledLocalEncoder();
  await testConverterMp3FormatExposureWithLocalEncoderAdapter();
  testConverterMp3FilenameUsesMp3Extension();
  await testConverterMp3FormatExposureWithSameOriginConverter();
  await testConverterMp3FallbackMessageWhenNativeSupportMissing();
  await testConverterMp3BundledLocalEncoderRenderFallbackWithoutNativeMimeSupport();
  await testConverterNativeMp3MimeDetectionSupportsAlternateMimeTypes();
  await testConverterFormatRefreshClearsUnavailableSelection();
  await testConverterMp3CompressedExportPath();
  testConverterRenderFinishMatchesPreviewAndLimitsCleanly();
  await testConverterWavEncoderWritesDitheredPcm();
  await testConverterLocalMp3EncodesInChunksWithProgress();
  await testConverterRealtimeExportWatchdogAndEmptyOutput();
  await testConverterServerMp3ErrorsAreExplicit();
  await testConverterRenderFlowProgressGuardsAndSummary();
  testConverterDownloadClearsTemporaryAsset();
  await testConverterCloudSyncWithoutConfigurationIsHonest();
  await testConverterCloudSyncUsesCloudflareWorker();
  await testConverterLocalFileWorkflowAndAbsenceOfRemoteControls();
  await testRemoteAudioProxyValidatesAndFetchesAudio();
  await testRemoteAudioProxyHandlerResponses();
  await testSunoDownloaderBackendValidationAndFetch();
  await testConverterAdaptiveEnhance();
  await testConverterAutomaticQualityWorkflow();
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
