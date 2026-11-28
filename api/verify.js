// GET /api/verify?reference=... — called by the receipt page after Paystack
// returns. On a fresh successful payment it also emails the owner (same
// idempotent send as the webhook, so the owner gets one email either way).
'use strict';
const L = require('./_lib');

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
  if (L.rateLimited(req, 30, 60 * 1000)) { res.setHeader('Retry-After', '60'); return send(res, 429, { ok: false, error: 'too_many_requests' }); }
  const url = new URL(req.url, 'http://x');
  const keys = [...url.searchParams.keys()];
  if (keys.some(k => k !== 'reference')) return send(res, 400, { ok: false, error: 'bad_request' });
  const reference = (url.searchParams.get('reference') || '').trim();
  // Only Hanga order references (HNG-…, optionally -R<n> for a retry).
  if (!L.PAYSTACK_REF_RE.test(reference)) return send(res, 400, { ok: false, error: 'bad_reference' });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return send(res, 503, { ok: false, error: 'unavailable' });
  try {
    const data = await L.paystackVerify(reference, secret);
    const check = await L.verifyPayment(data, { record: true });
    let notified = false;
    if (data.status === 'success' && L.isFresh(data)) {
      const r = await L.notifyPaid(data, check, 'verify').catch(() => ({}));
      notified = !!(r && r.owner && !r.owner.skipped);
    }
    return send(res, 200, Object.assign({ ok: true, notified }, L.publicView(data, check)));
  } catch (e) {
    console.error('[hanga] verify failed', L.line(e && e.message, 200));
    return send(res, 502, { ok: false, error: 'verify_failed' });
  }
};
