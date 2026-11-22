// GET /api/verify?reference=... — called by the receipt page after Paystack
// returns. Read-only: it never sends email (the webhook does that, once).
'use strict';
const L = require('./_lib');

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const reference = (url.searchParams.get('reference') || '').trim();
  if (!/^[A-Za-z0-9._=-]{6,100}$/.test(reference)) return send(res, 400, { ok: false, error: 'missing_or_bad_reference' });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return send(res, 503, { ok: false, error: 'payments_not_configured' });
  try {
    const data = await L.paystackVerify(reference, secret);
    const check = L.checkPayment(data);
    return send(res, 200, Object.assign({ ok: true }, L.publicView(data, check)));
  } catch (e) {
    return send(res, 502, { ok: false, error: 'verify_failed', message: String(e.message || e).slice(0, 200) });
  }
};
