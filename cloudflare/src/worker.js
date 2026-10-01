/**
 * Reusable Cloudflare Worker backend (Workers + D1 + KV).
 *
 * The Worker is server-authoritative: clients may only name an action, never
 * submit account ids, scores or whole state objects. Sessions live in KV and
 * are referenced by an HttpOnly cookie, so browsers never store credentials or
 * game state as a source of truth.
 */

export const API_PREFIX = '/api/quantum-vault';
export const SESSION_COOKIE = 'quantum_vault_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_HARVEST_COOLDOWN_MS = 700;
export const PBKDF2_ITERATIONS = 210000;
export const LEADERBOARD_LIMIT = 25;

const UPGRADE_RULES = Object.freeze({
  resonator: { currency: 'fragments', baseCost: 20, maxLevel: 8 },
  forge: { currency: 'alloys', baseCost: 3, maxLevel: 8 },
  prism: { currency: 'alloys', baseCost: 5, maxLevel: 5 }
});

const TREE_RULES = Object.freeze({
  pulse: { vibe: 75, fragments: 25, requires: null },
  lattice: { vibe: 250, fragments: 75, requires: 'pulse' },
  singularity: { vibe: 750, alloys: 20, requires: 'lattice' }
});

const JUKEBOX_RULES = Object.freeze({
  'event-horizon': 100,
  'neon-drift': 350,
  'zero-point': 900
});

// Studio presets only contain mastering slider values and Auto-Enhance
// preferences. Audio files and renders never leave the browser.
export const STUDIO_PRESET_RULES = Object.freeze({
  eqLow: { min: -12, max: 12, step: 0.5 },
  eqMid: { min: -12, max: 12, step: 0.5 },
  eqHigh: { min: -12, max: 12, step: 0.5 },
  compThreshold: { min: -36, max: 0, step: 1 },
  compRatio: { min: 1, max: 8, step: 0.1 },
  limiterCeiling: { min: -6, max: 0, step: 0.1 },
  stereoWidth: { min: 0, max: 200, step: 1 },
  targetLufs: { min: -18, max: -8, step: 0.5 }
});
export const STUDIO_ENHANCE_STRENGTHS = Object.freeze(['subtle', 'gentle', 'balanced', 'strong', 'intense', 'maximum']);

export class VaultError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'VaultError';
    this.status = status || 400;
    this.code = code || 'VAULT_ERROR';
  }
}

export function defaultState(now) {
  const timestamp = new Date(now).toISOString();
  return {
    revision: 0,
    vibeScore: 0,
    fragments: 0,
    alloys: 0,
    upgrades: { resonator: 0, forge: 0, prism: 0 },
    treeNodes: [],
    jukebox: [],
    stats: {
      harvests: 0,
      forges: 0,
      upgrades: 0,
      nodes: 0,
      manualSaves: 0,
      autosaves: 0,
      createdAt: timestamp,
      lastSavedAt: timestamp
    },
    _lastHarvestAt: 0
  };
}

export function publicState(state) {
  return {
    revision: state.revision,
    vibeScore: state.vibeScore,
    fragments: state.fragments,
    alloys: state.alloys,
    upgrades: Object.assign({}, state.upgrades),
    treeNodes: state.treeNodes.slice(),
    jukebox: state.jukebox.slice(),
    stats: Object.assign({}, state.stats)
  };
}

export function normalizeHandle(value) {
  const handle = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(handle)) {
    throw new VaultError('Handle must be 3–20 characters using letters, numbers, _ or -.', 400, 'HANDLE_INVALID');
  }
  return { display: handle, key: handle.toLowerCase() };
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 128) {
    throw new VaultError('Password must be between 10 and 128 characters.', 400, 'PASSWORD_INVALID');
  }
  return password;
}

function toBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export function randomBase64(byteLength) {
  return toBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/**
 * Workers have no Node `crypto.scrypt`, so this template uses WebCrypto PBKDF2
 * (SHA-256) with a per-account salt and an optional server-side pepper secret.
 */
export async function hashPassword(password, salt, pepper) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${password}${pepper || ''}`),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    256
  );
  return toBase64(new Uint8Array(bits));
}

export function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveOrigin(env, request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return allowedOrigins(env).includes(origin) ? origin : null;
}

function corsHeaders(env, request) {
  const headers = new Headers({ Vary: 'Origin' });
  const origin = resolveOrigin(env, request);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  headers.set('Access-Control-Allow-Headers', 'content-type');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function json(data, status, baseHeaders, extraHeaders) {
  const headers = new Headers(baseHeaders || undefined);
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach((name) => headers.append(name, extraHeaders[name]));
  }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store, private');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) {
    throw new VaultError('Request body is too large.', 413, 'BODY_TOO_LARGE');
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new VaultError('Request body is too large.', 413, 'BODY_TOO_LARGE');
  }
  if (!raw) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new VaultError('Request body must be a JSON object.', 400, 'INVALID_JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VaultError('Request body must be a JSON object.', 400, 'INVALID_JSON');
  }
  return value;
}

export function parseCookies(header) {
  const cookies = Object.create(null);
  String(header || '').split(';').forEach((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    if (name) cookies[name] = part.slice(separator + 1).trim();
  });
  return cookies;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=${API_PREFIX}; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=${API_PREFIX}; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

function cooldownMs(env) {
  const configured = Number(env && env.HARVEST_COOLDOWN_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_HARVEST_COOLDOWN_MS;
}

/**
 * Applies a single named action. Only `action` and its id selector are read
 * from the request; every amount is derived from the stored server state.
 */
export function applyAction(state, body, options) {
  const settings = options || {};
  const now = typeof settings.now === 'number' ? settings.now : Date.now();
  const cooldown = typeof settings.cooldownMs === 'number' ? settings.cooldownMs : DEFAULT_HARVEST_COOLDOWN_MS;
  const action = String(body.action || '');

  if (action === 'harvest') {
    if (now - state._lastHarvestAt < cooldown) {
      throw new VaultError('Harvester is recharging.', 429, 'ACTION_COOLDOWN');
    }
    const amount = 1 + state.upgrades.resonator;
    state.fragments += amount;
    state.vibeScore += amount;
    state.stats.harvests += 1;
    state._lastHarvestAt = now;
  } else if (action === 'forge') {
    const cost = Math.max(4, 10 - state.upgrades.forge);
    if (state.fragments < cost) {
      throw new VaultError(`Forging requires ${cost} fragments.`, 409, 'INSUFFICIENT_RESOURCES');
    }
    state.fragments -= cost;
    state.alloys += 1 + Math.floor(state.upgrades.forge / 3);
    state.vibeScore += 5;
    state.stats.forges += 1;
  } else if (action === 'upgrade') {
    const id = String(body.upgrade || '');
    const rule = UPGRADE_RULES[id];
    if (!rule) throw new VaultError('Unknown upgrade.', 400, 'UNKNOWN_UPGRADE');
    const level = state.upgrades[id];
    if (level >= rule.maxLevel) {
      throw new VaultError('Upgrade is already at maximum level.', 409, 'UPGRADE_MAXED');
    }
    const cost = rule.baseCost * (level + 1);
    if (state[rule.currency] < cost) {
      throw new VaultError(`Upgrade requires ${cost} ${rule.currency}.`, 409, 'INSUFFICIENT_RESOURCES');
    }
    state[rule.currency] -= cost;
    state.upgrades[id] += 1;
    state.vibeScore += cost;
    state.stats.upgrades += 1;
  } else if (action === 'tree') {
    const id = String(body.node || '');
    const rule = TREE_RULES[id];
    if (!rule) throw new VaultError('Unknown tree node.', 400, 'UNKNOWN_NODE');
    if (state.treeNodes.includes(id)) {
      throw new VaultError('Tree node is already unlocked.', 409, 'NODE_UNLOCKED');
    }
    if (rule.requires && !state.treeNodes.includes(rule.requires)) {
      throw new VaultError('Required tree node is not unlocked.', 409, 'NODE_LOCKED');
    }
    if (state.vibeScore < rule.vibe) {
      throw new VaultError(`Tree node requires ${rule.vibe} Vibe.`, 409, 'INSUFFICIENT_RESOURCES');
    }
    if (rule.fragments && state.fragments < rule.fragments) {
      throw new VaultError(`Tree node requires ${rule.fragments} fragments.`, 409, 'INSUFFICIENT_RESOURCES');
    }
    if (rule.alloys && state.alloys < rule.alloys) {
      throw new VaultError(`Tree node requires ${rule.alloys} alloys.`, 409, 'INSUFFICIENT_RESOURCES');
    }
    state.fragments -= rule.fragments || 0;
    state.alloys -= rule.alloys || 0;
    state.treeNodes.push(id);
    state.stats.nodes += 1;
  } else if (action === 'jukebox') {
    const id = String(body.track || '');
    const threshold = JUKEBOX_RULES[id];
    if (!threshold) throw new VaultError('Unknown jukebox signal.', 400, 'UNKNOWN_TRACK');
    if (state.jukebox.includes(id)) {
      throw new VaultError('Jukebox signal is already decoded.', 409, 'TRACK_DECODED');
    }
    if (state.vibeScore < threshold) {
      throw new VaultError(`Signal requires ${threshold} Vibe.`, 409, 'INSUFFICIENT_RESOURCES');
    }
    state.jukebox.push(id);
  } else {
    throw new VaultError('Unknown game action.', 400, 'UNKNOWN_ACTION');
  }

  state.revision += 1;
  state.stats.lastSavedAt = new Date(now).toISOString();
  return state;
}

/**
 * Builds a clean Studio preset from untrusted input. Only whitelisted numeric
 * slider values (clamped and snapped to the slider step) and the Auto-Enhance
 * preferences are kept; everything else is dropped.
 */
export function normalizeStudioPreset(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const settingsInput = source && source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)
    ? source.settings
    : null;
  if (!settingsInput) {
    throw new VaultError('Studio preset must contain a settings object.', 400, 'STUDIO_PRESET_INVALID');
  }
  const settings = {};
  Object.keys(STUDIO_PRESET_RULES).forEach((key) => {
    const rule = STUDIO_PRESET_RULES[key];
    const value = Number(settingsInput[key]);
    if (settingsInput[key] === null || settingsInput[key] === '' || !Number.isFinite(value)) {
      throw new VaultError(`Studio preset value ${key} must be a number.`, 400, 'STUDIO_PRESET_INVALID');
    }
    const snapped = Math.round(value / rule.step) * rule.step;
    settings[key] = Number(Math.max(rule.min, Math.min(rule.max, snapped)).toFixed(2));
  });
  const enhanceInput = source.enhance && typeof source.enhance === 'object' ? source.enhance : {};
  const enhance = {
    auto: typeof enhanceInput.auto === 'boolean' ? enhanceInput.auto : true,
    strength: STUDIO_ENHANCE_STRENGTHS.includes(enhanceInput.strength) ? enhanceInput.strength : 'balanced'
  };
  return { settings, enhance };
}

async function loadStudioPreset(env, userId) {
  const row = await env.DB.prepare('SELECT preset_json, updated_at FROM studio_presets WHERE user_id = ?').bind(userId).first();
  if (!row) return { preset: null, updatedAt: null };
  try {
    return { preset: normalizeStudioPreset(JSON.parse(row.preset_json)), updatedAt: row.updated_at };
  } catch (error) {
    return { preset: null, updatedAt: null };
  }
}

function requireBindings(env) {
  if (!env || !env.DB) throw new VaultError('Vault database binding is missing.', 500, 'DB_UNAVAILABLE');
  if (!env.SESSIONS) throw new VaultError('Session store binding is missing.', 500, 'SESSIONS_UNAVAILABLE');
}

async function issueSession(env, userId) {
  const token = `${crypto.randomUUID()}.${randomBase64(24)}`;
  await env.SESSIONS.put(`sess:${token}`, JSON.stringify({ userId, createdAt: new Date().toISOString() }), {
    expirationTtl: SESSION_TTL_SECONDS
  });
  return token;
}

async function authenticate(request, env) {
  const raw = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  const token = raw ? decodeURIComponent(raw) : '';
  const stored = token ? await env.SESSIONS.get(`sess:${token}`) : null;
  let userId = '';
  if (stored) {
    try {
      userId = String(JSON.parse(stored).userId || '');
    } catch (error) {
      userId = '';
    }
  }
  if (!userId) throw new VaultError('Authentication required.', 401, 'SESSION_REQUIRED');
  const user = await env.DB.prepare('SELECT id, handle FROM users WHERE id = ?').bind(userId).first();
  if (!user) {
    await env.SESSIONS.delete(`sess:${token}`);
    throw new VaultError('Authentication required.', 401, 'SESSION_REQUIRED');
  }
  return { token, user };
}

async function loadState(env, userId) {
  const row = await env.DB.prepare('SELECT state_json FROM vault_state WHERE user_id = ?').bind(userId).first();
  if (!row) throw new VaultError('Vault state is missing for this account.', 500, 'VAULT_STATE_MISSING');
  try {
    return JSON.parse(row.state_json);
  } catch (error) {
    throw new VaultError('Vault state could not be read.', 500, 'VAULT_STATE_INVALID');
  }
}

async function persistState(env, user, state, updateLeaderboard = true) {
  const timestamp = new Date().toISOString();
  const statements = [
    env.DB.prepare('UPDATE vault_state SET state_json = ?, updated_at = ? WHERE user_id = ?')
      .bind(JSON.stringify(state), timestamp, user.id)
  ];
  if (updateLeaderboard) {
    statements.push(
      env.DB.prepare('UPDATE leaderboard SET vibe_score = ?, updated_at = ? WHERE user_id = ?')
        .bind(state.vibeScore, timestamp, user.id)
    );
  }
  await env.DB.batch(statements);
}

async function register(request, env, cors) {
  const body = await readJsonBody(request);
  const handle = normalizeHandle(body.handle);
  const password = validatePassword(body.password);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE handle_key = ?').bind(handle.key).first();
  if (existing) throw new VaultError('This handle is already registered.', 409, 'HANDLE_TAKEN');

  const userId = crypto.randomUUID();
  const salt = randomBase64(16);
  const passwordHash = await hashPassword(password, salt, env.PEPPER);
  const timestamp = new Date().toISOString();
  const state = defaultState(Date.now());

  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, handle, handle_key, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, handle.display, handle.key, passwordHash, salt, timestamp),
    env.DB.prepare('INSERT INTO vault_state (user_id, state_json, updated_at) VALUES (?, ?, ?)')
      .bind(userId, JSON.stringify(state), timestamp),
    env.DB.prepare('INSERT INTO leaderboard (user_id, handle, vibe_score, updated_at) VALUES (?, ?, 0, ?)')
      .bind(userId, handle.display, timestamp)
  ]);

  const token = await issueSession(env, userId);
  return json({ handle: handle.display, state: publicState(state) }, 201, cors, {
    'Set-Cookie': sessionCookie(token)
  });
}

async function login(request, env, cors) {
  const body = await readJsonBody(request);
  const handle = normalizeHandle(body.handle);
  const password = validatePassword(body.password);

  const user = await env.DB
    .prepare('SELECT id, handle, pw_hash, pw_salt FROM users WHERE handle_key = ?')
    .bind(handle.key)
    .first();
  const salt = user ? user.pw_salt : randomBase64(16);
  const candidate = await hashPassword(password, salt, env.PEPPER);
  if (!user || !timingSafeEqual(candidate, user.pw_hash)) {
    throw new VaultError('Invalid handle or password.', 401, 'INVALID_CREDENTIALS');
  }

  const token = await issueSession(env, user.id);
  const state = await loadState(env, user.id);
  return json({ handle: user.handle, state: publicState(state) }, 200, cors, {
    'Set-Cookie': sessionCookie(token)
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const cors = corsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (!url.pathname.startsWith(API_PREFIX)) {
    return json({ code: 'NOT_FOUND', error: 'Quantum Vault endpoint not found.' }, 404, cors);
  }

  const route = url.pathname.slice(API_PREFIX.length) || '/';

  try {
    if (request.method !== 'GET' && !resolveOrigin(env, request)) {
      throw new VaultError('Cross-origin requests are not allowed.', 403, 'CROSS_ORIGIN');
    }

    if (route === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'quantum-vault', status: 'ready' }, 200, cors);
    }

    requireBindings(env);

    if (route === '/register' && request.method === 'POST') return await register(request, env, cors);
    if (route === '/login' && request.method === 'POST') return await login(request, env, cors);

    if (route === '/leaderboard' && request.method === 'GET') {
      const result = await env.DB
        .prepare('SELECT handle, vibe_score FROM leaderboard ORDER BY vibe_score DESC, handle ASC LIMIT ?')
        .bind(LEADERBOARD_LIMIT)
        .all();
      const leaders = (result && result.results ? result.results : []).map((row) => ({
        handle: row.handle,
        vibeScore: Number(row.vibe_score) || 0
      }));
      return json({ leaders }, 200, cors, { 'Cache-Control': 'public, max-age=30' });
    }

    if (route === '/session' && request.method === 'GET') {
      const authenticated = await authenticate(request, env);
      const state = await loadState(env, authenticated.user.id);
      return json({ handle: authenticated.user.handle, state: publicState(state) }, 200, cors);
    }

    if (route === '/logout' && request.method === 'POST') {
      const authenticated = await authenticate(request, env);
      await env.SESSIONS.delete(`sess:${authenticated.token}`);
      return json({ ok: true }, 200, cors, { 'Set-Cookie': clearSessionCookie() });
    }

    if (route === '/action' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const authenticated = await authenticate(request, env);
      const state = await loadState(env, authenticated.user.id);
      applyAction(state, body, { cooldownMs: cooldownMs(env) });
      await persistState(env, authenticated.user, state);
      return json({ handle: authenticated.user.handle, state: publicState(state) }, 200, cors);
    }

    if (route === '/save' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const kind = body.kind === 'auto' ? 'auto' : body.kind === 'manual' ? 'manual' : '';
      if (!kind) throw new VaultError('Save kind must be auto or manual.', 400, 'INVALID_SAVE_KIND');
      const authenticated = await authenticate(request, env);
      const state = await loadState(env, authenticated.user.id);
      state.stats[kind === 'auto' ? 'autosaves' : 'manualSaves'] += 1;
      state.stats.lastSavedAt = new Date().toISOString();
      state.revision += 1;
      await persistState(env, authenticated.user, state, false);
      return json({ handle: authenticated.user.handle, state: publicState(state) }, 200, cors);
    }

    if (route === '/studio-preset' && request.method === 'GET') {
      const authenticated = await authenticate(request, env);
      const stored = await loadStudioPreset(env, authenticated.user.id);
      return json({ handle: authenticated.user.handle, preset: stored.preset, updatedAt: stored.updatedAt }, 200, cors);
    }

    if (route === '/studio-preset' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const preset = normalizeStudioPreset(body.preset);
      const authenticated = await authenticate(request, env);
      const timestamp = new Date().toISOString();
      await env.DB
        .prepare('INSERT INTO studio_presets (user_id, preset_json, updated_at) VALUES (?, ?, ?) '
          + 'ON CONFLICT(user_id) DO UPDATE SET preset_json = excluded.preset_json, updated_at = excluded.updated_at')
        .bind(authenticated.user.id, JSON.stringify(preset), timestamp)
        .run();
      return json({ handle: authenticated.user.handle, preset, updatedAt: timestamp }, 200, cors);
    }

    throw new VaultError('Quantum Vault endpoint not found.', 404, 'NOT_FOUND');
  } catch (error) {
    const known = error instanceof VaultError;
    const status = known ? error.status : 500;
    if (!known || status >= 500) {
      console.error(`[quantum-vault] ${known ? error.code : 'INTERNAL_ERROR'}: ${error && error.message}`);
    }
    return json({
      code: known ? error.code : 'INTERNAL_ERROR',
      error: known ? error.message : 'Quantum Vault request failed.'
    }, status, cors);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
