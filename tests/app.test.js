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
  for (let index = 0; index < 6; index += 1) {
    chain = chain.then(() => Promise.resolve());
  }
  return chain;
}

function createEnvironment(options = {}) {
  const missingIds = new Set(options.missingIds || []);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let timerId = 1;
  let shareCall = null;
  let openedUrl = '';
  let scrollCall = null;
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
    'favorite-status',
    'favorites-list',
    'favorites-empty',
    'favorites-clear',
    'history-list',
    'history-empty',
    'schedule-highlight',
    'schedule-list',
    'events-list',
    'news-list',
    'archive-list',
    'platform-links',
    'feedback-kind',
    'feedback-name',
    'feedback-subject',
    'feedback-message',
    'feedback-email',
    'feedback-issue',
    'feedback-status',
    'feedback-email-hint'
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
    __JACKDARCKART_CONFIG__: options.appConfig || {}
  };
  windowObject.window = windowObject;
  windowObject.document = document;

  const navigator = {
    onLine: true,
    clipboard: {
      async writeText() {}
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
    getOpenedUrl() {
      return openedUrl;
    },
    getScrollCall() {
      return scrollCall;
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

async function testNowPlayingIsNotFetchedWithoutConfiguredSource() {
  let fetchCalls = 0;
  const env = createEnvironment({
    fetch: async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({}) };
    }
  });

  await flushMicrotasks();

  assert.equal(fetchCalls, 0, 'default configuration should not trigger now-playing fetches');
  assert.equal(env.elements['now-playing-track'].textContent, 'Titelinformationen derzeit nicht verfügbar');
  assert.match(env.elements['now-playing-artist'].textContent, /deaktiviert/);
}

async function testShareUsesCurrentTrackWhenMetadataIsAvailable() {
  let fetchedUrl = '';
  const env = createEnvironment({
    appConfig: {
      nowPlaying: {
        endpoint: 'metadata/now-playing.json'
      }
    },
    fetch: async (url) => {
      fetchedUrl = url;
      return {
        ok: true,
        json: async () => ({
          current: {
            title: 'Mitternacht',
            artist: 'jackdarckart'
          },
          history: [
            { title: 'Mitternacht', artist: 'jackdarckart', playedAt: '2026-09-19T12:00:00.000Z' },
            { title: 'Mitternacht', artist: 'jackdarckart', playedAt: '2026-09-19T12:00:00.000Z' },
            { title: 'Wolkenlauf', artist: 'jackdarckart', playedAt: '2026-09-19T11:45:00.000Z' }
          ]
        })
      };
    },
    share: async () => undefined
  });

  await flushMicrotasks();
  await env.elements.share.dispatch('click');

  const shareCall = env.getShareCall();
  assert.ok(shareCall, 'share callback should receive data');
  assert.equal(shareCall.title, 'jackdarckart');
  assert.equal(shareCall.text, 'Jetzt live: jackdarckart – Mitternacht', 'share payload should include current track details when real metadata is available');
  assert.equal(shareCall.url, 'https://stream-musik.space/');
  assert.equal(env.elements['history-list'].children.length, 2, 'history should deduplicate repeated entries');
  assert.equal(env.elements['history-empty'].hidden, true, 'history fallback should be hidden once entries exist');
  assert.equal(env.navigator.mediaSession.metadata.title, 'Mitternacht', 'media session metadata should reflect real now-playing data');
  assert.equal(fetchedUrl, 'https://stream-musik.space/metadata/now-playing.json', 'configured now-playing fetches should use the normalized endpoint');
  assert.equal(env.elements['now-playing-source'].textContent, 'Datenquelle: stream-musik.space', 'configured now-playing sources should expose a stable label');
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

async function testExternalNowPlayingEndpointStaysDisabledByDefaultCsp() {
  let fetchCalls = 0;
  const env = createEnvironment({
    appConfig: {
      nowPlaying: {
        endpoint: 'https://example.com/now-playing.json'
      }
    },
    fetch: async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({}) };
    }
  });

  await flushMicrotasks();

  assert.equal(fetchCalls, 0, 'external now-playing endpoints should stay disabled until CSP and code are explicitly widened');
  assert.match(env.elements['now-playing-source'].textContent, /same-origin|CSP/, 'the UI should explain why the configured endpoint stays inactive');
}

function testUsesStationSpecificHttpsStreamUrl() {
  assert.match(
    appCode,
    /const STREAM_URL = 'https:\/\/jackdarckart\.stream\.laut\.fm\/jackdarckart';/,
    'player code should target the station-specific laut.fm HTTPS stream URL'
  );
}

function getBerlinParts() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const values = {};
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    day: weekdayMap[values.weekday],
    hour: Number.parseInt(values.hour, 10),
    minute: Number.parseInt(values.minute, 10)
  };
}

function toTimeString(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return String(Math.floor(normalized / 60)).padStart(2, '0') + ':' + String(normalized % 60).padStart(2, '0');
}

async function testScheduleHandlesOvernightWraparound() {
  const env = createEnvironment({
    now: '2026-09-21T00:30:00+02:00',
    appConfig: {
      content: {
        schedule: {
          timeZone: 'Europe/Berlin',
          entries: [
            {
              day: 'Sonntag',
              start: '23:00',
              end: '01:00',
              title: 'Late Night'
            },
            {
              day: 'Montag',
              start: '02:00',
              end: '03:00',
              title: 'Morgenmix'
            }
          ]
        }
      }
    }
  });

  const highlightCards = env.elements['schedule-highlight'].children;
  assert.equal(highlightCards.length, 2, 'overnight entries should still yield live and next highlight cards');
  assert.match(highlightCards[0].children[0].textContent, /Late Night/, 'overnight entry should be detected as currently live after midnight');
  assert.match(highlightCards[1].children[0].textContent, /Morgenmix/, 'next entry should still be identified after an overnight live slot');
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
    appConfig: {
      nowPlaying: {
        endpoint: 'metadata/now-playing.json'
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        current: {
          title: 'Mitternacht',
          artist: 'jackdarckart'
        }
      })
    })
  });

  await flushMicrotasks();

  await env.elements['favorite-track'].dispatch('click');
  assert.equal(env.elements['favorites-list'].children.length, 1, 'current track should be storable as a local favorite');
  assert.match(env.window.localStorage.getItem('jackdarckart-favorites'), /Mitternacht/, 'favorites should be persisted in localStorage');

  await env.elements['favorite-track'].dispatch('click');
  assert.equal(env.elements['favorites-list'].children.length, 0, 'clicking the favorite action again should remove the current favorite');
  assert.equal(env.elements['favorites-empty'].hidden, false, 'empty state should return once all favorites are removed');
}

async function testScheduleShowsLiveAndNextWhenConfigured() {
  const berlin = getBerlinParts();
  const currentMinutes = berlin.hour * 60 + berlin.minute;
  const nextMinutes = currentMinutes + 60;
  const nextDay = berlin.day + Math.floor(nextMinutes / 1440);

  const env = createEnvironment({
    appConfig: {
      content: {
        schedule: {
          timeZone: 'Europe/Berlin',
          entries: [
            {
              day: berlin.day,
              start: toTimeString(currentMinutes),
              end: toTimeString(currentMinutes + 15),
              title: 'Live-Test'
            },
            {
              day: nextDay % 7,
              start: toTimeString(nextMinutes),
              end: toTimeString(nextMinutes + 60),
              title: 'Next-Test'
            }
          ]
        }
      }
    }
  });

  const highlightCards = env.elements['schedule-highlight'].children;
  assert.equal(highlightCards.length, 2, 'configured schedule should render live and next highlight cards');
  assert.match(highlightCards[0].children[1].textContent, /Jetzt live/, 'highlight should identify the currently live show');
  assert.equal(env.elements['schedule-list'].children.length >= 2, true, 'configured schedule should render upcoming schedule cards');
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
}

async function main() {
  testUsesStationSpecificHttpsStreamUrl();
  await testReusesExistingSourceWithoutForcedReload();
  await testMissingOptionalElementsDoNotCrashInitialization();
  await testMissingAudioElementShowsGuardedErrorState();
  await testMuteButtonRestoresAudiblePlaybackFromZeroVolume();
  await testNowPlayingIsNotFetchedWithoutConfiguredSource();
  await testShareUsesCurrentTrackWhenMetadataIsAvailable();
  await testThemeSelectionUpdatesDatasetAndThemeColor();
  await testOfflineRecoveryShowsDedicatedRetryAction();
  await testExternalNowPlayingEndpointStaysDisabledByDefaultCsp();
  await testKeyboardShortcutsRespectInteractiveTargets();
  await testSleepTimerResetsOnManualStop();
  await testFavoritesCanBeAddedAndRemovedLocally();
  await testScheduleShowsLiveAndNextWhenConfigured();
  await testScheduleHandlesOvernightWraparound();
  await testFeedbackUsesHonestFallbacksAndValidation();
  console.log('app.js player tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
