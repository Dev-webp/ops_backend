const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_env';

function requireAuth(req, res, next) {
  const token = req.cookies?.vjc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
const userWorkProfiles =
  Array.isArray(req.user.work_profiles) &&
  req.user.work_profiles.length
    ? req.user.work_profiles
    : [req.user.work_profile];

const hasPermission = roles.some(role =>
  userWorkProfiles.includes(role)
);

if (!hasPermission) {
  return res.status(403).json({
    error: 'You do not have permission to do this'
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

// For server-to-server calls only (e.g. the Invoice Portal pushing a lead
// over). No user is logged in here — this checks a shared secret instead.
function requireInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.OPS_INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing internal key' });
  }
  next();
}

module.exports = { requireAuth, requireRole, isManagement, requireInternalKey, JWT_SECRET };
