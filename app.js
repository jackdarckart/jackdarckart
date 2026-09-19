  function savePlayerSessionState(shouldPlayOverride) {
    if (!window || !window.sessionStorage || !audio) {
      return;
    }

    const shouldPlay = typeof shouldPlayOverride === 'boolean'
      ? shouldPlayOverride
      : Boolean(wantsPlayback || currentState === 'playing' || currentState === 'loading');

    try {
      window.sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify({
        shouldPlay,
        volume: Math.round(Number.isFinite(audio.volume) ? audio.volume * 100 : getStoredVolume()),
        muted: Boolean(audio.muted),
        lastSuccessfulStartAt,
        state: currentState,
        savedAt: Date.now()
      }));
    } catch (error) {
      return;
    }
  }

  function restorePlayerSessionState() {
    if (!window || !window.sessionStorage || !audio) {
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(PLAYER_SESSION_KEY);
      if (!raw) {
        return;
      }

      const state = JSON.parse(raw);
      if (!state || typeof state.shouldPlay !== 'boolean' || !state.shouldPlay) {
        return;
      }

      const volume = Number.isFinite(Number(state.volume)) ? Number(state.volume) : getStoredVolume();
      updateVolume(volume, { persist: false });
      if (typeof state.muted === 'boolean') {
        audio.muted = state.muted;
      }
      if (state.lastSuccessfulStartAt) {
        lastSuccessfulStartAt = state.lastSuccessfulStartAt;
      }
      updateMuteButton();
      wantsPlayback = true;
      setState('loading', 'Wiedergabe wird nach Seitenwechsel fortgesetzt …', 'Der Player versucht die Verbindung nach dem Seitenwechsel automatisch wieder aufzunehmen.');
      window.setTimeout(() => {
        if (audio && audio.paused) {
          startPlayback(false, true);
        }
      }, 250);
    } catch (error) {
      return;
    }
  }

