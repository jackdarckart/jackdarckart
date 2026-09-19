'use strict';

(function () {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted',
    theme: 'jackdarckart-theme',
    favorites: 'jackdarckart-favorites'
  };
  const STREAM_URL = 'https://jackdarckart.stream.laut.fm/jackdarckart';
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

  const audio = document.getElementById('audio');
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
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const scheduleHighlight = document.getElementById('schedule-highlight');
  const scheduleList = document.getElementById('schedule-list');
  const eventsList = document.getElementById('events-list');
  const newsList = document.getElementById('news-list');
  const archiveList = document.getElementById('archive-list');
  const platformLinks = document.getElementById('platform-links');
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
  let nowPlayingState = {
    current: null,
    history: []
  };
  let favoritesState = [];
  let sleepTimerId = 0;
  let sleepEndAt = 0;
  let lastPauseReason = '';

  function createAppConfig(overrides) {
    const directStreamUrl = normalizeUrl(STREAM_URL) || STREAM_URL;
    const defaultConfig = {
      theme: DEFAULT_THEME,
      nowPlaying: {
        endpoint: '',
        pollIntervalMs: 60000,
        requestInit: {},
        adapter: 'generic-json'
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
      nowPlaying: Object.assign({}, defaultConfig.nowPlaying, overrides.nowPlaying || {}),
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
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: currentTrack && currentTrack.title ? currentTrack.title : 'jackdarckart Radio',
      artist: currentTrack && currentTrack.artist ? currentTrack.artist : 'laut.fm',
      album: 'stream-musik.space'
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

    const statusRect = status ? status.getBoundingClientRect() : null;
    const playerCardVisible = Boolean(statusRect) && statusRect.top < window.innerHeight && statusRect.bottom > 0;
    stickyPlayer.classList.toggle('is-visible', window.scrollY > 260 && !playerCardVisible);
  }

  function bindNavigation() {
    if (!menuToggle || !siteNav) {
      return;
    }

    menuToggle.addEventListener('click', () => {
      if (siteNav.classList.contains('is-open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    siteNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('click', (event) => {
      if (!siteNav.classList.contains('is-open')) {
        return;
      }
      if (siteNav.contains(event.target) || menuToggle.contains(event.target)) {
        return;
      }
      closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && siteNav.classList.contains('is-open')) {
        closeMenu();
        menuToggle.focus();
      }
    });
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

  function normalizeFavoriteTrack(track) {
    if (!track || typeof track !== 'object') {
      return null;
    }

    const normalized = {
      title: String(track.title || '').trim(),
      artist: String(track.artist || '').trim(),
      meta: String(track.meta || '').trim()
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
  }

  function renderFavorites() {
    if (!favoritesList || !favoritesEmpty) {
      return;
    }

    clearElement(favoritesList);

    if (!favoritesState.length) {
      favoritesList.hidden = true;
      favoritesEmpty.hidden = false;
      favoritesEmpty.textContent = 'Noch keine lokalen Favoriten gespeichert.';
      if (favoritesClearButton) {
        favoritesClearButton.disabled = true;
      }
      syncFavoriteButton();
      return;
    }

    favoritesList.hidden = false;
    favoritesEmpty.hidden = true;
    if (favoritesClearButton) {
      favoritesClearButton.disabled = false;
    }

    favoritesState.forEach((entry) => {
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
      removeButton.addEventListener('click', () => {
        favoritesState = favoritesState.filter((favorite) => favorite.key !== entry.key);
        if (!writeJsonStorage(STORAGE_KEYS.favorites, favoritesState)) {
          setText(favoriteStatus, 'Favorit konnte nicht lokal aktualisiert werden.');
        } else {
          setText(favoriteStatus, 'Favorit entfernt.');
        }
        renderFavorites();
      });
      item.appendChild(removeButton);
      favoritesList.appendChild(item);
    });

    syncFavoriteButton();
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

  function normalizeWeekday(value) {
    if (Number.isInteger(value) && value >= 0 && value <= 6) {
      return value;
    }

    const normalized = String(value || '').trim().toLowerCase();
    const weekdayMap = {
      so: 0,
      sonntag: 0,
      sunday: 0,
      mo: 1,
      montag: 1,
      monday: 1,
      di: 2,
      dienstag: 2,
      tuesday: 2,
      mi: 3,
      mittwoch: 3,
      wednesday: 3,
      do: 4,
      donnerstag: 4,
      thursday: 4,
      fr: 5,
      freitag: 5,
      friday: 5,
      sa: 6,
      samstag: 6,
      saturday: 6
    };

    return Object.prototype.hasOwnProperty.call(weekdayMap, normalized) ? weekdayMap[normalized] : -1;
  }

  function parseScheduleTime(value) {
    const match = String(value || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      return null;
    }

    return {
      hours: Number.parseInt(match[1], 10),
      minutes: Number.parseInt(match[2], 10)
    };
  }

  function getTimeZoneParts(date, timeZone) {
    if (!(typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function')) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(date);
    const values = {};
    parts.forEach((part) => {
      if (part.type !== 'literal') {
        values[part.type] = part.value;
      }
    });

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
      weekday: Object.prototype.hasOwnProperty.call(weekdayMap, values.weekday) ? weekdayMap[values.weekday] : -1,
      hours: Number.parseInt(values.hour || '0', 10),
      minutes: Number.parseInt(values.minute || '0', 10)
    };
  }

  function formatScheduleMeta(entry, label, timeZone) {
    const timeLabel = entry.start + '–' + entry.end + ' Uhr';
    const detailParts = [label, WEEKDAY_LABELS[entry.day] + ' · ' + timeLabel];

    if (entry.host) {
      detailParts.push(entry.host);
    }
    if (entry.genre) {
      detailParts.push(entry.genre);
    }
    if (timeZone) {
      detailParts.push(timeZone);
    }

    return detailParts.join(' · ');
  }

  function getScheduleEntries() {
    const scheduleConfig = APP_CONFIG.content.schedule || {};
    return (Array.isArray(scheduleConfig.entries) ? scheduleConfig.entries : [])
      .map((entry) => {
        const day = normalizeWeekday(entry && entry.day);
        const start = parseScheduleTime(entry && entry.start);
        const end = parseScheduleTime(entry && entry.end);
        if (day < 0 || !start || !end) {
          return null;
        }

        const startMinutes = start.hours * 60 + start.minutes;
        let endMinutes = end.hours * 60 + end.minutes;
        if (endMinutes <= startMinutes) {
          endMinutes += 1440;
        }

        return {
          day,
          start: entry.start,
          end: entry.end,
          startMinutes,
          endMinutes,
          title: String(entry.title || '').trim() || 'Sendung',
          host: String(entry.host || '').trim(),
          genre: String(entry.genre || '').trim(),
          description: String(entry.description || '').trim(),
          linkLabel: String(entry.linkLabel || '').trim(),
          url: normalizeUrl(entry.url),
          isPlaceholder: Boolean(entry.isPlaceholder)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.day * 1440 + a.startMinutes) - (b.day * 1440 + b.startMinutes));
  }

  function buildScheduleSnapshot() {
    const entries = getScheduleEntries();
    const timeZone = APP_CONFIG.content.schedule && APP_CONFIG.content.schedule.timeZone
      ? APP_CONFIG.content.schedule.timeZone
      : 'Europe/Berlin';

    if (!entries.length) {
      return { entries, current: null, next: null, upcoming: [], timeZone };
    }

    const parts = getTimeZoneParts(new Date(), timeZone);
    if (!parts || parts.weekday < 0) {
      return { entries, current: null, next: null, upcoming: entries.slice(0, 6), timeZone };
    }

    const currentMinutesOfWeek = (parts.weekday * 1440) + (parts.hours * 60) + parts.minutes;
    const weekMinutes = 7 * 1440;
    let currentOccurrence = null;

    const upcomingOccurrences = entries.map((entry) => {
      const baseStart = (entry.day * 1440) + entry.startMinutes;
      const baseEnd = (entry.day * 1440) + entry.endMinutes;
      const isCurrentOccurrence = (
        (currentMinutesOfWeek >= baseStart && currentMinutesOfWeek < baseEnd)
        || (currentMinutesOfWeek + weekMinutes >= baseStart && currentMinutesOfWeek + weekMinutes < baseEnd)
      );

      if (isCurrentOccurrence) {
        currentOccurrence = {
          entry,
          start: currentMinutesOfWeek >= baseStart ? baseStart : baseStart - weekMinutes,
          end: currentMinutesOfWeek >= baseStart ? baseEnd : baseEnd - weekMinutes
        };
      }

      let nextStart = baseStart;
      while (nextStart <= currentMinutesOfWeek) {
        nextStart += weekMinutes;
      }

      return {
        entry,
        start: nextStart
      };
    })
      .sort((a, b) => a.start - b.start)
      .slice(0, 6);

    const nextOccurrence = upcomingOccurrences.find((candidate) => !currentOccurrence || candidate.entry !== currentOccurrence.entry) || null;

    return {
      entries,
      current: currentOccurrence ? currentOccurrence.entry : null,
      next: nextOccurrence ? nextOccurrence.entry : null,
      upcoming: upcomingOccurrences.length ? upcomingOccurrences.map((candidate) => candidate.entry) : entries.slice(0, 6),
      timeZone
    };
  }

  function renderSchedule() {
    const snapshot = buildScheduleSnapshot();
    const highlightItems = [];

    if (snapshot.current) {
      highlightItems.push({
        title: snapshot.current.title,
        meta: formatScheduleMeta(snapshot.current, 'Jetzt live', snapshot.timeZone),
        description: snapshot.current.description || (snapshot.current.isPlaceholder ? 'Beispiel-/Platzhalterdaten klar gekennzeichnet.' : 'Aktuell laufende Sendung aus der statischen Konfiguration.')
      });
    }

    if (snapshot.next) {
      highlightItems.push({
        title: snapshot.next.title,
        meta: formatScheduleMeta(snapshot.next, 'Als Nächstes', snapshot.timeZone),
        description: snapshot.next.description || 'Nächster statisch gepflegter Programmpunkt.'
      });
    }

    renderCollection(scheduleHighlight, highlightItems, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: snapshot.entries.length ? 'Derzeit kein eindeutiger Live-/Next-Treffer.' : 'Noch kein Sendeplan hinterlegt.',
      emptyText: snapshot.entries.length
        ? 'Die vorhandenen Einträge ergeben im Moment keinen verlässlichen Treffer für „Jetzt live“ oder „Als Nächstes“.'
        : 'Ohne bestätigte Termine zeigt die Website absichtlich keinen erfundenen Programmstatus an.',
      hintText: snapshot.entries.length
        ? 'Prüfe Wochentag, Start- und Endzeit, Zeitzone und mögliche Übernacht-Slots.'
        : 'Pflege bestätigte Termine in APP_CONFIG.content.schedule.entries. Zeiten werden in ' + snapshot.timeZone + ' interpretiert.',
      emptyItems: snapshot.entries.length
        ? ['Übernacht-Sendungen sind erlaubt, wenn die Endzeit numerisch vor der Startzeit liegt.', 'Fehlende oder unlesbare Zeiten verhindern einen Live-/Next-Hinweis.']
        : ['Benötigt werden mindestens day, start, end und title.', 'Optional helfen host, genre, description, url und linkLabel für mehr Kontext.']
    });

    renderCollection(scheduleList, snapshot.upcoming.map((entry) => ({
      title: entry.title + (entry.isPlaceholder ? ' (Beispiel)' : ''),
      meta: formatScheduleMeta(entry, 'Geplant', snapshot.timeZone),
      description: entry.description || (entry.isPlaceholder ? 'Klar gekennzeichneter Beispielplatzhalter.' : 'Statischer Programmeintrag ohne zusätzliche Tracking- oder Fremddaten.'),
      url: entry.url,
      linkLabel: entry.linkLabel || 'Mehr dazu'
    })), {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyTitle: 'Derzeit sind keine kommenden Sendungen eingetragen.',
      emptyText: 'Dieser Bereich zeigt erst dann Karten, wenn bestätigte Programmeinträge statisch gepflegt wurden.',
      hintText: 'Lege bestätigte Wochentage sowie Start- und Endzeiten in APP_CONFIG.content.schedule.entries fest.',
      emptyItems: [
        'Zeiten werden in der konfigurierten Zeitzone ausgewertet.',
        'Fehlende Einträge bedeuten nicht, dass der Stream offline ist – nur, dass kein Plan hinterlegt wurde.'
      ]
    });
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
    const interval = Math.max(15000, Number.parseInt(String(APP_CONFIG.nowPlaying.pollIntervalMs), 10) || 60000);
    const seconds = Math.round(interval / 1000);
    return seconds >= 60 && seconds % 60 === 0
      ? 'ca. alle ' + String(seconds / 60) + ' min'
      : 'ca. alle ' + String(seconds) + ' s';
  }

  function getNowPlayingSourceLabel() {
    const endpoint = getNowPlayingEndpoint();
    if (!endpoint) {
      return hasExternalNowPlayingEndpoint()
        ? 'Externe Now-Playing-Quelle erkannt, aber ohne same-origin-Freigabe bzw. bewusste CSP-Anpassung deaktiviert.'
        : 'Keine Now-Playing-Quelle konfiguriert. Für Titelinfos und Historie kann eine same-origin-Quelle gepflegt werden; der Stream funktioniert trotzdem.';
    }

    try {
      const url = new window.URL(endpoint);
      return 'Datenquelle: ' + url.host + url.pathname + url.search + ' · Aktualisierung ' + formatNowPlayingIntervalLabel() + '.';
    } catch (error) {
      return 'Datenquelle konfiguriert · Aktualisierung ' + formatNowPlayingIntervalLabel() + '.';
    }
  }

  function isNowPlayingConfigured() {
    return Boolean(getNowPlayingEndpoint()) && typeof window.fetch === 'function';
  }

  function hasExternalNowPlayingEndpoint() {
    const rawEndpoint = normalizeUrl(APP_CONFIG.nowPlaying.endpoint);
    if (!rawEndpoint) {
      return false;
    }

    try {
      return new window.URL(rawEndpoint).origin !== window.location.origin;
    } catch (error) {
      return false;
    }
  }

  function getNowPlayingEndpoint() {
    const endpoint = normalizeUrl(APP_CONFIG.nowPlaying.endpoint);
    if (!endpoint) {
      return '';
    }

    try {
      return new window.URL(endpoint).origin === window.location.origin ? endpoint : '';
    } catch (error) {
      return '';
    }
  }

  function getNowPlayingAdapter() {
    const adapters = {
      'generic-json': {
        parse(payload) {
          const currentSource = payload && typeof payload === 'object'
            ? (payload.current || payload.nowPlaying || payload.track || payload.song || payload)
            : {};
          const historySource = payload && typeof payload === 'object'
            ? (payload.history || payload.recent || payload.lastPlayed || payload.tracks || [])
            : [];
          const current = normalizeTrack(currentSource);
          const history = Array.isArray(historySource)
            ? historySource.map(normalizeTrack).filter((entry) => entry.title || entry.artist)
            : [];

          return {
            current: current.title || current.artist ? current : null,
            history
          };
        }
      }
    };

    return adapters[APP_CONFIG.nowPlaying.adapter] || adapters['generic-json'];
  }

  function normalizeTrack(source) {
    const title = source && typeof source === 'object'
      ? String(source.title || source.track || source.song || source.name || '').trim()
      : '';
    const artist = source && typeof source === 'object'
      ? String(source.artist || source.interpret || source.creator || source.dj || '').trim()
      : '';
    const playedAt = source && typeof source === 'object'
      ? String(source.playedAt || source.startedAt || source.timestamp || source.time || '').trim()
      : '';
    const meta = source && typeof source === 'object'
      ? String(source.show || source.program || '').trim()
      : '';

    return {
      title,
      artist,
      playedAt,
      meta
    };
  }

  function buildHistoryKey(entry) {
    return [entry.title, entry.artist, entry.playedAt].map((value) => String(value || '').trim().toLowerCase()).join('|');
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

    if (!Array.isArray(entries) || entries.length === 0) {
      historyList.hidden = true;
      historyEmpty.hidden = false;
      historyEmpty.textContent = sourceMessage;
      return;
    }

    historyList.hidden = false;
    historyEmpty.hidden = true;

    entries.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'history-item';

      const heading = createDetailBlock('p', 'history-track', [entry.artist, entry.title].filter(Boolean).join(' – ') || 'Ohne Titelangabe');
      item.appendChild(heading);

      const detailParts = [];
      if (entry.playedAt) {
        detailParts.push(formatDateTime(entry.playedAt));
      }
      if (entry.meta) {
        detailParts.push(entry.meta);
      }
      item.appendChild(createDetailBlock('p', 'history-meta', detailParts.length ? detailParts.join(' · ') : 'Zeitstempel derzeit nicht verfügbar'));

      historyList.appendChild(item);
    });
  }

  function renderNowPlayingFallback(messageText, sourceText) {
    setText(nowPlayingTitle, 'Titelinformationen derzeit nicht verfügbar');
    setText(nowPlayingArtist, messageText);
    setText(nowPlayingSource, sourceText);
    renderHistory([], 'Noch keine Historie verfügbar. Ohne same-origin-Metadatenquelle bleibt dieser Bereich leer; der Stream selbst funktioniert weiterhin normal.');
    nowPlayingState = {
      current: null,
      history: []
    };
    syncFavoriteButton();
    updateMediaSessionMetadata();
    updateStationStatus();
  }

  function applyNowPlayingData(data) {
    const history = dedupeHistory(Array.isArray(data.history) ? data.history : []).slice(0, 10);
    nowPlayingState = {
      current: data.current || null,
      history
    };

    if (data.current) {
      setText(nowPlayingTitle, data.current.title || 'Titelinformationen derzeit nicht verfügbar');
      setText(nowPlayingArtist, data.current.artist || 'Interpret derzeit nicht verfügbar');
      setText(nowPlayingSource, getNowPlayingSourceLabel());
    } else {
      setText(nowPlayingTitle, 'Titelinformationen derzeit nicht verfügbar');
      setText(nowPlayingArtist, 'Die konfigurierte Quelle liefert aktuell keine verlässlichen Titeldaten.');
      setText(nowPlayingSource, getNowPlayingSourceLabel());
    }

    renderHistory(history, 'Die Datenquelle liefert aktuell noch keine Historie. Prüfe bei Bedarf JSON-Felder, Aktualisierungstakt und Zeitstempel.');
    syncFavoriteButton();
    updateMediaSessionMetadata();
    updateStationStatus();
  }

  async function refreshNowPlaying() {
    if (!isNowPlayingConfigured()) {
      renderNowPlayingFallback(
        hasExternalNowPlayingEndpoint()
          ? 'Die konfigurierte Now-Playing-Quelle liegt außerhalb der eigenen Origin und bleibt ohne bewusste CSP-Anpassung deaktiviert.'
          : 'Live-Metadaten bleiben deaktiviert, bis in der Konfiguration eine echte same-origin-Quelle hinterlegt ist. Der Stream selbst ist davon unabhängig nutzbar.',
        getNowPlayingSourceLabel()
      );
      return;
    }

    try {
      const response = await window.fetch(
        getNowPlayingEndpoint(),
        Object.assign({}, APP_CONFIG.nowPlaying.requestInit || {}, { method: 'GET', cache: 'no-store' })
      );
      if (!response || !response.ok) {
        throw new Error('now-playing-unavailable');
      }

      const payload = await response.json();
      const adapter = getNowPlayingAdapter();
      const parsed = adapter.parse(payload || {});
      applyNowPlayingData(parsed);
    } catch (error) {
      renderNowPlayingFallback(
        'Die konfigurierte Quelle ist derzeit nicht erreichbar oder liefert keine lesbaren Titeldaten. Prüfe Pfad, Antwortformat und ob die Quelle unter derselben Origin erreichbar bleibt.',
        getNowPlayingSourceLabel()
      );
    } finally {
      scheduleNowPlayingRefresh();
    }
  }

  function scheduleNowPlayingRefresh() {
    clearNowPlayingTimer();
    if (!isNowPlayingConfigured()) {
      return;
    }

    const interval = Math.max(15000, Number.parseInt(String(APP_CONFIG.nowPlaying.pollIntervalMs), 10) || 60000);
    nowPlayingTimer = window.setTimeout(() => {
      refreshNowPlaying();
    }, interval);
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
      if (reducedMotion && document.documentElement && document.documentElement.dataset) {
        delete document.documentElement.dataset.js;
      }
      revealNodes.forEach((node) => node.classList && node.classList.add('is-visible'));
      return;
    }

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
  setState('ready', 'Bereit zum Start', 'Die Wiedergabe startet erst nach deiner Aktion und meldet Status sowie Neuversuche direkt im Player.');
  renderNowPlayingFallback(
    'Live-Metadaten bleiben deaktiviert, bis in der Konfiguration eine echte same-origin-Quelle hinterlegt ist. Der Stream selbst ist davon unabhängig nutzbar.',
    'Keine Now-Playing-Quelle konfiguriert. Für Titelinfos und Historie kann eine same-origin-Quelle gepflegt werden.'
  );
  setupMediaSession();
  bindNavigation();
  initScrollReveal();
  setBackToTopVisibility();
  registerServiceWorker();
  refreshNowPlaying();

  if (shareButton) {
    shareButton.addEventListener('click', handleShare);
  }
  if (shareWebsiteButton) {
    shareWebsiteButton.addEventListener('click', handleShare);
  }
  if (shareStreamButton) {
    shareStreamButton.addEventListener('click', handleShare);
  }
  if (playButton) {
    playButton.addEventListener('click', togglePlayback);
  }
  if (stickyPlayButton) {
    stickyPlayButton.addEventListener('click', togglePlayback);
  }
  if (retryButton) {
    retryButton.addEventListener('click', () => {
      reconnectAttempts = 0;
      showRecoveryRetry = false;
      attemptPlayback(true);
    });
  }
  if (offlineRetryButton) {
    offlineRetryButton.addEventListener('click', () => {
      reconnectAttempts = 0;
      showRecoveryRetry = false;
      attemptPlayback(true);
    });
  }
  if (muteButton) {
    muteButton.addEventListener('click', () => {
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
    volumeInput.addEventListener('input', () => updateVolume(volumeInput.value));
    volumeInput.addEventListener('change', () => updateVolume(volumeInput.value));
  }
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      applyTheme(themeSelect.value || DEFAULT_THEME);
      writeStorage(STORAGE_KEYS.theme, themeSelect.value || DEFAULT_THEME);
    });
  }
  if (installButton) {
    installButton.addEventListener('click', handleInstallClick);
  }
  if (sleepTimerSelect) {
    sleepTimerSelect.addEventListener('change', () => {
      updateSleepCustomVisibility();
      if (sleepTimerSelect.value === 'off' && !sleepEndAt) {
        updateSleepTimerStatus('Kein Sleep-Timer aktiv.');
      }
    });
  }
  if (sleepApplyButton) {
    sleepApplyButton.addEventListener('click', applySleepTimer);
  }
  if (sleepCancelButton) {
    sleepCancelButton.addEventListener('click', () => clearSleepTimer('Kein Sleep-Timer aktiv.'));
  }
  if (favoriteTrackButton) {
    favoriteTrackButton.addEventListener('click', toggleCurrentFavorite);
  }
  if (favoritesClearButton) {
    favoritesClearButton.addEventListener('click', clearFavorites);
  }
  if (feedbackEmailButton) {
    feedbackEmailButton.addEventListener('click', () => handleFeedbackAction('email'));
  }
  if (feedbackIssueButton) {
    feedbackIssueButton.addEventListener('click', () => handleFeedbackAction('issue'));
  }

  if (audio) {
    audio.addEventListener('loadstart', () => {
      if (!wantsPlayback) {
        return;
      }
      setState('loading', 'Verbindung wird aufgebaut …', 'Der Livestream wird geladen, die Verbindung geprüft und der Browser-Start vorbereitet.');
      scheduleLoadTimeout();
    });

    audio.addEventListener('playing', () => {
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

    audio.addEventListener('pause', () => {
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

    audio.addEventListener('waiting', () => {
      if (!wantsPlayback) {
        return;
      }
      setState('loading', 'Stream puffert …', 'Die Verbindung wird stabilisiert. Falls nötig, folgt automatisch ein Neuversuch im Player.');
      scheduleLoadTimeout();
    });

    audio.addEventListener('stalled', () => {
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

    audio.addEventListener('error', () => {
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

    if (typeof lightModeQuery.addEventListener === 'function') {
      lightModeQuery.addEventListener('change', handleThemeChange);
    } else if (typeof lightModeQuery.addListener === 'function') {
      lightModeQuery.addListener(handleThemeChange);
    }
  }

  window.addEventListener('scroll', setBackToTopVisibility, { passive: true });
  window.addEventListener('resize', setBackToTopVisibility);
  window.addEventListener('online', () => {
    updateNetworkStatus();
    if (shareStatus) {
      shareStatus.textContent = 'Netzwerk wieder verfügbar. Du kannst den Stream oder die Website erneut teilen bzw. verbinden.';
    }
  });
  window.addEventListener('offline', () => {
    updateNetworkStatus();
    if (shareStatus) {
      shareStatus.textContent = 'Offline erkannt. Teilen und Livestream benötigen wieder eine aktive Verbindung.';
    }
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    installPromptEvent = event;
    updateInstallPromptVisibility();
    if (installStatus) {
      installStatus.textContent = 'Die Web-App kann auf diesem Gerät installiert werden.';
    }
  });
  window.addEventListener('appinstalled', () => {
    installPromptEvent = null;
    updateInstallPromptVisibility();
    if (installStatus) {
      installStatus.textContent = 'Die App wurde installiert oder zum Homescreen hinzugefügt.';
    }
  });
  document.addEventListener('keydown', handleKeyboardShortcuts);
  if (backToTopButton) {
    backToTopButton.addEventListener('click', scrollToTop);
  }
}());
