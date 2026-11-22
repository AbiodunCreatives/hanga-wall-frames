// Shared helpers for the Paystack functions. Files starting with "_" are not
// exposed as routes by Vercel.
'use strict';
const crypto = require('crypto');

// Keep in sync with customize.html (data-price) and js/site.js (setDiscounts).
const PRICES = { '12×16': 8000, '16×20': 9500, '16×24': 11000, '20×24': 14000, '20×30': 17500, '24×36': 20000 };
const SET_DISCOUNTS = { 2: 200, 3: 500 };
const SET_LABELS = { 1: 'Single', 2: 'Pair', 3: 'Trio' };

const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Price the order from our own table — never trust a total sent by the browser.
function expectedTotal(order) {
  const size = String((order && order.size) || '').replace(/["x]/g, m => (m === 'x' ? '×' : ''));
  const unit = PRICES[size];
  const n = Math.min(3, Math.max(1, parseInt(order && order.pieces, 10) || ((order && order.items) || []).length || 1));
  if (!unit) return null;
  return { unit, n, subtotal: unit * n, discount: n > 1 ? (SET_DISCOUNTS[n] || 0) : 0, total: unit * n - (n > 1 ? (SET_DISCOUNTS[n] || 0) : 0) };
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(hash), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function paystackVerify(reference, secret) {
  const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + secret }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error((j && j.message) || ('Paystack verify HTTP ' + r.status));
  return j.data;
}

function readMetaOrder(data) {
  let meta = data && data.metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch (e) { meta = {}; } }
  meta = meta || {};
  let order = meta.order;
  if (typeof order === 'string') { try { order = JSON.parse(order); } catch (e) { order = null; } }
  return order || {};
}

// Check a verified Paystack transaction against our own price table.
function checkPayment(data) {
  const order = readMetaOrder(data);
  const exp = expectedTotal(order);
  const paid = Number(data.amount || 0) / 100;
  const problems = [];
  if (data.status !== 'success') problems.push('Paystack status is "' + data.status + '"');
  if (data.currency && data.currency !== 'NGN') problems.push('Currency is ' + data.currency);
  if (!exp) problems.push('Could not price this order (unknown size "' + (order.size || '') + '")');
  else if (paid !== exp.total) problems.push('Paid ' + naira(paid) + ' but price list says ' + naira(exp.total));
  if (order.total != null && Number(order.total) !== paid) problems.push('Paid ' + naira(paid) + ' but receipt total was ' + naira(order.total));
  return { order, expected: exp, paid, ok: problems.length === 0, problems };
}

// Sanitised view for the browser receipt (no Paystack internals).
function publicView(data, check) {
  const o = check.order || {};
  return {
    reference: data.reference,
    orderRef: o.ref || data.reference,
    status: data.status,
    paid: data.status === 'success',
    amountOk: check.ok,
    amount: check.paid,
    currency: data.currency,
    paidAt: data.paid_at || data.paidAt || null,
    channel: data.channel || null,
    order: {
      ref: o.ref, size: o.size, style: o.style, pieces: o.pieces, setName: o.setName,
      unitPrice: o.unitPrice, discount: o.discount, subtotal: o.subtotal, total: o.total,
      items: Array.isArray(o.items) ? o.items.map(i => ({ imageName: i.name || i.imageName, isUpload: !!i.isUpload, fileKind: i.fileKind || null })) : [],
      name: o.customer && o.customer.name, email: o.customer && o.customer.email,
      phone: o.customer && o.customer.phone, address: o.customer && o.customer.address,
      city: o.customer && o.customer.city, state: o.customer && o.customer.state, notes: o.customer && o.customer.notes,
      placedAt: o.placedAt
    }
  };
}

// Full owner receipt, HTML + plain text.
function receiptEmail(data, check) {
  const o = check.order || {}, c = o.customer || {}, exp = check.expected;
  const n = Number(o.pieces) || (o.items || []).length || 1;
  const items = (o.items || []).map((it, i) => ({
    name: (it.name || it.imageName || 'Frame') + (it.isUpload ? (it.fileKind === 'pdf' ? ' (customer PDF' + (it.fileName ? ': ' + it.fileName : '') + ')' : ' (customer photo' + (it.fileName ? ': ' + it.fileName : '') + ')') : ''),
    piece: n > 1 ? 'Frame ' + (i + 1) + ' of ' + n : '',
    size: o.size, style: o.style, set: (SET_LABELS[n] || 'Single') + (o.setName && n > 1 ? ' · ' + o.setName : ''),
    qty: 1, unit: it.unit || o.unitPrice, total: it.lineTotal || it.unit || o.unitPrice
  }));
  const ref = o.ref || data.reference;
  const subject = (check.ok ? '' : '⚠ CHECK AMOUNT — ') + 'New paid order ' + ref + ' — ' + naira(check.paid);
  const warn = check.ok ? '' : 'CHECK BEFORE SHIPPING: ' + check.problems.join('; ');
  const when = data.paid_at ? new Date(data.paid_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) + ' (WAT)' : '';
  const custRows = [['Name', c.name], ['Email', c.email], ['Phone', c.phone], ['Delivery address', c.address], ['City / State', [c.city, c.state].filter(Boolean).join(', ')], ['Notes', c.notes]].filter(r => r[1]);
  const uploads = (o.items || []).some(i => i.isUpload);

  const text = [
    'NEW PAID ORDER — ' + ref, warn, '',
    'Order reference: ' + ref,
    'Paystack reference: ' + data.reference,
    'Paid: ' + naira(check.paid) + (when ? ' on ' + when : '') + (data.channel ? ' via ' + data.channel : ''),
    '', 'ITEMS',
    ...items.map(i => '- ' + i.name + (i.piece ? ' [' + i.piece + ']' : '') + ' | ' + i.size + '" | ' + i.style + ' | ' + i.set + ' | qty ' + i.qty + ' | ' + naira(i.unit) + ' | ' + naira(i.total)),
    '',
    'Subtotal: ' + naira(o.subtotal != null ? o.subtotal : exp && exp.subtotal),
    (o.discount ? (SET_LABELS[n] + ' set discount: -' + naira(o.discount)) : ''),
    'Delivery: to be confirmed with the customer',
    'TOTAL PAID: ' + naira(check.paid),
    '', 'CUSTOMER', ...custRows.map(r => r[0] + ': ' + r[1]),
    uploads ? '\nThis order includes the customer\'s own file(s). Ask them to send the original file(s) on WhatsApp or email.' : '',
    '\nNext: confirm the delivery fee with the customer, then start framing.'
  ].filter(l => l !== '').join('\n');

  const td = 'padding:8px 6px;border-bottom:1px solid #eee;vertical-align:top;font-size:13px';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<div style="max-width:640px;margin:0 auto;padding:24px">
<div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:24px">
<div style="text-align:center;border-bottom:1px dashed #ccc;padding-bottom:14px">
<div style="font:700 26px Georgia,serif;letter-spacing:2px">HANGA<span style="color:#c9a96e">.</span></div>
<div style="font-size:12px;color:#777">Ado Ekiti, Ekiti State</div></div>
${warn ? `<p style="background:#fdecea;color:#8a1f11;padding:10px 12px;border-radius:4px;font-weight:bold">${esc(warn)}</p>` : `<p style="background:#e8f5e9;color:#1b5e20;padding:10px 12px;border-radius:4px;font-weight:bold">PAID — verified with Paystack</p>`}
<table style="width:100%;font-size:13px;margin:10px 0">
<tr><td style="color:#777">Order reference</td><td style="text-align:right;font:700 18px monospace">${esc(ref)}</td></tr>
<tr><td style="color:#777">Paystack reference</td><td style="text-align:right;font-family:monospace">${esc(data.reference)}</td></tr>
${when ? `<tr><td style="color:#777">Paid at</td><td style="text-align:right">${esc(when)}</td></tr>` : ''}
${data.channel ? `<tr><td style="color:#777">Channel</td><td style="text-align:right">${esc(data.channel)}</td></tr>` : ''}
</table>
<table style="width:100%;border-collapse:collapse;margin-top:8px">
<tr style="background:#faf7f2;text-align:left"><th style="${td}">Item</th><th style="${td}">Size</th><th style="${td}">Style</th><th style="${td}">Set</th><th style="${td};text-align:right">Qty</th><th style="${td};text-align:right">Unit</th><th style="${td};text-align:right">Total</th></tr>
${items.map(i => `<tr><td style="${td}">${esc(i.name)}${i.piece ? `<br><span style="color:#888;font-size:11px">${esc(i.piece)}</span>` : ''}</td><td style="${td}">${esc(i.size)}"</td><td style="${td}">${esc(i.style)}</td><td style="${td}">${esc(i.set)}</td><td style="${td};text-align:right">${i.qty}</td><td style="${td};text-align:right">${naira(i.unit)}</td><td style="${td};text-align:right">${naira(i.total)}</td></tr>`).join('')}
</table>
<table style="width:100%;font-size:14px;margin-top:10px">
<tr><td>Subtotal</td><td style="text-align:right">${naira(o.subtotal != null ? o.subtotal : exp && exp.subtotal)}</td></tr>
${o.discount ? `<tr><td>${esc(SET_LABELS[n])} set discount</td><td style="text-align:right">−${naira(o.discount)}</td></tr>` : ''}
<tr><td>Delivery</td><td style="text-align:right">To be confirmed</td></tr>
<tr><td style="font-weight:bold;font-size:17px;border-top:2px solid #1a1a1a;padding-top:8px">TOTAL PAID</td><td style="text-align:right;font-weight:bold;font-size:17px;border-top:2px solid #1a1a1a;padding-top:8px">${naira(check.paid)}</td></tr>
</table>
<h3 style="font-size:13px;letter-spacing:1px;color:#777;margin:20px 0 6px">CUSTOMER</h3>
<table style="width:100%;font-size:13px">${custRows.map(r => `<tr><td style="color:#777;width:140px;vertical-align:top">${esc(r[0])}</td><td>${esc(r[1]).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>
${uploads ? '<p style="font-size:13px;background:#fff6e0;padding:10px;border-radius:4px">This order includes the customer\'s own file(s). Ask them to send the original file(s) on WhatsApp or email.</p>' : ''}
<p style="font-size:13px;color:#555;border-top:1px dashed #ccc;padding-top:12px">Next: confirm the delivery fee with the customer, then start framing.</p>
</div></div></body></html>`;
  return { subject, text, html, ref };
}

async function sendResend({ to, subject, html, text, replyTo, idempotencyKey }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: 'RESEND_API_KEY not set' };
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey; // Resend drops duplicates for 24h
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers,
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'Hanga Orders <onboarding@resend.dev>', to: [to], subject, html, text, reply_to: replyTo || undefined })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + JSON.stringify(j));
  return j;
}

module.exports = { PRICES, SET_DISCOUNTS, naira, expectedTotal, verifySignature, paystackVerify, checkPayment, publicView, receiptEmail, sendResend, readMetaOrder };
