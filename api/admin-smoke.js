// Temporary smoke-test endpoint. DELETE AFTER USE.
// GET /api/admin-smoke?secret=<ADMIN_SECRET>
// Writes a test order to KV, reads it back, patches it, verifies the result.
'use strict';
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.ADMIN_SECRET || '';
  const qs = new URL(req.url, 'http://x').searchParams;
  const provided = (qs.get('secret') || '').trim();

  // Gate: caller must know ADMIN_SECRET
  if (!secret || !provided) return res.end(JSON.stringify({ ok: false, step: 'auth', error: 'missing' }));
  const a = Buffer.from(crypto.createHmac('sha256','gate').update(secret).digest('hex'));
  const b = Buffer.from(crypto.createHmac('sha256','gate').update(provided).digest('hex'));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.end(JSON.stringify({ ok: false, step: 'auth', error: 'wrong_secret' }));

  const KV_URL   = (process.env.KV_REST_API_URL   || '').replace(/\/$/, '');
  const KV_TOKEN = process.env.KV_REST_API_TOKEN   || '';
  const results  = {};

  // ── Step 1: check env vars ──
  results.env = {
    KV_URL:    !!KV_URL,
    KV_TOKEN:  !!KV_TOKEN,
    ADMIN_SECRET: !!secret,
    ADMIN_PIN:    !!(process.env.ADMIN_PIN),
  };
  if (!KV_URL || !KV_TOKEN) {
    results.verdict = 'FAIL — KV not configured';
    return res.end(JSON.stringify({ ok: false, results }));
  }

  const headers = { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' };

  // ── Step 2: KV write ──
  const TEST_REF = 'HNG-SMOKE00-TEST0000000001';
  const testOrder = {
    ref: TEST_REF, paystackRef: 'smoke-paystack-ref',
    placedAt: new Date().toISOString(), paidAt: new Date().toISOString(),
    price: 11000, size: '16×24', style: 'Black', pieces: 1,
    name: 'Smoke Test', phone: '08000000000', email: 'smoke@test.com',
    address: '1 Test St', city: 'Lagos', state: 'Lagos',
    items: [{ imageName: 'smoke-image' }], imageName: 'smoke-image',
    fulfilmentStatus: 'paid', deliveryFee: null, adminNotes: '', deleted: false,
    _savedAt: new Date().toISOString(), amountStatus: 'exact', problems: []
  };

  try {
    const w = await fetch(KV_URL + '/set/' + encodeURIComponent('order:' + TEST_REF), {
      method: 'POST', headers, body: JSON.stringify(testOrder)
    });
    const wj = await w.json().catch(() => ({}));
    results.kvWrite = { status: w.status, result: wj.result };
    if (!w.ok) throw new Error('KV write failed: ' + w.status);
  } catch (e) {
    results.kvWrite = { error: e.message };
    results.verdict = 'FAIL — KV write error';
    return res.end(JSON.stringify({ ok: false, results }));
  }

  // ── Step 3: KV zadd (index) ──
  try {
    const score = Date.now();
    const z = await fetch(KV_URL + '/zadd/' + encodeURIComponent('orders:index'), {
      method: 'POST', headers, body: JSON.stringify([{ score, member: TEST_REF }])
    });
    const zj = await z.json().catch(() => ({}));
    results.kvZadd = { status: z.status, result: zj.result };
  } catch (e) {
    results.kvZadd = { error: e.message };
  }

  // ── Step 4: KV read back ──
  try {
    const r = await fetch(KV_URL + '/get/' + encodeURIComponent('order:' + TEST_REF), { headers });
    const rj = await r.json().catch(() => ({}));
    const readBack = rj.result;
    results.kvRead = {
      status: r.status,
      found: !!readBack,
      refMatch: readBack && readBack.ref === TEST_REF,
      priceMatch: readBack && readBack.price === 11000,
    };
    if (!readBack) throw new Error('KV read returned null');
  } catch (e) {
    results.kvRead = { error: e.message };
    results.verdict = 'FAIL — KV read error';
    return res.end(JSON.stringify({ ok: false, results }));
  }

  // ── Step 5: list via zrange ──
  try {
    const z = await fetch(KV_URL + '/zrange/' + encodeURIComponent('orders:index') + '/+inf/-inf/byscore/rev', { headers });
    const zj = await z.json().catch(() => ({}));
    const refs = Array.isArray(zj.result) ? zj.result : [];
    results.kvZrange = { status: z.status, count: refs.length, includesTestRef: refs.includes(TEST_REF) };
  } catch (e) {
    results.kvZrange = { error: e.message };
  }

  // ── Step 6: test admin-orders GET via self-call ──
  try {
    const tokenExpiry = Date.now() + 60000;
    const tokenSig = crypto.createHmac('sha256', secret).update(tokenExpiry + '|admin').digest('hex');
    const token = tokenExpiry + '.' + tokenSig;
    const host = req.headers.host || 'www.hangaframes.art';
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const apiUrl = protocol + '://' + host + '/api/admin-orders';
    const ar = await fetch(apiUrl, { headers: { Authorization: 'Bearer ' + token } });
    const aj = await ar.json().catch(() => ({}));
    results.adminOrdersAPI = {
      status: ar.status,
      ok: aj.ok,
      hasStats: !!aj.stats,
      orderCount: aj.total,
      testOrderVisible: Array.isArray(aj.orders) && aj.orders.some(o => o.ref === TEST_REF),
    };
  } catch (e) {
    results.adminOrdersAPI = { error: e.message };
  }

  // ── Step 7: cleanup — delete test order ──
  try {
    await fetch(KV_URL + '/del/' + encodeURIComponent('order:' + TEST_REF), { method: 'POST', headers });
    await fetch(KV_URL + '/zrem/' + encodeURIComponent('orders:index'), {
      method: 'POST', headers, body: JSON.stringify([TEST_REF])
    });
    results.cleanup = 'done';
  } catch (e) {
    results.cleanup = 'error: ' + e.message;
  }

  // ── Verdict ──
  const allPassed =
    results.env.KV_URL && results.env.KV_TOKEN && results.env.ADMIN_SECRET && results.env.ADMIN_PIN &&
    results.kvWrite && !results.kvWrite.error &&
    results.kvRead && results.kvRead.found && results.kvRead.refMatch &&
    results.kvZrange && results.kvZrange.includesTestRef &&
    results.adminOrdersAPI && results.adminOrdersAPI.ok && results.adminOrdersAPI.hasStats;

  results.verdict = allPassed ? 'PASS — all checks green' : 'FAIL — see results above';
  return res.end(JSON.stringify({ ok: allPassed, results }, null, 2));
};
