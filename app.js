'use strict';

(function () {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted',
    theme: 'jackdarckart-theme'
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
  const nowPlayingTitle = document.getElementById('now-playing-track');
  const nowPlayingArtist = document.getElementById('now-playing-artist');
  const nowPlayingSource = document.getElementById('now-playing-source');
  const stationStatus = document.getElementById('station-status');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const eventsList = document.getElementById('events-list');
  const newsList = document.getElementById('news-list');
  const archiveList = document.getElementById('archive-list');
  const platformLinks = document.getElementById('platform-links');
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

  function pausePlayback() {
    if (!audio) {
      return;
    }

    wantsPlayback = false;
    reconnectAttempts = 0;
    clearLoadTimer();
    clearReconnectTimer();
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

  function renderCollection(container, items, options) {
    if (!container) {
      return;
    }

    clearElement(container);

    if (!Array.isArray(items) || items.length === 0) {
      const emptyState = createDetailBlock('div', 'empty-state', options.emptyText);
      const hint = createDetailBlock('p', 'empty-state-hint', options.hintText);
      emptyState.appendChild(hint);
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
      emptyText: 'Noch keine zusätzlichen Plattform-Links gepflegt.',
      hintText: 'Pflege Plattform-Links in der Konfiguration in app.js, sobald verifizierte Profile oder Ziele feststehen.'
    });
  }

  function renderStaticSections() {
    renderCollection(eventsList, APP_CONFIG.content.events, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyText: 'Derzeit sind keine kommenden Live-Events eingetragen.',
      hintText: 'Neue Termine lassen sich als statische Einträge in der Konfiguration in app.js pflegen.'
    });

    renderCollection(newsList, APP_CONFIG.content.news, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyText: 'Momentan sind keine News veröffentlicht.',
      hintText: 'News können als statische Meldungen in der Konfiguration in app.js ergänzt werden.'
    });

    renderCollection(archiveList, APP_CONFIG.content.archive, {
      itemTag: 'article',
      itemClassName: 'content-card-item',
      headingTag: 'h3',
      emptyText: 'Noch kein Mix- oder Sendungsarchiv gepflegt.',
      hintText: 'Archiv-Einträge lassen sich statisch in der Konfiguration in app.js ergänzen.'
    });

    renderPlatformLinks();
  }

  function getNowPlayingSourceLabel() {
    const endpoint = getNowPlayingEndpoint();
    if (!endpoint) {
      return hasExternalNowPlayingEndpoint()
        ? 'Externe Now-Playing-Quelle erfordert same-origin oder eine bewusst angepasste CSP.'
        : 'Keine Now-Playing-Quelle konfiguriert.';
    }

    try {
      return 'Datenquelle: ' + new window.URL(endpoint).hostname;
    } catch (error) {
      return 'Datenquelle konfiguriert.';
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
    renderHistory([], 'Noch keine Historie verfügbar. Sobald eine verlässliche Quelle eingerichtet ist, erscheinen hier zuletzt gespielte Titel.');
    nowPlayingState = {
      current: null,
      history: []
    };
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

    renderHistory(history, 'Die Datenquelle meldet derzeit noch keine Historie.');
    updateMediaSessionMetadata();
    updateStationStatus();
  }

  async function refreshNowPlaying() {
    if (!isNowPlayingConfigured()) {
      renderNowPlayingFallback(
        hasExternalNowPlayingEndpoint()
          ? 'Die konfigurierte Now-Playing-Quelle liegt außerhalb der eigenen Origin und bleibt ohne bewusste CSP-Anpassung deaktiviert.'
          : 'Live-Metadaten bleiben deaktiviert, bis in der Konfiguration eine echte Quelle hinterlegt ist.',
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
        'Die konfigurierte Quelle ist derzeit nicht erreichbar oder liefert keine lesbaren Titeldaten.',
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

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  renderStaticSections();
  updateVolume(getStoredVolume(), { persist: false });
  if (audio) {
    audio.muted = getStoredMuted() || audio.volume === 0;
  }
  updateMuteButton();
  applyTheme(getStoredThemePreference());
  setState('ready', 'Bereit zum Start', 'Die Wiedergabe startet erst nach deiner Aktion und meldet Status sowie Neuversuche direkt im Player.');
  renderNowPlayingFallback(
    'Live-Metadaten bleiben deaktiviert, bis in der Konfiguration eine echte Quelle hinterlegt ist.',
    'Keine Now-Playing-Quelle konfiguriert.'
  );
  setupMediaSession();
  bindNavigation();
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
      setState('paused', 'Der Stream ist pausiert.', 'Starte die Wiedergabe jederzeit erneut oder wechsle auf einen externen Hörweg.');
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
  if (backToTopButton) {
    backToTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}());
