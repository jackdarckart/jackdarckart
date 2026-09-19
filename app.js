'use strict';

(function () {
  const STORAGE_KEYS = {
    volume: 'jackdarckart-volume',
    muted: 'jackdarckart-muted'
  };
  const LOAD_TIMEOUT_MS = 12000;

  const audio = document.getElementById('audio');
  const playButton = document.getElementById('play');
  const muteButton = document.getElementById('mute');
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

  let loadTimer = 0;
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

  function setState(type, title, detail) {
    status.dataset.state = type;
    statusText.textContent = title;
    message.textContent = detail;
    equalizer.querySelectorAll('i').forEach((bar) => {
      bar.style.animationPlayState = type === 'playing' ? 'running' : 'paused';
    });
  }

  function updateMuteButton() {
    const muted = audio.muted;
    muteButton.textContent = muted ? 'Stumm' : 'Ton an';
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
    audio.muted = normalized === 0 ? true : audio.muted;
    if (normalized > 0 && audio.muted) {
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

  function startLoadTimeout() {
    clearLoadTimer();
    loadTimer = window.setTimeout(() => {
      if (!audio.paused) {
        setState('error', 'Verbindung dauert zu lange.', 'Bitte prüfe deine Verbindung oder öffne den Stream direkt auf laut.fm.');
      }
    }, LOAD_TIMEOUT_MS);
  }

  function updatePlayButton(isPlaying) {
    playButton.textContent = isPlaying ? 'Stream pausieren' : 'Stream starten';
    playButton.setAttribute('aria-pressed', String(isPlaying));
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

  async function togglePlayback() {
    if (!audio.paused) {
      audio.pause();
      return;
    }

    setState('loading', 'Verbindung wird aufgebaut …', 'Der Livestream wird geladen.');
    startLoadTimeout();

    try {
      await audio.play();
    } catch (error) {
      clearLoadTimer();
      const blocked = error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
      setState(
        'error',
        blocked ? 'Wiedergabe benötigt deine Bestätigung.' : 'Wiedergabe konnte nicht starten.',
        blocked
          ? 'Bitte erneut klicken oder den Stream direkt auf laut.fm öffnen.'
          : 'Bitte prüfe deine Verbindung oder versuche es erneut.'
      );
      updatePlayButton(false);
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
    navigator.mediaSession.setActionHandler('play', togglePlayback);
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
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
  updatePlayButton(false);
  setupMediaSession();
  bindNavigation();
  setBackToTopVisibility();

  shareButton.addEventListener('click', handleShare);
  playButton.addEventListener('click', togglePlayback);
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
    setState('loading', 'Verbindung wird aufgebaut …', 'Der Livestream wird geladen.');
    startLoadTimeout();
  });

  audio.addEventListener('playing', () => {
    clearLoadTimer();
    updatePlayButton(true);
    setState('playing', 'Der Livestream läuft.', 'Du hörst jetzt jackdarckart.');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  });

  audio.addEventListener('pause', () => {
    clearLoadTimer();
    updatePlayButton(false);
    if (!audio.ended) {
      setState('paused', 'Der Stream ist pausiert.', 'Starte die Wiedergabe jederzeit erneut.');
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  });

  audio.addEventListener('waiting', () => {
    setState('loading', 'Stream puffert …', 'Die Verbindung wird stabilisiert.');
    startLoadTimeout();
  });

  audio.addEventListener('stalled', () => {
    setState('error', 'Die Verbindung stockt.', 'Bitte warte kurz oder versuche es erneut.');
  });

  audio.addEventListener('error', () => {
    clearLoadTimer();
    updatePlayButton(false);
    setState('error', 'Stream momentan nicht verfügbar.', 'Bitte prüfe deine Verbindung oder öffne laut.fm.');
  });

  window.addEventListener('scroll', setBackToTopVisibility, { passive: true });
  backToTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}());
