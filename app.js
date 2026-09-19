'use strict';

(function () {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted'
  };
  const STREAM_URL = 'https://stream.laut.fm/jackdarckart';
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
  const stickyStatusText = document.getElementById('sticky-status-text');
  const stickyMessage = document.getElementById('sticky-message');
  const stickyNetworkState = document.getElementById('sticky-network-state');
  const stickyPlayerState = document.getElementById('sticky-player-state');
  const stickyRetryState = document.getElementById('sticky-retry-state');

  let currentState = 'ready';
  let loadTimer = 0;
  let reconnectTimer = 0;
  let reconnectAttempts = 0;
  let wantsPlayback = false;
  let hasConfirmedPlayback = false;
  let lastAudibleVolume = 70;

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
      });
      return;
    }

    buttons.forEach((button) => {
      button.textContent = currentState === 'loading' ? 'Verbindung läuft …' : 'Stream starten';
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function updateRetryButton() {
    retryButton.hidden = currentState !== 'error' && currentState !== 'blocked';
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
    if (stickyNetworkState) {
      stickyNetworkState.textContent = isOffline ? 'Netz offline' : 'Netz online';
      stickyNetworkState.dataset.state = isOffline ? 'offline' : 'online';
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

    if (stickyStatusText) {
      stickyStatusText.textContent = statusText.textContent;
    }

    if (stickyMessage) {
      stickyMessage.textContent = message.textContent;
    }

    if (stickyPlayerState) {
      stickyPlayerState.textContent = STATE_LABELS[currentState] || STATE_LABELS.ready;
      stickyPlayerState.dataset.state = currentState;
    }

    if (stickyRetryState) {
      stickyRetryState.textContent = getRetryStatusText();
      if (currentState === 'error' || currentState === 'blocked') {
        stickyRetryState.dataset.state = 'action-needed';
      } else if (currentState === 'loading' || reconnectAttempts > 0) {
        stickyRetryState.dataset.state = 'active';
      } else {
        stickyRetryState.dataset.state = 'manual';
      }
    }

    if (stickyPlayer) {
      stickyPlayer.dataset.state = currentState;
    }
  }

  function setState(type, title, detail) {
    currentState = type;
    status.dataset.state = type;
    status.setAttribute('aria-busy', String(type === 'loading'));
    statusText.textContent = title;
    message.textContent = detail;
    updateEqualizer(type === 'playing');
    updatePlayButton();
    updateRetryButton();
    updateNetworkStatus();
    syncStatusMirrors();
  }

  function updateMuteButton() {
    const muted = audio.muted;
    muteButton.textContent = muted ? 'Ton an' : 'Stumm';
    muteButton.setAttribute('aria-pressed', String(muted));
    muteButton.setAttribute('aria-label', muted ? 'Ton wieder einschalten' : 'Ton stummschalten');
  }

  function updateVolume(value) {
    const normalized = Math.max(0, Math.min(100, Number.parseInt(String(value), 10) || 0));
    volumeInput.value = String(normalized);
    volumeText.textContent = normalized + '%';
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
    writeStorage(STORAGE_KEYS.volume, String(normalized));
    writeStorage(STORAGE_KEYS.muted, String(audio.muted));
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
    if (!audio.paused) {
      audio.pause();
    }
  }

  function pausePlayback() {
    wantsPlayback = false;
    reconnectAttempts = 0;
    clearLoadTimer();
    clearReconnectTimer();
    if (!audio.paused) {
      audio.pause();
    }
  }

  function ensureStreamSource(forceReload) {
    const hasSource = audio.getAttribute('src') === STREAM_URL;
    if (!hasSource) {
      audio.setAttribute('src', STREAM_URL);
      forceReload = true;
    }

    if (forceReload) {
      audio.load();
    }
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

      ensureStreamSource(forceReload);
      await audio.play();
    } catch (error) {
      handlePlaybackFailure(error);
    }
  }

  async function togglePlayback() {
    if (currentState === 'loading') {
      pausePlayback();
      setState('paused', 'Start wurde abgebrochen.', 'Tippe auf „Stream starten“, um den Streamzugang direkt neu aufzubauen.');
      return;
    }

    if (!audio.paused) {
      pausePlayback();
      return;
    }

    reconnectAttempts = 0;
    await attemptPlayback(audio.getAttribute('src') !== STREAM_URL);
  }

  function closeMenu() {
    menuToggle.setAttribute('aria-expanded', 'false');
    siteNav.classList.remove('is-open');
  }

  function openMenu() {
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
        shareStatus.textContent = 'Link erfolgreich geteilt.';
        return;
      }

      await copyToClipboard(window.location.href);
      shareStatus.textContent = 'Link in die Zwischenablage kopiert.';
    } catch (error) {
      shareStatus.textContent = error && error.name === 'AbortError'
        ? 'Teilen wurde abgebrochen.'
        : 'Teilen war nicht möglich. Du kannst die Adresse manuell kopieren.';
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
      navigator.mediaSession.setActionHandler('play', togglePlayback);
      navigator.mediaSession.setActionHandler('pause', pausePlayback);
    } catch (error) {
      return;
    }
  }

  function setBackToTopVisibility() {
    backToTopButton.classList.toggle('is-visible', window.scrollY > 480);

    if (!stickyPlayer) {
      return;
    }

    const playerCardVisible = status.getBoundingClientRect().top < window.innerHeight && status.getBoundingClientRect().bottom > 0;
    stickyPlayer.classList.toggle('is-visible', window.scrollY > 260 && !playerCardVisible);
  }

  function bindNavigation() {
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

  year.textContent = String(new Date().getFullYear());

  updateVolume(getStoredVolume());
  audio.muted = getStoredMuted() || audio.volume === 0;
  updateMuteButton();
  setState('ready', 'Bereit zum Start', 'Die Wiedergabe startet erst nach deiner Aktion und meldet Status sowie Neuversuche direkt im Player.');
  setupMediaSession();
  bindNavigation();
  setBackToTopVisibility();

  shareButton.addEventListener('click', handleShare);
  playButton.addEventListener('click', togglePlayback);
  if (stickyPlayButton) {
    stickyPlayButton.addEventListener('click', togglePlayback);
  }
  retryButton.addEventListener('click', () => {
    reconnectAttempts = 0;
    attemptPlayback(true);
  });
  muteButton.addEventListener('click', () => {
    if (audio.muted && audio.volume === 0) {
      updateVolume(lastAudibleVolume || 70);
    }
    audio.muted = !audio.muted;
    updateMuteButton();
    writeStorage(STORAGE_KEYS.muted, String(audio.muted));
  });
  volumeInput.addEventListener('input', () => updateVolume(volumeInput.value));

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
      reconnectTimer = window.setTimeout(() => {
        attemptPlayback(true);
      }, RECONNECT_DELAY_MS);
      return;
    }

    wantsPlayback = false;
    stopAudioAfterFailure();
    setState('error', 'Stream momentan nicht verfügbar.', getNetworkFailureText());
  });

  window.addEventListener('scroll', setBackToTopVisibility, { passive: true });
  window.addEventListener('resize', setBackToTopVisibility);
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  backToTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}());
