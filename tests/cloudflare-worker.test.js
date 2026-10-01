'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WORKER_URL = pathToFileURL(path.join(__dirname, '..', 'cloudflare', 'src', 'worker.js')).href;
const ORIGIN = 'https://stream-musik.space';
const BASE = 'https://vault.stream-musik.space/api/quantum-vault';

function createDatabase() {
  const users = [];
  const vaultState = new Map();
  const leaderboard = new Map();
  const studioPresets = new Map();
  let leaderboardUpdateCount = 0;

  function execute(sql, args) {
    if (sql.startsWith('SELECT id FROM users WHERE handle_key')) {
      return { first: users.find((user) => user.handle_key === args[0]) || null };
    }
    if (sql.startsWith('SELECT id, handle, pw_hash, pw_salt FROM users WHERE handle_key')) {
      return { first: users.find((user) => user.handle_key === args[0]) || null };
    }
    if (sql.startsWith('SELECT id, handle FROM users WHERE id')) {
      return { first: users.find((user) => user.id === args[0]) || null };
    }
    if (sql.startsWith('INSERT INTO users')) {
      users.push({ id: args[0], handle: args[1], handle_key: args[2], pw_hash: args[3], pw_salt: args[4] });
      return { first: null };
    }
    if (sql.startsWith('SELECT state_json FROM vault_state')) {
      const stored = vaultState.get(args[0]);
      return { first: stored ? { state_json: stored } : null };
    }
    if (sql.startsWith('INSERT INTO vault_state')) {
      vaultState.set(args[0], args[1]);
      return { first: null };
    }
    if (sql.startsWith('UPDATE vault_state')) {
      vaultState.set(args[2], args[0]);
      return { first: null };
    }
    if (sql.startsWith('INSERT INTO leaderboard')) {
      leaderboard.set(args[0], { handle: args[1], vibe_score: 0 });
      return { first: null };
    }
    if (sql.startsWith('UPDATE leaderboard')) {
      leaderboardUpdateCount += 1;
      const entry = leaderboard.get(args[2]);
      if (entry) entry.vibe_score = args[0];
      return { first: null };
    }
    if (sql.startsWith('SELECT handle, vibe_score FROM leaderboard')) {
      const rows = Array.from(leaderboard.values())
        .slice()
        .sort((a, b) => b.vibe_score - a.vibe_score || a.handle.localeCompare(b.handle))
        .slice(0, args[0]);
      return { results: rows };
    }
    if (sql.startsWith('SELECT preset_json, updated_at FROM studio_presets')) {
      const stored = studioPresets.get(args[0]);
      return { first: stored ? { preset_json: stored.json, updated_at: stored.updatedAt } : null };
    }
    if (sql.startsWith('INSERT INTO studio_presets') && sql.includes('ON CONFLICT(user_id) DO UPDATE')) {
      studioPresets.set(args[0], { json: args[1], updatedAt: args[2] });
      return { first: null };
    }
    throw new Error(`unsupported SQL in test double: ${sql}`);
  }

  return {
    users,
    studioPresets,
    get leaderboardUpdateCount() { return leaderboardUpdateCount; },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return execute(sql, args).first; },
            async all() { return { results: execute(sql, args).results || [] }; },
            async run() { execute(sql, args); return { success: true }; },
            __run() { execute(sql, args); }
          };
        }
      };
    },
    async batch(statements) {
      statements.forEach((statement) => statement.__run());
      return statements.map(() => ({ success: true }));
    }
  };
}

function createSessions() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); }
  };
}

function createEnv(overrides) {
  return Object.assign({
    DB: createDatabase(),
    SESSIONS: createSessions(),
    ALLOWED_ORIGINS: `${ORIGIN}, https://www.stream-musik.space`,
    HARVEST_COOLDOWN_MS: '0',
    PEPPER: 'test-pepper'
  }, overrides || {});
}

async function call(worker, env, route, options) {
  const settings = Object.assign({ method: 'GET' }, options || {});
  const headers = new Headers(settings.headers || {});
  if (settings.json !== undefined) {
    settings.body = JSON.stringify(settings.json);
    headers.set('Content-Type', 'application/json');
    delete settings.json;
  }
  if (settings.method !== 'GET' && !headers.has('Origin') && !settings.noOrigin) headers.set('Origin', ORIGIN);
  delete settings.noOrigin;
  if (settings.cookie) {
    headers.set('Cookie', settings.cookie);
    delete settings.cookie;
  }
  settings.headers = headers;
  const response = await worker.fetch(new Request(`${BASE}${route}`, settings), env);
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

async function main() {
  const module = await import(WORKER_URL);
  const worker = module.default;
  const env = createEnv();

  const health = await call(worker, env, '/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.payload, { ok: true, service: 'quantum-vault', status: 'ready' });

  const preflight = await call(worker, env, '/login', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  assert.equal(preflight.response.status, 204);
  assert.equal(preflight.response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(preflight.response.headers.get('access-control-allow-credentials'), 'true');

  const foreignPreflight = await call(worker, env, '/login', {
    method: 'OPTIONS',
    headers: { Origin: 'https://attacker.example' }
  });
  assert.equal(foreignPreflight.response.headers.get('access-control-allow-origin'), null);

  const crossOrigin = await call(worker, env, '/register', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
    json: { handle: 'Attacker', password: 'correct-horse-vault' }
  });
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.payload.code, 'CROSS_ORIGIN');

  const unknownRoute = await call(worker, env, '/does-not-exist');
  assert.equal(unknownRoute.response.status, 404);
  assert.equal(unknownRoute.payload.code, 'NOT_FOUND');

  const badHandle = await call(worker, env, '/register', {
    method: 'POST',
    json: { handle: 'no spaces!', password: 'correct-horse-vault' }
  });
  assert.equal(badHandle.response.status, 400);
  assert.equal(badHandle.payload.code, 'HANDLE_INVALID');

  const weak = await call(worker, env, '/register', { method: 'POST', json: { handle: 'pilot', password: 'short' } });
  assert.equal(weak.response.status, 400);
  assert.equal(weak.payload.code, 'PASSWORD_INVALID');

  const badJson = await call(worker, env, '/login', {
    method: 'POST',
    body: '{not json',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(badJson.response.status, 400);
  assert.equal(badJson.payload.code, 'INVALID_JSON');

  const oversized = await call(worker, env, '/register', {
    method: 'POST',
    json: { handle: 'large', password: 'x'.repeat(17000) }
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.payload.code, 'BODY_TOO_LARGE');

  const registered = await call(worker, env, '/register', {
    method: 'POST',
    json: { handle: 'Pilot_One', password: 'correct-horse-vault' }
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.payload.handle, 'Pilot_One');
  assert.equal(registered.payload.state.vibeScore, 0);
  assert.equal(registered.payload.id, undefined, 'account IDs must never be exposed');
  const setCookie = registered.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=None/);
  assert.match(registered.response.headers.get('cache-control'), /no-store/);
  const cookie = cookieFrom(registered.response);

  assert.ok(env.DB.users.length === 1);
  assert.ok(!JSON.stringify(env.DB.users[0]).includes('correct-horse-vault'), 'passwords must never be stored');

  const duplicate = await call(worker, env, '/register', {
    method: 'POST',
    json: { handle: 'pilot_one', password: 'another-strong-password' }
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.code, 'HANDLE_TAKEN');

  const session = await call(worker, env, '/session', { cookie });
  assert.equal(session.response.status, 200);
  assert.equal(session.payload.handle, 'Pilot_One');

  const anonymous = await call(worker, env, '/session');
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.payload.code, 'SESSION_REQUIRED');

  const manipulated = await call(worker, env, '/action', {
    method: 'POST',
    cookie,
    json: {
      action: 'harvest',
      userId: 'another-account',
      vibeScore: 999999999,
      fragments: 999999999,
      state: { vibeScore: 999999999 }
    }
  });
  assert.equal(manipulated.response.status, 200);
  assert.equal(manipulated.payload.state.vibeScore, 1, 'client supplied scores must be ignored');
  assert.equal(manipulated.payload.state.fragments, 1);

  for (let count = 1; count < 20; count += 1) {
    const harvested = await call(worker, env, '/action', { method: 'POST', cookie, json: { action: 'harvest' } });
    assert.equal(harvested.response.status, 200);
  }

  const upgraded = await call(worker, env, '/action', {
    method: 'POST',
    cookie,
    json: { action: 'upgrade', upgrade: 'resonator', level: 99, cost: 0 }
  });
  assert.equal(upgraded.response.status, 200);
  assert.equal(upgraded.payload.state.upgrades.resonator, 1);
  assert.equal(upgraded.payload.state.fragments, 0);
  assert.equal(upgraded.payload.state.vibeScore, 40);

  const invalidAction = await call(worker, env, '/action', {
    method: 'POST',
    cookie,
    json: { action: 'set-score', vibeScore: Number.MAX_SAFE_INTEGER }
  });
  assert.equal(invalidAction.response.status, 400);
  assert.equal(invalidAction.payload.code, 'UNKNOWN_ACTION');

  const leaderboardUpdatesBeforeSave = env.DB.leaderboardUpdateCount;
  const saved = await call(worker, env, '/save', {
    method: 'POST',
    cookie,
    json: { kind: 'manual', state: { vibeScore: 999999999 } }
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.state.vibeScore, 40);
  assert.equal(saved.payload.state.stats.manualSaves, 1);
  assert.equal(env.DB.leaderboardUpdateCount, leaderboardUpdatesBeforeSave,
    'saving state must not issue an unchanged leaderboard write');

  const badSaveKind = await call(worker, env, '/save', { method: 'POST', cookie, json: { kind: 'cheat' } });
  assert.equal(badSaveKind.response.status, 400);
  assert.equal(badSaveKind.payload.code, 'INVALID_SAVE_KIND');

  const anonymousPreset = await call(worker, env, '/studio-preset');
  assert.equal(anonymousPreset.response.status, 401);
  assert.equal(anonymousPreset.payload.code, 'SESSION_REQUIRED');

  const emptyPreset = await call(worker, env, '/studio-preset', { cookie });
  assert.equal(emptyPreset.response.status, 200);
  assert.equal(emptyPreset.payload.preset, null, 'accounts start without a stored studio preset');

  const invalidPreset = await call(worker, env, '/studio-preset', {
    method: 'POST',
    cookie,
    json: { preset: { settings: { eqLow: 'loud' } } }
  });
  assert.equal(invalidPreset.response.status, 400);
  assert.equal(invalidPreset.payload.code, 'STUDIO_PRESET_INVALID');

  const crossOriginPreset = await call(worker, env, '/studio-preset', {
    method: 'POST',
    cookie,
    headers: { Origin: 'https://attacker.example' },
    json: { preset: { settings: {} } }
  });
  assert.equal(crossOriginPreset.response.status, 403);
  assert.equal(crossOriginPreset.payload.code, 'CROSS_ORIGIN');

  const savedPreset = await call(worker, env, '/studio-preset', {
    method: 'POST',
    cookie,
    json: {
      preset: {
        settings: {
          eqLow: 1.3, eqMid: -40, eqHigh: 2, compThreshold: -20, compRatio: 3.24,
          limiterCeiling: -1, stereoWidth: 400, targetLufs: -12, audio: 'data:audio/wav;base64,AAAA'
        },
        enhance: { auto: false, strength: 'strong' },
        userId: 'another-account'
      }
    }
  });
  assert.equal(savedPreset.response.status, 200);
  assert.deepEqual(savedPreset.payload.preset, {
    settings: {
      eqLow: 1.5, eqMid: -12, eqHigh: 2, compThreshold: -20, compRatio: 3.2,
      limiterCeiling: -1, stereoWidth: 200, targetLufs: -12
    },
    enhance: { auto: false, strength: 'strong' }
  }, 'studio presets must be clamped, snapped and stripped of unknown fields');
  assert.ok(!JSON.stringify(Array.from(env.DB.studioPresets.values())).includes('audio'),
    'studio presets must never persist audio payloads');

  for (const strength of ['subtle', 'intense', 'maximum']) {
    const finerPreset = await call(worker, env, '/studio-preset', {
      method: 'POST',
      cookie,
      json: { preset: { settings: savedPreset.payload.preset.settings, enhance: { auto: true, strength } } }
    });
    assert.equal(finerPreset.response.status, 200, JSON.stringify(finerPreset.payload));
    assert.equal(finerPreset.payload.preset.enhance.strength, strength, 'finer enhance strengths must sync: ' + strength);
  }
  const unknownStrength = await call(worker, env, '/studio-preset', {
    method: 'POST',
    cookie,
    json: { preset: { settings: savedPreset.payload.preset.settings, enhance: { auto: true, strength: 'ultra' } } }
  });
  assert.equal(unknownStrength.payload.preset.enhance.strength, 'balanced', 'unknown strengths must fall back to balanced');
  await call(worker, env, '/studio-preset', { method: 'POST', cookie, json: { preset: savedPreset.payload.preset } });

  const loadedPreset = await call(worker, env, '/studio-preset', { cookie });
  assert.equal(loadedPreset.response.status, 200);
  assert.deepEqual(loadedPreset.payload.preset, savedPreset.payload.preset);
  assert.equal(typeof loadedPreset.payload.updatedAt, 'string');

  const second = await call(worker, env, '/register', {
    method: 'POST',
    json: { handle: 'SecondPilot', password: 'second-correct-password' }
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.payload.state.vibeScore, 0, 'vault state must be account-bound');
  const secondPreset = await call(worker, env, '/studio-preset', { cookie: cookieFrom(second.response) });
  assert.equal(secondPreset.payload.preset, null, 'studio presets must be account-bound');

  const leaderboard = await call(worker, env, '/leaderboard');
  assert.equal(leaderboard.response.status, 200);
  assert.deepEqual(leaderboard.payload.leaders.map((entry) => entry.handle), ['Pilot_One', 'SecondPilot']);
  assert.deepEqual(leaderboard.payload.leaders.map((entry) => entry.vibeScore), [40, 0]);

  const loggedOut = await call(worker, env, '/logout', { method: 'POST', cookie, json: {} });
  assert.equal(loggedOut.response.status, 200);
  assert.match(loggedOut.response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(env.SESSIONS.store.size, 1, 'logout must revoke the session entry');

  const revoked = await call(worker, env, '/session', { cookie });
  assert.equal(revoked.response.status, 401);
  assert.equal(revoked.payload.code, 'SESSION_REQUIRED');

  const wrongPassword = await call(worker, env, '/login', {
    method: 'POST',
    json: { handle: 'Pilot_One', password: 'incorrect-password' }
  });
  assert.equal(wrongPassword.response.status, 401);
  assert.equal(wrongPassword.payload.code, 'INVALID_CREDENTIALS');

  const unknownUser = await call(worker, env, '/login', {
    method: 'POST',
    json: { handle: 'GhostPilot', password: 'incorrect-password' }
  });
  assert.equal(unknownUser.response.status, 401);
  assert.equal(unknownUser.payload.code, 'INVALID_CREDENTIALS');

  const relogin = await call(worker, env, '/login', {
    method: 'POST',
    json: { handle: 'pilot_one', password: 'correct-horse-vault' }
  });
  assert.equal(relogin.response.status, 200);
  assert.equal(relogin.payload.state.vibeScore, 40, 'vault state must survive new sessions');
  assert.equal(relogin.payload.state.upgrades.resonator, 1);

  const cooldownEnv = createEnv({ HARVEST_COOLDOWN_MS: '60000' });
  const cooldownAccount = await call(worker, cooldownEnv, '/register', {
    method: 'POST',
    json: { handle: 'CooldownPilot', password: 'cooldown-password-ok' }
  });
  const cooldownCookie = cookieFrom(cooldownAccount.response);
  const firstHarvest = await call(worker, cooldownEnv, '/action', {
    method: 'POST',
    cookie: cooldownCookie,
    json: { action: 'harvest' }
  });
  assert.equal(firstHarvest.response.status, 200);
  const throttled = await call(worker, cooldownEnv, '/action', {
    method: 'POST',
    cookie: cooldownCookie,
    json: { action: 'harvest' }
  });
  assert.equal(throttled.response.status, 429);
  assert.equal(throttled.payload.code, 'ACTION_COOLDOWN');

  const withoutBindings = await call(worker, { ALLOWED_ORIGINS: ORIGIN }, '/session');
  assert.equal(withoutBindings.response.status, 500);
  assert.equal(withoutBindings.payload.code, 'DB_UNAVAILABLE');

  console.log('cloudflare worker tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
