const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const h = require('./helpers');

test.before(h.start);
test.after(h.stop);

function loadAuthWithEnv(env) {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./middleware/auth')"],
    {
      cwd: path.join(__dirname, '..'),
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    }
  );
  return result;
}

test('server refuses to load without JWT_SECRET (no public fallback)', () => {
  const r = loadAuthWithEnv({});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET is not set/);
});

test('server refuses the old public fallback secret', () => {
  const r = loadAuthWithEnv({ JWT_SECRET: 'change_this_secret_in_env' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /known placeholder/);
});

test('a token signed with the old public fallback secret is rejected', async () => {
  const forged = h.jwt.sign(
    { id: 'x', role: 'manager', work_profile: 'MD', work_profiles: ['MD'] },
    'change_this_secret_in_env'
  );
  const res = await h.call('GET', '/api/auth/me', { token: forged });
  assert.equal(res.status, 401);
});

test('no credentials -> 401', async () => {
  const res = await h.call('GET', '/api/dashboard/stats');
  assert.equal(res.status, 401);
});

test('Bearer token is accepted as a session', async () => {
  h.setDb(async () => ({ rows: [], rowCount: 0 }));
  const res = await h.call('GET', '/api/notifications', { token: h.sessionToken() });
  assert.notEqual(res.status, 401);
});

test('existing cookie session is still accepted', async () => {
  h.setDb(async () => ({ rows: [], rowCount: 0 }));
  const res = await h.call('GET', '/api/notifications', { cookie: h.sessionToken() });
  assert.notEqual(res.status, 401);
});

test('unsigned (alg=none) token is rejected', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 'x', work_profile: 'MD', work_profiles: ['MD'] })}.`;
  const res = await h.call('GET', '/api/notifications', { token: none });
  assert.equal(res.status, 401);
});

test('non-HS256 token is rejected', async () => {
  const t = h.jwt.sign({ id: 'x', work_profiles: ['MD'] }, process.env.JWT_SECRET, { algorithm: 'HS512' });
  const res = await h.call('GET', '/api/notifications', { token: t });
  assert.equal(res.status, 401);
});

test('expired session is rejected', async () => {
  const t = h.sessionToken({}, { expiresIn: -10 });
  const res = await h.call('GET', '/api/notifications', { token: t });
  assert.equal(res.status, 401);
});

test('a single-purpose (SSO) token cannot be used as a session, even if signed with the session secret', async () => {
  const t = h.sessionToken({ purpose: 'ops_sso' });
  const res = await h.call('GET', '/api/notifications', { token: t });
  assert.equal(res.status, 401);
});

test('a token signed with the SSO secret is not a session', async () => {
  const t = h.jwt.sign({ id: 'x', work_profiles: ['MD'] }, process.env.OPS_SSO_SECRET, { algorithm: 'HS256' });
  const res = await h.call('GET', '/api/notifications', { token: t });
  assert.equal(res.status, 401);
});
