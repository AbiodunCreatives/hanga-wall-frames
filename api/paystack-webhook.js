// POST /api/paystack-webhook — set this URL in Paystack → Settings → API Keys & Webhooks.
// The ONLY place the owner email is sent from, so each paid order produces one email.
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
      const mail = L.receiptEmail(data, check);
      const owner = process.env.OWNER_EMAIL || 'hello@hanga.ng';
      const cust = (check.order.customer || {}).email;
      const r = await L.sendResend({ to: owner, subject: mail.subject, html: mail.html, text: mail.text, replyTo: cust, idempotencyKey: 'owner-' + data.reference });
      console.log('[hanga] paid order', mail.ref, data.reference, check.ok ? 'OK' : check.problems.join('; '), 'email:', JSON.stringify(r));
      if (cust && process.env.SEND_CUSTOMER_COPY === 'true' && data.status === 'success') {
        await L.sendResend({ to: cust, subject: 'Your Hanga receipt ' + mail.ref, html: mail.html, text: mail.text, replyTo: owner, idempotencyKey: 'cust-' + data.reference })
          .catch(e => console.error('[hanga] customer copy failed', e.message));
      }
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
