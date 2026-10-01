'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const API_PREFIX = '/api/quantum-vault';
const SESSION_COOKIE = 'quantum_vault_session';
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HARVEST_COOLDOWN_MS = 700;

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

class VaultError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'VaultError';
    this.status = status || 400;
  }
}

function parseVaultKey(value) {
  const input = String(value || '').trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(input)) {
    key = Buffer.from(input, 'hex');
  } else {
    key = Buffer.from(input, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('QUANTUM_VAULT_KEY must contain exactly 32 bytes (64 hex characters or base64).');
  }
  return key;
}

function defaultState(now) {
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

function publicState(state) {
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

function encryptState(state, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64')
  };
}

function decryptState(payload, key) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw new VaultError('Vault data could not be authenticated.', 500);
  }
}

function normalizeHandle(value) {
  const handle = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(handle)) {
    throw new VaultError('Handle must be 3–20 characters using letters, numbers, _ or -.', 400);
  }
  return { display: handle, key: handle.toLowerCase() };
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 128) {
    throw new VaultError('Password must be between 10 and 128 characters.', 400);
  }
  return password;
}

async function hashPassword(password, salt, cost) {
  return scrypt(password, salt, 64, {
    cost: cost || 16384,
    blockSize: 8,
    parallelization: 1,
    maxmem: 64 * 1024 * 1024
  });
}

function parseCookies(header) {
  const cookies = Object.create(null);
  String(header || '').split(';').forEach((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  });
  return cookies;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new VaultError('Request body is too large.', 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('invalid payload');
        }
        resolve(value);
      } catch (error) {
        reject(new VaultError('Request body must be a JSON object.', 400));
      }
    });
    request.on('error', reject);
  });
}

function createQuantumVaultHandler(options) {
  const settings = options || {};
  const key = settings.key
    ? (Buffer.isBuffer(settings.key) ? settings.key : parseVaultKey(settings.key))
    : parseVaultKey(process.env.QUANTUM_VAULT_KEY);
  if (key.length !== 32) throw new Error('Quantum Vault key must be 32 bytes.');

  const dataFile = settings.dataFile || process.env.QUANTUM_VAULT_DATA_FILE
    || path.join(process.cwd(), 'data', 'quantum-vault.json');
  const now = typeof settings.now === 'function' ? settings.now : Date.now;
  const randomBytes = typeof settings.randomBytes === 'function' ? settings.randomBytes : crypto.randomBytes;
  const scryptCost = settings.scryptCost || 16384;
  const secureCookie = settings.secureCookie !== undefined ? settings.secureCookie : true;
  const authRateLimit = settings.authRateLimit || 10;
  const authRateWindowMs = settings.authRateWindowMs || 60 * 1000;
  const maxPasswordJobs = settings.maxPasswordJobs || 4;
  const sessions = new Map();
  const authAttempts = new Map();
  let store = { version: 1, accounts: [] };
  let lock = Promise.resolve();
  let passwordJobs = 0;

  if (fs.existsSync(dataFile)) {
    const loaded = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!loaded || loaded.version !== 1 || !Array.isArray(loaded.accounts)) {
      throw new Error('Quantum Vault data file has an unsupported format.');
    }
    store = loaded;
  }

  function withLock(operation) {
    const pending = lock.then(operation, operation);
    lock = pending.catch(() => null);
    return pending;
  }

  function checkAuthRate(request) {
    const address = request.socket && request.socket.remoteAddress
      ? request.socket.remoteAddress
      : 'unknown';
    const current = now();
    const attempt = authAttempts.get(address);
    if (!attempt || current - attempt.startedAt >= authRateWindowMs) {
      authAttempts.set(address, { count: 1, startedAt: current });
      return;
    }
    attempt.count += 1;
    if (attempt.count > authRateLimit) {
      throw new VaultError('Too many authentication attempts. Try again later.', 429);
    }
  }

  async function passwordDigest(password, salt) {
    if (passwordJobs >= maxPasswordJobs) {
      throw new VaultError('Authentication service is busy. Try again shortly.', 503);
    }
    passwordJobs += 1;
    try {
      return await hashPassword(password, salt, scryptCost);
    } finally {
      passwordJobs -= 1;
    }
  }

  async function persist() {
    await fs.promises.mkdir(path.dirname(dataFile), { recursive: true, mode: 0o700 });
    const temporary = `${dataFile}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(store), { mode: 0o600 });
    await fs.promises.rename(temporary, dataFile);
  }

  function issueSession(accountId) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { accountId, expiresAt: now() + SESSION_TTL_MS });
    return token;
  }

  function sessionCookie(token) {
    const secure = secureCookie ? '; Secure' : '';
    return `${SESSION_COOKIE}=${token}; Path=${API_PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
  }

  function clearSessionCookie() {
    const secure = secureCookie ? '; Secure' : '';
    return `${SESSION_COOKIE}=; Path=${API_PREFIX}; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  function authenticate(request) {
    const token = parseCookies(request.headers && request.headers.cookie)[SESSION_COOKIE];
    const session = token && sessions.get(token);
    if (!session || session.expiresAt <= now()) {
      if (token) sessions.delete(token);
      throw new VaultError('Authentication required.', 401);
    }
    const account = store.accounts.find((entry) => entry.id === session.accountId);
    if (!account) {
      sessions.delete(token);
      throw new VaultError('Authentication required.', 401);
    }
    return { account, token };
  }

  function assertSameOrigin(request) {
    const origin = request.headers && request.headers.origin;
    if (!origin) return;
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch (error) {
      throw new VaultError('Invalid request origin.', 403);
    }
    if (!request.headers.host || originHost !== request.headers.host) {
      throw new VaultError('Cross-origin requests are not allowed.', 403);
    }
  }

  function send(response, status, payload, extraHeaders) {
    const body = payload === null ? '' : JSON.stringify(payload);
    response.writeHead(status, Object.assign({
      'Cache-Control': 'no-store, private',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }, extraHeaders));
    response.end(body);
  }

  function stateFor(account) {
    return decryptState(account.vault, key);
  }

  function saveState(account, state) {
    account.vault = encryptState(state, key);
    account.updatedAt = new Date(now()).toISOString();
  }

  function accountPayload(account) {
    return { handle: account.handle, state: publicState(stateFor(account)) };
  }

  async function register(body) {
    const handle = normalizeHandle(body.handle);
    const password = validatePassword(body.password);
    return withLock(async () => {
      if (store.accounts.some((account) => account.handleKey === handle.key)) {
        throw new VaultError('This handle is already registered.', 409);
      }
      const salt = randomBytes(16);
      const passwordHash = await passwordDigest(password, salt);
      const timestamp = new Date(now()).toISOString();
      const account = {
        id: randomBytes(16).toString('hex'),
        handle: handle.display,
        handleKey: handle.key,
        salt: salt.toString('base64'),
        passwordHash: passwordHash.toString('base64'),
        vault: encryptState(defaultState(now()), key),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      store.accounts.push(account);
      await persist();
      return account;
    });
  }

  async function login(body) {
    const handle = normalizeHandle(body.handle);
    const password = validatePassword(body.password);
    const account = store.accounts.find((entry) => entry.handleKey === handle.key);
    const salt = account ? Buffer.from(account.salt, 'base64') : randomBytes(16);
    const candidate = await passwordDigest(password, salt);
    const expected = account ? Buffer.from(account.passwordHash, 'base64') : randomBytes(64);
    if (!account || expected.length !== candidate.length || !crypto.timingSafeEqual(expected, candidate)) {
      throw new VaultError('Invalid handle or password.', 401);
    }
    return account;
  }

  function applyAction(state, body) {
    const action = String(body.action || '');
    if (action === 'harvest') {
      if (now() - state._lastHarvestAt < HARVEST_COOLDOWN_MS) {
        throw new VaultError('Harvester is recharging.', 429);
      }
      const amount = 1 + state.upgrades.resonator;
      state.fragments += amount;
      state.vibeScore += amount;
      state.stats.harvests += 1;
      state._lastHarvestAt = now();
    } else if (action === 'forge') {
      const cost = Math.max(4, 10 - state.upgrades.forge);
      if (state.fragments < cost) throw new VaultError(`Forging requires ${cost} fragments.`, 409);
      state.fragments -= cost;
      state.alloys += 1 + Math.floor(state.upgrades.forge / 3);
      state.vibeScore += 5;
      state.stats.forges += 1;
    } else if (action === 'upgrade') {
      const id = String(body.upgrade || '');
      const rule = UPGRADE_RULES[id];
      if (!rule) throw new VaultError('Unknown upgrade.', 400);
      const level = state.upgrades[id];
      if (level >= rule.maxLevel) throw new VaultError('Upgrade is already at maximum level.', 409);
      const cost = rule.baseCost * (level + 1);
      if (state[rule.currency] < cost) throw new VaultError(`Upgrade requires ${cost} ${rule.currency}.`, 409);
      state[rule.currency] -= cost;
      state.upgrades[id] += 1;
      state.vibeScore += cost;
      state.stats.upgrades += 1;
    } else if (action === 'tree') {
      const id = String(body.node || '');
      const rule = TREE_RULES[id];
      if (!rule) throw new VaultError('Unknown tree node.', 400);
      if (state.treeNodes.includes(id)) throw new VaultError('Tree node is already unlocked.', 409);
      if (rule.requires && !state.treeNodes.includes(rule.requires)) {
        throw new VaultError('Required tree node is not unlocked.', 409);
      }
      if (state.vibeScore < rule.vibe) throw new VaultError(`Tree node requires ${rule.vibe} Vibe.`, 409);
      if (rule.fragments && state.fragments < rule.fragments) {
        throw new VaultError(`Tree node requires ${rule.fragments} fragments.`, 409);
      }
      if (rule.alloys && state.alloys < rule.alloys) {
        throw new VaultError(`Tree node requires ${rule.alloys} alloys.`, 409);
      }
      state.fragments -= rule.fragments || 0;
      state.alloys -= rule.alloys || 0;
      state.treeNodes.push(id);
      state.stats.nodes += 1;
    } else if (action === 'jukebox') {
      const id = String(body.track || '');
      const threshold = JUKEBOX_RULES[id];
      if (!threshold) throw new VaultError('Unknown jukebox signal.', 400);
      if (state.jukebox.includes(id)) throw new VaultError('Jukebox signal is already decoded.', 409);
      if (state.vibeScore < threshold) throw new VaultError(`Signal requires ${threshold} Vibe.`, 409);
      state.jukebox.push(id);
    } else {
      throw new VaultError('Unknown game action.', 400);
    }
    state.revision += 1;
    state.stats.lastSavedAt = new Date(now()).toISOString();
  }

  async function handle(request, response) {
    try {
      const url = new URL(request.url, 'http://vault.invalid');
      if (!url.pathname.startsWith(API_PREFIX)) return false;

      if (request.method !== 'GET') assertSameOrigin(request);
      const route = url.pathname.slice(API_PREFIX.length) || '/';

      if (route === '/register' && request.method === 'POST') {
        const body = await readJsonBody(request);
        checkAuthRate(request);
        const account = await register(body);
        const token = issueSession(account.id);
        send(response, 201, accountPayload(account), { 'Set-Cookie': sessionCookie(token) });
        return true;
      }
      if (route === '/login' && request.method === 'POST') {
        const body = await readJsonBody(request);
        checkAuthRate(request);
        const account = await login(body);
        const token = issueSession(account.id);
        send(response, 200, accountPayload(account), { 'Set-Cookie': sessionCookie(token) });
        return true;
      }
      if (route === '/leaderboard' && request.method === 'GET') {
        const leaders = store.accounts.map((account) => ({
          handle: account.handle,
          vibeScore: stateFor(account).vibeScore
        })).sort((a, b) => b.vibeScore - a.vibeScore || a.handle.localeCompare(b.handle)).slice(0, 25);
        send(response, 200, { leaders }, { 'Cache-Control': 'public, max-age=30' });
        return true;
      }

      const authenticated = authenticate(request);
      if (route === '/session' && request.method === 'GET') {
        send(response, 200, accountPayload(authenticated.account));
        return true;
      }
      if (route === '/logout' && request.method === 'POST') {
        sessions.delete(authenticated.token);
        send(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
        return true;
      }
      if (route === '/action' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const state = await withLock(async () => {
          const current = stateFor(authenticated.account);
          applyAction(current, body);
          saveState(authenticated.account, current);
          await persist();
          return current;
        });
        send(response, 200, { handle: authenticated.account.handle, state: publicState(state) });
        return true;
      }
      if (route === '/save' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const kind = body.kind === 'auto' ? 'auto' : body.kind === 'manual' ? 'manual' : '';
        if (!kind) throw new VaultError('Save kind must be auto or manual.', 400);
        const state = await withLock(async () => {
          const current = stateFor(authenticated.account);
          current.stats[kind === 'auto' ? 'autosaves' : 'manualSaves'] += 1;
          current.stats.lastSavedAt = new Date(now()).toISOString();
          current.revision += 1;
          saveState(authenticated.account, current);
          await persist();
          return current;
        });
        send(response, 200, { handle: authenticated.account.handle, state: publicState(state) });
        return true;
      }
      throw new VaultError('Quantum Vault endpoint not found.', 404);
    } catch (error) {
      const status = error instanceof VaultError ? error.status : 500;
      const message = error instanceof VaultError ? error.message : 'Quantum Vault request failed.';
      send(response, status, { error: message });
      return true;
    }
  }

  handle.close = () => sessions.clear();
  return handle;
}

function createQuantumVaultServer(options) {
  const settings = options || {};
  const root = path.resolve(settings.root || path.join(__dirname, '..'));
  const vault = createQuantumVaultHandler(settings);
  const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  };

  return http.createServer(async (request, response) => {
    if (await vault(request, response)) return;
    try {
      if (!['GET', 'HEAD'].includes(request.method)) throw new VaultError('Method not allowed.', 405);
      const url = new URL(request.url, 'http://vault.invalid');
      const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = path.resolve(root, `.${requested}`);
      if (!filePath.startsWith(`${root}${path.sep}`)) throw new VaultError('Not found.', 404);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new VaultError('Not found.', 404);
      const headers = {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'X-Content-Type-Options': 'nosniff'
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      const status = error instanceof VaultError ? error.status : 404;
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(status === 404 ? 'Not found.' : error.message);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const server = createQuantumVaultServer({ secureCookie: process.env.NODE_ENV === 'production' });
  server.listen(port, () => {
    console.log(`Quantum Vault listening on http://localhost:${port}`);
  });
}

module.exports = {
  API_PREFIX,
  VaultError,
  createQuantumVaultHandler,
  createQuantumVaultServer,
  decryptState,
  encryptState,
  parseVaultKey,
  publicState
};
