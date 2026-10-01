'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createQuantumVaultServer, parseVaultKey } = require('../server/quantum-vault.js');

function testStartupDiagnostics() {
  assert.throws(() => parseVaultKey(''), (error) => error.code === 'VAULT_KEY_MISSING');
  assert.throws(() => parseVaultKey('not-a-valid-key!'), (error) => error.code === 'VAULT_KEY_INVALID');
  assert.throws(() => parseVaultKey('abcd'), (error) => error.code === 'VAULT_KEY_INVALID');
  assert.equal(parseVaultKey('07'.repeat(32)).length, 32);
  assert.equal(parseVaultKey(Buffer.alloc(32, 1).toString('base64')).length, 32);

  const serverScript = path.join(__dirname, '..', 'server', 'quantum-vault.js');
  const env = Object.assign({}, process.env, { PORT: '0' });
  delete env.QUANTUM_VAULT_KEY;
  const missing = spawnSync(process.execPath, [serverScript], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(missing.status, 1, 'server must exit when QUANTUM_VAULT_KEY is missing');
  assert.match(missing.stderr, /QUANTUM_VAULT_KEY ist nicht gesetzt/);
  assert.match(missing.stderr, /randomBytes\(32\)/, 'startup error should explain how to generate a key');
  assert.doesNotMatch(missing.stderr, /\n\s+at /, 'startup diagnostics should not dump stack traces');

  const invalid = spawnSync(process.execPath, [serverScript], {
    env: Object.assign({}, env, { QUANTUM_VAULT_KEY: 'too-short' }),
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(invalid.status, 1, 'server must exit when QUANTUM_VAULT_KEY is invalid');
  assert.match(invalid.stderr, /QUANTUM_VAULT_KEY ist ungültig/);
  assert.doesNotMatch(invalid.stderr, /too-short/, 'invalid key values must never be logged');
}

async function startServer(options) {
  const server = createQuantumVaultServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function request(origin, route, options) {
  const settings = Object.assign({ headers: {} }, options || {});
  if (settings.json) {
    settings.body = JSON.stringify(settings.json);
    settings.headers['Content-Type'] = 'application/json';
    delete settings.json;
  }

  const response = await fetch(`${origin}/api/quantum-vault${route}`, settings);
  const payload = await response.json();
  return { response, payload };
}

function startDelayedAction(origin, cookie) {
  const target = new URL('/api/quantum-vault/action', origin);
  let requestHandle;
  const result = new Promise((resolve, reject) => {
    requestHandle = http.request(target, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        payload: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    requestHandle.on('error', reject);
    requestHandle.write('{"action":"har');
  });
  return {
    finish() {
      requestHandle.end('vest"}');
      return result;
    }
  };
}

async function main() {
  testStartupDiagnostics();
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quantum-vault-test-'));
  const dataFile = path.join(tempRoot, 'vault.json');
  const key = Buffer.alloc(32, 7);
  let clock = Date.parse('2026-10-01T00:00:00.000Z');
  const options = {
    root: path.join(__dirname, '..'),
    dataFile,
    key,
    now: () => clock,
    scryptCost: 1024,
    secureCookie: false
  };
  let running = await startServer(options);

  try {
    const page = await fetch(`${running.origin}/game.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SINGULARITY ARCADE/);

    const oversized = await fetch(`${running.origin}/api/quantum-vault/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'large', password: 'x'.repeat(17000) })
    });
    assert.equal(oversized.status, 413);
    const oversizedPayload = await oversized.json();
    assert.match(oversizedPayload.error, /too large/i);
    assert.equal(oversizedPayload.code, 'BODY_TOO_LARGE');

    const health = await request(running.origin, '/health');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.payload, { ok: true, service: 'quantum-vault', status: 'ready' });
    assert.match(health.response.headers.get('cache-control'), /no-store/);

    const unknownRoute = await request(running.origin, '/does-not-exist');
    assert.equal(unknownRoute.response.status, 404);
    assert.equal(unknownRoute.payload.code, 'NOT_FOUND');

    const badHandle = await request(running.origin, '/register', {
      method: 'POST',
      json: { handle: 'no spaces!', password: 'correct-horse-vault' }
    });
    assert.equal(badHandle.response.status, 400);
    assert.equal(badHandle.payload.code, 'HANDLE_INVALID');

    const badJson = await fetch(`${running.origin}/api/quantum-vault/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).code, 'INVALID_JSON');

    const weak = await request(running.origin, '/register', {
      method: 'POST',
      json: { handle: 'pilot', password: 'short' }
    });
    assert.equal(weak.response.status, 400);
    assert.equal(weak.payload.code, 'PASSWORD_INVALID');
    assert.ok(weak.payload.error, 'error responses keep a human-readable message');

    const registered = await request(running.origin, '/register', {
      method: 'POST',
      json: { handle: 'Pilot_One', password: 'correct-horse-vault' }
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.payload.handle, 'Pilot_One');
    assert.equal(registered.payload.state.vibeScore, 0);
    assert.equal(registered.payload.id, undefined, 'account IDs must never be exposed');
    assert.match(registered.response.headers.get('cache-control'), /no-store/);
    assert.match(registered.response.headers.get('cache-control'), /private/);
    const cookie = registered.response.headers.get('set-cookie').split(';')[0];
    assert.ok(cookie.startsWith('quantum_vault_session='));
    assert.match(registered.response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(registered.response.headers.get('set-cookie'), /SameSite=Strict/);

    const diskData = await fs.promises.readFile(dataFile, 'utf8');
    assert.doesNotMatch(diskData, /correct-horse-vault/);
    assert.doesNotMatch(diskData, /"vibeScore"/, 'vault state should be encrypted at rest');
    assert.match(diskData, /"passwordHash":/);
    const exposedVault = await fetch(`${running.origin}/data/vault.json`);
    assert.equal(exposedVault.status, 404, 'persistent vault files must never be served');
    const exposedGit = await fetch(`${running.origin}/.git/config`);
    assert.equal(exposedGit.status, 404, 'repository internals must never be served');

    const duplicate = await request(running.origin, '/register', {
      method: 'POST',
      json: { handle: 'pilot_one', password: 'another-strong-password' }
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.payload.code, 'HANDLE_TAKEN');
    assert.match(duplicate.response.headers.get('cache-control'), /no-store/);

    const session = await request(running.origin, '/session', { headers: { Cookie: cookie } });
    assert.equal(session.response.status, 200);
    assert.equal(session.payload.handle, 'Pilot_One');

    const manipulated = await request(running.origin, '/action', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: {
        action: 'harvest',
        userId: 'another-account',
        vibeScore: 999999999,
        fragments: 999999999,
        state: { vibeScore: 999999999 }
      }
    });
    assert.equal(manipulated.response.status, 200);
    assert.equal(manipulated.payload.state.vibeScore, 1);
    assert.equal(manipulated.payload.state.fragments, 1);

    const rateLimited = await request(running.origin, '/action', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: { action: 'harvest' }
    });
    assert.equal(rateLimited.response.status, 429);
    assert.equal(rateLimited.payload.code, 'ACTION_COOLDOWN');

    for (let count = 1; count < 20; count += 1) {
      clock += 701;
      const harvested = await request(running.origin, '/action', {
        method: 'POST',
        headers: { Cookie: cookie },
        json: { action: 'harvest' }
      });
      assert.equal(harvested.response.status, 200);
    }

    const upgraded = await request(running.origin, '/action', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: { action: 'upgrade', upgrade: 'resonator', level: 99, cost: 0 }
    });
    assert.equal(upgraded.response.status, 200);
    assert.equal(upgraded.payload.state.upgrades.resonator, 1);
    assert.equal(upgraded.payload.state.fragments, 0);
    assert.equal(upgraded.payload.state.vibeScore, 40);

    const invalidAction = await request(running.origin, '/action', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: { action: 'set-score', vibeScore: Number.MAX_SAFE_INTEGER }
    });
    assert.equal(invalidAction.response.status, 400);

    const saved = await request(running.origin, '/save', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: { kind: 'manual', state: { vibeScore: 999999999 } }
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.state.vibeScore, 40);
    assert.equal(saved.payload.state.stats.manualSaves, 1);

    const second = await request(running.origin, '/register', {
      method: 'POST',
      json: { handle: 'SecondPilot', password: 'second-correct-password' }
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.payload.state.vibeScore, 0, 'vault state must be account-bound');

    const leaderboard = await request(running.origin, '/leaderboard');
    assert.equal(leaderboard.response.status, 200);
    assert.deepEqual(leaderboard.payload.leaders.map((entry) => entry.handle), ['Pilot_One', 'SecondPilot']);
    assert.deepEqual(leaderboard.payload.leaders.map((entry) => entry.vibeScore), [40, 0]);
    assert.match(leaderboard.response.headers.get('cache-control'), /public/);

    const crossOrigin = await request(running.origin, '/save', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://attacker.example' },
      json: { kind: 'manual' }
    });
    assert.equal(crossOrigin.response.status, 403);
    assert.equal(crossOrigin.payload.code, 'CROSS_ORIGIN');

    const delayedAction = startDelayedAction(running.origin, cookie);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const loggedOut = await request(running.origin, '/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: {}
    });
    assert.equal(loggedOut.response.status, 200);
    const revokedAction = await delayedAction.finish();
    assert.equal(revokedAction.status, 401, 'pending requests must re-check authorization after logout');
    const expired = await request(running.origin, '/session', { headers: { Cookie: cookie } });
    assert.equal(expired.response.status, 401);
    assert.equal(expired.payload.code, 'SESSION_REQUIRED');

    const wrongPassword = await request(running.origin, '/login', {
      method: 'POST',
      json: { handle: 'Pilot_One', password: 'incorrect-password' }
    });
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(wrongPassword.payload.code, 'INVALID_CREDENTIALS');

    await running.close();
    running = await startServer(options);
    const login = await request(running.origin, '/login', {
      method: 'POST',
      json: { handle: 'pilot_one', password: 'correct-horse-vault' }
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.payload.state.vibeScore, 40, 'encrypted vault state must survive server restarts');
    assert.equal(login.payload.state.upgrades.resonator, 1);

    await running.close();
    running = await startServer(Object.assign({}, options, {
      dataFile: path.join(tempRoot, 'rate-limit.json'),
      authRateLimit: 2
    }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const invalid = await request(running.origin, '/login', {
        method: 'POST',
        json: { handle: 'UnknownPilot', password: 'incorrect-password' }
      });
      assert.equal(invalid.response.status, 401);
    }
    const throttled = await request(running.origin, '/login', {
      method: 'POST',
      json: { handle: 'UnknownPilot', password: 'incorrect-password' }
    });
    assert.equal(throttled.response.status, 429);
    assert.equal(throttled.payload.code, 'RATE_LIMITED');
    assert.equal(throttled.response.headers.get('retry-after'), '60');

    console.log('quantum vault tests passed');
  } finally {
    await running.close().catch(() => null);
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
