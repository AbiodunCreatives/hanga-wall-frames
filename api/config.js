// GET /api/config — exposes ONLY the Paystack PUBLIC key (safe for browsers)
// so it can live in Vercel env vars instead of the code.
'use strict';
module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  const pk = process.env.PAYSTACK_PUBLIC_KEY || '';
  res.end(JSON.stringify({ paystackPublicKey: /^pk_(live|test)_/.test(pk) ? pk : '' }));
};
