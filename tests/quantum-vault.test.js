'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createQuantumVaultServer } = require('../server/quantum-vault.js');

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

async function main() {
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

    const weak = await request(running.origin, '/register', {
      method: 'POST',
      json: { handle: 'pilot', password: 'short' }
    });
    assert.equal(weak.response.status, 400);

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

    const loggedOut = await request(running.origin, '/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
      json: {}
    });
    assert.equal(loggedOut.response.status, 200);
    const expired = await request(running.origin, '/session', { headers: { Cookie: cookie } });
    assert.equal(expired.response.status, 401);

    const wrongPassword = await request(running.origin, '/login', {
      method: 'POST',
      json: { handle: 'Pilot_One', password: 'incorrect-password' }
    });
    assert.equal(wrongPassword.response.status, 401);

    await running.close();
    running = await startServer(options);
    const login = await request(running.origin, '/login', {
      method: 'POST',
      json: { handle: 'pilot_one', password: 'correct-horse-vault' }
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.payload.state.vibeScore, 40, 'encrypted vault state must survive server restarts');
    assert.equal(login.payload.state.upgrades.resonator, 1);

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
