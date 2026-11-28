// POST /api/paystack-webhook — set this URL in Paystack → Settings → API Keys & Webhooks.
// Sends the owner email (shared with /api/verify; idempotent per Paystack reference).
'use strict';
const L = require('./_lib');

const MAX_BODY = 256 * 1024; // Paystack events are a few KB

// Exact bytes Paystack signed. Vercel exposes them as the request stream; a
// pre-buffered string/Buffer body is used if the platform already read it.
function rawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
    const chunks = []; let size = 0, done = false;
    const finish = v => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => finish(null), 8000);
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { finish(null); try { req.destroy(); } catch (e) {} } else chunks.push(c); });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end('Method not allowed'); }
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const body = await rawBody(req);
  if (body == null) { res.statusCode = 413; return res.end('Bad request'); }
  // HMAC-SHA512 of the raw body with the secret key, timing-safe compare.
  if (!secret || !L.verifySignature(body, req.headers['x-paystack-signature'], secret)) {
    res.statusCode = 401; return res.end('Invalid signature');
  }
  let event = {};
  try { event = JSON.parse(body); } catch (e) { res.statusCode = 400; return res.end('Bad request'); }

  const ref = event && event.data && typeof event.data.reference === 'string' ? event.data.reference : '';
  // Only our own order references; anything else is acknowledged and ignored.
  if (event.event === 'charge.success' && L.PAYSTACK_REF_RE.test(ref)) {
    try {
      // Never trust the webhook body alone: re-check with Paystack.
      const data = await L.paystackVerify(ref, secret);
      const check = await L.verifyPayment(data, { record: true });
      // Replay guard: old events don't re-send (Resend also dedupes per ref for 24h).
      if (L.isFresh(data)) await L.notifyPaid(data, check, 'webhook');
    } catch (e) {
      // Still 200: Paystack would otherwise retry for days. Paystack's own
      // merchant email + dashboard still show the payment.
      console.error('[hanga] webhook processing failed', L.line(e && e.message, 200));
    }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ received: true }));
};
