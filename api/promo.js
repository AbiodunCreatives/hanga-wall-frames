// GET /api/promo[?phone=0803…] — tells checkout whether the automatic DETTY26
// discount is running right now (server clock, Africa/Lagos window) and, when
// a phone is given, whether that number has already used it. Advisory only:
// /api/verify and the webhook re-check every claim before trusting a payment.
'use strict';
const L = require('./_lib');
const P = require('./_promo');

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'method_not_allowed' }); }
  if (L.rateLimited(req, 40, 60 * 1000)) { res.setHeader('Retry-After', '60'); return send(res, 429, { ok: false, error: 'too_many_requests' }); }
  const url = new URL(req.url, 'http://x');
  if ([...url.searchParams.keys()].some(k => k !== 'phone')) return send(res, 400, { ok: false, error: 'bad_request' });
  const raw = url.searchParams.get('phone');
  const phone = raw ? P.normPhone(raw) : '';
  if (raw && !phone) return send(res, 400, { ok: false, error: 'bad_phone' });
  const active = P.inWindow(P.nowMs());
  const used = active && phone ? !!(await P.usedBy(phone)) : false;
  return send(res, 200, { ok: true, name: P.PROMO.name, label: P.PROMO.label, amount: P.PROMO.amount, minSubtotal: P.PROMO.minSubtotal, active, used });
};
