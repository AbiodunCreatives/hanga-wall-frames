// GET /api/config — exposes ONLY the Paystack PUBLIC key (safe for browsers)
// so it can live in Vercel env vars instead of the code.
'use strict';
module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('{"error":"method_not_allowed"}'); }
  res.setHeader('Cache-Control', 'public, max-age=300');
  const pk = process.env.PAYSTACK_PUBLIC_KEY || '';
  res.end(JSON.stringify({ paystackPublicKey: /^pk_(live|test)_[A-Za-z0-9]+$/.test(pk) ? pk : '' }));
};
