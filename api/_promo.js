// DETTY26 — automatic Detty December discount. The SERVER decides eligibility
// and the amount; the browser only asks (/api/promo) and claims it in the
// Paystack metadata, and verify/webhook re-check every claim here.
//   ₦1,000 off, once per order, when the frame subtotal (after the Pair ₦500
//   saving, before delivery) is at least ₦13,000, from 1 Dec 2026 00:00 to
//   31 Dec 2026 23:59 Africa/Lagos (UTC+1, no DST). One use per phone number,
//   recorded in KV only after a verified payment. Delivery fees never change.
'use strict';

const PROMO = Object.freeze({
  name: 'DETTY26',
  amount: 1000,
  minSubtotal: 13000,
  startMs: Date.parse('2026-12-01T00:00:00+01:00'), // inclusive
  endMs: Date.parse('2027-01-01T00:00:00+01:00'),   // exclusive (31 Dec 23:59:59.999 Lagos is the last valid instant)
  label: 'DETTY26 – ₦1,000 off'
});

// QA only: PROMO_TEST_NOW=<ISO date> moves the promo clock on preview/dev
// deployments. Ignored in production (VERCEL_ENV=production).
function nowMs() {
  const t = process.env.PROMO_TEST_NOW;
  if (t && process.env.VERCEL_ENV !== 'production') { const v = Date.parse(t); if (Number.isFinite(v)) return v; }
  return Date.now();
}
const testClock = () => !!(process.env.PROMO_TEST_NOW && process.env.VERCEL_ENV !== 'production' && Number.isFinite(Date.parse(process.env.PROMO_TEST_NOW)));
const inWindow = ms => Number.isFinite(ms) && ms >= PROMO.startMs && ms < PROMO.endMs;

// Nigerian mobile → canonical 234XXXXXXXXXX ('' if not a valid NG mobile).
// Accepts 0803…, 803…, +234 803…, 234803…, with spaces / dashes / brackets.
function normPhone(p) {
  let d = String(p == null ? '' : p).replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d+$/.test(d)) return '';
  if (d.startsWith('234')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  if (d.startsWith('0')) d = d.slice(1); // "+234 0803…"
  return /^[789][01]\d{8}$/.test(d) ? '234' + d : '';
}
const phoneKey = phone => 'promo:' + PROMO.name + ':phone:' + phone;

// When did this payment happen? Paystack's own timestamps (server-trusted).
// The order qualifies if the transaction was created OR paid inside the window,
// so a customer who opened Paystack at 23:58 on 31 Dec is not punished.
function txTimes(data) {
  if (testClock()) return [nowMs()];
  return [data && (data.created_at || data.createdAt), data && (data.paid_at || data.paidAt)].map(t => Date.parse(t || '')).filter(Number.isFinite);
}

// Pure rule check. subtotal = frames after Pair saving, before delivery.
// usedBy = order ref already holding this phone's use (or null).
function evaluate({ subtotal, times, phone, usedBy, ref }) {
  if (!(times || []).some(inWindow)) return { ok: false, reason: 'inactive' };
  if (!(Number(subtotal) >= PROMO.minSubtotal)) return { ok: false, reason: 'under_min' };
  const ph = normPhone(phone);
  if (!ph) return { ok: false, reason: 'bad_phone' };
  if (usedBy && usedBy !== ref) return { ok: false, reason: 'used', usedBy };
  return { ok: true, name: PROMO.name, amount: PROMO.amount, phone: ph };
}
const REASONS = {
  inactive: 'DETTY26 is only valid 1–31 December 2026 (Lagos time)',
  under_min: 'DETTY26 needs a frame subtotal of at least ₦13,000',
  bad_phone: 'DETTY26 needs a valid Nigerian phone number',
  used: 'DETTY26 was already used by this phone number'
};

// ── KV (Upstash REST). Best effort: if KV is down, reads return null. ──
async function kv(commands) {
  const url = (process.env.KV_REST_API_URL || '').replace(/\/$/, ''), token = process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  const o = { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) o.signal = AbortSignal.timeout(5000);
  const r = await fetch(url + '/pipeline', o);
  if (!r.ok) throw new Error('KV HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : null;
}
const asRef = v => { if (v == null) return null; try { const p = JSON.parse(v); return typeof p === 'string' ? p : (p && p.ref) || String(v); } catch (e) { return String(v); } };
async function usedBy(phone) {
  const ph = normPhone(phone);
  if (!ph) return null;
  try { const out = await kv([['GET', phoneKey(ph)]]); return out && out[0] ? asRef(out[0].result) : null; }
  catch (e) { console.warn('[hanga] promo KV read skipped:', e && e.message); return null; }
}
// Record the use AFTER a verified payment. Returns the ref that owns the use
// (this ref if we won; another ref if a different order got there first).
async function recordUse(phone, ref, meta) {
  const ph = normPhone(phone);
  if (!ph || !ref) return null;
  try {
    const val = JSON.stringify(Object.assign({ ref, at: new Date().toISOString() }, meta || {}));
    const out = await kv([['SET', phoneKey(ph), val, 'NX'], ['GET', phoneKey(ph)]]);
    if (!out) return ref; // KV not configured: nothing to enforce against
    return asRef(out[1] && out[1].result) || ref;
  } catch (e) { console.warn('[hanga] promo KV write skipped:', e && e.message); return ref; }
}

module.exports = { PROMO, REASONS, nowMs, inWindow, normPhone, phoneKey, txTimes, evaluate, usedBy, recordUse };
