const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
// The session secret must come from the environment. There is deliberately no
// fallback: a hardcoded default would let anyone who has read this repository
// forge a login for any employee, including the MD.
const PREVIOUS_INSECURE_FALLBACK = 'change_this_secret_in_env';

function loadJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start without a session signing secret.'
    );
  }
  if (secret === PREVIOUS_INSECURE_FALLBACK) {
    throw new Error(
      'JWT_SECRET is set to a known placeholder value. Set a long random secret.'
    );
  }
  if (secret.length < 32) {
    console.warn(
      '[OPS_AUTH] JWT_SECRET is shorter than 32 characters. Use a longer random value.'
    );
  }
  return secret;
}

const JWT_SECRET = loadJwtSecret();

// Only HS256 is ever issued or accepted, so a token cannot choose its own
// algorithm (for example "none").
const JWT_ALGORITHMS = ['HS256'];

// ---------------------------------------------------------------------------
// Session authentication
// ---------------------------------------------------------------------------
// OPS keeps its existing cookie session (vjc_token). SSO sessions are handed to
// the browser as a Bearer token instead, because the HRMS frontend and the OPS
// API are on different origins and cross-site cookies are not reliable.
function extractToken(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match) return match[1].trim();
  }
  return req.cookies?.vjc_token || null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: JWT_ALGORITHMS });
    // An SSO exchange token (or any other single-purpose token) is never a session.
    if (payload.purpose) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
function userProfiles(user) {
  if (!user) return [];
  if (Array.isArray(user.work_profiles) && user.work_profiles.length) {
    return user.work_profiles;
  }
  return user.work_profile ? [user.work_profile] : [];
}

function hasProfile(user, profile) {
  return userProfiles(user).includes(profile);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const profiles = userProfiles(req.user);
    const hasPermission = roles.some((role) => profiles.includes(role));

    if (!hasPermission) {
      return res.status(403).json({
        error: 'You do not have permission to do this',
      });
    }
    next();
  };
}

// MD (Chairman) and OPS_MANAGER are the two "management" roles that are
// allowed to see every employee's data. Everyone else only sees their own.
function isManagement(workProfile) {
  return workProfile === 'MD' || workProfile === 'OPS_MANAGER';
}

// Same rule, but looks at every work profile the person holds, not just the
// primary one. Used wherever a route must decide "see everything" versus
// "see only your own records". Anyone who is not management is scoped to
// their own records, so a missing or unexpected profile fails closed.
function isManagementUser(user) {
  return userProfiles(user).some(isManagement);
}

// ---------------------------------------------------------------------------
// Server-to-server key (Invoice Portal -> OPS)
// ---------------------------------------------------------------------------
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // Compare fixed-length digests so neither the length nor the content of the
  // expected key leaks through timing.
  const leftDigest = crypto.createHash('sha256').update(left).digest();
  const rightDigest = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

// For server-to-server calls only (e.g. the Invoice Portal pushing a lead
// over). No user is logged in here, so this checks a shared secret instead.
function requireInternalKey(req, res, next) {
  const expected = process.env.OPS_INTERNAL_API_KEY;
  if (!expected) {
    console.error('[OPS_AUTH] OPS_INTERNAL_API_KEY is not configured');
    return res.status(503).json({ error: 'Internal integration is not configured' });
  }
  const key = req.headers['x-internal-key'];
  if (typeof key !== 'string' || !key || !safeEqual(key, expected)) {
    return res.status(401).json({ error: 'Invalid or missing internal key' });
  }
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  isManagement,
  isManagementUser,
  hasProfile,
  userProfiles,
  requireInternalKey,
  safeEqual,
  JWT_SECRET,
  JWT_ALGORITHMS,
};
