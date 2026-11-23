// POST /api/paystack-webhook — set this URL in Paystack → Settings → API Keys & Webhooks.
// Sends the owner email (shared with /api/verify; idempotent per Paystack reference).
'use strict';
const L = require('./_lib');

function rawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method not allowed'); }
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const body = await rawBody(req);
  if (!secret || !L.verifySignature(body, req.headers['x-paystack-signature'], secret)) {
    res.statusCode = 401; return res.end('Invalid signature');
  }
  let event = {};
  try { event = JSON.parse(body); } catch (e) { res.statusCode = 400; return res.end('Bad JSON'); }

  if (event.event === 'charge.success' && event.data && event.data.reference) {
    try {
      // Never trust the webhook body alone: re-check with Paystack.
      const data = await L.paystackVerify(event.data.reference, secret);
      const check = L.checkPayment(data);
      await L.notifyPaid(data, check, 'webhook');
    } catch (e) {
      // Still 200: Paystack would otherwise retry for days. Paystack's own
      // merchant email + dashboard still show the payment.
      console.error('[hanga] webhook processing failed', e.message);
    }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ received: true }));
};
