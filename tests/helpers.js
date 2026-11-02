// Shared test harness. No new dependencies: node:test, global fetch, and a fake
// database pool injected through require.cache so no real database is touched.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-session-secret-0123456789abcdef0123456789';
process.env.OPS_SSO_SECRET = process.env.OPS_SSO_SECRET || 'test-ops-sso-secret-abcdef0123456789abcdef0123';
process.env.OPS_INTERNAL_API_KEY = process.env.OPS_INTERNAL_API_KEY || 'test-internal-key-0123456789';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
// Make sure a developer's real database settings can never be used by a test.
delete process.env.DATABASE_URL;

const path = require('path');
const jwt = require('jsonwebtoken');

let handler = async () => ({ rows: [], rowCount: 0 });
const queries = [];

const fakeClient = {
  query: (sql, params) => run(sql, params),
  release() {},
};
const fakePool = {
  query: (sql, params) => run(sql, params),
  connect: async () => fakeClient,
  end: async () => {},
};

async function run(sql, params) {
  queries.push({ sql: String(sql), params });
  return handler(String(sql), params);
}

const poolPath = require.resolve(path.join(__dirname, '..', 'db', 'pool.js'));
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: fakePool,
};

const app = require('../server');

let server;
let baseUrl;

async function start() {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
}

function setDb(fn) {
  handler = fn;
  queries.length = 0;
}

function sessionToken(overrides = {}, options = {}) {
  const payload = {
    id: 'user-1',
    name: 'Test User',
    email: 'user@example.com',
    role: 'employee',
    work_profile: 'COUNSELOR',
    work_profiles: ['COUNSELOR'],
    ...overrides,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', ...options });
}

async function call(method, url, { token, cookie, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = `vjc_token=${cookie}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

const url = () => baseUrl;

module.exports = { start, stop, setDb, queries, sessionToken, call, url, jwt };
