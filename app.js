'use strict';

(function () {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted'
  };
  const STREAM_URL = 'https://jackdarckart.stream.laut.fm/jackdarckart';
  const NOW_PLAYING_URL = 'https://api.laut.fm/station/jackdarckart/current_song';
  const NOW_PLAYING_TIMEOUT_MS = 4000;
  const LOAD_TIMEOUT_MS = 10000;
  const RECONNECT_DELAY_MS = 1500;
  const MAX_AUTO_RECONNECTS = 2;
  const STATE_LABELS = {
    ready: 'Bereit',
    loading: 'Verbindet',
    playing: 'Live',
    paused: 'Pausiert',
    blocked: 'Blockiert',
    error: 'Fehler'
  };

  const audio = document.getElementById('audio');
  const playButton = document.getElementById('play');
  const muteButton = document.getElementById('mute');
  const retryButton = document.getElementById('retry');
  const shareButton = document.getElementById('share');
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
  const stickyPlayer = document.getElementById('sticky-player');
  const stickyPlayButton = document.getElementById('sticky-play');
  const nowPlayingState = document.getElementById('now-playing-state');
  const nowPlayingTitle = document.getElementById('now-playing-title');
  const nowPlayingArtist = document.getElementById('now-playing-artist');
  const nowPlayingUpdatedAt = document.getElementById('now-playing-updated-at');
  const STREAM_URL_RESOLVED = normalizeUrl(STREAM_URL);

  let currentState = 'ready';
  let loadTimer = 0;
  let reconnectTimer = 0;
  let reconnectAttempts = 0;
  let wantsPlayback = false;
  let hasConfirmedPlayback = false;
  let lastAudibleVolume = 70;
  let nowPlayingAbortController = null;

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

  function updateEqualizer(isPlaying) {
    if (!equalizer || typeof equalizer.querySelectorAll !== 'function') {
      return;
    }

    equalizer.querySelectorAll('i').forEach((bar) => {
      bar.style.animationPlayState = isPlaying ? 'running' : 'paused';
    });
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

    retryButton.hidden = currentState !== 'error' && currentState !== 'blocked';
    retryButton.dataset.state = retryButton.hidden ? 'hidden' : 'action-needed';
  }

  function updateNetworkStatus() {
    if (!networkStatus) {
      return;
    }

    const isOffline = typeof navigator.onLine === 'boolean' && !navigator.onLine;
    networkStatus.textContent = isOffline ? 'Browser meldet offline' : 'Browser meldet online';
    if (networkStatus.parentElement) {
      networkStatus.parentElement.dataset.state = isOffline ? 'offline' : 'online';
    }
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

    if (currentState === 'error' || currentState === 'blocked') {
      return 'Bitte manuell erneut versuchen';
    }

    return 'Manuell verfügbar';
  }

  function syncStatusMirrors() {
    if (playerStateLabel) {
      playerStateLabel.textContent = STATE_LABELS[currentState] || STATE_LABELS.ready;
      if (playerStateLabel.parentElement) {
        playerStateLabel.parentElement.dataset.state = currentState;
      }
    }

    if (retryStatus) {
      retryStatus.textContent = getRetryStatusText();
      if (retryStatus.parentElement) {
        if (currentState === 'error' || currentState === 'blocked') {
          retryStatus.parentElement.dataset.state = 'action-needed';
        } else if (currentState === 'loading' || reconnectAttempts > 0) {
          retryStatus.parentElement.dataset.state = 'active';
        } else {
          retryStatus.parentElement.dataset.state = 'manual';
        }
      }
    }

    if (stickyPlayer) {
      stickyPlayer.dataset.state = currentState;
    }
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
    updateRetryButton();
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

    const shouldPersist = !options || options.persist !== false;
    const normalized = Math.max(0, Math.min(100, Number.parseInt(String(value), 10) || 0));
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
    if (shouldPersist) {
      writeStorage(STORAGE_KEYS.volume, String(normalized));
      writeStorage(STORAGE_KEYS.muted, String(audio.muted));
    }
  }

  function updateNowPlayingView(state, info) {
    if (nowPlayingState) {
      nowPlayingState.textContent = info && info.stateText ? info.stateText : 'Nicht verfügbar';
    }
    if (nowPlayingTitle) {
      nowPlayingTitle.textContent = info && info.title ? info.title : 'Keine verlässlichen Live-Metadaten verfügbar';
    }
    if (nowPlayingArtist) {
      nowPlayingArtist.textContent = info && info.artist ? info.artist : 'Live-Quelle aktuell nicht nutzbar';
    }
    if (nowPlayingUpdatedAt) {
      nowPlayingUpdatedAt.textContent = info && info.updatedAt ? info.updatedAt : 'Letzte Prüfung: –';
    }
    if (nowPlayingState && nowPlayingState.parentElement) {
      nowPlayingState.parentElement.dataset.state = state;
    }
  }

  function formatNowPlayingTimestamp(date) {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(date);
  }

  function getNowPlayingFallbackMessage(error) {
    if (error && error.name === 'AbortError') {
      return 'Zeitüberschreitung bei der Live-Abfrage';
    }

    return 'Live-Abfrage derzeit nicht erreichbar';
  }

  function normalizeNowPlayingPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    const artist = payload.artist && typeof payload.artist.name === 'string'
      ? payload.artist.name.trim()
      : '';

    if (!title || !artist) {
      return null;
    }

    return { title, artist };
  }

  async function fetchNowPlaying() {
    if (typeof window.fetch !== 'function') {
      updateNowPlayingView('unavailable', {
        stateText: 'Nicht verfügbar',
        title: 'Keine verlässlichen Live-Metadaten verfügbar',
        artist: 'Dieser Browser unterstützt die nötige Abfrage nicht',
        updatedAt: 'Letzte Prüfung: ' + formatNowPlayingTimestamp(new Date())
      });
      return;
    }

    if (nowPlayingAbortController) {
      nowPlayingAbortController.abort();
    }
    nowPlayingAbortController = typeof AbortController === 'function' ? new AbortController() : null;

    const timeout = window.setTimeout(() => {
      if (nowPlayingAbortController) {
        nowPlayingAbortController.abort();
      }
    }, NOW_PLAYING_TIMEOUT_MS);

    updateNowPlayingView('loading', {
      stateText: 'Wird geladen …',
      title: 'Livedaten werden abgefragt',
      artist: 'Quelle: api.laut.fm (current_song)',
      updatedAt: 'Letzte Prüfung: läuft …'
    });

    try {
      const response = await window.fetch(NOW_PLAYING_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: nowPlayingAbortController ? nowPlayingAbortController.signal : undefined
      });
      if (!response.ok) {
        throw new Error('http-' + response.status);
      }

      const payload = await response.json();
      const normalized = normalizeNowPlayingPayload(payload);
      const now = formatNowPlayingTimestamp(new Date());

      if (!normalized) {
        updateNowPlayingView('unavailable', {
          stateText: 'Nicht verfügbar',
          title: 'Live-Quelle liefert aktuell keine belastbaren Titelinfos',
          artist: 'Player bleibt ohne Metadaten voll nutzbar',
          updatedAt: 'Letzte Prüfung: ' + now
        });
        return;
      }

      updateNowPlayingView('available', {
        stateText: 'Live-Daten aktiv',
        title: normalized.title,
        artist: normalized.artist,
        updatedAt: 'Zuletzt aktualisiert: ' + now
      });
    } catch (error) {
      const now = formatNowPlayingTimestamp(new Date());
      updateNowPlayingView('error', {
        stateText: 'Nicht verfügbar',
        title: 'Keine verlässlichen Live-Metadaten verfügbar',
        artist: getNowPlayingFallbackMessage(error) + ' (CORS/Netzwerk möglich)',
        updatedAt: 'Letzte Prüfung: ' + now
      });
    } finally {
      window.clearTimeout(timeout);
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
      setState(
        'error',
        'Der Stream startet gerade nicht.',
        getNetworkFailureText()
      );
    }, LOAD_TIMEOUT_MS);
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
      setState(
        'blocked',
        'Browser blockiert die Wiedergabe.',
        'Bitte tippe erneut auf „Stream starten“ oder „Erneut versuchen“. Erst danach gibt der Browser den Livestream für diese Seite frei.'
      );
      return;
    }

    stopAudioAfterFailure();
    setState(
      'error',
      'Wiedergabe konnte nicht starten.',
      getNetworkFailureText()
    );
  }

  async function attemptPlayback(forceReload) {
    if (!audio) {
      setState(
        'error',
        'Player nicht verfügbar.',
        'Die Audio-Komponente konnte nicht initialisiert werden. Bitte lade die Seite neu oder nutze den Direktstream.'
      );
      return;
    }

    wantsPlayback = true;
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

  async function handleShare() {
    const shareData = {
      title: document.title,
      text: 'jackdarckart Webradio auf stream-musik.space',
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        if (shareStatus) {
          shareStatus.textContent = 'Link erfolgreich geteilt.';
        }
        return;
      }

      await copyToClipboard(window.location.href);
      if (shareStatus) {
        shareStatus.textContent = 'Link in die Zwischenablage kopiert.';
      }
    } catch (error) {
      if (shareStatus) {
        shareStatus.textContent = error && error.name === 'AbortError'
          ? 'Teilen wurde abgebrochen.'
          : 'Teilen war nicht möglich. Du kannst die Adresse manuell kopieren.';
      }
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) {
      return;
    }

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: 'jackdarckart Radio',
      artist: 'laut.fm',
      album: 'stream-musik.space'
    });

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

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  updateVolume(getStoredVolume(), { persist: false });
  if (audio) {
    audio.muted = getStoredMuted() || audio.volume === 0;
  }
  if (audio && audio.volume > 0) {
    lastAudibleVolume = Math.max(1, Math.round(audio.volume * 100));
  }
  updateMuteButton();
  updateNowPlayingView('unavailable', {
    stateText: 'Nicht verfügbar',
    title: 'Keine verlässlichen Live-Metadaten verfügbar',
    artist: 'Player funktioniert auch ohne diese Zusatzdaten',
    updatedAt: 'Letzte Prüfung: –'
  });
  fetchNowPlaying();
  setState('ready', 'Bereit zum Start', 'Die Wiedergabe startet erst nach deiner Aktion und meldet Status sowie Neuversuche direkt im Player.');
  setupMediaSession();
  bindNavigation();
  setBackToTopVisibility();

  if (shareButton) {
    shareButton.addEventListener('click', handleShare);
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
      setState('error', 'Stream momentan nicht verfügbar.', getNetworkFailureText());
    });
  }

  window.addEventListener('scroll', setBackToTopVisibility, { passive: true });
  window.addEventListener('resize', setBackToTopVisibility);
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  if (backToTopButton) {
    backToTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}());
