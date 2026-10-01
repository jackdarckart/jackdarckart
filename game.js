'use strict';

(function () {
  const API = './api/quantum-vault';
  const AUTO_SAVE_MS = 30000;
  const elements = {
    authShell: document.getElementById('auth-shell'),
    gameShell: document.getElementById('game-shell'),
    authMessage: document.getElementById('auth-message'),
    gameMessage: document.getElementById('game-message'),
    connection: document.getElementById('connection-status'),
    handle: document.getElementById('operator-handle'),
    saveState: document.getElementById('save-state'),
    leaderboard: document.getElementById('leaderboard')
  };
  let currentState = null;
  let autoSaveTimer = 0;
  let actionPending = false;
  let dirty = false;
  let authGeneration = 0;
  let authPending = false;

  const SESSION_EXPIRED = 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
  const MESSAGES = {
    NETWORK: 'Keine Verbindung zum Server. Prüfe deine Internetverbindung und versuche es erneut.',
    VAULT_OFFLINE: 'Der Spielserver (Quantum Vault) ist auf dieser Adresse nicht aktiv. Login und Registrierung '
      + 'funktionieren erst, wenn der Vault-Server läuft. Betreiber: Server mit QUANTUM_VAULT_KEY und „npm start“ starten.',
    INVALID_CREDENTIALS: 'Handle oder Passwort ist falsch. Prüfe deine Eingabe – noch kein Account? Dann registriere dich.',
    HANDLE_TAKEN: 'Dieser Handle ist bereits vergeben. Wähle einen anderen Namen oder melde dich an, falls es dein Account ist.',
    HANDLE_INVALID: 'Der Handle muss 3–20 Zeichen lang sein und darf nur Buchstaben, Zahlen, _ oder - enthalten.',
    PASSWORD_INVALID: 'Das Passwort muss 10 bis 128 Zeichen lang sein.',
    RATE_LIMITED: 'Zu viele Versuche. Bitte warte etwa eine Minute und versuche es dann erneut.',
    SERVICE_BUSY: 'Der Server ist gerade ausgelastet. Bitte versuche es in ein paar Sekunden erneut.',
    SESSION_REQUIRED: SESSION_EXPIRED,
    CROSS_ORIGIN: 'Die Anfrage wurde aus Sicherheitsgründen blockiert. Öffne das Spiel direkt über diese Website und lade die Seite neu.',
    BODY_TOO_LARGE: 'Die Eingabe ist zu lang. Bitte kürze Handle oder Passwort.',
    INVALID_JSON: 'Die Anfrage war ungültig. Bitte lade die Seite neu und versuche es erneut.',
    VAULT_DATA_INVALID: 'Der Quantum Vault ist falsch konfiguriert (Schlüssel oder Datendatei). Bitte später erneut versuchen.',
    INTERNAL_ERROR: 'Interner Serverfehler im Quantum Vault. Bitte versuche es später erneut.',
    ACTION_COOLDOWN: 'Der Harvester lädt noch – warte einen Moment.'
  };
  const FIELD_FOR_CODE = {
    HANDLE_INVALID: 'handle',
    HANDLE_TAKEN: 'handle',
    PASSWORD_INVALID: 'password',
    INVALID_CREDENTIALS: 'password'
  };

  function vaultError(code, serverMessage) {
    const error = new Error(MESSAGES[code] || serverMessage || MESSAGES.INTERNAL_ERROR);
    error.code = code;
    error.status = 0;
    return error;
  }

  async function request(route, options) {
    const settings = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (settings.body) settings.headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${API}${route}`, settings);
    } catch (networkError) {
      throw vaultError('NETWORK');
    }
    const isJson = /application\/json/i.test(response.headers.get('Content-Type') || '');
    let payload = null;
    if (isJson) {
      try {
        payload = await response.json();
      } catch (parseError) {
        payload = null;
      }
    }
    // HTML/plain responses mean no Vault server answered (e.g. static hosting or a proxy error).
    const offline = !payload || typeof payload !== 'object';
    if (offline || !response.ok) {
      const error = offline
        ? vaultError('VAULT_OFFLINE')
        : vaultError(payload.code || 'INTERNAL_ERROR', payload.error);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function isOffline(error) {
    return error.code === 'NETWORK' || error.code === 'VAULT_OFFLINE';
  }

  function setMessage(target, message, isError) {
    target.textContent = message;
    target.classList.toggle('error', Boolean(isError));
  }

  function setConnection(state, message, hint) {
    elements.connection.className = `connection ${state}`;
    elements.connection.lastChild.textContent = message;
    elements.connection.title = hint || message;
  }

  function setOfflineConnection(error) {
    if (error.code === 'NETWORK') setConnection('offline', 'Keine Verbindung – Internet prüfen', error.message);
    else setConnection('offline', 'Vault-Server offline', error.message);
  }

  function markField(form, field) {
    form.querySelectorAll('input').forEach((input) => {
      input.removeAttribute('aria-invalid');
    });
    const input = field && form.elements.namedItem(field);
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    if (field === 'password') input.value = '';
    input.focus();
  }

  function sessionExpired() {
    showAuth(SESSION_EXPIRED);
    setConnection('', 'Session abgelaufen – bitte neu anmelden');
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function render(payload) {
    currentState = payload.state;
    elements.handle.textContent = payload.handle;
    setText('vibe-score', currentState.vibeScore);
    setText('fragments', currentState.fragments);
    setText('alloys', currentState.alloys);
    setText('revision', currentState.revision);
    Object.entries(currentState.upgrades).forEach(([id, level]) => setText(`level-${id}`, `LV ${level}`));
    setText('stat-harvests', currentState.stats.harvests);
    setText('stat-forges', currentState.stats.forges);
    setText('stat-upgrades', currentState.stats.upgrades);
    setText('stat-nodes', currentState.stats.nodes);
    setText('stat-manual-saves', currentState.stats.manualSaves);
    setText('stat-autosaves', currentState.stats.autosaves);
    document.querySelectorAll('[data-node]').forEach((button) => {
      button.classList.toggle('unlocked', currentState.treeNodes.includes(button.dataset.node));
    });
    document.querySelectorAll('[data-track]').forEach((button) => {
      button.classList.toggle('unlocked', currentState.jukebox.includes(button.dataset.track));
    });
    elements.authShell.hidden = true;
    elements.gameShell.hidden = false;
    setConnection('online', 'Vault verbunden');
  }

  function showAuth(message) {
    authGeneration += 1;
    currentState = null;
    dirty = false;
    elements.authShell.hidden = false;
    elements.gameShell.hidden = true;
    window.clearInterval(autoSaveTimer);
    autoSaveTimer = 0;
    if (message) setMessage(elements.authMessage, message, false);
  }

  function startAutosave() {
    window.clearInterval(autoSaveTimer);
    autoSaveTimer = window.setInterval(() => {
      if (dirty && currentState) save('auto');
    }, AUTO_SAVE_MS);
  }

  async function authenticate(route, form) {
    if (authPending) return;
    authPending = true;
    document.querySelectorAll('.auth-form button').forEach((button) => {
      button.disabled = true;
    });
    const generation = ++authGeneration;
    const data = new FormData(form);
    markField(form, null);
    setMessage(elements.authMessage, route === '/register' ? 'Account wird erstellt …' : 'Anmeldung läuft …', false);
    try {
      const payload = await request(route, {
        method: 'POST',
        body: JSON.stringify({ handle: data.get('handle'), password: data.get('password') })
      });
      if (generation !== authGeneration) return;
      document.querySelectorAll('.auth-form').forEach((authForm) => {
        authForm.reset();
        markField(authForm, null);
      });
      render(payload);
      startAutosave();
      setMessage(elements.gameMessage, 'Quantum Vault synchronisiert.', false);
      loadLeaderboard();
    } catch (error) {
      if (generation !== authGeneration) return;
      if (isOffline(error)) setOfflineConnection(error);
      else setConnection('', 'Vault online – bitte anmelden');
      setMessage(elements.authMessage, error.message, true);
      markField(form, FIELD_FOR_CODE[error.code]);
    } finally {
      if (generation === authGeneration) {
        authPending = false;
        document.querySelectorAll('.auth-form button').forEach((button) => {
          button.disabled = false;
        });
      }
    }
  }

  async function performAction(body, source) {
    if (actionPending || !currentState) return;
    actionPending = true;
    const generation = authGeneration;
    source.disabled = true;
    setMessage(elements.gameMessage, 'Vault validiert Aktion …', false);
    try {
      const payload = await request('/action', { method: 'POST', body: JSON.stringify(body) });
      if (generation !== authGeneration || !currentState) return;
      render(payload);
      dirty = true;
      elements.saveState.textContent = 'Autosave ausstehend';
      setMessage(elements.gameMessage, 'Aktion bestätigt und im Vault persistiert.', false);
    } catch (error) {
      if (generation !== authGeneration) return;
      if (error.status === 401) {
        sessionExpired();
        return;
      }
      if (isOffline(error)) setOfflineConnection(error);
      setMessage(elements.gameMessage, error.message, true);
    } finally {
      const cooldown = body.action === 'harvest' ? 720 : 0;
      window.setTimeout(() => {
        source.disabled = false;
        actionPending = false;
      }, cooldown);
    }
  }

  async function save(kind) {
    if (!currentState) return;
    const generation = authGeneration;
    const button = document.getElementById('save-button');
    button.disabled = true;
    elements.saveState.textContent = kind === 'auto' ? 'Autosave läuft …' : 'Speichern …';
    try {
      const payload = await request('/save', { method: 'POST', body: JSON.stringify({ kind }) });
      if (generation !== authGeneration || !currentState) return;
      render(payload);
      dirty = false;
      elements.saveState.textContent = kind === 'auto' ? 'Autosave abgeschlossen' : 'Manuell gespeichert';
    } catch (error) {
      if (generation !== authGeneration) return;
      if (error.status === 401) {
        sessionExpired();
        return;
      }
      if (isOffline(error)) setOfflineConnection(error);
      elements.saveState.textContent = 'Speichern fehlgeschlagen – erneut versuchen';
      setMessage(elements.gameMessage, error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function loadLeaderboard() {
    try {
      const payload = await request('/leaderboard');
      elements.leaderboard.replaceChildren(...payload.leaders.map((leader) => {
        const item = document.createElement('li');
        const handle = document.createElement('span');
        const score = document.createElement('b');
        handle.textContent = leader.handle;
        score.textContent = leader.vibeScore;
        item.append(handle, score);
        return item;
      }));
      if (!payload.leaders.length) {
        const empty = document.createElement('li');
        empty.innerHTML = '<span>Noch keine Signale</span><b>0</b>';
        elements.leaderboard.append(empty);
      }
    } catch (error) {
      const item = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = isOffline(error) ? 'Leaderboard nicht verfügbar – Vault-Server offline' : 'Leaderboard konnte nicht geladen werden';
      item.append(text);
      elements.leaderboard.replaceChildren(item);
    }
  }

  document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate('/login', event.currentTarget);
  });
  document.getElementById('register-form').addEventListener('submit', (event) => {
    event.preventDefault();
    authenticate('/register', event.currentTarget);
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => performAction({ action: button.dataset.action }, button));
  });
  document.querySelectorAll('[data-upgrade]').forEach((button) => {
    button.addEventListener('click', () => performAction({ action: 'upgrade', upgrade: button.dataset.upgrade }, button));
  });
  document.querySelectorAll('[data-node]').forEach((button) => {
    button.addEventListener('click', () => performAction({ action: 'tree', node: button.dataset.node }, button));
  });
  document.querySelectorAll('[data-track]').forEach((button) => {
    button.addEventListener('click', () => performAction({ action: 'jukebox', track: button.dataset.track }, button));
  });
  document.getElementById('save-button').addEventListener('click', () => save('manual'));
  document.getElementById('leaderboard-refresh').addEventListener('click', loadLeaderboard);
  document.getElementById('logout-button').addEventListener('click', async () => {
    const generation = authGeneration;
    try {
      await request('/logout', { method: 'POST', body: '{}' });
    } catch (error) {
      if (generation !== authGeneration) return;
      if (error.status === 401) {
        sessionExpired();
        return;
      }
      setMessage(elements.gameMessage, error.message, true);
      return;
    }
    if (generation !== authGeneration) return;
    showAuth('Session beendet. Dein Fortschritt bleibt im Vault.');
    setConnection('', 'Vault online – bitte anmelden');
  });

  let bootstrapGeneration = authGeneration;
  let bootstrapError = null;
  Promise.all([
    request('/session').then((payload) => {
      if (bootstrapGeneration !== authGeneration) return;
      render(payload);
      startAutosave();
    }).catch((error) => {
      if (bootstrapGeneration !== authGeneration) return;
      showAuth();
      bootstrapGeneration = authGeneration;
      if (error.code !== 'SESSION_REQUIRED') {
        bootstrapError = error;
        setMessage(elements.authMessage, error.message, true);
      }
    }),
    loadLeaderboard()
  ]).finally(() => {
    if (currentState || bootstrapGeneration !== authGeneration) return;
    if (bootstrapError && isOffline(bootstrapError)) setOfflineConnection(bootstrapError);
    else if (bootstrapError) setConnection('offline', 'Vault-Fehler – später erneut versuchen', bootstrapError.message);
    else setConnection('', 'Vault online – bitte anmelden');
  });
}());
