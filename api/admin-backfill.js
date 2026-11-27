// ONE-SHOT backfill endpoint — DELETE AFTER USE.
// GET /api/admin-backfill?secret=<ADMIN_SECRET>&dry=1   (dry run — no writes)
// GET /api/admin-backfill?secret=<ADMIN_SECRET>         (live run — writes to KV)
//
// Pulls every transaction from Paystack, extracts order metadata,
// writes each one to KV (skipping duplicates), and reports a summary.
'use strict';
const crypto = require('crypto');
const L = require('./_lib');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // ── Gate: caller must supply ADMIN_SECRET ───────────────────────
  const secret   = process.env.ADMIN_SECRET || '';
  const qs       = new URL(req.url, 'http://x').searchParams;
  const provided = (qs.get('secret') || '').trim();
  const dry      = qs.get('dry') === '1';

  if (L.rateLimited(req, 5, 60 * 1000)) { res.statusCode = 429; res.setHeader('Retry-After', '60'); return end(res, { ok: false, error: 'too_many_requests' }); }
  if (!secret || !provided) { res.statusCode = 401; return end(res, { ok: false, error: 'missing_secret' }); }
  const a = Buffer.from(crypto.createHmac('sha256','gate').update(secret).digest('hex'));
  const b = Buffer.from(crypto.createHmac('sha256','gate').update(provided).digest('hex'));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    { res.statusCode = 401; return end(res, { ok: false, error: 'wrong_secret' }); }

  const PS_KEY = process.env.PAYSTACK_SECRET_KEY || '';
  const KV_URL = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
  const KV_TOK = process.env.KV_REST_API_TOKEN || '';

  if (!PS_KEY) return end(res, { ok: false, error: 'PAYSTACK_SECRET_KEY not set' });
  if (!KV_URL || !KV_TOK) return end(res, { ok: false, error: 'KV not configured' });

  const kvHeaders = { Authorization: 'Bearer ' + KV_TOK, 'Content-Type': 'application/json' };

  // ── Pull all transactions from Paystack (paginated) ─────────────
  let allTx = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const r = await fetch(
      'https://api.paystack.co/transaction?perPage=' + perPage + '&page=' + page,
      { headers: { Authorization: 'Bearer ' + PS_KEY } }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.status) {
      return end(res, { ok: false, error: 'Paystack error: ' + (j.message || r.status) });
    }
    const batch = j.data || [];
    allTx = allTx.concat(batch);
    if (batch.length < perPage) break; // last page
    page++;
    if (page > 50) break; // safety cap at 5000 transactions
  }

  // ── Process each transaction ────────────────────────────────────
  const summary = { total: allTx.length, written: 0, skipped: 0, failed: 0, errors: [] };
  const written = [];

  for (const tx of allTx) {
    try {
      const check = L.checkPayment(tx);
      const o     = check.order || {};
      const c     = o.customer || {};
      const mail  = L.receiptEmail(tx, check);
      const ref   = mail.ref;

      if (!ref || !L.REF_RE.test(ref)) { summary.skipped++; continue; }

      // Check if already in KV
      if (!dry) {
        const existing = await kvGet(KV_URL, KV_TOK, kvHeaders, 'order:' + ref);
        if (existing) { summary.skipped++; continue; }
      }

      const record = {
        ref,
        paystackRef:   tx.reference,
        placedAt:      o.placedAt || tx.paid_at || tx.created_at || new Date().toISOString(),
        paidAt:        tx.paid_at || tx.created_at || new Date().toISOString(),
        channel:       tx.channel || null,
        price:         check.paid,
        expectedTotal: check.expected ? check.expected.total : null,
        unitPrice:     o.unitPrice,
        subtotal:      o.subtotal,
        discount:      o.discount,
        size:          o.size,
        style:         o.style,
        pieces:        o.pieces,
        set:           o.set,
        setName:       o.setName || null,
        items:         Array.isArray(o.items) ? o.items : [],
        imageName:     Array.isArray(o.items) && o.items[0] ? o.items[0].name : (o.imageName || ''),
        name:          c.name    || '',
        phone:         c.phone   || '',
        email:         c.email   || '',
        address:       c.address || '',
        city:          c.city    || '',
        state:         c.state   || '',
        notes:         c.notes   || '',
        amountStatus:  check.ok ? 'exact' : 'mismatch',
        problems:      check.ok ? [] : (check.problems || []),
        utm:           o.utm || null,
        campaign:      L.utmSummary(o.utm) || null,
        // Fulfilment status — default to 'paid' for successful transactions,
        // 'cancelled' for failed/abandoned ones
        fulfilmentStatus: tx.status === 'success' ? 'paid' : 'cancelled',
        deliveryFee:   null,
        adminNotes:    '',
        deleted:       false,
        _savedAt:      new Date().toISOString(),
        _backfilled:   true
      };

      if (!dry) {
        const score = Date.parse(record.placedAt) || Date.now();
        // Write order record
        await kvSet(KV_URL, KV_TOK, kvHeaders, 'order:' + ref, record);
        // Add to sorted index
        await kvZadd(KV_URL, KV_TOK, kvHeaders, 'orders:index', score, ref);
      }

      summary.written++;
      written.push({ ref, status: record.fulfilmentStatus, amount: record.price, channel: record.channel });
    } catch (e) {
      summary.failed++;
      summary.errors.push(e.message);
    }
  }

  summary.dry = dry;
  summary.verdict = dry
    ? 'DRY RUN — ' + summary.written + ' orders would be written, ' + summary.skipped + ' skipped'
    : 'DONE — ' + summary.written + ' written, ' + summary.skipped + ' skipped, ' + summary.failed + ' failed';

  return end(res, { ok: true, summary, written });
};

// ── KV helpers ───────────────────────────────────────────────────
async function kvGet(url, tok, headers, key) {
  const r = await fetch(url + '/get/' + encodeURIComponent(key), { headers });
  const j = await r.json().catch(() => ({}));
  let v = j.result;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch(e) {} }
  return v;
}
async function kvSet(url, tok, headers, key, value) {
  await fetch(url + '/set/' + encodeURIComponent(key), {
    method: 'POST', headers, body: JSON.stringify(value)
  });
}
async function kvZadd(url, tok, headers, key, score, member) {
  await fetch(url + '/zadd/' + encodeURIComponent(key) + '/' + score + '/' + encodeURIComponent(member), { headers });
}

function end(res, obj) {
  res.end(JSON.stringify(obj, null, 2));
}
