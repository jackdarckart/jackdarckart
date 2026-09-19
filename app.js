'use strict';

(function () {
  function bootstrapApp() {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted',
    theme: 'jackdarckart-theme',
    favorites: 'jackdarckart-favorites'
  };
  const STATION_NAME = 'jackdarckart';
  const STREAM_URL = 'https://jackdarckart.stream.laut.fm/jackdarckart';
  const OFFICIAL_LAUT_FM_API_BASE = 'https://api.laut.fm/station/' + STATION_NAME;
  const LOAD_TIMEOUT_MS = 10000;
  const RECONNECT_DELAY_MS = 1500;
  const MAX_AUTO_RECONNECTS = 2;
  const DEFAULT_THEME = 'auto';
  const APP_CONFIG = createAppConfig(window.__JACKDARCKART_CONFIG__ || {});
  const STATE_LABELS = {
    ready: 'Bereit',
    loading: 'Verbindet',
    playing: 'Live',
    paused: 'Pausiert',
    blocked: 'Blockiert',
    error: 'Fehler'
  };
  const DATE_TIME_FORMATTER = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const WEEKDAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const WEEKDAY_INDEX_BY_LABEL = Object.fromEntries(WEEKDAY_LABELS.map((label, index) => [label.toLocaleLowerCase('de-DE'), index]));
  const APP_INSTANCE_KEY = '__JACKDARCKART_APP__';
  const PERSISTENT_AUDIO_KEY = '__JACKDARCKART_PERSISTENT_AUDIO__';
  const PERSISTENT_STATE_KEY = '__JACKDARCKART_PERSISTENT_STATE__';
  const INTERNAL_NAVIGATION_KEY = '__JACKDARCKART_INTERNAL_NAVIGATION__';
  const restoredPersistentState = readAndClearPersistentState();

  const audio = resolveAudioElement();
  const playButton = document.getElementById('play');
  const muteButton = document.getElementById('mute');
  const retryButton = document.getElementById('retry');
  const shareButton = document.getElementById('share');
  const shareWebsiteButton = document.getElementById('share-website');
  const shareStreamButton = document.getElementById('share-stream');
  const volumeInput = document.getElementById('volume');
  const volumeText = document.getElementById('volume-text');
  const status = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const message = document.getElementById('message');
  const shareStatus = document.getElementById('share-status');
  const equalizer = document.getElementById('equalizer');
  const menuToggle = document.getElementById('menu-toggle');
  const siteNav = document.getElementById('site-nav');
  const backToTopButton = document.getElementById('back-to-top');
  const year = document.getElementById('year');
  const networkStatus = document.getElementById('network-status');
  const playerStateLabel = document.getElementById('player-state-label');
  const retryStatus = document.getElementById('retry-status');
  const retryCounter = document.getElementById('retry-counter');
  const connectionQuality = document.getElementById('connection-quality');
  const lastStarted = document.getElementById('last-started');
  const lastError = document.getElementById('last-error');
  const stickyPlayer = document.getElementById('sticky-player');
  const stickyPlayButton = document.getElementById('sticky-play');
  const offlineNotice = document.getElementById('offline-notice');
  const offlineNoticeText = document.getElementById('offline-notice-text');
  const offlineRetryButton = document.getElementById('offline-retry');
  const themeSelect = document.getElementById('theme-select');
  const themeHint = document.getElementById('theme-hint');
  const installPromptShell = document.getElementById('install-prompt');
  const installButton = document.getElementById('install-app');
  const installStatus = document.getElementById('install-status');
  const sleepTimerSelect = document.getElementById('sleep-timer-select');
  const sleepCustomWrap = document.getElementById('sleep-custom-wrap');
  const sleepCustomMinutes = document.getElementById('sleep-custom-minutes');
  const sleepApplyButton = document.getElementById('sleep-apply');
  const sleepCancelButton = document.getElementById('sleep-cancel');
  const sleepRemaining = document.getElementById('sleep-remaining');
  const nowPlayingTitle = document.getElementById('now-playing-track');
  const nowPlayingArtist = document.getElementById('now-playing-artist');
  const nowPlayingSource = document.getElementById('now-playing-source');
  const stationStatus = document.getElementById('station-status');
  const favoriteTrackButton = document.getElementById('favorite-track');
  const favoriteStatus = document.getElementById('favorite-status');
  const favoritesList = document.getElementById('favorites-list');
  const favoritesEmpty = document.getElementById('favorites-empty');
  const favoritesClearButton = document.getElementById('favorites-clear');
  const favoritesCopyButton = document.getElementById('favorites-copy');
  const copyTrackButton = document.getElementById('copy-track');
  const libraryFilterInput = document.getElementById('library-filter');
  const libraryFilterClearButton = document.getElementById('library-filter-clear');
  const librarySummary = document.getElementById('library-summary');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const scheduleHighlight = document.getElementById('schedule-highlight');
  const scheduleList = document.getElementById('schedule-list');
  const scheduleFilterSelect = document.getElementById('schedule-filter');
  const scheduleSummary = document.getElementById('schedule-summary');
  const eventsList = document.getElementById('events-list');
  const newsList = document.getElementById('news-list');
  const archiveList = document.getElementById('archive-list');
  const platformLinks = document.getElementById('platform-links');
  const liveDataStatus = document.getElementById('live-data-status');
  const liveDataUpdated = document.getElementById('live-data-updated');
  const liveDataSource = document.getElementById('live-data-source');
  const liveDataRefreshButton = document.getElementById('live-data-refresh');
  const historySource = document.getElementById('history-source');
  const scheduleSource = document.getElementById('schedule-source');
  const nowPlayingArtwork = document.getElementById('now-playing-artwork');
  const nowPlayingArtworkWrap = document.getElementById('now-playing-artwork-wrap');
  const nowPlayingArtworkFallback = document.getElementById('now-playing-artwork-fallback');
  const stationProfileTitle = document.getElementById('station-profile-title');
  const stationProfileDescription = document.getElementById('station-profile-description');
  const stationProfileMeta = document.getElementById('station-profile-meta');
  const stationProfileLink = document.getElementById('station-profile-link');
  const stationProfileListeners = document.getElementById('station-profile-listeners');
  const stationProfileNextArtists = document.getElementById('station-profile-next-artists');
  const stationProfileImage = document.getElementById('station-profile-image');
  const stationProfileImageWrap = document.getElementById('station-profile-image-wrap');
  const stationProfileImageFallback = document.getElementById('station-profile-image-fallback');
  const feedbackKind = document.getElementById('feedback-kind');
  const feedbackName = document.getElementById('feedback-name');
  const feedbackSubject = document.getElementById('feedback-subject');
  const feedbackMessage = document.getElementById('feedback-message');
  const feedbackEmailButton = document.getElementById('feedback-email');
  const feedbackIssueButton = document.getElementById('feedback-issue');
  const feedbackStatus = document.getElementById('feedback-status');
  const feedbackEmailHint = document.getElementById('feedback-email-hint');
  const STREAM_URL_RESOLVED = normalizeUrl(STREAM_URL);
  const themeColorMeta = safeQuerySelector('meta[name="theme-color"]');
  const baseDocumentTitle = document && typeof document.title === 'string' ? document.title : '';

  let currentState = 'ready';
  let loadTimer = 0;
  let reconnectTimer = 0;
  let reconnectAttempts = 0;
  let wantsPlayback = false;
  let hasConfirmedPlayback = false;
  let lastAudibleVolume = 70;
  let lastSuccessfulStartAt = '';
  let lastErrorMessage = 'Noch kein Fehler registriert';
  let sawOffline = false;
  let showRecoveryRetry = false;
  let installPromptEvent = null;
  let nowPlayingTimer = 0;
  let stationInfoTimer = 0;
  let scheduleTimer = 0;
  let nowPlayingState = {
    current: null,
    history: []
  };
  let stationProfileState = null;
  let scheduleState = [];
  let nextArtistsState = [];
  let listenersState = null;
  let liveDataStatusState = {
    nowPlaying: { requestId: 0, loading: false, lastSuccessAt: '', lastError: '' },
    station: { requestId: 0, loading: false, lastSuccessAt: '', lastError: '' },
    schedule: { requestId: 0, loading: false, lastSuccessAt: '', lastError: '' }
  };
  let liveDataAbortControllers = {
    nowPlaying: null,
    station: null,
    schedule: null
  };
  let favoritesState = [];
  let libraryFilterValue = '';
  let sleepTimerId = 0;
  let sleepEndAt = 0;
  let lastPauseReason = '';
  const listenerCleanups = [];

  function createAppConfig(overrides) {
    const directStreamUrl = normalizeUrl(STREAM_URL) || STREAM_URL;
    const defaultConfig = {
      theme: DEFAULT_THEME,
      lautFm: {
        baseUrl: OFFICIAL_LAUT_FM_API_BASE,
        proxyBase: '',
        pollIntervalMs: 45000,
        stationPollIntervalMs: 180000,
        schedulePollIntervalMs: 180000,
        requestTimeoutMs: 12000,
        scheduleTimeZone: 'Europe/Berlin'
      },
      content: {
        events: [],
        news: [],
        archive: [],
        platformLinks: [
          {
            label: 'Offizielle laut.fm-Seite',
            url: 'https://laut.fm/jackdarckart',
            description: 'Senderprofil und externer Hörweg über laut.fm'
          },
          {
            label: 'Direkter Stream',
            url: directStreamUrl,
            description: 'Offizielle Stream-URL ohne zusätzliche Weiterleitungen'
          },
          {
            label: 'GitHub Issues',
            url: 'https://github.com/jackdarckart/jackdarckart/issues',
            description: 'Datenschutzfreundlicher Weg für Feedback, Fehler und Wünsche'
          }
        ],
        schedule: {
          timeZone: 'Europe/Berlin',
          entries: []
        },
        contact: {
          email: '',
          issueUrl: 'https://github.com/jackdarckart/jackdarckart/issues',
          stationUrl: 'https://laut.fm/jackdarckart'
        }
      }
    };

    const merged = {
      theme: typeof overrides.theme === 'string' ? overrides.theme : defaultConfig.theme,
    lautFm: Object.assign({}, defaultConfig.lautFm, overrides.lautFm || {}),
      content: {
        events: Array.isArray(overrides.content && overrides.content.events) ? overrides.content.events : defaultConfig.content.events,
        news: Array.isArray(overrides.content && overrides.content.news) ? overrides.content.news : defaultConfig.content.news,
        archive: Array.isArray(overrides.content && overrides.content.archive) ? overrides.content.archive : defaultConfig.content.archive,
        platformLinks: Array.isArray(overrides.content && overrides.content.platformLinks)
          ? overrides.content.platformLinks
          : defaultConfig.content.platformLinks,
        schedule: {
          timeZone: overrides.content && overrides.content.schedule && typeof overrides.content.schedule.timeZone === 'string'
            ? overrides.content.schedule.timeZone
            : defaultConfig.content.schedule.timeZone,
          entries: Array.isArray(overrides.content && overrides.content.schedule && overrides.content.schedule.entries)
            ? overrides.content.schedule.entries
            : defaultConfig.content.schedule.entries
        },
        contact: Object.assign({}, defaultConfig.content.contact, overrides.content && overrides.content.contact)
      }
    };

    return merged;
  }

  function readAndClearPersistentState() {
    const snapshot = window[PERSISTENT_STATE_KEY];
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }

    try {
      delete window[PERSISTENT_STATE_KEY];
    } catch (error) {
      window[PERSISTENT_STATE_KEY] = null;
    }

    return snapshot;
  }

  function resolveAudioElement() {
    const pageAudio = document.getElementById('audio');
    const persistentAudio = window[PERSISTENT_AUDIO_KEY];

    if (!persistentAudio) {
      return pageAudio;
    }

    if (pageAudio && pageAudio !== persistentAudio && pageAudio.parentNode) {
      pageAudio.parentNode.replaceChild(persistentAudio, pageAudio);
    } else if (!persistentAudio.parentNode && document.body) {
      document.body.appendChild(persistentAudio);
    }

    if (typeof persistentAudio.setAttribute === 'function') {
      persistentAudio.setAttribute('id', 'audio');
      persistentAudio.setAttribute('hidden', 'hidden');
    }
    persistentAudio.hidden = true;

    try {
      delete window[PERSISTENT_AUDIO_KEY];
    } catch (error) {
      window[PERSISTENT_AUDIO_KEY] = null;
    }

    return persistentAudio;
  }

  function bindManagedEvent(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== 'function') {
      return listener;
    }

    target.addEventListener(type, listener, options);
    listenerCleanups.push(() => {
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener(type, listener, options);
      }
    });
    return listener;
  }

  function bindManagedMediaQuery(query, listener) {
    if (!query || !listener) {
      return;
    }

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      listenerCleanups.push(() => query.removeEventListener('change', listener));
      return;
    }

    if (typeof query.addListener === 'function') {
      query.addListener(listener);
      listenerCleanups.push(() => query.removeListener(listener));
    }
  }

  function capturePersistentState() {
    return {
      currentState,
      wantsPlayback,
      hasConfirmedPlayback,
      lastAudibleVolume,
      lastSuccessfulStartAt,
      lastErrorMessage,
      lastPauseReason,
      sleepEndAt,
      volume: audio ? Math.round((Number.isFinite(audio.volume) ? audio.volume : getStoredVolume() / 100) * 100) : getStoredVolume(),
      muted: audio ? Boolean(audio.muted) : getStoredMuted()
    };
  }

  function destroyApp(options) {
    const preserveAudio = Boolean(options && options.preserveAudio);

    if (preserveAudio && audio) {
      window[PERSISTENT_AUDIO_KEY] = audio;
      window[PERSISTENT_STATE_KEY] = capturePersistentState();
    }

    clearNowPlayingTimer();
    clearStationInfoTimer();
    clearScheduleTimer();
    clearLoadTimer();
    clearReconnectTimer();
    if (sleepTimerId) {
      window.clearTimeout(sleepTimerId);
      sleepTimerId = 0;
    }

    Object.keys(liveDataAbortControllers).forEach((key) => {
      if (liveDataAbortControllers[key] && typeof liveDataAbortControllers[key].abort === 'function') {
        liveDataAbortControllers[key].abort();
      }
      liveDataAbortControllers[key] = null;
    });

    while (listenerCleanups.length) {
      const cleanup = listenerCleanups.pop();
      try {
        cleanup();
      } catch (error) {
        continue;
      }
    }

    if (window[APP_INSTANCE_KEY] && window[APP_INSTANCE_KEY].destroy === destroyApp) {
      window[APP_INSTANCE_KEY] = null;
    }
  }

  function normalizeUrl(value) {
    if (!value) {
      return '';
    }

    try {
      return new window.URL(value, window.location.href).href;
    } catch (error) {
      return '';
    }
  }

  function safeQuerySelector(selector) {
    if (!document || typeof document.querySelector !== 'function') {
      return null;
    }

    return document.querySelector(selector);
  }

  function hasStreamSource() {
    if (!audio) {
      return false;
    }

    const attributeValue = typeof audio.getAttribute === 'function' ? audio.getAttribute('src') : '';
    const candidates = [attributeValue, audio.currentSrc, audio.src];
    return candidates.some((candidate) => normalizeUrl(candidate) === STREAM_URL_RESOLVED);
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      return false;
    }

    return true;
  }

  function getStoredVolume() {
    const stored = Number.parseInt(readStorage(STORAGE_KEYS.volume) || '', 10);
    if (!Number.isFinite(stored) || stored < 0 || stored > 100) {
      return 70;
    }
    return stored;
  }

  function getStoredMuted() {
    return readStorage(STORAGE_KEYS.muted) === 'true';
  }

  function getStoredThemePreference() {
    const stored = readStorage(STORAGE_KEYS.theme);
    if (stored === 'dark' || stored === 'light' || stored === 'auto') {
      return stored;
    }

    return APP_CONFIG.theme === 'dark' || APP_CONFIG.theme === 'light' ? APP_CONFIG.theme : DEFAULT_THEME;
  }

  function getPreferredColorScheme() {
    if (window.matchMedia && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    return 'dark';
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function setHidden(element, hidden) {
    if (element) {
      element.hidden = Boolean(hidden);
    }
  }

  function formatDateTime(value) {
    if (!value) {
      return 'Noch nicht verfügbar';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Zeitpunkt unbekannt';
    }

    if (!DATE_TIME_FORMATTER) {
      return date.toLocaleString ? date.toLocaleString('de-DE') : date.toString();
    }

    return DATE_TIME_FORMATTER.format(date);
  }

  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function readJsonStorage(key) {
    const value = readStorage(key);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      return writeStorage(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
  }

  function updateEqualizer(isPlaying) {
    if (!equalizer || typeof equalizer.querySelectorAll !== 'function') {
      return;
    }

    equalizer.querySelectorAll('i').forEach((bar) => {
      bar.style.animationPlayState = isPlaying ? 'running' : 'paused';
    });
  }

  function getThemeMetaColor(theme) {
    return theme === 'light' ? '#edf4ff' : '#070b18';
  }

  function applyTheme(preference) {
    const resolvedTheme = preference === 'auto' ? getPreferredColorScheme() : preference;
    const root = document.documentElement;
    if (root && root.dataset) {
      root.dataset.theme = resolvedTheme;
      root.dataset.themePreference = preference;
    }

    if (themeSelect) {
      themeSelect.value = preference;
    }

    if (themeHint) {
      const label = preference === 'auto'
        ? 'Automatisch aktiv (' + (resolvedTheme === 'light' ? 'hell' : 'dunkel') + ')'
        : (preference === 'light' ? 'Helles Theme aktiv' : 'Dunkles Theme aktiv');
      themeHint.textContent = label;
    }

    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', getThemeMetaColor(resolvedTheme));
    }
  }

  function updatePlayButton() {
    const buttons = [playButton, stickyPlayButton].filter(Boolean);

    if (currentState === 'playing') {
      buttons.forEach((button) => {
        button.textContent = 'Stream pausieren';
        button.setAttribute('aria-pressed', 'true');
        button.dataset.state = 'playing';
      });
      return;
    }

    buttons.forEach((button) => {
      button.textContent = currentState === 'loading' ? 'Verbindung läuft …' : 'Stream starten';
      button.setAttribute('aria-pressed', 'false');
      button.dataset.state = currentState === 'loading' ? 'loading' : 'ready';
    });
  }

  function updateRetryButton() {
    if (!retryButton) {
      return;
    }

    const isVisible = currentState === 'error' || currentState === 'blocked' || showRecoveryRetry;
    retryButton.hidden = !isVisible;
    retryButton.dataset.state = retryButton.hidden ? 'hidden' : 'action-needed';
  }

  function getConnectionQualityText() {
    const isOffline = typeof navigator.onLine === 'boolean' && !navigator.onLine;
    if (isOffline) {
      return 'Offline erkannt';
    }

    if (currentState === 'playing') {
      return reconnectAttempts > 0 ? 'Stabilisiert nach Neuversuch' : 'Stabil verbunden';
    }

    if (currentState === 'loading') {
      return reconnectAttempts > 0 ? 'Neuaufbau läuft' : 'Verbindung wird geprüft';
    }

    if (currentState === 'blocked') {
      return 'Wartet auf Nutzeraktion';
    }

    if (currentState === 'error') {
      return 'Instabil / Fehler';
    }

    return 'Bereit bei Bedarf';
  }

  function updateNetworkStatus() {
    const isOffline = typeof navigator.onLine === 'boolean' && !navigator.onLine;

    if (networkStatus) {
      networkStatus.textContent = isOffline ? 'Browser meldet offline' : 'Browser meldet online';
      if (networkStatus.parentElement) {
        networkStatus.parentElement.dataset.state = isOffline ? 'offline' : 'online';
      }
    }

    if (connectionQuality) {
      connectionQuality.textContent = getConnectionQualityText();
      if (connectionQuality.parentElement) {
        connectionQuality.parentElement.dataset.state = isOffline ? 'offline' : currentState;
      }
    }

    if (offlineNotice) {
      if (isOffline) {
        sawOffline = true;
        showRecoveryRetry = false;
        offlineNotice.hidden = false;
        setText(offlineNoticeText, 'Der Browser ist aktuell offline. Sobald die Verbindung zurück ist, kannst du den Stream direkt erneut starten.');
        setHidden(offlineRetryButton, true);
      } else if (sawOffline && currentState !== 'playing') {
        showRecoveryRetry = true;
        offlineNotice.hidden = false;
        setText(offlineNoticeText, 'Die Verbindung ist wieder da. Du kannst den Stream jetzt erneut verbinden.');
        setHidden(offlineRetryButton, false);
      } else {
        if (currentState === 'playing') {
          sawOffline = false;
        }
        offlineNotice.hidden = true;
        setHidden(offlineRetryButton, true);
      }
    }

    updateRetryButton();
  }

  function getRetryStatusText() {
    if (currentState === 'loading') {
      return reconnectAttempts > 0
        ? 'Automatik ' + reconnectAttempts + '/' + MAX_AUTO_RECONNECTS
        : 'Start wird geprüft';
    }

    if (currentState === 'playing') {
      return MAX_AUTO_RECONNECTS > 0 ? 'Auto-Reconnect bereit' : 'Nur manuell';
    }

    if (currentState === 'error' || currentState === 'blocked' || showRecoveryRetry) {
      return 'Bitte manuell erneut versuchen';
    }

    return 'Manuell verfügbar';
  }

  function updateExtendedStatus() {
    if (retryStatus) {
      retryStatus.textContent = getRetryStatusText();
      if (retryStatus.parentElement) {
        if (currentState === 'error' || currentState === 'blocked' || showRecoveryRetry) {
          retryStatus.parentElement.dataset.state = 'action-needed';
        } else if (currentState === 'loading' || reconnectAttempts > 0) {
          retryStatus.parentElement.dataset.state = 'active';
        } else {
          retryStatus.parentElement.dataset.state = 'manual';
        }
      }
    }

    if (retryCounter) {
      retryCounter.textContent = String(reconnectAttempts) + ' / ' + String(MAX_AUTO_RECONNECTS);
      if (retryCounter.parentElement) {
        retryCounter.parentElement.dataset.state = reconnectAttempts > 0 ? 'active' : 'manual';
      }
    }

    if (lastStarted) {
      lastStarted.textContent = lastSuccessfulStartAt ? formatDateTime(lastSuccessfulStartAt) : 'Noch kein Start';
    }

    if (lastError) {
      lastError.textContent = lastErrorMessage;
      if (lastError.parentElement) {
        lastError.parentElement.dataset.state = currentState === 'error' || currentState === 'blocked' ? 'error' : 'manual';
      }
    }
  }

  function updateStationStatus() {
    if (!stationStatus) {
      return;
    }

    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
      stationStatus.textContent = 'Offline-Hinweis aktiv';
      return;
    }

    if (currentState === 'playing') {
      stationStatus.textContent = nowPlayingState.current ? 'Stream aktiv · Titelinfos verfügbar' : 'Stream aktiv';
      return;
    }

    if (currentState === 'loading') {
      stationStatus.textContent = 'Verbindung wird aufgebaut';
      return;
    }

    if (currentState === 'blocked') {
      stationStatus.textContent = 'Wartet auf Freigabe im Browser';
      return;
    }

    if (currentState === 'error') {
      stationStatus.textContent = 'Aktuell gestört';
      return;
    }

    stationStatus.textContent = 'Bereit für manuellen Start';
  }

  function syncStatusMirrors() {
    if (playerStateLabel) {
      playerStateLabel.textContent = STATE_LABELS[currentState] || STATE_LABELS.ready;
      if (playerStateLabel.parentElement) {
        playerStateLabel.parentElement.dataset.state = currentState;
      }
    }

    if (stickyPlayer) {
      stickyPlayer.dataset.state = currentState;
    }

    updateExtendedStatus();
    updateStationStatus();
  }

  function setState(type, title, detail) {
    currentState = type;
    if (status) {
      status.dataset.state = type;
      status.setAttribute('aria-busy', String(type === 'loading'));
    }
    if (statusText) {
      statusText.textContent = title;
    }
    if (message) {
      message.textContent = detail;
    }
    updateEqualizer(type === 'playing');
    updatePlayButton();
    updateNetworkStatus();
    syncStatusMirrors();
  }

  function updateMuteButton() {
    if (!muteButton || !audio) {
      return;
    }

    const muted = audio.muted;
    muteButton.textContent = muted ? 'Ton an' : 'Stumm';
    muteButton.setAttribute('aria-pressed', String(muted));
    muteButton.setAttribute('aria-label', muted ? 'Ton wieder einschalten' : 'Ton stummschalten');
    muteButton.dataset.state = muted ? 'muted' : 'active';
  }

  function updateVolume(value, options) {
    if (!audio) {
      return;
    }

    const normalized = Math.max(0, Math.min(100, Number.parseInt(String(value), 10) || 0));
    const persist = !options || options.persist !== false;
    if (volumeInput) {
      volumeInput.value = String(normalized);
    }
    if (volumeText) {
      volumeText.textContent = normalized + '%';
    }
    audio.volume = normalized / 100;

    if (normalized > 0) {
      lastAudibleVolume = normalized;
    }

    if (normalized === 0) {
      audio.muted = true;
    } else if (audio.muted) {
      audio.muted = false;
    }

    updateMuteButton();
    if (persist) {
      writeStorage(STORAGE_KEYS.volume, String(normalized));
      writeStorage(STORAGE_KEYS.muted, String(audio.muted));
    }
  }

  function clearLoadTimer() {
    if (loadTimer) {
      window.clearTimeout(loadTimer);
      loadTimer = 0;
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = 0;
    }
  }

  function clearNowPlayingTimer() {
    if (nowPlayingTimer) {
      window.clearTimeout(nowPlayingTimer);
      nowPlayingTimer = 0;
    }
  }

  function clearStationInfoTimer() {
    if (stationInfoTimer) {
      window.clearTimeout(stationInfoTimer);
      stationInfoTimer = 0;
    }
  }

  function clearScheduleTimer() {
    if (scheduleTimer) {
      window.clearTimeout(scheduleTimer);
      scheduleTimer = 0;
    }
  }

  function updateSleepCustomVisibility() {
    setHidden(sleepCustomWrap, !sleepTimerSelect || sleepTimerSelect.value !== 'custom');
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return String(hours) + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function updateSleepTimerStatus(text) {
    if (!sleepRemaining) {
      return;
    }

    if (text) {
      sleepRemaining.textContent = text;
      return;
    }

    if (!sleepEndAt) {
      sleepRemaining.textContent = 'Kein Sleep-Timer aktiv.';
      return;
    }

    sleepRemaining.textContent = 'Sleep-Timer aktiv · verbleibend ' + formatDuration(sleepEndAt - Date.now());
  }

  function clearSleepTimer(text) {
    if (sleepTimerId) {
      window.clearTimeout(sleepTimerId);
      sleepTimerId = 0;
    }

    sleepEndAt = 0;
    if (sleepTimerSelect) {
      sleepTimerSelect.value = 'off';
    }
    updateSleepCustomVisibility();
    updateSleepTimerStatus(text || 'Kein Sleep-Timer aktiv.');
  }

  function tickSleepTimer() {
    if (!sleepEndAt) {
      return;
    }

    const remaining = sleepEndAt - Date.now();
    if (remaining <= 0) {
      clearSleepTimer('Sleep-Timer beendet die Wiedergabe.');
      pausePlayback('sleep-timer');
      if (audio && audio.paused) {
        setState('paused', 'Sleep-Timer beendet die Wiedergabe.', 'Der aktive Sleep-Timer ist abgelaufen. Du kannst den Stream jederzeit wieder manuell starten.');
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
        }
      }
      return;
    }

    updateSleepTimerStatus();
    sleepTimerId = window.setTimeout(tickSleepTimer, Math.min(1000, remaining));
  }

  function getSelectedSleepDurationMinutes() {
    if (!sleepTimerSelect) {
      return 0;
    }

    if (sleepTimerSelect.value === 'custom') {
      const customValue = Number.parseInt(sleepCustomMinutes && sleepCustomMinutes.value ? sleepCustomMinutes.value : '', 10);
      if (!Number.isFinite(customValue) || customValue < 1 || customValue > 480) {
        updateSleepTimerStatus('Bitte wähle für den Sleep-Timer 1 bis 480 Minuten.');
        if (sleepCustomMinutes) {
          sleepCustomMinutes.focus();
        }
        return -1;
      }

      return customValue;
    }

    return Number.parseInt(sleepTimerSelect.value || '0', 10) || 0;
  }

  function applySleepTimer() {
    const minutes = getSelectedSleepDurationMinutes();
    if (minutes < 0) {
      return;
    }

    if (!minutes) {
      clearSleepTimer('Kein Sleep-Timer aktiv.');
      return;
    }

    if (sleepTimerId) {
      window.clearTimeout(sleepTimerId);
      sleepTimerId = 0;
    }

    sleepEndAt = Date.now() + (minutes * 60 * 1000);
    updateSleepTimerStatus();
    tickSleepTimer();
  }

  function getFavoriteStorageEntries() {
    const stored = readJsonStorage(STORAGE_KEYS.favorites);
    if (!Array.isArray(stored)) {
      return [];
    }

    return stored
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        key: typeof entry.key === 'string' ? entry.key : '',
        title: typeof entry.title === 'string' ? entry.title : '',
        artist: typeof entry.artist === 'string' ? entry.artist : '',
        meta: typeof entry.meta === 'string' ? entry.meta : '',
        savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : ''
      }))
      .filter((entry) => entry.key && (entry.title || entry.artist));
  }

  function getPlaybackPreparationText(forceReload) {
    const isOffline = typeof navigator.onLine === 'boolean' && !navigator.onLine;

    if (isOffline) {
      return 'Dein Browser meldet aktuell keine Verbindung. Sobald du wieder online bist, kannst du den Stream direkt neu starten.';
    }

    return forceReload
      ? 'Die Verbindung zum Livestream wird kontrolliert neu aufgebaut.'
      : 'Der Livestream wird jetzt nach deiner Aktion direkt im Browser vorbereitet.';
  }

  function getNetworkFailureText() {
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
      return 'Dein Browser meldet aktuell Offline. Prüfe die Verbindung und starte den Stream danach erneut.';
    }

    return 'Bitte versuche es erneut oder wechsle über den Direktstream beziehungsweise laut.fm auf einen externen Hörweg.';
  }

  function stopAudioAfterFailure() {
    if (!audio) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
    }
  }

  function pausePlayback(reason) {
    if (!audio) {
      return;
    }

    lastPauseReason = reason || 'manual';
    wantsPlayback = false;
    reconnectAttempts = 0;
    clearLoadTimer();
    clearReconnectTimer();
    if (lastPauseReason !== 'sleep-timer' && sleepEndAt) {
      clearSleepTimer('Sleep-Timer zurückgesetzt.');
    }
    if (!audio.paused) {
      audio.pause();
    }
  }

  function ensureStreamSource(forceReload) {
    if (!audio) {
      return forceReload;
    }

    const hasSource = hasStreamSource();
    if (!hasSource) {
      if (typeof audio.setAttribute === 'function') {
        audio.setAttribute('src', STREAM_URL);
      }
      audio.src = STREAM_URL;
      forceReload = true;
    }

    if (forceReload) {
      audio.load();
    }

    return forceReload;
  }

  function shouldForceReloadOnStart() {
    return currentState === 'error' || currentState === 'blocked' || !hasStreamSource();
  }

  function scheduleLoadTimeout() {
    clearLoadTimer();
    loadTimer = window.setTimeout(() => {
      if (!wantsPlayback || currentState !== 'loading') {
        return;
      }

      if (hasConfirmedPlayback && reconnectAttempts < MAX_AUTO_RECONNECTS) {
        reconnectAttempts += 1;
        setState(
          'loading',
          'Verbindung wird erneut aufgebaut …',
          'Der Stream antwortet noch nicht. Automatischer Neuversuch ' + reconnectAttempts + ' von ' + MAX_AUTO_RECONNECTS + ' startet jetzt direkt im Player.'
        );
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(() => {
          attemptPlayback(true);
        }, RECONNECT_DELAY_MS);
        return;
      }

      wantsPlayback = false;
      stopAudioAfterFailure();
      rememberLastError('Start-Timeout');
      setState(
        'error',
        'Der Stream startet gerade nicht.',
        getNetworkFailureText()
      );
    }, LOAD_TIMEOUT_MS);
  }

  function rememberLastError(summary) {
    lastErrorMessage = summary + ' · ' + formatDateTime(new Date());
  }

  function handlePlaybackFailure(error) {
    clearLoadTimer();
    clearReconnectTimer();

    if (error && error.name === 'AbortError' && !wantsPlayback) {
      return;
    }

    wantsPlayback = false;

    if (error && error.name === 'NotAllowedError') {
      stopAudioAfterFailure();
      rememberLastError('Browser-Freigabe fehlt');
      setState(
        'blocked',
        'Browser blockiert die Wiedergabe.',
        'Bitte tippe erneut auf „Stream starten“ oder „Erneut versuchen“. Erst danach gibt der Browser den Livestream für diese Seite frei.'
      );
      return;
    }

    stopAudioAfterFailure();
    rememberLastError('Wiedergabe konnte nicht starten');
    setState(
      'error',
      'Wiedergabe konnte nicht starten.',
      getNetworkFailureText()
    );
  }

  async function attemptPlayback(forceReload) {
    if (!audio) {
      rememberLastError('Audio-Komponente fehlt');
      setState(
        'error',
        'Player nicht verfügbar.',
        'Die Audio-Komponente konnte nicht initialisiert werden. Bitte lade die Seite neu oder nutze den Direktstream.'
      );
      return;
    }

    wantsPlayback = true;
    lastPauseReason = '';
    showRecoveryRetry = false;
    clearReconnectTimer();
    setState(
      'loading',
      forceReload ? 'Verbindung wird aufgebaut …' : 'Wiedergabe wird vorbereitet …',
      getPlaybackPreparationText(forceReload)
    );
    scheduleLoadTimeout();

    try {
      if (forceReload && !audio.paused) {
        audio.pause();
      }

      forceReload = ensureStreamSource(forceReload);
      await audio.play();
    } catch (error) {
      handlePlaybackFailure(error);
    }
  }

  async function togglePlayback() {
    if (!audio) {
      rememberLastError('Audio-Komponente fehlt');
      setState(
        'error',
        'Player nicht verfügbar.',
        'Die Audio-Komponente fehlt auf der Seite. Bitte lade neu oder öffne den Direktstream.'
      );
      return;
    }

    if (currentState === 'loading') {
      pausePlayback();
      setState('paused', 'Start wurde abgebrochen.', 'Tippe auf „Stream starten“, um den Streamzugang direkt neu aufzubauen.');
      return;
    }

    if (!audio.paused) {
      pausePlayback();
      return;
    }

    await startPlayback(true, shouldForceReloadOnStart());
  }

  async function startPlayback(resetReconnectBudget, forceReload) {
    if (!audio) {
      rememberLastError('Audio-Komponente fehlt');
      setState(
        'error',
        'Player nicht verfügbar.',
        'Die Audio-Komponente fehlt auf der Seite. Bitte lade neu oder öffne den Direktstream.'
      );
      return;
    }

    if (resetReconnectBudget) {
      reconnectAttempts = 0;
    }

    await attemptPlayback(typeof forceReload === 'boolean' ? forceReload : !hasStreamSource());
  }

  function closeMenu() {
    if (!menuToggle || !siteNav) {
      return;
    }

    menuToggle.setAttribute('aria-expanded', 'false');
    siteNav.classList.remove('is-open');
  }

  function openMenu() {
    if (!menuToggle || !siteNav) {
      return;
    }

    menuToggle.setAttribute('aria-expanded', 'true');
    siteNav.classList.add('is-open');
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'absolute';
    helper.style.left = '-9999px';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(helper);
    if (!copied) {
      throw new Error('clipboard-unavailable');
    }
  }

  function getCurrentTrackLabel() {
    if (!nowPlayingState.current) {
      return '';
    }

    const parts = [nowPlayingState.current.artist, nowPlayingState.current.title].filter(Boolean);
    return parts.join(' – ');
  }

  function getCurrentTrackCopyText() {
    if (!nowPlayingState.current) {
      return '';
    }

    return [
      [nowPlayingState.current.artist, nowPlayingState.current.title].filter(Boolean).join(' – '),
      nowPlayingState.current.album
    ].filter(Boolean).join(' · ');
  }

  function normalizeSearchText(value) {
    return String(value || '').trim().toLocaleLowerCase('de-DE');
  }

  function matchesLibraryFilter(parts) {
    if (!libraryFilterValue) {
      return true;
    }

    return parts.some((part) => normalizeSearchText(part).includes(libraryFilterValue));
  }

  function updateLibrarySummary() {
    if (!librarySummary) {
      return;
    }

    const matchingFavorites = favoritesState.filter((entry) => matchesLibraryFilter([entry.artist, entry.title, entry.meta]));
    const matchingHistory = nowPlayingState.history.filter((entry) => matchesLibraryFilter([entry.artist, entry.title, entry.album]));
    librarySummary.textContent = libraryFilterValue
      ? 'Filter aktiv: ' + matchingFavorites.length + ' Favoriten · ' + matchingHistory.length + ' Historieneinträge passen zu „' + libraryFilterValue + '“.'
      : 'Ohne Filter sichtbar: ' + matchingFavorites.length + ' Favoriten · ' + matchingHistory.length + ' Historieneinträge.';
  }

  function syncTrackActionButtons() {
    if (copyTrackButton) {
      copyTrackButton.disabled = !getCurrentTrackCopyText();
    }
    if (favoritesCopyButton) {
      favoritesCopyButton.disabled = !favoritesState.length;
      favoritesCopyButton.textContent = libraryFilterInput ? 'Sichtbare Favoriten kopieren' : 'Alle Favoriten kopieren';
    }
    if (libraryFilterClearButton) {
      libraryFilterClearButton.disabled = !libraryFilterValue;
    }
  }

  function buildShareData(target) {
    const currentTrack = getCurrentTrackLabel();
    if (target === 'stream') {
      return {
        title: 'jackdarckart Livestream',
        text: currentTrack ? 'Jetzt live im Stream: ' + currentTrack : 'Direkter Livestream von jackdarckart',
        url: STREAM_URL
      };
    }

    if (target === 'website') {
      return {
        title: document.title,
        text: currentTrack ? 'Jetzt live auf stream-musik.space: ' + currentTrack : 'jackdarckart Webradio auf stream-musik.space',
        url: window.location.href
      };
    }

    return {
      title: document.title,
      text: currentTrack ? 'Jetzt live: ' + currentTrack : 'jackdarckart Webradio auf stream-musik.space',
      url: window.location.href
    };
  }

  async function shareTarget(target) {
    const shareData = buildShareData(target);

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        if (shareStatus) {
          shareStatus.textContent = target === 'stream'
            ? 'Direktstream erfolgreich geteilt.'
            : 'Link erfolgreich geteilt.';
        }
        return;
      }

      await copyToClipboard(shareData.url);
      if (shareStatus) {
        shareStatus.textContent = target === 'stream'
          ? 'Direktstream-Link in die Zwischenablage kopiert.'
          : 'Link in die Zwischenablage kopiert.';
      }
    } catch (error) {
      if (shareStatus) {
        shareStatus.textContent = error && error.name === 'AbortError'
          ? 'Teilen wurde abgebrochen.'
          : 'Teilen war nicht möglich. Du kannst die Adresse manuell kopieren.';
      }
    }
  }

  async function handleShare(event) {
    const target = event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.shareTarget || 'page'
      : 'page';
    await shareTarget(target);
  }

  async function handleCopyCurrentTrack() {
    const trackText = getCurrentTrackCopyText();
    if (!trackText) {
      if (shareStatus) {
        shareStatus.textContent = 'Für das Kopieren werden erst verlässliche Now-Playing-Daten benötigt.';
      }
      syncTrackActionButtons();
      return;
    }

    try {
      await copyToClipboard(trackText);
      if (shareStatus) {
        shareStatus.textContent = 'Aktueller Titel in die Zwischenablage kopiert.';
      }
    } catch (error) {
      if (shareStatus) {
        shareStatus.textContent = 'Titel konnte nicht kopiert werden. Bitte markiere den Text manuell.';
      }
    }
  }

  async function handleCopyFavorites() {
    const visibleFavorites = favoritesState.filter((entry) => matchesLibraryFilter([entry.artist, entry.title, entry.meta]));
    if (!visibleFavorites.length) {
      if (favoriteStatus) {
        favoriteStatus.textContent = libraryFilterValue
          ? 'Zum Kopieren passen aktuell keine Favoriten zum aktiven Filter.'
          : 'Es sind noch keine lokalen Favoriten zum Kopieren gespeichert.';
      }
      syncTrackActionButtons();
      return;
    }

    const exportText = visibleFavorites
      .map((entry, index) => String(index + 1) + '. ' + ([entry.artist, entry.title].filter(Boolean).join(' – ') || 'Ohne Titelangabe') + (entry.meta ? ' · ' + entry.meta : ''))
      .join('\n');

    try {
      await copyToClipboard(exportText);
      if (favoriteStatus) {
        favoriteStatus.textContent = libraryFilterValue
          ? 'Sichtbare Favoritenliste in die Zwischenablage kopiert.'
          : (libraryFilterInput ? 'Sichtbare Favoritenliste in die Zwischenablage kopiert.' : 'Komplette Favoritenliste in die Zwischenablage kopiert.');
      }
    } catch (error) {
      if (favoriteStatus) {
        favoriteStatus.textContent = 'Favoritenliste konnte nicht kopiert werden.';
      }
    }
  }

  function rerenderLibraryCollections() {
    renderFavorites();
    renderHistory(
      nowPlayingState.history,
      liveDataStatusState.nowPlaying.lastError
        ? 'Letzte Titel konnten momentan nicht frisch geladen werden. Letzter erfolgreicher Abruf: ' + (liveDataStatusState.nowPlaying.lastSuccessAt ? formatDateTime(liveDataStatusState.nowPlaying.lastSuccessAt) : 'noch keiner') + '.'
        : 'Die offizielle laut.fm-API liefert aktuell keine letzten Songs.'
    );
  }

  function handleLibraryFilterInput(event) {
    libraryFilterValue = normalizeSearchText(event && event.target ? event.target.value : '');
    rerenderLibraryCollections();
  }

  function clearLibraryFilter() {
    libraryFilterValue = '';
    if (libraryFilterInput) {
      libraryFilterInput.value = '';
    }
    rerenderLibraryCollections();
  }

  function setFieldValidity(field, isValid) {
    if (!field) {
      return;
    }

    field.setAttribute('aria-invalid', String(!isValid));
  }

  function validateFeedbackFields() {
    const subject = feedbackSubject ? feedbackSubject.value.trim() : '';
    const messageValue = feedbackMessage ? feedbackMessage.value.trim() : '';
    const name = feedbackName ? feedbackName.value.trim() : '';
    const invalidField = !subject
      ? feedbackSubject
      : (!messageValue || messageValue.length < 5)
        ? feedbackMessage
        : (name.length > 80 ? feedbackName : null);

    setFieldValidity(feedbackSubject, Boolean(subject));
    setFieldValidity(feedbackMessage, Boolean(messageValue) && messageValue.length >= 5);
    setFieldValidity(feedbackName, name.length <= 80);

    if (invalidField) {
      invalidField.focus();
      setText(feedbackStatus, 'Bitte ergänze mindestens einen Betreff und eine Nachricht mit mindestens 5 Zeichen.');
      return null;
    }

    return {
      kind: feedbackKind ? feedbackKind.value : 'feedback',
      name,
      subject,
      message: messageValue
    };
  }

  function buildFeedbackTitle(data) {
    return (data.kind === 'song' ? 'Songwunsch: ' : 'Feedback: ') + data.subject;
  }

  function buildFeedbackBody(data) {
    const lines = [
      data.kind === 'song' ? 'Art: Songwunsch' : 'Art: Feedback',
      data.name ? 'Name: ' + data.name : 'Name: anonym',
      '',
      data.message,
      '',
      'Gesendet über stream-musik.space'
    ];

    const currentTrack = getCurrentTrackLabel();
    if (currentTrack) {
      lines.push('Aktuell angezeigt: ' + currentTrack);
    }

    return lines.join('\n');
  }

  function openUrl(url, options) {
    if (!url) {
      return;
    }

    if (options && options.newTab && typeof window.open === 'function') {
      const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
      if (!openedWindow) {
        window.location.href = url;
        return;
      }
      if (openedWindow && typeof openedWindow === 'object') {
        try {
          openedWindow.opener = null;
        } catch (error) {
          return;
        }
      }
      return;
    }

    window.location.href = url;
  }

  function handleFeedbackAction(target) {
    const data = validateFeedbackFields();
    if (!data) {
      return;
    }

    const title = buildFeedbackTitle(data);
    const body = buildFeedbackBody(data);
    const contactConfig = APP_CONFIG.content.contact || {};
    const email = String(contactConfig.email || '').trim();
    const issueUrl = normalizeUrl(contactConfig.issueUrl);

    if (target === 'email') {
      if (!email) {
        setText(feedbackStatus, 'Aktuell ist keine Mailadresse hinterlegt. Nutze bitte den GitHub-Issue-Fallback.');
        return;
      }

      const mailtoUrl = 'mailto:' + email
        + '?subject=' + encodeURIComponent(title)
        + '&body=' + encodeURIComponent(body);
      setText(feedbackStatus, 'E-Mail wird lokal in deinem Mailprogramm vorbereitet.');
      openUrl(mailtoUrl);
      return;
    }

    if (!issueUrl) {
      setText(feedbackStatus, 'Der GitHub-Issue-Fallback ist derzeit nicht konfiguriert.');
      return;
    }

    const separator = issueUrl.indexOf('?') === -1 ? '?' : '&';
    const issueTarget = issueUrl + separator
      + 'title=' + encodeURIComponent(title)
      + '&body=' + encodeURIComponent(body);
    setText(feedbackStatus, 'GitHub-Issue wird mit deinen lokalen Eingaben vorbereitet.');
    openUrl(issueTarget, { newTab: true });
  }

  function updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) {
      return;
    }

    const currentTrack = nowPlayingState.current;
    const artworkType = currentTrack && currentTrack.artworkUrl ? getArtworkMimeType(currentTrack.artworkUrl) : '';
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: currentTrack && currentTrack.title ? currentTrack.title : 'jackdarckart Radio',
      artist: currentTrack && currentTrack.artist ? currentTrack.artist : 'laut.fm',
      album: currentTrack && currentTrack.album ? currentTrack.album : 'stream-musik.space',
      artwork: currentTrack && currentTrack.artworkUrl
        ? [Object.assign({ src: currentTrack.artworkUrl, sizes: '512x512' }, artworkType ? { type: artworkType } : {})]
        : []
    });
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) {
      return;
    }

    updateMediaSessionMetadata();

    try {
      navigator.mediaSession.setActionHandler('play', () => startPlayback(false, shouldForceReloadOnStart()));
      navigator.mediaSession.setActionHandler('pause', pausePlayback);
    } catch (error) {
      return;
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function isEditableTarget(target) {
    if (!target || typeof target !== 'object') {
      return false;
    }

    const tagName = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
    return tagName === 'INPUT'
      || tagName === 'TEXTAREA'
      || tagName === 'SELECT'
      || tagName === 'BUTTON'
      || tagName === 'A'
      || Boolean(target.isContentEditable);
  }

  function handleKeyboardShortcuts(event) {
    if (!event || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
      return;
    }

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        togglePlayback();
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        if (audio) {
          if (audio.muted && audio.volume === 0) {
            updateVolume(lastAudibleVolume || 70);
            audio.muted = false;
          } else {
            audio.muted = !audio.muted;
          }
          updateMuteButton();
          writeStorage(STORAGE_KEYS.muted, String(audio.muted));
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        updateVolume((Number.parseInt(volumeInput && volumeInput.value ? volumeInput.value : '0', 10) || 0) + 5);
        break;
      case 'ArrowDown':
        event.preventDefault();
        updateVolume((Number.parseInt(volumeInput && volumeInput.value ? volumeInput.value : '0', 10) || 0) - 5);
        break;
      case 's':
      case 'S':
        event.preventDefault();
        shareTarget('website');
        break;
      case 't':
      case 'T':
        event.preventDefault();
        scrollToTop();
        break;
      default:
        break;
    }
  }

  function setBackToTopVisibility() {
    if (backToTopButton) {
      backToTopButton.classList.toggle('is-visible', window.scrollY > 480);
    }

    if (!stickyPlayer) {
      return;
    }

    const stickyAnchor = playButton || status;
    const stickyAnchorRect = stickyAnchor && typeof stickyAnchor.getBoundingClientRect === 'function'
      ? stickyAnchor.getBoundingClientRect()
      : null;
    const stickyAnchorVisible = Boolean(stickyAnchorRect) && stickyAnchorRect.top < window.innerHeight && stickyAnchorRect.bottom > 0;
    stickyPlayer.classList.toggle('is-visible', window.scrollY > 260 && !stickyAnchorVisible);
  }

  function bindNavigation() {
    if (!menuToggle || !siteNav) {
      return;
    }

    bindManagedEvent(menuToggle, 'click', () => {
      if (siteNav.classList.contains('is-open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    siteNav.querySelectorAll('a').forEach((link) => {
      bindManagedEvent(link, 'click', closeMenu);
    });

    bindManagedEvent(document, 'click', (event) => {
      if (!siteNav.classList.contains('is-open')) {
        return;
      }
      if (siteNav.contains(event.target) || menuToggle.contains(event.target)) {
        return;
      }
      closeMenu();
    });

    bindManagedEvent(document, 'keydown', (event) => {
      if (event.key === 'Escape' && siteNav.classList.contains('is-open')) {
        closeMenu();
        menuToggle.focus();
      }
    });
  }

  function getClosestAnchor(target) {
    let node = target;

    while (node) {
      if (node.tagName && String(node.tagName).toLowerCase() === 'a' && node.href) {
        return node;
      }
      node = node.parentElement || node.parentNode || null;
    }

    return null;
  }

  function isInternalPageUrl(url) {
    if (!url || url.origin !== window.location.origin) {
      return false;
    }

    return url.pathname === '/' || /\.html$/i.test(url.pathname);
  }

  function hasPersistentShellContent(parsedDocument, sourceHtml) {
    if (parsedDocument && typeof parsedDocument.getElementById === 'function' && parsedDocument.getElementById('content')) {
      return true;
    }

    return /<main[^>]*\bid\s*=\s*["']content["'][^>]*>/i.test(sourceHtml);
  }

  function hasPersistentShellSiteNav(parsedDocument, sourceHtml) {
    if (parsedDocument && typeof parsedDocument.getElementById === 'function' && parsedDocument.getElementById('site-nav')) {
      return true;
    }

    return /<nav[^>]*\bid\s*=\s*["']site-nav["'][^>]*>/i.test(sourceHtml);
  }

  function hasPersistentShellFooterNav(parsedDocument, sourceHtml) {
    if (parsedDocument && typeof parsedDocument.querySelector === 'function' && parsedDocument.querySelector('nav.footer-nav')) {
      return true;
    }

    return /<nav[^>]*\bclass\s*=\s*["'][^"']*\bfooter-nav\b[^"']*["'][^>]*>/i.test(sourceHtml);
  }

  function isTrustedShellResponseHtml(html, parsedDocument) {
    if (typeof html !== 'string' || !html.trim()) {
      return false;
    }

    const parsed = parsedDocument || parsePersistentShellDocument(html);
    return hasPersistentShellContent(parsed, html)
      && hasPersistentShellSiteNav(parsed, html)
      && hasPersistentShellFooterNav(parsed, html);
  }

  function getPersistentPageRequestUrl(url) {
    try {
      const requestUrl = new window.URL(url.href || url, window.location.href);
      requestUrl.hash = '';
      return requestUrl.href;
    } catch (error) {
      return '';
    }
  }

  function getPersistentPageCacheUrl(url) {
    try {
      const cacheUrl = new window.URL(url.href || url, window.location.href);
      cacheUrl.hash = '';
      if (isInternalPageUrl(cacheUrl)) {
        cacheUrl.search = '';
      }
      return cacheUrl.href;
    } catch (error) {
      return '';
    }
  }

  async function readCachedPersistentShellResponse(destination) {
    if (!window.caches || typeof window.caches.match !== 'function') {
      return null;
    }

    const requestUrl = getPersistentPageRequestUrl(destination);
    const cacheUrl = getPersistentPageCacheUrl(destination);
    const candidates = requestUrl && cacheUrl && requestUrl !== cacheUrl
      ? [requestUrl, cacheUrl]
      : [requestUrl || cacheUrl];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        const cachedResponse = await window.caches.match(candidate);
        if (cachedResponse) {
          return cachedResponse;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  async function fetchPersistentShellResponse(destination) {
    let response = null;
    let networkError = null;

    try {
      response = await window.fetch(destination.href, { credentials: 'same-origin' });
    } catch (error) {
      networkError = error;
    }

    if (response && response.ok) {
      return response;
    }

    const cachedResponse = await readCachedPersistentShellResponse(destination);
    if (cachedResponse) {
      return cachedResponse;
    }

    if (response && !response.ok) {
      throw new Error('page-unavailable');
    }

    throw networkError || new Error('page-unavailable');
  }

  function shouldHandleInternalNavigation(link, event) {
    if (!link || !link.href || typeof window.fetch !== 'function') {
      return false;
    }

    if (event && (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
      return false;
    }

    if (event && typeof event.button === 'number' && event.button !== 0) {
      return false;
    }

    if (link.target && link.target !== '_self') {
      return false;
    }

    if (typeof link.hasAttribute === 'function' && link.hasAttribute('download')) {
      return false;
    }

    const destination = new window.URL(link.href, window.location.href);
    if (!isInternalPageUrl(destination)) {
      return false;
    }

    const currentUrl = new window.URL(window.location.href);
    if (destination.pathname === currentUrl.pathname && destination.search === currentUrl.search && destination.hash === currentUrl.hash) {
      return false;
    }
    if (destination.pathname === currentUrl.pathname && destination.search === currentUrl.search && destination.hash && destination.hash !== currentUrl.hash) {
      return false;
    }

    return true;
  }

  function parsePersistentShellDocument(html) {
    if (typeof window.DOMParser !== 'function') {
      return null;
    }

    try {
      return new window.DOMParser().parseFromString(html, 'text/html');
    } catch (error) {
      return null;
    }
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractElementInnerHtmlFromSource(sourceHtml, tagName, attributeName, attributeValue) {
    if (typeof sourceHtml !== 'string' || !sourceHtml.trim()) {
      return '';
    }

    const safeTagName = escapeRegExp(tagName);
    const attributeSegment = attributeName && attributeValue
      ? '\\b' + escapeRegExp(attributeName) + '\\s*=\\s*["\']' + escapeRegExp(attributeValue) + '["\']'
      : '';
    const pattern = new RegExp(
      '<' + safeTagName + '(?=[^>]*' + attributeSegment + ')[^>]*>([\\s\\S]*?)<\\/' + safeTagName + '>',
      'i'
    );
    const match = sourceHtml.match(pattern);
    return match ? match[1] : '';
  }

  function extractFooterNavInnerHtmlFromSource(sourceHtml) {
    if (typeof sourceHtml !== 'string' || !sourceHtml.trim()) {
      return '';
    }

    const match = sourceHtml.match(/<nav[^>]*class=["'][^"']*\bfooter-nav\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i);
    return match ? match[1] : '';
  }

  function extractDocumentTitleFromSource(sourceHtml) {
    if (typeof sourceHtml !== 'string' || !sourceHtml.trim()) {
      return '';
    }

    const match = sourceHtml.match(/<title>([\s\S]*?)<\/title>/i);
    return match ? match[1] : '';
  }

  function extractDocumentLanguageFromSource(sourceHtml) {
    if (typeof sourceHtml !== 'string' || !sourceHtml.trim()) {
      return '';
    }

    const match = sourceHtml.match(/<html[^>]*\blang\s*=\s*["']([^"']+)["']/i);
    return match ? match[1] : '';
  }

  function extractPersistentShellContentInnerHtml(parsedDocument, sourceHtml) {
    if (parsedDocument && typeof parsedDocument.getElementById === 'function') {
      const contentElement = parsedDocument.getElementById('content');
      if (contentElement && typeof contentElement.innerHTML === 'string') {
        return contentElement.innerHTML;
      }
    }

    return extractElementInnerHtmlFromSource(sourceHtml, 'main', 'id', 'content');
  }

  function extractPersistentShellSiteNavInnerHtml(parsedDocument, sourceHtml) {
    if (parsedDocument && typeof parsedDocument.getElementById === 'function') {
      const siteNavElement = parsedDocument.getElementById('site-nav');
      if (siteNavElement && typeof siteNavElement.innerHTML === 'string') {
        return siteNavElement.innerHTML;
      }
    }

    return extractElementInnerHtmlFromSource(sourceHtml, 'nav', 'id', 'site-nav');
  }

  function extractPersistentShellFooterNavInnerHtml(parsedDocument, sourceHtml) {
    if (parsedDocument && typeof parsedDocument.querySelector === 'function') {
      const footerNavElement = parsedDocument.querySelector('nav.footer-nav');
      if (footerNavElement && typeof footerNavElement.innerHTML === 'string') {
        return footerNavElement.innerHTML;
      }
    }

    return extractFooterNavInnerHtmlFromSource(sourceHtml);
  }

  function replacePersistentShellDocument(parsedDocument, sourceHtml) {
    if (!document || !document.body) {
      return false;
    }

    const currentContent = document.getElementById('content');
    if (!currentContent) {
      return false;
    }

    const nextContentHtml = extractPersistentShellContentInnerHtml(parsedDocument, sourceHtml);
    if (!hasPersistentShellContent(parsedDocument, sourceHtml)) {
      return false;
    }

    const nextLanguage = parsedDocument && parsedDocument.documentElement && typeof parsedDocument.documentElement.getAttribute === 'function'
      ? parsedDocument.documentElement.getAttribute('lang')
      : extractDocumentLanguageFromSource(sourceHtml);
    if (nextLanguage && document.documentElement && typeof document.documentElement.setAttribute === 'function') {
      document.documentElement.setAttribute('lang', nextLanguage);
    }

    const nextTitle = parsedDocument && typeof parsedDocument.title === 'string'
      ? parsedDocument.title
      : extractDocumentTitleFromSource(sourceHtml);
    if (nextTitle && typeof document.title === 'string') {
      document.title = nextTitle;
    }

    currentContent.innerHTML = nextContentHtml;

    const currentSiteNav = document.getElementById('site-nav');
    const nextSiteNavInnerHtml = extractPersistentShellSiteNavInnerHtml(parsedDocument, sourceHtml);
    if (currentSiteNav && hasPersistentShellSiteNav(parsedDocument, sourceHtml)) {
      currentSiteNav.innerHTML = nextSiteNavInnerHtml;
    }

    const currentFooterNav = safeQuerySelector('nav.footer-nav');
    const nextFooterNavInnerHtml = extractPersistentShellFooterNavInnerHtml(parsedDocument, sourceHtml);
    if (currentFooterNav && hasPersistentShellFooterNav(parsedDocument, sourceHtml)) {
      currentFooterNav.innerHTML = nextFooterNavInnerHtml;
    }

    return true;
  }

  function finalizePersistentNavigation(destination) {
    if (destination && destination.hash) {
      const targetId = decodeURIComponent(destination.hash.slice(1));
      const target = targetId ? document.getElementById(targetId) : null;
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView();
      }
    } else if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    if (typeof window.__JACKDARCKART_BOOTSTRAP__ !== 'function') {
      throw new Error('shell-bootstrap-missing');
    }

    window[INTERNAL_NAVIGATION_KEY] = false;
    window.__JACKDARCKART_BOOTSTRAP__();
  }

  async function navigateWithinPersistentShell(targetUrl, options) {
    const destination = new window.URL(targetUrl, window.location.href);

    if (!isInternalPageUrl(destination)) {
      window.location.href = destination.href;
      return;
    }

    if (window[INTERNAL_NAVIGATION_KEY]) {
      return;
    }

    window[INTERNAL_NAVIGATION_KEY] = true;

    try {
      const response = await fetchPersistentShellResponse(destination);
      const html = await response.text();
      const parsedDocument = parsePersistentShellDocument(html);
      if (!isTrustedShellResponseHtml(html, parsedDocument)) {
        throw new Error('page-untrusted');
      }
      destroyApp({ preserveAudio: true });

      if (!options || !options.fromPopState) {
        if (options && options.replace) {
          window.history.replaceState(null, '', destination.href);
        } else {
          window.history.pushState(null, '', destination.href);
        }
      }

      if (!replacePersistentShellDocument(parsedDocument, html)) {
        throw new Error('page-replace-failed');
      }
      finalizePersistentNavigation(destination);
    } catch (error) {
      window[INTERNAL_NAVIGATION_KEY] = false;
      window[PERSISTENT_AUDIO_KEY] = null;
      window[PERSISTENT_STATE_KEY] = null;
      window.location.href = destination.href;
    }
  }

  function bindPersistentInternalNavigation() {
    if (typeof window.fetch !== 'function') {
      return;
    }

    bindManagedEvent(document, 'click', (event) => {
      const link = getClosestAnchor(event.target);
      if (!shouldHandleInternalNavigation(link, event)) {
        return;
      }

      event.preventDefault();
      navigateWithinPersistentShell(link.href);
    }, true);

    bindManagedEvent(window, 'popstate', () => {
      if (window[INTERNAL_NAVIGATION_KEY]) {
        return;
      }

      navigateWithinPersistentShell(window.location.href, { fromPopState: true, replace: true });
    });
  }

  function restorePersistentShellState() {
    if (!restoredPersistentState || typeof restoredPersistentState !== 'object') {
      return false;
    }

    if (Number.isFinite(Number(restoredPersistentState.lastAudibleVolume))) {
      lastAudibleVolume = Math.max(0, Math.min(100, Number(restoredPersistentState.lastAudibleVolume)));
    }
    lastSuccessfulStartAt = restoredPersistentState.lastSuccessfulStartAt || lastSuccessfulStartAt;
    lastErrorMessage = restoredPersistentState.lastErrorMessage || lastErrorMessage;
    lastPauseReason = restoredPersistentState.lastPauseReason || '';
    hasConfirmedPlayback = Boolean(restoredPersistentState.hasConfirmedPlayback);
    wantsPlayback = Boolean(restoredPersistentState.wantsPlayback);

    if (Number.isFinite(Number(restoredPersistentState.sleepEndAt)) && Number(restoredPersistentState.sleepEndAt) > Date.now()) {
      sleepEndAt = Number(restoredPersistentState.sleepEndAt);
    } else {
      sleepEndAt = 0;
    }

    if (audio) {
      const restoredVolume = Number.isFinite(Number(restoredPersistentState.volume))
        ? Number(restoredPersistentState.volume)
        : getStoredVolume();
      updateVolume(restoredVolume, { persist: false });
      audio.muted = typeof restoredPersistentState.muted === 'boolean'
        ? restoredPersistentState.muted
        : (getStoredMuted() || audio.volume === 0);
    }

    updateMuteButton();

    if (sleepEndAt) {
      updateSleepTimerStatus();
      tickSleepTimer();
    } else {
      updateSleepTimerStatus('Kein Sleep-Timer aktiv.');
    }

    if (audio && !audio.paused) {
      wantsPlayback = true;
      hasConfirmedPlayback = true;
      setState('playing', 'Der Livestream läuft.', 'Du hörst jetzt jackdarckart direkt über den offiziellen laut.fm-Stream im Browser.');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      return true;
    }

    if (restoredPersistentState.currentState === 'loading' && wantsPlayback) {
      setState('loading', 'Livestream bleibt aktiv …', 'Die Seite wurde ohne vollständigen Reload innerhalb der App-Shell gewechselt. Die laufende Audioinstanz bleibt erhalten.');
      return true;
    }

    if (restoredPersistentState.currentState === 'blocked') {
      setState(
        'blocked',
        'Browser blockiert die Wiedergabe.',
        'Bitte tippe erneut auf „Stream starten“ oder „Erneut versuchen“. Erst danach gibt der Browser den Livestream für diese Seite frei.'
      );
      return true;
    }

    if (restoredPersistentState.currentState === 'error') {
      setState('error', 'Stream momentan nicht verfügbar.', getNetworkFailureText());
      return true;
    }

    if (restoredPersistentState.currentState === 'paused' || restoredPersistentState.hasConfirmedPlayback) {
      wantsPlayback = false;
      setState('paused', 'Der Stream ist pausiert.', 'Starte die Wiedergabe jederzeit erneut oder wechsle auf einen externen Hörweg.');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      return true;
    }

    return false;
  }

  function clearElement(element) {
    if (!element) {
      return;
    }

    element.textContent = '';
    if (Array.isArray(element.children)) {
      while (element.children.length) {
        element.removeChild(element.children[0]);
      }
      return;
    }

    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function createDetailBlock(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function appendOptionalText(parent, tagName, className, text) {
    if (!parent || !text) {
      return;
    }

    parent.appendChild(createDetailBlock(tagName, className, text));
  }

  function createListBlock(className, items) {
    if (!Array.isArray(items) || !items.length) {
      return null;
    }

    const list = document.createElement('ul');
    list.className = className;
    items.forEach((item) => {
      if (!item) {
        return;
      }
      list.appendChild(createDetailBlock('li', '', item));
    });
    return list;
  }

  function createDetailsDisclosure(config) {
    if (!config || !config.summary) {
      return null;
    }

    const details = document.createElement('details');
    details.className = 'empty-state-details';
    details.appendChild(createDetailBlock('summary', '', config.summary));
    const body = document.createElement('div');
    body.className = 'details-copy';
    appendOptionalText(body, 'p', '', config.text || '');
    const list = createListBlock('inline-list', config.items || []);
    if (list) {
      body.appendChild(list);
    }
    details.appendChild(body);
    return details;
  }

  function renderCollection(container, items, options) {
    if (!container) {
      return;
    }

    clearElement(container);

    if (!Array.isArray(items) || items.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      appendOptionalText(emptyState, 'h4', 'empty-state-title', options.emptyTitle || 'Aktuell keine Einträge');
      appendOptionalText(emptyState, 'p', 'empty-state-copy', options.emptyText || '');
      appendOptionalText(emptyState, 'p', 'empty-state-hint', options.hintText || '');
      const bulletList = createListBlock('empty-state-list', options.emptyItems || []);
      if (bulletList) {
        emptyState.appendChild(bulletList);
      }
      appendOptionalText(emptyState, 'p', 'empty-state-note', options.noteText || '');
      const details = createDetailsDisclosure(options.emptyDetails);
      if (details) {
        emptyState.appendChild(details);
      }
      container.appendChild(emptyState);
      return;
    }

    items.forEach((item) => {
      const article = document.createElement(options.itemTag || 'article');
      article.className = options.itemClassName;

      const heading = createDetailBlock(options.headingTag || 'h3', options.headingClassName || '', item.title || item.label || 'Eintrag');
      article.appendChild(heading);

      if (item.meta) {
        article.appendChild(createDetailBlock('p', 'content-meta', item.meta));
      }

      if (item.description) {
        article.appendChild(createDetailBlock('p', 'content-description', item.description));
      }

      if (item.url) {
        const link = document.createElement('a');
        link.className = 'content-link';
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.linkLabel || 'Öffnen';
        article.appendChild(link);
      }

      container.appendChild(article);
    });
  }

  function renderPlatformLinks() {
    renderCollection(platformLinks, APP_CONFIG.content.platformLinks.filter((entry) => entry && entry.url), {
      itemTag: 'article',
      itemClassName: 'platform-link-card',
      headingTag: 'h3',
      emptyTitle: 'Noch keine zusätzlichen Plattform-Links gepflegt.',
      emptyText: 'Dieser Bereich zeigt nur bewusst hinterlegte Ziele wie laut.fm, Direktstream, Support- oder verifizierte Profil-Links.',
      hintText: 'Pflege Plattform-Links in APP_CONFIG.content.platformLinks, sobald ein Ziel wirklich geprüft und veröffentlicht werden soll.',
      emptyItems: [
        'Keine Social-Profile oder Kontaktwege werden hier automatisch erfunden.',
        'Leere Zustände bedeuten daher: aktuell nichts zusätzlich bestätigt.'
      ]
    });
  }

  function getLautFmPollIntervalMs() {
    return Math.max(15000, Number.parseInt(String(APP_CONFIG.lautFm.pollIntervalMs), 10) || 45000);
  }

  function getStationPollIntervalMs() {
    return Math.max(getLautFmPollIntervalMs(), Number.parseInt(String(APP_CONFIG.lautFm.stationPollIntervalMs), 10) || 180000);
  }

  function getSchedulePollIntervalMs() {
    return Math.max(getLautFmPollIntervalMs(), Number.parseInt(String(APP_CONFIG.lautFm.schedulePollIntervalMs), 10) || 180000);
  }

  function getLautFmTimeoutMs() {
    return Math.max(3000, Number.parseInt(String(APP_CONFIG.lautFm.requestTimeoutMs), 10) || 12000);
  }

  function normalizeHttpsUrl(value) {
    const normalized = normalizeUrl(value);
    if (!normalized) {
      return '';
    }

    try {
      const parsed = new window.URL(normalized);
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch (error) {
      return '';
    }
  }

  function normalizeOptionalText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function readFirstText(values) {
    for (let index = 0; index < values.length; index += 1) {
      const value = normalizeOptionalText(values[index]);
      if (value) {
        return value;
      }
    }
    return '';
  }

  function normalizeArtistName(source) {
    if (source && typeof source === 'object') {
      return readFirstText([source.name, source.display_name, source.title]);
    }
    return normalizeOptionalText(source);
  }

  function normalizeArtworkUrl(source) {
    if (!source) {
      return '';
    }

    if (typeof source === 'string') {
      return normalizeHttpsUrl(source);
    }

    if (Array.isArray(source)) {
      for (let index = 0; index < source.length; index += 1) {
        const normalized = normalizeArtworkUrl(source[index]);
        if (normalized) {
          return normalized;
        }
      }
      return '';
    }

    if (typeof source === 'object') {
      const candidates = [
        source.art,
        source.cover,
        source.image,
        source.logo,
        source.url,
        source.large,
        source.medium,
        source.small,
        source['300x300'],
        source['180x180'],
        source['120x120'],
        source['100x100'],
        source['50x50']
      ];
      if (Array.isArray(source.images)) {
        candidates.push(source.images);
      }
      for (let index = 0; index < candidates.length; index += 1) {
        const normalized = normalizeArtworkUrl(candidates[index]);
        if (normalized) {
          return normalized;
        }
      }
    }

    return '';
  }

  function getArtworkMimeType(url) {
    const normalized = normalizeHttpsUrl(url);
    if (!normalized) {
      return '';
    }

    try {
      const pathname = new window.URL(normalized).pathname.toLowerCase();
      if (pathname.endsWith('.png')) {
        return 'image/png';
      }
      if (pathname.endsWith('.webp')) {
        return 'image/webp';
      }
      if (pathname.endsWith('.gif')) {
        return 'image/gif';
      }
      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
        return 'image/jpeg';
      }
    } catch (error) {
      return '';
    }

    return '';
  }

  function normalizeIsoTimestamp(value) {
    const text = normalizeOptionalText(value);
    if (!text) {
      return '';
    }
    return Number.isNaN(Date.parse(text)) ? '' : text;
  }

  function normalizeTrack(source) {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const title = readFirstText([source.title, source.name]);
    const artist = normalizeArtistName(source.artist || source.interpret || source.creator || source.dj);
    const album = readFirstText([source.album, source.release]);
    const artworkUrl = normalizeArtworkUrl(source.art || source.cover || source.image || source.artwork);
    const startedAt = normalizeIsoTimestamp(source.started_at || source.startedAt || source.start);
    const endsAt = normalizeIsoTimestamp(source.ends_at || source.endsAt || source.end);

    if (!title && !artist) {
      return null;
    }

    return {
      title,
      artist,
      album,
      artworkUrl,
      startedAt,
      endsAt
    };
  }

  function normalizeStationProfile(source) {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const name = readFirstText([source.display_name, source.name]);
    const description = readFirstText([source.description, source.tagline, source.claim]);
    const genres = Array.isArray(source.genres)
      ? source.genres.map((entry) => normalizeOptionalText(entry && entry.name ? entry.name : entry)).filter(Boolean)
      : [];
    const imageUrl = normalizeArtworkUrl(source.images || source.image || source.logo);
    const pageUrl = normalizeHttpsUrl(source.page_url || source.website || source.url);
    const streamUrl = normalizeHttpsUrl(source.stream_url);

    if (!name && !description && !genres.length && !pageUrl) {
      return null;
    }

    return {
      name,
      description,
      genres,
      imageUrl,
      pageUrl,
      streamUrl
    };
  }

  function normalizeListenersCount(source) {
    const raw = source && typeof source === 'object' ? source.listeners : source;
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw || ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function normalizeNextArtists(source) {
    const input = Array.isArray(source) ? source : [];
    const seen = new Set();
    const result = [];

    input.forEach((entry) => {
      const name = entry && typeof entry === 'object'
        ? readFirstText([entry.name, entry.display_name, entry.artist])
        : normalizeOptionalText(entry);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(name);
    });

    return result.slice(0, 8);
  }

  function normalizeScheduleEntries(source) {
    return (Array.isArray(source) ? source : [])
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const startsAt = normalizeIsoTimestamp(entry.starts || entry.start || entry.started_at);
        const endsAt = normalizeIsoTimestamp(entry.ends || entry.end || entry.ends_at);
        const title = readFirstText([
          entry.title,
          entry.name,
          entry.playlist && entry.playlist.name,
          entry.show && entry.show.name
        ]) || 'Programmpunkt';
        const description = readFirstText([
          entry.description,
          entry.playlist && entry.playlist.description
        ]);
        const type = readFirstText([entry.type, entry.kind]);
        const host = readFirstText([
          entry.host,
          entry.dj,
          entry.playlist && entry.playlist.user && entry.playlist.user.name
        ]);
        const linkUrl = normalizeHttpsUrl(
          entry.page_url
          || (entry.playlist && (entry.playlist.page_url || entry.playlist.url))
          || entry.url
        );

        if (!startsAt || !endsAt) {
          return null;
        }

        return {
          title,
          description,
          type,
          host,
          startsAt,
          endsAt,
          url: linkUrl
        };
      })
      .filter(Boolean)
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  }

  function normalizeFavoriteTrack(track) {
    if (!track || typeof track !== 'object') {
      return null;
    }

    const normalized = {
      title: String(track.title || '').trim(),
      artist: String(track.artist || '').trim(),
      meta: String(track.album || track.meta || '').trim()
    };
    normalized.key = [normalized.artist, normalized.title, normalized.meta]
      .map((value) => value.toLowerCase())
      .join('|');

    return normalized.key && (normalized.title || normalized.artist) ? normalized : null;
  }

  function isFavoriteTrack(track) {
    const normalized = normalizeFavoriteTrack(track);
    return Boolean(normalized) && favoritesState.some((entry) => entry.key === normalized.key);
  }

  function syncFavoriteButton() {
    if (!favoriteTrackButton) {
      return;
    }

    const hasTrack = Boolean(normalizeFavoriteTrack(nowPlayingState.current));
    const active = hasTrack && isFavoriteTrack(nowPlayingState.current);
    favoriteTrackButton.disabled = !hasTrack;
    favoriteTrackButton.textContent = active ? 'Favorit entfernen' : 'Zu Favoriten';
    favoriteTrackButton.dataset.state = active ? 'active' : 'ready';
    syncTrackActionButtons();
  }

  function renderFavorites() {
    if (!favoritesList || !favoritesEmpty) {
      return;
    }

    const visibleFavorites = favoritesState.filter((entry) => matchesLibraryFilter([entry.artist, entry.title, entry.meta]));
    clearElement(favoritesList);

    if (!favoritesState.length) {
      favoritesList.hidden = true;
      favoritesEmpty.hidden = false;
      favoritesEmpty.textContent = 'Noch keine lokalen Favoriten gespeichert.';
      if (favoritesClearButton) {
        favoritesClearButton.disabled = true;
      }
      syncFavoriteButton();
      updateLibrarySummary();
      return;
    }

    favoritesList.hidden = false;
    favoritesEmpty.hidden = visibleFavorites.length > 0;
    if (favoritesClearButton) {
      favoritesClearButton.disabled = false;
    }
    if (!visibleFavorites.length) {
      favoritesEmpty.textContent = 'Kein gespeicherter Favorit passt aktuell zum gesetzten Filter.';
    }

    visibleFavorites.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'favorite-item';

      const copy = document.createElement('div');
      copy.className = 'favorite-copy';
      copy.appendChild(createDetailBlock('p', 'history-track', [entry.artist, entry.title].filter(Boolean).join(' – ') || 'Ohne Titelangabe'));
      copy.appendChild(createDetailBlock('p', 'history-meta', entry.meta || (entry.savedAt ? 'Gespeichert am ' + formatDateTime(entry.savedAt) : 'Lokal gespeichert')));
      item.appendChild(copy);

      const removeButton = document.createElement('button');
      removeButton.className = 'button secondary';
      removeButton.type = 'button';
      removeButton.textContent = 'Entfernen';
      removeButton.dataset.favoriteKey = entry.key;
      item.appendChild(removeButton);
      favoritesList.appendChild(item);
    });

    syncFavoriteButton();
    updateLibrarySummary();
  }

  function removeFavoriteByKey(favoriteKey) {
    if (!favoriteKey) {
      return;
    }

    favoritesState = favoritesState.filter((favorite) => favorite.key !== favoriteKey);
    if (!writeJsonStorage(STORAGE_KEYS.favorites, favoritesState)) {
      setText(favoriteStatus, 'Favorit konnte nicht lokal aktualisiert werden.');
    } else {
      setText(favoriteStatus, 'Favorit entfernt.');
    }
    renderFavorites();
  }

  function loadFavorites() {
    favoritesState = getFavoriteStorageEntries();
    renderFavorites();
  }

  function toggleCurrentFavorite() {
    const currentTrack = normalizeFavoriteTrack(nowPlayingState.current);
    if (!currentTrack) {
      setText(favoriteStatus, 'Für Favoriten werden erst verlässliche Now-Playing-Daten benötigt.');
      syncFavoriteButton();
      return;
    }

    if (favoritesState.some((entry) => entry.key === currentTrack.key)) {
      favoritesState = favoritesState.filter((entry) => entry.key !== currentTrack.key);
      if (!writeJsonStorage(STORAGE_KEYS.favorites, favoritesState)) {
        setText(favoriteStatus, 'Favorit konnte nicht lokal entfernt werden.');
      } else {
        setText(favoriteStatus, 'Favorit entfernt.');
      }
      renderFavorites();
      return;
    }

    favoritesState = [
      {
        key: currentTrack.key,
        title: currentTrack.title,
        artist: currentTrack.artist,
        meta: currentTrack.meta,
        savedAt: new Date().toISOString()
      }
    ].concat(favoritesState).slice(0, 50);

    if (!writeJsonStorage(STORAGE_KEYS.favorites, favoritesState)) {
      favoritesState = getFavoriteStorageEntries();
      setText(favoriteStatus, 'Favorit konnte nicht lokal gespeichert werden.');
    } else {
      setText(favoriteStatus, 'Favorit lokal gespeichert.');
    }
    renderFavorites();
  }

  function clearFavorites() {
    favoritesState = [];
    if (!writeJsonStorage(STORAGE_KEYS.favorites, favoritesState)) {
      setText(favoriteStatus, 'Favoriten konnten nicht geleert werden.');
      favoritesState = getFavoriteStorageEntries();
    } else {
      setText(favoriteStatus, 'Lokale Favoritenliste geleert.');
    }
    renderFavorites();
  }

  function formatDateTimeInTimeZone(value, timeZone) {
    const timestamp = value ? new Date(value) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      return '';
    }

    if (!(typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function')) {
      return DATE_TIME_FORMATTER ? DATE_TIME_FORMATTER.format(timestamp) : timestamp.toISOString();
    }

    try {
      return new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone
      }).format(timestamp);
    } catch (error) {
      return DATE_TIME_FORMATTER ? DATE_TIME_FORMATTER.format(timestamp) : timestamp.toISOString();
    }
  }

  function getScheduleTimeZone() {
    return normalizeOptionalText(APP_CONFIG.lautFm.scheduleTimeZone)
      || ((typeof Intl !== 'undefined' && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions)
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : '')
      || 'Europe/Berlin';
  }

  function getCalendarPartsInTimeZone(value, timeZone) {
    const timestamp = value ? new Date(value) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      return null;
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      if (typeof formatter.formatToParts === 'function') {
        const parts = formatter.formatToParts(timestamp);
        const year = parts.find((part) => part.type === 'year');
        const month = parts.find((part) => part.type === 'month');
        const day = parts.find((part) => part.type === 'day');
        if (year && month && day) {
          return {
            year: Number.parseInt(year.value, 10),
            month: Number.parseInt(month.value, 10),
            day: Number.parseInt(day.value, 10)
          };
        }
      }
      const formatted = formatter.format(timestamp);
      const match = formatted.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return {
          year: Number.parseInt(match[1], 10),
          month: Number.parseInt(match[2], 10),
          day: Number.parseInt(match[3], 10)
        };
      }
      return null;
    } catch (error) {
      return {
        year: timestamp.getUTCFullYear(),
        month: timestamp.getUTCMonth() + 1,
        day: timestamp.getUTCDate()
      };
    }
  }

  function buildDateKeyFromCalendarParts(parts, dayOffset) {
    if (!parts) {
      return '';
    }

    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset)).toISOString().slice(0, 10);
  }

  function getDateKeyInTimeZone(value, timeZone) {
    return buildDateKeyFromCalendarParts(getCalendarPartsInTimeZone(value, timeZone), 0);
  }

  function getWeekdayIndexInTimeZone(value, timeZone) {
    const timestamp = value ? new Date(value) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      return new Date().getDay();
    }

    try {
      const label = new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone }).format(timestamp);
      return Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX_BY_LABEL, label.toLocaleLowerCase('de-DE'))
        ? WEEKDAY_INDEX_BY_LABEL[label.toLocaleLowerCase('de-DE')]
        : timestamp.getDay();
    } catch (error) {
      return timestamp.getDay();
    }
  }

  function getScheduleFilterValue() {
    if (!scheduleFilterSelect) {
      return 'all';
    }
    return ['today', 'tomorrow', 'week', 'all'].includes(scheduleFilterSelect.value)
      ? scheduleFilterSelect.value
      : 'week';
  }

  function getFilteredScheduleUpcoming(snapshot) {
    const filterValue = getScheduleFilterValue();
    const timeZone = snapshot.timeZone;
    const todayParts = getCalendarPartsInTimeZone(new Date(), timeZone);
    const todayKey = buildDateKeyFromCalendarParts(todayParts, 0);
    const tomorrowKey = buildDateKeyFromCalendarParts(todayParts, 1);

    if (filterValue === 'today') {
      return snapshot.allUpcoming.filter((entry) => getDateKeyInTimeZone(entry.startsAt, timeZone) === todayKey);
    }
    if (filterValue === 'tomorrow') {
      return snapshot.allUpcoming.filter((entry) => getDateKeyInTimeZone(entry.startsAt, timeZone) === tomorrowKey);
    }
    if (filterValue === 'week') {
      const todayWeekday = getWeekdayIndexInTimeZone(new Date(), timeZone);
      const localizedWeekday = todayWeekday === 0 ? 7 : todayWeekday;
      const allowedDateKeys = new Set();
      for (let offset = 0; offset <= (7 - localizedWeekday); offset += 1) {
        allowedDateKeys.add(buildDateKeyFromCalendarParts(todayParts, offset));
      }
      return snapshot.allUpcoming.filter((entry) => allowedDateKeys.has(getDateKeyInTimeZone(entry.startsAt, timeZone)));
    }
    return snapshot.allUpcoming;
  }

  function renderScheduleSummary(snapshot, filteredEntries) {
    if (!scheduleSummary) {
      return;
    }

    const labels = {
      today: 'heute',
      tomorrow: 'morgen',
      week: 'diese Woche',
      all: 'alle bestätigten kommenden API-Einträge'
    };
    const filterValue = getScheduleFilterValue();
    scheduleSummary.textContent = filteredEntries.length
      ? 'Zeige ' + filteredEntries.length + ' kommende Einträge für ' + labels[filterValue] + ' · Zeitzone ' + snapshot.timeZone + '.'
      : 'Für ' + labels[filterValue] + ' liegen aktuell keine bestätigten kommenden API-Einträge vor.';
  }

  function buildScheduleSnapshot() {
    const entries = Array.isArray(scheduleState) ? scheduleState : [];
    const timeZone = getScheduleTimeZone();
    const now = Date.now();
    let current = null;
    let next = null;

    const allUpcoming = entries
      .filter((entry) => Date.parse(entry.endsAt) >= now)
      .slice(0, 24);

    entries.forEach((entry) => {
      const startsAt = Date.parse(entry.startsAt);
      const endsAt = Date.parse(entry.endsAt);
      if (!current && startsAt <= now && endsAt > now) {
        current = entry;
      }
      if (!next && startsAt > now) {
        next = entry;
      }
    });

    return {
      entries,
      current,
      next,
      allUpcoming,
      upcoming: allUpcoming.slice(0, 8),
      timeZone
    };
  }

  function formatScheduleMeta(entry, label, timeZone) {
    const detailParts = [
      label,
      formatDateTimeInTimeZone(entry.startsAt, timeZone) + ' – ' + formatDateTimeInTimeZone(entry.endsAt, timeZone)
    ];

    if (entry.type) {
      detailParts.push(entry.type);
    }
    if (entry.host) {
      detailParts.push(entry.host);
    }
    detailParts.push(timeZone);

    return detailParts.join(' · ');
  }

  function renderSchedule() {
    const snapshot = buildScheduleSnapshot();
    const highlightItems = [];
    const filteredUpcoming = getFilteredScheduleUpcoming(snapshot);
    const scheduleStatus = liveDataStatusState.schedule;

    if (snapshot.current) {
      highlightItems.push({
        title: snapshot.current.title,
        meta: formatScheduleMeta(snapshot.current, scheduleStatus.lastError ? 'Zuletzt verifiziert · zuvor live' : 'Jetzt live', snapshot.timeZone),
        description: snapshot.current.description || (scheduleStatus.lastError
          ? 'Zuletzt erfolgreich geladener Programmeintrag aus der offiziellen laut.fm-API.'
          : 'Aktuell laufender Programmeintrag aus der offiziellen laut.fm-API.'),
        url: snapshot.current.url,
        linkLabel: snapshot.current.url ? 'Auf laut.fm ansehen' : ''
      });
    }

    if (snapshot.next) {
      highlightItems.push({
        title: snapshot.next.title,
        meta: formatScheduleMeta(snapshot.next, scheduleStatus.lastError ? 'Zuletzt verifiziert · danach geplant' : 'Als Nächstes', snapshot.timeZone),
        description: snapshot.next.description || (scheduleStatus.lastError
          ? 'Zuletzt erfolgreich geladener Folgeeintrag aus der offiziellen laut.fm-API.'
          : 'Nächster bestätigter Programmeintrag aus der offiziellen laut.fm-API.'),
        url: snapshot.next.url,
        linkLabel: snapshot.next.url ? 'Auf laut.fm ansehen' : ''
      });
    }

    renderCollection(scheduleHighlight, highlightItems, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: scheduleStatus.lastError && !snapshot.entries.length ? 'Sendeplan konnte momentan nicht geladen werden.' : 'Derzeit kein aktueller oder kommender API-Eintrag.',
      emptyText: scheduleStatus.lastError && !snapshot.entries.length
        ? 'Die offizielle laut.fm-API hat aktuell keine lesbaren Sendeplandaten geliefert oder der Abruf wurde blockiert.'
        : 'Für diesen Moment liefert die API keinen eindeutigen „Jetzt live“- oder „Als Nächstes“-Treffer.',
      hintText: scheduleStatus.lastSuccessAt
        ? (scheduleStatus.lastError
          ? 'Aktualisierung fehlgeschlagen · Anzeige basiert auf dem letzten erfolgreichen Sendeplan-Abruf vom ' + formatDateTime(scheduleStatus.lastSuccessAt) + ' · Zeitzone: ' + snapshot.timeZone + '.'
          : 'Letzter erfolgreicher Sendeplan-Abruf: ' + formatDateTime(scheduleStatus.lastSuccessAt) + ' · Zeitzone: ' + snapshot.timeZone + '.')
        : 'Quelle: offizielle laut.fm-API · Zeitzone: ' + snapshot.timeZone + '.',
      emptyItems: [
        'Nutze „Jetzt aktualisieren“, um die offiziellen API-Daten erneut abzurufen.',
        'Ohne API-Treffer werden bewusst keine Beispielsendungen im Frontend angezeigt.'
      ]
    });

    renderCollection(scheduleList, filteredUpcoming.map((entry) => ({
      title: entry.title,
      meta: formatScheduleMeta(entry, 'Geplant', snapshot.timeZone),
      description: entry.description || 'Kommender Programmeintrag aus der offiziellen laut.fm-API.',
      url: entry.url,
      linkLabel: entry.url ? 'Auf laut.fm ansehen' : ''
    })), {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: scheduleStatus.lastError && !filteredUpcoming.length ? 'Kommende Sendungen konnten momentan nicht geladen werden.' : 'Die API liefert derzeit keine passenden kommenden Sendungen.',
      emptyText: scheduleStatus.lastError && !filteredUpcoming.length
        ? 'Aktuell ist kein verlässlicher API-Abruf für den Wochenplan möglich.'
        : 'Das bedeutet nicht automatisch, dass der Stream offline ist – nur, dass im gewählten Zeitraum momentan keine passenden kommenden Programmeinträge vorliegen.',
      hintText: scheduleStatus.lastError && scheduleStatus.lastSuccessAt
        ? 'Aktualisierung fehlgeschlagen · Es werden zuletzt erfolgreich geladene Programmeinträge vom ' + formatDateTime(scheduleStatus.lastSuccessAt) + ' gezeigt.'
        : 'Quelle: offizielle laut.fm-API · Zeitzone: ' + snapshot.timeZone + '.',
      emptyItems: [
        'Es werden ausschließlich bestätigte API-Einträge dargestellt.',
        'Bei API-Problemen bleibt dieser Bereich ehrlich leer statt Beispielinhalte zu zeigen.'
      ]
    });
    renderScheduleSummary(snapshot, filteredUpcoming);

    if (scheduleSource) {
      scheduleSource.textContent = scheduleStatus.lastError
        ? 'Sendeplan-API-Status: Fehler · Anzeige basiert auf dem letzten erfolgreichen Abruf ' + (scheduleStatus.lastSuccessAt ? formatDateTime(scheduleStatus.lastSuccessAt) : 'noch nicht erfolgt') + ' · Zeitzone ' + snapshot.timeZone + '.'
        : 'Sendeplan-API-Status: ' + (scheduleStatus.loading ? 'Aktualisierung läuft' : 'bereit') + ' · Letzter erfolgreicher Abruf ' + (scheduleStatus.lastSuccessAt ? formatDateTime(scheduleStatus.lastSuccessAt) : 'steht noch aus') + ' · Zeitzone ' + snapshot.timeZone + '.';
    }
  }

  function renderStaticSections() {
    renderSchedule();
    renderCollection(eventsList, APP_CONFIG.content.events, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: 'Derzeit sind keine kommenden Live-Events eingetragen.',
      emptyText: 'Hier erscheinen nur bestätigte Hinweise auf besondere Termine, Specials oder externe Anlässe.',
      hintText: 'Neue Termine lassen sich als statische Einträge in APP_CONFIG.content.events pflegen.',
      emptyItems: [
        'Ohne verifizierte Angaben bleibt der Bereich bewusst leer und ehrlich.',
        'Events sind nicht dasselbe wie reguläre Sendeplan-Einträge oder Now-Playing-Daten.'
      ]
    });

    renderCollection(newsList, APP_CONFIG.content.news, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: 'Momentan sind keine News veröffentlicht.',
      emptyText: 'News sind kurze statische Mitteilungen zu Änderungen, Hinweisen oder neuen Inhalten.',
      hintText: 'News können in APP_CONFIG.content.news ergänzt werden, sobald eine Meldung wirklich freigegeben ist.',
      emptyItems: [
        'Keine News bedeutet nicht automatisch, dass nichts gesendet wird.',
        'Der Bereich ersetzt weder Live-Metadaten noch einen Sendeplan.'
      ]
    });

    renderCollection(archiveList, APP_CONFIG.content.archive, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: 'Noch kein Mix- oder Sendungsarchiv gepflegt.',
      emptyText: 'Archivkarten erscheinen erst, wenn Mitschnitte, Mixes oder Referenzlinks verifiziert eingetragen wurden.',
      hintText: 'Archiv-Einträge lassen sich statisch in APP_CONFIG.content.archive ergänzen.',
      emptyItems: [
        'Externe Links sollten vor Veröffentlichung geprüft werden.',
        'Ohne bestätigte Inhalte wird hier bewusst nichts als echt dargestellt.'
      ],
      emptyDetails: {
        summary: 'Archiv vorbereiten',
        items: ['Titel und Quelle prüfen', 'Kurze Beschreibung ergänzen', 'Nur bestätigte Veröffentlichungen verlinken']
      }
    });

    renderPlatformLinks();
  }

  function formatNowPlayingIntervalLabel() {
    const interval = getLautFmPollIntervalMs();
    const seconds = Math.round(interval / 1000);
    return seconds >= 60 && seconds % 60 === 0
      ? 'ca. alle ' + String(seconds / 60) + ' min'
      : 'ca. alle ' + String(seconds) + ' s';
  }

  function getLautFmBaseUrl() {
    const proxyBase = normalizeUrl(APP_CONFIG.lautFm.proxyBase);
    if (!proxyBase) {
      return normalizeUrl(APP_CONFIG.lautFm.baseUrl) || OFFICIAL_LAUT_FM_API_BASE;
    }

    try {
      const proxyUrl = new window.URL(proxyBase);
      return proxyUrl.origin === window.location.origin ? proxyUrl.href.replace(/\/+$/, '') : (normalizeUrl(APP_CONFIG.lautFm.baseUrl) || OFFICIAL_LAUT_FM_API_BASE);
    } catch (error) {
      return normalizeUrl(APP_CONFIG.lautFm.baseUrl) || OFFICIAL_LAUT_FM_API_BASE;
    }
  }

  function isUsingSameOriginProxy() {
    const proxyBase = normalizeUrl(APP_CONFIG.lautFm.proxyBase);
    if (!proxyBase) {
      return false;
    }

    try {
      return new window.URL(proxyBase).origin === window.location.origin;
    } catch (error) {
      return false;
    }
  }

  function buildLautFmEndpoint(section) {
    const baseUrl = getLautFmBaseUrl().replace(/\/+$/, '');
    return section ? baseUrl + '/' + section : baseUrl;
  }

  function getLiveDataSourceText() {
    const proxyText = isUsingSameOriginProxy()
      ? 'offizielle laut.fm-API via konfigurierbaren Same-Origin-Proxy'
      : 'offizielle laut.fm-API direkt im Browser';
    return 'Quelle: ' + proxyText + ' · Station ' + STATION_NAME + ' · Song-Aktualisierung ' + formatNowPlayingIntervalLabel() + '.';
  }

  function getLastSuccessfulLiveDataAt() {
    return [
      liveDataStatusState.nowPlaying.lastSuccessAt,
      liveDataStatusState.station.lastSuccessAt,
      liveDataStatusState.schedule.lastSuccessAt
    ].filter(Boolean).sort().reverse()[0] || '';
  }

  function buildApiErrorLabel(error) {
    if (!error) {
      return 'Unbekannter API-Fehler';
    }
    if (error.__jackTimeout) {
      return 'API-Timeout';
    }
    if (error.name === 'AbortError') {
      return 'API-Abruf abgebrochen';
    }
    if (error && error.message === 'current-song-invalid') {
      return 'Aktueller Song nicht valide';
    }
    if (error && typeof error.message === 'string' && error.message.indexOf('http-') === 0) {
      return 'API-Antwort ' + error.message.slice(5);
    }
    if (error && typeof error.message === 'string' && error.message) {
      return error.message;
    }
    return 'Technischer API-Fehler';
  }

  function createLiveDataAbortController(key) {
    if (liveDataAbortControllers[key] && typeof liveDataAbortControllers[key].abort === 'function') {
      liveDataAbortControllers[key].abort();
    }

    if (typeof AbortController !== 'function') {
      liveDataAbortControllers[key] = null;
      return null;
    }

    const controller = new AbortController();
    liveDataAbortControllers[key] = controller;
    return controller;
  }

  function clearLiveDataAbortController(key, controller) {
    if (liveDataAbortControllers[key] === controller) {
      liveDataAbortControllers[key] = null;
    }
  }

  function setLiveDataButtonBusy(isBusy) {
    if (!liveDataRefreshButton) {
      return;
    }
    liveDataRefreshButton.disabled = Boolean(isBusy);
    liveDataRefreshButton.textContent = isBusy ? 'Aktualisierung …' : 'Jetzt aktualisieren';
  }

  function renderArtwork(image, wrapper, fallback, url, alt) {
    if (!image || !wrapper || !fallback) {
      return;
    }

    const safeUrl = normalizeHttpsUrl(url);
    if (!safeUrl) {
      wrapper.hidden = true;
      fallback.hidden = false;
      if (typeof image.removeAttribute === 'function') {
        image.removeAttribute('src');
      } else {
        image.src = '';
      }
      image.alt = '';
      return;
    }

    wrapper.hidden = false;
    fallback.hidden = true;
    image.src = safeUrl;
    image.alt = normalizeOptionalText(alt) || 'Verifiziertes Coverbild';
  }

  function renderLiveDataSummary() {
    const hasError = Boolean(liveDataStatusState.nowPlaying.lastError || liveDataStatusState.station.lastError || liveDataStatusState.schedule.lastError);
    const hasLoading = Boolean(liveDataStatusState.nowPlaying.loading || liveDataStatusState.station.loading || liveDataStatusState.schedule.loading);
    const lastSuccessAt = getLastSuccessfulLiveDataAt();

    if (liveDataStatus) {
      liveDataStatus.textContent = hasError
        ? 'Live-Daten momentan nicht vollständig erreichbar'
        : (hasLoading ? 'Live-Daten werden aktualisiert' : 'Live-Daten aktiv');
    }

    if (liveDataUpdated) {
      liveDataUpdated.textContent = lastSuccessAt
        ? formatDateTime(lastSuccessAt)
        : 'Noch kein erfolgreicher API-Abruf';
    }

    if (liveDataSource) {
      liveDataSource.textContent = hasError
        ? getLiveDataSourceText() + ' Letzter erfolgreicher Abruf: ' + (lastSuccessAt ? formatDateTime(lastSuccessAt) : 'noch keiner') + '. Wenn der Browser die API nicht direkt erreicht, konfiguriere einen echten Same-Origin-Proxy.'
        : getLiveDataSourceText();
    }

    setLiveDataButtonBusy(hasLoading);
  }

  function updatePageTitle() {
    if (!document || typeof document.title !== 'string') {
      return;
    }
    const currentTrack = nowPlayingState.current;
    const currentLabel = currentTrack ? [currentTrack.artist, currentTrack.title].filter(Boolean).join(' – ') : '';
    document.title = currentLabel ? currentLabel + ' | ' + baseDocumentTitle : baseDocumentTitle;
  }

  function renderStationProfile() {
    const stationMetaParts = [];
    const stationName = stationProfileState && stationProfileState.name ? stationProfileState.name : STATION_NAME;
    const stationError = liveDataStatusState.station.lastError;
    const stationLastSuccess = liveDataStatusState.station.lastSuccessAt;

    setText(stationProfileTitle, stationName);
    setText(
      stationProfileDescription,
      stationProfileState && stationProfileState.description
        ? (stationError
          ? stationProfileState.description + ' · Live-Aktualisierung momentan fehlgeschlagen.'
          : stationProfileState.description)
        : (stationError
          ? 'Senderinformationen konnten momentan nicht verifiziert geladen werden.'
          : 'Verifizierte Senderinformationen werden aus dem offiziellen laut.fm-Station-Endpoint geladen, sobald die API erreichbar ist.')
    );

    if (stationProfileState && stationProfileState.genres.length) {
      stationMetaParts.push('Genres: ' + stationProfileState.genres.join(', '));
    }
    if (typeof listenersState === 'number') {
      stationMetaParts.push('Hörer:innen: ' + String(listenersState));
    }
    if (nextArtistsState.length) {
      stationMetaParts.push('Als Nächstes laut API: ' + nextArtistsState.join(', '));
    }
    if (stationError && stationLastSuccess) {
      stationMetaParts.push('Zuletzt erfolgreich verifiziert: ' + formatDateTime(stationLastSuccess));
    }
    if (!stationMetaParts.length) {
      stationMetaParts.push(stationError
        ? 'Live-Daten momentan nicht erreichbar.'
        : 'Keine weiteren verifizierten Stationsdetails von der API geliefert.');
    }
    setText(stationProfileMeta, stationMetaParts.join(' · '));

    if (stationProfileListeners) {
      stationProfileListeners.textContent = typeof listenersState === 'number'
        ? String(listenersState) + ' aktuelle Hörer:innen laut API'
        : 'Listener-Wert wird nur angezeigt, wenn die API einen gültigen Zahlenwert liefert.';
    }

    if (stationProfileNextArtists) {
      stationProfileNextArtists.textContent = nextArtistsState.length
        ? nextArtistsState.join(', ')
        : 'Keine verifizierten Next-Artists-Daten verfügbar.';
    }

    if (stationProfileLink) {
      const pageUrl = stationProfileState && stationProfileState.pageUrl ? stationProfileState.pageUrl : 'https://laut.fm/' + STATION_NAME;
      stationProfileLink.href = pageUrl;
      stationProfileLink.hidden = !pageUrl;
    }

    renderArtwork(
      stationProfileImage,
      stationProfileImageWrap,
      stationProfileImageFallback,
      stationProfileState && stationProfileState.imageUrl,
      stationName ? stationName + ' Senderbild' : 'Senderbild'
    );
  }

  function buildHistoryKey(entry) {
    return [entry.title, entry.artist, entry.startedAt].map((value) => String(value || '').trim().toLowerCase()).join('|');
  }

  function dedupeHistory(entries) {
    const seen = new Set();
    const result = [];

    entries.forEach((entry) => {
      const key = buildHistoryKey(entry);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(entry);
    });

    return result;
  }

  function renderHistory(entries, sourceMessage) {
    if (!historyList || !historyEmpty) {
      return;
    }

    clearElement(historyList);
    const visibleEntries = (Array.isArray(entries) ? entries : []).filter((entry) => matchesLibraryFilter([entry.artist, entry.title, entry.album]));

    if (!Array.isArray(entries) || entries.length === 0) {
      historyList.hidden = true;
      historyEmpty.hidden = false;
      historyEmpty.textContent = sourceMessage;
      updateLibrarySummary();
      return;
    }

    historyList.hidden = false;
    historyEmpty.hidden = visibleEntries.length > 0;
    if (!visibleEntries.length) {
      historyEmpty.textContent = 'Kein Historieneintrag passt aktuell zum gesetzten Filter.';
    }

    visibleEntries.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'history-item';

      const heading = createDetailBlock('p', 'history-track', [entry.artist, entry.title].filter(Boolean).join(' – ') || 'Ohne Titelangabe');
      item.appendChild(heading);

      const detailParts = [];
      if (entry.startedAt) {
        detailParts.push(formatDateTime(entry.startedAt));
      }
      if (entry.album) {
        detailParts.push(entry.album);
      }
      item.appendChild(createDetailBlock('p', 'history-meta', detailParts.length ? detailParts.join(' · ') : 'Zeitstempel derzeit nicht verfügbar'));

      historyList.appendChild(item);
    });
    updateLibrarySummary();
  }

  function renderNowPlayingFallback(messageText, sourceText) {
    setText(nowPlayingTitle, 'Titelinformationen derzeit nicht verfügbar');
    setText(nowPlayingArtist, messageText);
    setText(nowPlayingSource, sourceText);
    renderArtwork(nowPlayingArtwork, nowPlayingArtworkWrap, nowPlayingArtworkFallback, '', '');
    renderHistory(
      nowPlayingState.history,
      liveDataStatusState.nowPlaying.lastError
        ? 'Letzte Titel konnten momentan nicht frisch geladen werden. Letzter erfolgreicher Abruf: ' + (liveDataStatusState.nowPlaying.lastSuccessAt ? formatDateTime(liveDataStatusState.nowPlaying.lastSuccessAt) : 'noch keiner') + '.'
        : 'Die offizielle laut.fm-API liefert derzeit noch keine Historie.'
    );
    if (historySource) {
      historySource.textContent = liveDataStatusState.nowPlaying.lastError
        ? 'Historien-API-Status: Fehler · Letzter erfolgreicher Abruf ' + (liveDataStatusState.nowPlaying.lastSuccessAt ? formatDateTime(liveDataStatusState.nowPlaying.lastSuccessAt) : 'noch nicht erfolgt') + '.'
        : 'Historien-API-Status: wartet auf erste erfolgreiche Antwort.';
    }
    nowPlayingState = {
      current: null,
      history: nowPlayingState.history
    };
    syncFavoriteButton();
    updateMediaSessionMetadata();
    updateStationStatus();
    updatePageTitle();
    renderLiveDataSummary();
  }

  function applyNowPlayingData(data) {
    const history = dedupeHistory(Array.isArray(data.history) ? data.history : []).slice(0, 10);
    nowPlayingState = {
      current: data.current || null,
      history
    };

    if (data.current) {
      setText(nowPlayingTitle, data.current.title || 'Titelinformationen derzeit nicht verfügbar');
      setText(
        nowPlayingArtist,
        [data.current.artist || 'Interpret derzeit nicht verfügbar', data.current.album].filter(Boolean).join(' · ')
      );
      setText(
        nowPlayingSource,
        getLiveDataSourceText()
        + ' Letzter erfolgreicher Song-Abruf: ' + (liveDataStatusState.nowPlaying.lastSuccessAt ? formatDateTime(liveDataStatusState.nowPlaying.lastSuccessAt) : 'soeben') + '.'
        + (liveDataStatusState.nowPlaying.lastError ? ' Zusatzhinweis: ' + liveDataStatusState.nowPlaying.lastError + '.' : '')
      );
      renderArtwork(
        nowPlayingArtwork,
        nowPlayingArtworkWrap,
        nowPlayingArtworkFallback,
        data.current.artworkUrl,
        [data.current.artist, data.current.title].filter(Boolean).join(' – ') || 'Aktuelles Cover'
      );
    } else {
      setText(nowPlayingTitle, 'Titelinformationen derzeit nicht verfügbar');
      setText(nowPlayingArtist, 'Die offizielle laut.fm-API liefert aktuell keinen verlässlichen Now-Playing-Eintrag.');
      setText(nowPlayingSource, getLiveDataSourceText());
      renderArtwork(nowPlayingArtwork, nowPlayingArtworkWrap, nowPlayingArtworkFallback, '', '');
    }

    renderHistory(history, 'Die offizielle laut.fm-API liefert aktuell keine letzten Songs.');
    if (historySource) {
      historySource.textContent = 'Historien-API-Status: '
        + (liveDataStatusState.nowPlaying.lastError ? 'teilweise eingeschränkt' : 'bereit')
        + ' · Letzter erfolgreicher Abruf ' + (liveDataStatusState.nowPlaying.lastSuccessAt ? formatDateTime(liveDataStatusState.nowPlaying.lastSuccessAt) : 'soeben') + '.';
    }
    syncFavoriteButton();
    updateMediaSessionMetadata();
    updateStationStatus();
    updatePageTitle();
    renderLiveDataSummary();
  }

  async function fetchJsonWithTimeout(url, groupController) {
    let timeoutId = 0;
    let unlinkAbort = null;
    let timedOut = false;
    const requestController = typeof AbortController === 'function'
      ? new AbortController()
      : (groupController || null);

    try {
      if (requestController && typeof requestController.abort === 'function') {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          requestController.abort();
        }, getLautFmTimeoutMs());
      }

      if (
        requestController
        && groupController
        && requestController !== groupController
        && groupController.signal
        && typeof groupController.signal.addEventListener === 'function'
      ) {
        const handleAbort = () => requestController.abort();
        if (groupController.signal.aborted) {
          handleAbort();
        } else {
          groupController.signal.addEventListener('abort', handleAbort, { once: true });
          unlinkAbort = () => {
            if (groupController.signal && typeof groupController.signal.removeEventListener === 'function') {
              groupController.signal.removeEventListener('abort', handleAbort);
            }
          };
        }
      }

      let response;
      try {
        response = await window.fetch(url, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: requestController && requestController.signal ? requestController.signal : undefined
        });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (timedOut) {
            error.__jackTimeout = true;
          } else {
            error.__jackAbortedByRefresh = true;
          }
        }
        throw error;
      }
      if (!response || !response.ok) {
        throw new Error('http-' + String(response && response.status ? response.status : 'unavailable'));
      }
      return response.json();
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (typeof unlinkAbort === 'function') {
        unlinkAbort();
      }
    }
  }

  async function refreshNowPlaying(options) {
    if (typeof window.fetch !== 'function') {
      liveDataStatusState.nowPlaying.lastError = 'Fetch API nicht verfügbar';
      renderNowPlayingFallback('Dieser Browser stellt keine Fetch-API für laut.fm bereit.', getLiveDataSourceText());
      return;
    }

    const requestId = liveDataStatusState.nowPlaying.requestId + 1;
    liveDataStatusState.nowPlaying.requestId = requestId;
    liveDataStatusState.nowPlaying.loading = true;
    const controller = createLiveDataAbortController('nowPlaying');
    renderLiveDataSummary();

    try {
      const currentTrackPromise = fetchJsonWithTimeout(buildLautFmEndpoint('current_song'), controller);
      const safeAuxiliaryFetch = (section) => fetchJsonWithTimeout(buildLautFmEndpoint(section), controller)
        .then((value) => ({ status: 'fulfilled', value }))
        .catch((reason) => ({ status: 'rejected', reason }));
      const historyPromise = safeAuxiliaryFetch('last_songs');
      const listenersPromise = safeAuxiliaryFetch('listeners');
      const nextArtistsPromise = safeAuxiliaryFetch('next_artists');

      const currentTrack = normalizeTrack(await currentTrackPromise);
      if (!currentTrack) {
        throw new Error('current-song-invalid');
      }
      liveDataStatusState.nowPlaying.lastSuccessAt = new Date().toISOString();
      liveDataStatusState.nowPlaying.lastError = '';
      applyNowPlayingData({
        current: currentTrack,
        history: nowPlayingState.history
      });

      if (requestId !== liveDataStatusState.nowPlaying.requestId) {
        return;
      }

      const auxiliaryResults = await Promise.all([historyPromise, listenersPromise, nextArtistsPromise]);
      if (requestId !== liveDataStatusState.nowPlaying.requestId) {
        return;
      }

      const auxiliaryErrors = [];

      if (auxiliaryResults[0].status === 'fulfilled') {
        nowPlayingState.history = dedupeHistory((Array.isArray(auxiliaryResults[0].value) ? auxiliaryResults[0].value : []).map(normalizeTrack).filter(Boolean)).slice(0, 10);
      } else {
        auxiliaryErrors.push(buildApiErrorLabel(auxiliaryResults[0].reason));
      }

      if (auxiliaryResults[1].status === 'fulfilled') {
        const nextListenersState = normalizeListenersCount(auxiliaryResults[1].value);
        if (nextListenersState !== null) {
          listenersState = nextListenersState;
        }
      } else {
        auxiliaryErrors.push(buildApiErrorLabel(auxiliaryResults[1].reason));
      }

      if (auxiliaryResults[2].status === 'fulfilled') {
        nextArtistsState = normalizeNextArtists(auxiliaryResults[2].value);
      } else {
        auxiliaryErrors.push(buildApiErrorLabel(auxiliaryResults[2].reason));
      }

      liveDataStatusState.nowPlaying.lastError = auxiliaryErrors.length ? 'Teilweise unvollständig: ' + auxiliaryErrors.join(', ') : '';
      applyNowPlayingData({
        current: currentTrack,
        history: nowPlayingState.history
      });
      renderStationProfile();
    } catch (error) {
      if (requestId !== liveDataStatusState.nowPlaying.requestId) {
        return;
      }
      if (error && error.name === 'AbortError' && !error.__jackTimeout) {
        return;
      }
      liveDataStatusState.nowPlaying.lastError = buildApiErrorLabel(error);
      renderNowPlayingFallback(
        'Die offiziellen Songdaten konnten gerade nicht geladen werden. Prüfe Verbindung, CORS-Freigabe oder einen optionalen Same-Origin-Proxy.',
        getLiveDataSourceText() + ' Letzter erfolgreicher Song-Abruf: ' + (liveDataStatusState.nowPlaying.lastSuccessAt ? formatDateTime(liveDataStatusState.nowPlaying.lastSuccessAt) : 'noch keiner') + '.'
      );
      renderStationProfile();
    } finally {
      if (requestId === liveDataStatusState.nowPlaying.requestId) {
        liveDataStatusState.nowPlaying.loading = false;
        renderLiveDataSummary();
      }
      clearLiveDataAbortController('nowPlaying', controller);
      if (!options || options.scheduleNextPoll !== false) {
        scheduleNowPlayingRefresh();
      }
    }
  }

  async function refreshStationProfile(options) {
    if (typeof window.fetch !== 'function') {
      liveDataStatusState.station.lastError = 'Fetch API nicht verfügbar';
      renderStationProfile();
      return;
    }

    const requestId = liveDataStatusState.station.requestId + 1;
    liveDataStatusState.station.requestId = requestId;
    liveDataStatusState.station.loading = true;
    const controller = createLiveDataAbortController('station');
    renderLiveDataSummary();

    try {
      const payload = await fetchJsonWithTimeout(buildLautFmEndpoint(''), controller);
      if (requestId !== liveDataStatusState.station.requestId) {
        return;
      }
      stationProfileState = normalizeStationProfile(payload);
      liveDataStatusState.station.lastSuccessAt = new Date().toISOString();
      liveDataStatusState.station.lastError = '';
      renderStationProfile();
    } catch (error) {
      if (requestId !== liveDataStatusState.station.requestId) {
        return;
      }
      if (error && error.name === 'AbortError' && !error.__jackTimeout) {
        return;
      }
      liveDataStatusState.station.lastError = buildApiErrorLabel(error);
      renderStationProfile();
    } finally {
      if (requestId === liveDataStatusState.station.requestId) {
        liveDataStatusState.station.loading = false;
        renderLiveDataSummary();
      }
      clearLiveDataAbortController('station', controller);
      if (!options || options.scheduleNextPoll !== false) {
        scheduleStationRefresh();
      }
    }
  }

  async function refreshSchedule(options) {
    if (typeof window.fetch !== 'function') {
      liveDataStatusState.schedule.lastError = 'Fetch API nicht verfügbar';
      renderSchedule();
      return;
    }

    const requestId = liveDataStatusState.schedule.requestId + 1;
    liveDataStatusState.schedule.requestId = requestId;
    liveDataStatusState.schedule.loading = true;
    const controller = createLiveDataAbortController('schedule');
    renderLiveDataSummary();

    try {
      const payload = await fetchJsonWithTimeout(buildLautFmEndpoint('schedule'), controller);
      if (requestId !== liveDataStatusState.schedule.requestId) {
        return;
      }
      scheduleState = normalizeScheduleEntries(payload);
      liveDataStatusState.schedule.lastSuccessAt = new Date().toISOString();
      liveDataStatusState.schedule.lastError = '';
      renderSchedule();
    } catch (error) {
      if (requestId !== liveDataStatusState.schedule.requestId) {
        return;
      }
      if (error && error.name === 'AbortError' && !error.__jackTimeout) {
        return;
      }
      liveDataStatusState.schedule.lastError = buildApiErrorLabel(error);
      renderSchedule();
    } finally {
      if (requestId === liveDataStatusState.schedule.requestId) {
        liveDataStatusState.schedule.loading = false;
        renderLiveDataSummary();
      }
      clearLiveDataAbortController('schedule', controller);
      if (!options || options.scheduleNextPoll !== false) {
        scheduleScheduleRefresh();
      }
    }
  }

  function scheduleNowPlayingRefresh() {
    clearNowPlayingTimer();
    nowPlayingTimer = window.setTimeout(() => {
      refreshNowPlaying();
    }, getLautFmPollIntervalMs());
  }

  function scheduleStationRefresh() {
    clearStationInfoTimer();
    stationInfoTimer = window.setTimeout(() => {
      refreshStationProfile();
    }, getStationPollIntervalMs());
  }

  function scheduleScheduleRefresh() {
    clearScheduleTimer();
    scheduleTimer = window.setTimeout(() => {
      refreshSchedule();
    }, getSchedulePollIntervalMs());
  }

  function refreshAllLiveData() {
    clearNowPlayingTimer();
    clearStationInfoTimer();
    clearScheduleTimer();
    refreshNowPlaying({ scheduleNextPoll: true });
    refreshStationProfile({ scheduleNextPoll: true });
    refreshSchedule({ scheduleNextPoll: true });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker || typeof navigator.serviceWorker.register !== 'function') {
      return;
    }

    const hostname = window.location && window.location.hostname ? window.location.hostname : '';
    const isLocalhost = hostname === '127.0.0.1' || hostname === 'localhost';
    if (window.location.protocol !== 'https:' && !isLocalhost) {
      return;
    }

    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      if (shareStatus) {
        shareStatus.textContent = 'Offline-Modus konnte in diesem Browser nicht registriert werden.';
      } else if (message) {
        message.textContent = 'Offline-Modus konnte in diesem Browser nicht registriert werden.';
      }
    });
  }

  function updateInstallPromptVisibility() {
    if (!installPromptShell) {
      return;
    }

    installPromptShell.hidden = !installPromptEvent;
  }

  function initScrollReveal() {
    if (!document || typeof document.querySelectorAll !== 'function') {
      return;
    }

    const revealNodes = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!revealNodes.length) {
      return;
    }

    const reducedMotion = prefersReducedMotion();
    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
    }

    if (typeof window === 'undefined' || reducedMotion || !('IntersectionObserver' in window) || typeof window.IntersectionObserver !== 'function') {
      revealNodes.forEach((node) => node.classList && node.classList.add('is-visible'));
      return;
    }

    revealNodes.forEach((node) => node.classList && node.classList.add('reveal-managed'));

    const observer = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry || !entry.isIntersecting) {
          return;
        }
        if (entry.target && entry.target.classList) {
          entry.target.classList.add('is-visible');
        }
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.15 });
    listenerCleanups.push(() => observer.disconnect());

    revealNodes.forEach((node) => observer.observe(node));
  }

  async function handleInstallClick() {
    if (!installPromptEvent) {
      return;
    }

    try {
      await installPromptEvent.prompt();
      if (installStatus) {
        installStatus.textContent = 'Installationsdialog wurde geöffnet.';
      }
    } catch (error) {
      installPromptEvent = null;
      updateInstallPromptVisibility();
      if (installStatus) {
        installStatus.textContent = 'Installationsdialog konnte nicht geöffnet werden.';
      }
      return;
    }

    if (installPromptEvent.userChoice && typeof installPromptEvent.userChoice.then === 'function') {
      try {
        await installPromptEvent.userChoice;
      } catch (error) {
        return;
      } finally {
        installPromptEvent = null;
        updateInstallPromptVisibility();
      }
    }

    installPromptEvent = null;
    updateInstallPromptVisibility();
  }

  function updateFeedbackAvailability() {
    const contactConfig = APP_CONFIG.content.contact || {};
    const hasEmail = Boolean(String(contactConfig.email || '').trim());
    if (feedbackEmailButton) {
      feedbackEmailButton.disabled = !hasEmail;
    }
    if (feedbackEmailHint) {
      feedbackEmailHint.textContent = hasEmail
        ? 'Die E-Mail wird nur lokal mit deinen Eingaben vorbereitet; gesendet wird erst in deinem Mailprogramm.'
        : 'Aktuell ist keine Mailadresse hinterlegt. Nutze bitte den GitHub-Issue-Fallback oder die Senderseite.';
    }
  }

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  if (document.documentElement && document.documentElement.dataset) {
    document.documentElement.dataset.js = 'true';
  }

  renderStaticSections();
  loadFavorites();
  updateVolume(getStoredVolume(), { persist: false });
  if (audio) {
    audio.muted = getStoredMuted() || audio.volume === 0;
  }
  updateMuteButton();
  updateSleepCustomVisibility();
  updateSleepTimerStatus('Kein Sleep-Timer aktiv.');
  updateFeedbackAvailability();
  applyTheme(getStoredThemePreference());
  renderNowPlayingFallback(
    'Die offiziellen Songdaten werden vorbereitet.',
    getLiveDataSourceText()
  );
  renderStationProfile();
  renderSchedule();
  renderLiveDataSummary();
  if (!restorePersistentShellState()) {
    setState('ready', 'Bereit zum Start', 'Die Wiedergabe startet erst nach deiner Aktion und meldet Status sowie Neuversuche direkt im Player.');
  }
  setupMediaSession();
  bindNavigation();
  bindPersistentInternalNavigation();
  initScrollReveal();
  setBackToTopVisibility();
  registerServiceWorker();
  window[APP_INSTANCE_KEY] = {
    destroy: destroyApp,
    navigateWithinPersistentShell
  };
  window[INTERNAL_NAVIGATION_KEY] = false;
  refreshAllLiveData();

  if (shareButton) {
    bindManagedEvent(shareButton, 'click', handleShare);
  }
  if (shareWebsiteButton) {
    bindManagedEvent(shareWebsiteButton, 'click', handleShare);
  }
  if (shareStreamButton) {
    bindManagedEvent(shareStreamButton, 'click', handleShare);
  }
  if (copyTrackButton) {
    bindManagedEvent(copyTrackButton, 'click', handleCopyCurrentTrack);
    copyTrackButton.disabled = true;
  }
  if (playButton) {
    bindManagedEvent(playButton, 'click', togglePlayback);
  }
  if (stickyPlayButton) {
    bindManagedEvent(stickyPlayButton, 'click', togglePlayback);
  }
  if (retryButton) {
    bindManagedEvent(retryButton, 'click', () => {
      reconnectAttempts = 0;
      showRecoveryRetry = false;
      attemptPlayback(true);
    });
  }
  if (offlineRetryButton) {
    bindManagedEvent(offlineRetryButton, 'click', () => {
      reconnectAttempts = 0;
      showRecoveryRetry = false;
      attemptPlayback(true);
    });
  }
  if (muteButton) {
    bindManagedEvent(muteButton, 'click', () => {
      if (!audio) {
        return;
      }

      if (audio.muted && audio.volume === 0) {
        updateVolume(lastAudibleVolume || 70);
        audio.muted = false;
      } else {
        audio.muted = !audio.muted;
      }
      updateMuteButton();
      writeStorage(STORAGE_KEYS.muted, String(audio.muted));
    });
  }
  if (volumeInput) {
    bindManagedEvent(volumeInput, 'input', () => updateVolume(volumeInput.value));
    bindManagedEvent(volumeInput, 'change', () => updateVolume(volumeInput.value));
  }
  if (themeSelect) {
    bindManagedEvent(themeSelect, 'change', () => {
      applyTheme(themeSelect.value || DEFAULT_THEME);
      writeStorage(STORAGE_KEYS.theme, themeSelect.value || DEFAULT_THEME);
    });
  }
  if (installButton) {
    bindManagedEvent(installButton, 'click', handleInstallClick);
  }
  if (sleepTimerSelect) {
    bindManagedEvent(sleepTimerSelect, 'change', () => {
      updateSleepCustomVisibility();
      if (sleepTimerSelect.value === 'off' && !sleepEndAt) {
        updateSleepTimerStatus('Kein Sleep-Timer aktiv.');
      }
    });
  }
  if (sleepApplyButton) {
    bindManagedEvent(sleepApplyButton, 'click', applySleepTimer);
  }
  if (sleepCancelButton) {
    bindManagedEvent(sleepCancelButton, 'click', () => clearSleepTimer('Kein Sleep-Timer aktiv.'));
  }
  if (favoriteTrackButton) {
    bindManagedEvent(favoriteTrackButton, 'click', toggleCurrentFavorite);
  }
  if (liveDataRefreshButton) {
    bindManagedEvent(liveDataRefreshButton, 'click', refreshAllLiveData);
  }
  if (scheduleFilterSelect) {
    bindManagedEvent(scheduleFilterSelect, 'change', renderSchedule);
  }
  if (favoritesClearButton) {
    bindManagedEvent(favoritesClearButton, 'click', clearFavorites);
  }
  if (favoritesCopyButton) {
    bindManagedEvent(favoritesCopyButton, 'click', handleCopyFavorites);
  }
  if (libraryFilterInput) {
    bindManagedEvent(libraryFilterInput, 'input', handleLibraryFilterInput);
  }
  if (libraryFilterClearButton) {
    bindManagedEvent(libraryFilterClearButton, 'click', clearLibraryFilter);
    libraryFilterClearButton.disabled = true;
  }
  if (favoritesList) {
    bindManagedEvent(favoritesList, 'click', (event) => {
      const favoriteKey = event && event.target && event.target.dataset
        ? event.target.dataset.favoriteKey
        : '';
      if (!favoriteKey) {
        return;
      }
      removeFavoriteByKey(favoriteKey);
    });
  }
  if (feedbackEmailButton) {
    bindManagedEvent(feedbackEmailButton, 'click', () => handleFeedbackAction('email'));
  }
  if (feedbackIssueButton) {
    bindManagedEvent(feedbackIssueButton, 'click', () => handleFeedbackAction('issue'));
  }

  if (audio) {
    bindManagedEvent(audio, 'loadstart', () => {
      if (!wantsPlayback) {
        return;
      }
      setState('loading', 'Verbindung wird aufgebaut …', 'Der Livestream wird geladen, die Verbindung geprüft und der Browser-Start vorbereitet.');
      scheduleLoadTimeout();
    });

    bindManagedEvent(audio, 'playing', () => {
      clearLoadTimer();
      clearReconnectTimer();
      reconnectAttempts = 0;
      hasConfirmedPlayback = true;
      wantsPlayback = true;
      lastPauseReason = '';
      sawOffline = false;
      showRecoveryRetry = false;
      lastSuccessfulStartAt = new Date().toISOString();
      setState('playing', 'Der Livestream läuft.', 'Du hörst jetzt jackdarckart direkt über den offiziellen laut.fm-Stream im Browser.');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });

    bindManagedEvent(audio, 'pause', () => {
      clearLoadTimer();
      clearReconnectTimer();
      if (wantsPlayback || audio.ended || currentState === 'error' || currentState === 'blocked') {
        return;
      }
      if (lastPauseReason === 'sleep-timer') {
        setState('paused', 'Sleep-Timer beendet die Wiedergabe.', 'Der aktive Sleep-Timer ist abgelaufen. Du kannst den Stream jederzeit wieder manuell starten.');
      } else {
        setState('paused', 'Der Stream ist pausiert.', 'Starte die Wiedergabe jederzeit erneut oder wechsle auf einen externen Hörweg.');
      }
      lastPauseReason = '';
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });

    bindManagedEvent(audio, 'waiting', () => {
      if (!wantsPlayback) {
        return;
      }
      setState('loading', 'Stream puffert …', 'Die Verbindung wird stabilisiert. Falls nötig, folgt automatisch ein Neuversuch im Player.');
      scheduleLoadTimeout();
    });

    bindManagedEvent(audio, 'stalled', () => {
      if (!wantsPlayback) {
        return;
      }

      if (hasConfirmedPlayback && reconnectAttempts < MAX_AUTO_RECONNECTS) {
        reconnectAttempts += 1;
        setState(
          'loading',
          'Stream verbindet sich neu …',
          'Die Verbindung stockt. Automatischer Neuversuch ' + reconnectAttempts + ' von ' + MAX_AUTO_RECONNECTS + ' läuft direkt im Player.'
        );
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(() => {
          attemptPlayback(true);
        }, RECONNECT_DELAY_MS);
        return;
      }

      wantsPlayback = false;
      stopAudioAfterFailure();
      rememberLastError('Verbindung stockt');
      setState('error', 'Die Verbindung stockt.', 'Bitte tippe auf „Erneut versuchen“ oder wechsle auf den Direktstream beziehungsweise die offizielle Senderseite.');
    });

    bindManagedEvent(audio, 'error', () => {
      clearLoadTimer();
      clearReconnectTimer();

      if (wantsPlayback && hasConfirmedPlayback && reconnectAttempts < MAX_AUTO_RECONNECTS) {
        reconnectAttempts += 1;
        setState(
          'loading',
          'Stream verbindet sich neu …',
          'Der Stream antwortet nicht. Automatischer Neuversuch ' + reconnectAttempts + ' von ' + MAX_AUTO_RECONNECTS + ' läuft direkt im Player.'
        );
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(() => {
          attemptPlayback(true);
        }, RECONNECT_DELAY_MS);
        return;
      }

      wantsPlayback = false;
      stopAudioAfterFailure();
      rememberLastError('Stream nicht verfügbar');
      setState('error', 'Stream momentan nicht verfügbar.', getNetworkFailureText());
    });
  }

  if (window.matchMedia && typeof window.matchMedia === 'function') {
    const lightModeQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleThemeChange = () => {
      if (getStoredThemePreference() === 'auto') {
        applyTheme('auto');
      }
    };

    bindManagedMediaQuery(lightModeQuery, handleThemeChange);
  }

  bindManagedEvent(window, 'scroll', setBackToTopVisibility, { passive: true });
  bindManagedEvent(window, 'resize', setBackToTopVisibility);
  bindManagedEvent(window, 'online', () => {
    updateNetworkStatus();
    if (shareStatus) {
      shareStatus.textContent = 'Netzwerk wieder verfügbar. Du kannst den Stream oder die Website erneut teilen bzw. verbinden.';
    }
  });
  bindManagedEvent(window, 'offline', () => {
    updateNetworkStatus();
    if (shareStatus) {
      shareStatus.textContent = 'Offline erkannt. Teilen und Livestream benötigen wieder eine aktive Verbindung.';
    }
  });
  bindManagedEvent(window, 'beforeinstallprompt', (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    installPromptEvent = event;
    updateInstallPromptVisibility();
    if (installStatus) {
      installStatus.textContent = 'Die Web-App kann auf diesem Gerät installiert werden.';
    }
  });
  bindManagedEvent(window, 'appinstalled', () => {
    installPromptEvent = null;
    updateInstallPromptVisibility();
    if (installStatus) {
      installStatus.textContent = 'Die App wurde installiert oder zum Homescreen hinzugefügt.';
    }
  });
  bindManagedEvent(window, 'pagehide', (event) => {
    if (event && event.persisted) {
      return;
    }
    if (window[INTERNAL_NAVIGATION_KEY]) {
      return;
    }
    destroyApp();
  });
  bindManagedEvent(document, 'keydown', handleKeyboardShortcuts);
  if (backToTopButton) {
    bindManagedEvent(backToTopButton, 'click', scrollToTop);
  }
  }

  window.__JACKDARCKART_BOOTSTRAP__ = bootstrapApp;
  bootstrapApp();
}());
