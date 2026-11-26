// POST /api/admin-auth — verify admin PIN, return a short-lived signed token.
// The token is HMAC-SHA256(expiry|"admin", ADMIN_SECRET) so it can be verified
// server-side with no database and no JWT library.
'use strict';
const crypto = require('crypto');
const L = require('./_lib');

const TOKEN_TTL = 4 * 60 * 60 * 1000; // 4 hours in ms

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

// Make a signed token: "<expiry>.<hmac>"
function makeToken(secret) {
  const expiry = Date.now() + TOKEN_TTL;
  const payload = expiry + '|admin';
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return expiry + '.' + sig;
}

// Verify a token. Returns expiry ms on success, null on failure.
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const expiry = parseInt(token.slice(0, dot), 10);
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const payload = expiry + '|admin';
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try { if (!crypto.timingSafeEqual(a, b)) return null; } catch (e) { return null; }
  return expiry;
}

// Export verifyToken so other API routes can use it.
module.exports.verifyToken = verifyToken;

module.exports.handler = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
  if (L.rateLimited(req, 10, 60 * 1000)) { res.setHeader('Retry-After', '60'); return send(res, 429, { ok: false, error: 'too_many_requests' }); }

  const secret = process.env.ADMIN_SECRET;
  const pin    = process.env.ADMIN_PIN;
  if (!secret || !pin) return send(res, 503, { ok: false, error: 'admin_not_configured' });

  let body = {};
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    body = JSON.parse(raw);
  } catch (e) { return send(res, 400, { ok: false, error: 'bad_request' }); }

  const submitted = String(body.pin || '').trim();
  if (!submitted) return send(res, 400, { ok: false, error: 'pin_required' });

  // Constant-time PIN compare
  const expectedHash = crypto.createHmac('sha256', secret).update(pin).digest('hex');
  const submittedHash = crypto.createHmac('sha256', secret).update(submitted).digest('hex');
  const a = Buffer.from(expectedHash), b = Buffer.from(submittedHash);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) return send(res, 401, { ok: false, error: 'wrong_pin' });

  return send(res, 200, { ok: true, token: makeToken(secret), ttl: TOKEN_TTL });
};

// Also expose as default for Vercel routing
module.exports.default = module.exports.handler;
module.exports = module.exports.handler;
module.exports.verifyToken = verifyToken;
module.exports.makeToken = makeToken;
