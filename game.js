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

  async function request(route, options) {
    const settings = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (settings.body) settings.headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API}${route}`, settings);
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || 'Vault ist nicht erreichbar.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setMessage(target, message, isError) {
    target.textContent = message;
    target.classList.toggle('error', Boolean(isError));
  }

  function setConnection(state, message) {
    elements.connection.className = `connection ${state}`;
    elements.connection.lastChild.textContent = message;
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
    const generation = ++authGeneration;
    const data = new FormData(form);
    setMessage(elements.authMessage, 'Authentifizierung läuft …', false);
    try {
      const payload = await request(route, {
        method: 'POST',
        body: JSON.stringify({ handle: data.get('handle'), password: data.get('password') })
      });
      if (generation !== authGeneration) return;
      form.reset();
      render(payload);
      startAutosave();
      setMessage(elements.gameMessage, 'Quantum Vault synchronisiert.', false);
      loadLeaderboard();
    } catch (error) {
      if (generation !== authGeneration) return;
      setConnection('offline', 'Vault-Link fehlgeschlagen');
      setMessage(elements.authMessage, error.message, true);
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
        showAuth('Deine Session ist abgelaufen. Bitte melde dich erneut an.');
        setConnection('offline', 'Session abgelaufen');
        return;
      }
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
        showAuth('Deine Session ist abgelaufen. Bitte melde dich erneut an.');
        setConnection('offline', 'Session abgelaufen');
        return;
      }
      elements.saveState.textContent = 'Speichern fehlgeschlagen';
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
      elements.leaderboard.textContent = 'Leaderboard nicht erreichbar.';
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
        showAuth('Deine Session ist abgelaufen. Bitte melde dich erneut an.');
        setConnection('offline', 'Session abgelaufen');
        return;
      }
      setMessage(elements.gameMessage, error.message, true);
      return;
    }
    if (generation !== authGeneration) return;
    showAuth('Session beendet. Dein Fortschritt bleibt im Vault.');
    setConnection('', 'Bereit für Login');
  });

  const bootstrapGeneration = authGeneration;
  Promise.all([
    request('/session').then((payload) => {
      if (bootstrapGeneration !== authGeneration) return;
      render(payload);
      startAutosave();
    }).catch(() => {
      if (bootstrapGeneration === authGeneration) showAuth();
    }),
    loadLeaderboard()
  ]).finally(() => {
    if (!currentState) setConnection('', 'Bereit für Login');
  });
}());
