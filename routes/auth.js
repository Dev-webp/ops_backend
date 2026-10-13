const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Cookie options. For local dev (Vite proxy) the defaults are fine.
// If the frontend and API are on DIFFERENT domains in production, set
// COOKIE_SAMESITE=none and COOKIE_SECURE=true in the backend .env.
const cookieOptions = {
  httpOnly: true,
  sameSite: process.env.COOKIE_SAMESITE || 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
};

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const result = await pool.query(
`SELECT
   e.id,
   e.name,
   e.email,
   e.password_hash,
   e.role,
   e.work_profile,
   e.designation,
   e.specialty,
   b.branch_name,
   COALESCE(
  ARRAY_AGG(ewp.work_profile)
    FILTER (WHERE ewp.work_profile IS NOT NULL),
  ARRAY[e.work_profile]::VARCHAR[]
) AS work_profiles
 FROM employees e
 LEFT JOIN branches b ON b.id = e.branch_id
 LEFT JOIN employee_work_profiles ewp
   ON ewp.employee_id = e.id
 WHERE e.email = $1
   AND e.is_active = true
 GROUP BY
   e.id,
   e.name,
   e.email,
   e.password_hash,
   e.role,
   e.work_profile,
   e.designation,
   e.specialty,
   b.branch_name`,
  [email.toLowerCase().trim()]
);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

const payload = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  work_profile: user.work_profile,
  work_profiles: user.work_profiles,
  designation: user.designation,
  specialty: user.specialty
};
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

    res.cookie('vjc_token', token, {
      ...cookieOptions,
      maxAge: 12 * 60 * 60 * 1000,
    });

    res.json({ user: { ...payload, branch_name: user.branch_name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('vjc_token', cookieOptions);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});




router.post('/sso', async (req, res) => {
  console.log('[OPS_SSO] Received SSO request');
  const secret = process.env.HRMS_OPS_SSO_SECRET;

  if (!secret) {
    console.error('[OPS_SSO] HRMS_OPS_SSO_SECRET is not configured');
    return res.status(503).json({ error: 'SSO is not configured' });
  }

  const { ssoToken } = req.body || {};
  if (!ssoToken) {
    console.error('[OPS_SSO] No ssoToken in request body');
    return res.status(400).json({ error: 'SSO token is required' });
  }

  console.log('[OPS_SSO] Token received, verifying...');
  let claims;

  try {
    claims = jwt.verify(ssoToken, secret, {
      algorithms: ['HS256'],
      issuer: 'hrms',
      audience: 'ops',
    });
    console.log('[OPS_SSO] Token verified, claims:', { email: claims.email, employee_code: claims.employee_code });
  } catch (err) {
    console.error('[OPS_SSO] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired SSO token' });
  }

  if (
    claims.purpose !== 'ops_sso' ||
    !claims.jti ||
    !claims.email ||
    !claims.employee_code ||
    !claims.hrms_user_id
  ) {
    console.error('[OPS_SSO] Invalid claims:', { purpose: claims.purpose, hasJti: !!claims.jti, hasEmail: !!claims.email, hasEmployeeCode: !!claims.employee_code, hasHrmsUserId: !!claims.hrms_user_id });
    return res.status(401).json({ error: 'Invalid SSO claims' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Atomically consume the credential. A replay cannot insert the same jti.
    const consumed = await client.query(
      `INSERT INTO public.ops_sso_used_tokens (jti, expires_at)
       VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO NOTHING
       RETURNING jti`,
      [claims.jti, claims.exp]
    );

    if (!consumed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'SSO token has already been used' });
    }

    // Match BOTH email and employee ID, and require an active OPS account.
    const result = await client.query(
      `SELECT
         e.id, e.name, e.email, e.role, e.work_profile,
         e.designation, e.specialty, b.branch_name,
         COALESCE(
           ARRAY_AGG(ewp.work_profile)
             FILTER (WHERE ewp.work_profile IS NOT NULL),
           ARRAY[e.work_profile]::VARCHAR[]
         ) AS work_profiles
       FROM public.employees e
       LEFT JOIN public.branches b ON b.id = e.branch_id
       LEFT JOIN public.employee_work_profiles ewp
         ON ewp.employee_id = e.id
       WHERE LOWER(TRIM(e.email)) = $1
         AND TRIM(e.employee_id) = $2
         AND e.is_active = TRUE
       GROUP BY
         e.id, e.name, e.email, e.role, e.work_profile,
         e.designation, e.specialty, b.branch_name
       LIMIT 1`,
      [
        String(claims.email).trim().toLowerCase(),
        String(claims.employee_code).trim(),
      ]
    );

    if (!result.rows.length) {
      // Commit consumption so a failed identity match cannot reuse the token.
      await client.query('COMMIT');
      return res.status(403).json({
        error: 'No active OPS account matches this HRMS identity',
      });
    }

    const user = result.rows[0];

    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      work_profile: user.work_profile,
      work_profiles: user.work_profiles,
      designation: user.designation,
      specialty: user.specialty,
    };

    const opsToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: '12h',
    });

    await client.query('COMMIT');

    res.cookie('vjc_token', opsToken, {
      ...cookieOptions,
      maxAge: 12 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      user: { ...payload, branch_name: user.branch_name },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[OPS_SSO] Rollback failed:', rollbackError.message);
    }

    console.error('[OPS_SSO_ERROR]', err.message);
    return res.status(500).json({ error: 'Unable to create OPS session' });
  } finally {
    client.release();
  }
});

module.exports = router;
