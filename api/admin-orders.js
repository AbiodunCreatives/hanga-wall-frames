// /api/admin-orders — order management API for the Hanga admin dashboard.
//
// GET  /api/admin-orders              — list all orders (paginated, filterable)
// GET  /api/admin-orders?ref=HNG-...  — single order
// PATCH /api/admin-orders             — update status / delivery fee / notes
//
// All requests require: Authorization: Bearer <token>
// Token is issued by /api/admin-auth and is a HMAC-SHA256 signed expiry string.
//
// Storage: Vercel KV (Redis). Keys:
//   order:<ref>          — JSON order record
//   orders:index         — Redis sorted set, score = placedAt epoch ms
//
// Vercel KV is accessed via the @vercel/kv package, automatically available
// when a KV store is linked in the Vercel dashboard (adds KV_REST_API_URL +
// KV_REST_API_TOKEN env vars automatically).
'use strict';

const crypto = require('crypto');
const L = require('./_lib');

// ── Auth helper ────────────────────────────────────────────────────────────────
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expiry = parseInt(token.slice(0, dot), 10);
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const payload = expiry + '|admin';
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

function authCheck(req, secret) {
  const auth = (req.headers['authorization'] || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  return verifyToken(auth.slice(7), secret);
}

// ── KV helpers ─────────────────────────────────────────────────────────────────
// Upstash REST API: https://upstash.com/docs/redis/features/restapi
// Commands go as URL path segments: /COMMAND/arg1/arg2/...
// For JSON values, POST the raw JSON as the request body to /set/key
// All commands can also be sent via /pipeline as a 2D JSON array.

function kvBase() {
  const url   = (process.env.KV_REST_API_URL   || '').replace(/\/$/, '');
  const token = process.env.KV_REST_API_TOKEN  || '';
  if (!url || !token) throw new Error('KV not configured');
  return { url, token };
}

// Execute a batch of commands in one round-trip via the pipeline endpoint.
// commands = [["SET","key","val"], ["ZADD","idx","1234","member"], ...]
async function kvPipeline(commands) {
  const { url, token } = kvBase();
  const r = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  const results = await r.json().catch(() => []);
  if (!r.ok) throw new Error('KV pipeline HTTP ' + r.status);
  return Array.isArray(results) ? results : [];
}

// GET a JSON value. Upstash returns { result: <raw> }; we parse if it came back as a string.
async function kvGet(key) {
  const { url, token } = kvBase();
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('KV GET error ' + r.status);
  const raw = j.result;
  if (raw === null || raw === undefined) return null;
  // If stored via pipeline SET the value may come back as a JSON string — parse it.
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }
  return raw;
}

// SET a JSON value. POST the JSON as the body to /set/key
async function kvSet(key, value) {
  const { url, token } = kvBase();
  const r = await fetch(url + '/set/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('KV SET error ' + r.status);
  return j;
}

// ZADD key score member — score and member as URL path segments
async function kvZadd(key, score, member) {
  const { url, token } = kvBase();
  const r = await fetch(
    url + '/zadd/' + encodeURIComponent(key) + '/' + score + '/' + encodeURIComponent(member),
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('KV ZADD error ' + r.status);
  return j;
}

// ZRANGE key max min BYSCORE REV — newest first
async function kvZrange(key, start, stop) {
  const { url, token } = kvBase();
  // Upstash path: /zrange/key/max/min/byscore/rev  (max then min for reverse)
  const r = await fetch(
    url + '/zrange/' + encodeURIComponent(key) + '/' + start + '/' + stop + '/byscore/rev',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const j = await r.json().catch(() => ({ result: [] }));
  return Array.isArray(j.result) ? j.result : [];
}

// ── Write an order to KV (called from _lib.js notifyPaid) ─────────────────────
async function writeOrder(orderData) {
  const ref = orderData.ref;
  if (!ref || !L.REF_RE.test(ref)) return;
  // Don't overwrite existing record — idempotent
  const existing = await kvGet('order:' + ref).catch(() => null);
  if (existing) return;
  const record = Object.assign({}, orderData, {
    _savedAt: new Date().toISOString(),
    fulfilmentStatus: 'paid',   // paid | processing | shipped | delivered | cancelled
    deliveryFee: null,
    adminNotes: '',
    deleted: false
  });
  await kvSet('order:' + ref, record);
  const score = orderData.placedAt ? Date.parse(orderData.placedAt) : Date.now();
  await kvZadd('orders:index', score, ref);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

const VALID_STATUSES = ['paid', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAGE_SIZE = 50;

// ── Main handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return send(res, 503, { ok: false, error: 'admin_not_configured' });
  if (!authCheck(req, secret)) return send(res, 401, { ok: false, error: 'unauthorized' });
  if (L.rateLimited(req, 120, 60 * 1000)) { res.setHeader('Retry-After', '60'); return send(res, 429, { ok: false, error: 'too_many_requests' }); }

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url    = new URL(req.url, 'http://x');
    const ref    = (url.searchParams.get('ref') || '').trim();
    const status = (url.searchParams.get('status') || '').trim();
    const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const search = (url.searchParams.get('q') || '').trim().toLowerCase();

    // Single order lookup
    if (ref) {
      if (!L.REF_RE.test(ref)) return send(res, 400, { ok: false, error: 'bad_reference' });
      const order = await kvGet('order:' + ref).catch(() => null);
      if (!order || order.deleted) return send(res, 404, { ok: false, error: 'not_found' });
      return send(res, 200, { ok: true, order });
    }

    // List orders (newest first)
    try {
      const allRefs = await kvZrange('orders:index', '+inf', '-inf');
      const emptyStats = { total:0, paid:0, processing:0, shipped:0, delivered:0, cancelled:0, revenue:0 };
      if (!allRefs.length) return send(res, 200, { ok: true, orders: [], total: 0, page, pages: 0, stats: emptyStats });

      // Fetch all in parallel (KV reads are fast)
      const records = await Promise.all(allRefs.map(r => kvGet('order:' + r).catch(() => null)));
      let orders = records
        .filter(o => o && !o.deleted)
        .filter(o => !status || o.fulfilmentStatus === status)
        .filter(o => {
          if (!search) return true;
          const haystack = [o.ref, o.name, o.phone, o.email, o.address,
            o.imageName, (o.items || []).map(i => i.imageName).join(' ')
          ].join(' ').toLowerCase();
          return haystack.includes(search);
        });

      const total = orders.length;
      const pages = Math.ceil(total / PAGE_SIZE) || 1;
      const sliced = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      // Summary stats for the dashboard header
      const stats = {
        total: records.filter(o => o && !o.deleted).length,
        paid:        records.filter(o => o && !o.deleted && o.fulfilmentStatus === 'paid').length,
        processing:  records.filter(o => o && !o.deleted && o.fulfilmentStatus === 'processing').length,
        shipped:     records.filter(o => o && !o.deleted && o.fulfilmentStatus === 'shipped').length,
        delivered:   records.filter(o => o && !o.deleted && o.fulfilmentStatus === 'delivered').length,
        cancelled:   records.filter(o => o && !o.deleted && o.fulfilmentStatus === 'cancelled').length,
        revenue:     records.filter(o => o && !o.deleted && ['paid','processing','shipped','delivered'].includes(o.fulfilmentStatus))
                            .reduce((s, o) => s + (Number(o.price) || 0), 0)
      };

      return send(res, 200, { ok: true, orders: sliced, total, page, pages, stats });
    } catch (e) {
      console.error('[hanga] admin-orders GET failed', e && e.message);
      return send(res, 500, { ok: false, error: 'storage_error' });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body = {};
    try {
      const raw = typeof req.body === 'string' ? req.body
        : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {}));
      body = JSON.parse(raw);
    } catch (e) { return send(res, 400, { ok: false, error: 'bad_request' }); }

    const ref = L.line(body.ref || '', 50);
    if (!ref || !L.REF_RE.test(ref)) return send(res, 400, { ok: false, error: 'bad_reference' });

    const order = await kvGet('order:' + ref).catch(() => null);
    if (!order || order.deleted) return send(res, 404, { ok: false, error: 'not_found' });

    const updates = {};
    if (body.fulfilmentStatus !== undefined) {
      if (!VALID_STATUSES.includes(body.fulfilmentStatus)) return send(res, 400, { ok: false, error: 'bad_status' });
      updates.fulfilmentStatus = body.fulfilmentStatus;
    }
    if (body.deliveryFee !== undefined) {
      const fee = body.deliveryFee === null ? null : Number(body.deliveryFee);
      if (fee !== null && (!Number.isFinite(fee) || fee < 0 || fee > 50000)) return send(res, 400, { ok: false, error: 'bad_fee' });
      updates.deliveryFee = fee;
    }
    if (body.adminNotes !== undefined) {
      updates.adminNotes = L.block(body.adminNotes, 1000);
    }
    if (body.deleted === true) {
      updates.deleted = true;
    }

    const updated = Object.assign({}, order, updates, { _updatedAt: new Date().toISOString() });
    await kvSet('order:' + ref, updated);
    return send(res, 200, { ok: true, order: updated });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return send(res, 405, { ok: false, error: 'method_not_allowed' });
};

// Keep writeOrder accessible after module.exports is set to the handler function.
module.exports.writeOrder = writeOrder;
