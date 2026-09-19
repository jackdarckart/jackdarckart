'use strict';

(function () {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted'
  };
  const STREAM_URL = 'https://stream.laut.fm/jackdarckart';
  const LOAD_TIMEOUT_MS = 8000;
  const RECONNECT_DELAY_MS = 1200;
  const MAX_AUTO_RECONNECTS = 1;

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
    if (currentState === 'playing') {
      playButton.textContent = 'Stream pausieren';
      playButton.setAttribute('aria-pressed', 'true');
      return;
    }

    playButton.textContent = currentState === 'loading' ? 'Verbindung läuft …' : 'Stream starten';
    playButton.setAttribute('aria-pressed', 'false');
  }

  function updateRetryButton() {
    retryButton.hidden = currentState !== 'error' && currentState !== 'blocked';
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
          'Der Stream antwortet noch nicht. Ein weiterer Versuch startet jetzt.'
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
        'Bitte tippe auf „Erneut versuchen“ oder öffne den Stream direkt auf laut.fm.'
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
        'Bitte tippe erneut auf „Stream starten“ oder „Erneut versuchen“.'
      );
      return;
    }

    stopAudioAfterFailure();
    setState(
      'error',
      'Wiedergabe konnte nicht starten.',
      'Bitte versuche es erneut oder öffne den Stream direkt auf laut.fm.'
    );
  }

  async function attemptPlayback(forceReload) {
    wantsPlayback = true;
    clearReconnectTimer();
    setState(
      'loading',
      forceReload ? 'Verbindung wird aufgebaut …' : 'Wiedergabe wird vorbereitet …',
      'Der Livestream wird mit deiner Aktion gestartet.'
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
      setState('paused', 'Start wurde abgebrochen.', 'Tippe auf „Stream starten“, um den Livestream neu aufzubauen.');
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
  setState('ready', 'Bereit zum Start', 'Der Stream startet erst nach deinem Klick.');
  setupMediaSession();
  bindNavigation();
  setBackToTopVisibility();

  shareButton.addEventListener('click', handleShare);
  playButton.addEventListener('click', togglePlayback);
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
    setState('loading', 'Verbindung wird aufgebaut …', 'Der Livestream wird geladen.');
    scheduleLoadTimeout();
  });

  audio.addEventListener('playing', () => {
    clearLoadTimer();
    clearReconnectTimer();
    reconnectAttempts = 0;
    hasConfirmedPlayback = true;
    wantsPlayback = true;
    setState('playing', 'Der Livestream läuft.', 'Du hörst jetzt jackdarckart.');
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
    setState('paused', 'Der Stream ist pausiert.', 'Starte die Wiedergabe jederzeit erneut.');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  });

  audio.addEventListener('waiting', () => {
    if (!wantsPlayback) {
      return;
    }
    setState('loading', 'Stream puffert …', 'Die Verbindung wird stabilisiert.');
    scheduleLoadTimeout();
  });

  audio.addEventListener('stalled', () => {
    if (!wantsPlayback) {
      return;
    }

    if (hasConfirmedPlayback && reconnectAttempts < MAX_AUTO_RECONNECTS) {
      reconnectAttempts += 1;
      setState('loading', 'Stream verbindet sich neu …', 'Die Verbindung stockt. Ein neuer Versuch läuft.');
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        attemptPlayback(true);
      }, RECONNECT_DELAY_MS);
      return;
    }

    wantsPlayback = false;
    stopAudioAfterFailure();
    setState('error', 'Die Verbindung stockt.', 'Bitte tippe auf „Erneut versuchen“.');
  });

  audio.addEventListener('error', () => {
    clearLoadTimer();
    clearReconnectTimer();

    if (wantsPlayback && hasConfirmedPlayback && reconnectAttempts < MAX_AUTO_RECONNECTS) {
      reconnectAttempts += 1;
      setState('loading', 'Stream verbindet sich neu …', 'Der Stream antwortet nicht. Ein weiterer Versuch läuft.');
      reconnectTimer = window.setTimeout(() => {
        attemptPlayback(true);
      }, RECONNECT_DELAY_MS);
      return;
    }

    wantsPlayback = false;
    stopAudioAfterFailure();
    setState('error', 'Stream momentan nicht verfügbar.', 'Bitte prüfe deine Verbindung oder versuche es erneut.');
  });

  window.addEventListener('scroll', setBackToTopVisibility, { passive: true });
  backToTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}());
