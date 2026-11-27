// Shared helpers for the Paystack functions. Files starting with "_" are not
// exposed as routes by Vercel.
'use strict';
const crypto = require('crypto');

// Keep in sync with customize.html (data-price) and js/site.js (setDiscounts).
const PRICES = { '12×16': 7000, '16×20': 9000, '16×24': 11000, '20×24': 13000, '20×30': 16000, '24×36': 20000 };
// Hanga sells Singles and Pairs only. A Pair is ₦500 off the per-frame total.
const SET_DISCOUNTS = { 2: 500 };
const MAX_PIECES = 2;
const SET_LABELS = { 1: 'Single', 2: 'Pair' };
const setLabelOf = n => SET_LABELS[n] || (n > 1 ? n + ' frames' : 'Single');

// Flat delivery fee by region. Keep in sync with js/site.js (DELIVERY_REGIONS).
const DELIVERY_REGIONS = [
  { key: 'south-west', label: 'South-West', fee: 2500, states: ['Lagos', 'Ogun', 'Oyo', 'Osun', 'Ondo', 'Ekiti'] },
  { key: 'east', label: 'East & South', fee: 4500, states: ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo', 'Akwa Ibom', 'Bayelsa', 'Cross River', 'Delta', 'Edo', 'Rivers'] },
  { key: 'north', label: 'North', fee: 6000, states: ['FCT', 'Benue', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Plateau', 'Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Sokoto', 'Zamfara'] }
];
const normState = s => { let v = String(s || '').trim().toLowerCase().replace(/\s*\(abuja\)$/, '').replace(/\s+state$/, ''); if (v === 'abuja' || v === 'federal capital territory') v = 'fct'; return v; };
function deliveryFor(state) {
  const v = normState(state);
  if (!v) return null;
  for (const r of DELIVERY_REGIONS) if (r.states.some(s => s.toLowerCase() === v)) return { region: r.key, label: r.label, fee: r.fee };
  return null;
}
const MAX_LINES = 10, MAX_QTY = 10;
const CLOUDINARY_RE = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_\/.,:-]{1,300}$/;
const normSize = s => String(s || '').replace(/["x]/g, m => (m === 'x' ? '×' : ''));

const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- Input hygiene -------------------------------------------------------
// One line of text: no control chars / CR / LF (stops header + subject injection).
const line = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
// Multi-line text (address / notes): keep \n, drop other control chars.
const block = (s, max) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 500);
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null; };
const REF_RE = /^HNG-[A-Z0-9]{4,12}-[A-Z0-9]{3,16}$/;          // our order references
const STRONG_REF_RE = /^HNG-[A-Z0-9]{4,12}-[A-Z0-9]{10,16}$/;   // crypto-random refs (Nov 2026+)
const PAYSTACK_REF_RE = /^HNG-[A-Z0-9]{4,12}-[A-Z0-9]{3,16}(-R\d{1,3})?$/;
const EMAIL_RE = /^[^\s@<>",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

// Price the order from our own table — never trust a total sent by the browser.
function expectedTotal(order) {
  // v2 (cart) orders: price every line, then add the delivery fee for the state.
  if (order && Array.isArray(order.lines)) {
    let gross = 0, discount = 0, frames = 0;
    for (const l of order.lines) {
      const unit = PRICES[normSize(l.size)];
      const n = l.items.length, q = l.qty;
      if (!unit || n < 1 || n > MAX_PIECES || !(q >= 1 && q <= MAX_QTY)) return null;
      gross += unit * n * q; discount += (n > 1 ? (SET_DISCOUNTS[n] || 0) : 0) * q; frames += n * q;
    }
    const d = deliveryFor((order.customer || {}).state);
    if (!order.lines.length || !d) return null;
    const subtotal = gross - discount;
    return { v: 2, n: frames, gross, discount, subtotal, delivery: d.fee, region: d.label, total: subtotal + d.fee };
  }
  const size = String((order && order.size) || '').replace(/["x]/g, m => (m === 'x' ? '×' : ''));
  const unit = PRICES[size];
  // The number of frames actually listed wins over a "pieces" claim, so a
  // multi-frame order can't be priced as one. More than MAX_PIECES is never
  // discounted and checkPayment flags it for review.
  const itemsN = (order && order.itemCount) || ((order && order.items) || []).length;
  const n = Math.min(10, Math.max(1, itemsN || parseInt(order && order.pieces, 10) || 1));
  if (!unit) return null;
  return { unit, n, subtotal: unit * n, discount: n > 1 ? (SET_DISCOUNTS[n] || 0) : 0, total: unit * n - (n > 1 ? (SET_DISCOUNTS[n] || 0) : 0) };
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(hash), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// fetch with a hard timeout so a slow upstream (Paystack, Resend, KV) can't
// hang the function until the platform kills it.
function fetchT(url, opts, ms) {
  const o = Object.assign({}, opts || {});
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) o.signal = AbortSignal.timeout(ms || 8000);
  return fetch(url, o);
}

async function paystackVerify(reference, secret) {
  const r = await fetchT('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { Authorization: 'Bearer ' + secret }
  }, 8000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error((j && j.message) || ('Paystack verify HTTP ' + r.status));
  return j.data;
}

// Metadata is browser-supplied: whitelist fields, coerce types, cap lengths.
function readMetaOrder(data) {
  let meta = data && data.metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch (e) { meta = {}; } }
  meta = (meta && typeof meta === 'object') ? meta : {};
  let o = meta.order;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
  if (!o || typeof o !== 'object') return {};
  const c = (o.customer && typeof o.customer === 'object') ? o.customer : {};
  const items = Array.isArray(o.items) ? o.items : [];
  const email = line(c.email, 254);
  const customer = {
    name: line(c.name, 80), email: EMAIL_RE.test(email) ? email : '',
    phone: line(c.phone, 20), address: block(c.address, 300),
    city: line(c.city, 60), state: line(c.state, 60), notes: block(c.notes, 500)
  };
  if (Number(o.v) === 2 && Array.isArray(o.lines)) {
    const lineCount = o.lines.length;
    const lines = o.lines.slice(0, MAX_LINES).map(l => {
      l = (l && typeof l === 'object') ? l : {};
      const its = Array.isArray(l.items) ? l.items : [];
      const q = parseInt(l.qty, 10);
      return {
        size: line(l.size, 12), style: line(l.style, 40),
        qty: q >= 1 && q <= MAX_QTY ? q : 0, unit: num(l.unit),
        setName: l.setName ? line(l.setName, 60) : null,
        itemCount: its.length,
        items: its.slice(0, MAX_PIECES).map(i => (i && typeof i === 'object' ? {
          name: line(i.name || i.imageName, 80) || 'Frame', imageId: line(i.imageId, 60) || null,
          isUpload: !!i.isUpload, fileKind: i.fileKind === 'pdf' ? 'pdf' : (i.isUpload ? 'image' : null),
          fileName: i.fileName ? line(i.fileName, 80) : null,
          fileUrl: (i.isUpload && CLOUDINARY_RE.test(String(i.fileUrl || ''))) ? String(i.fileUrl) : null
        } : { name: 'Frame' }))
      };
    });
    const flat = [];
    lines.forEach(l => l.items.forEach(i => flat.push(Object.assign({}, i, { size: l.size, style: l.style, qty: l.qty }))));
    return {
      v: 2, ref: line(o.ref, 40), placedAt: line(o.placedAt, 40) || null,
      lines, lineCount,
      subtotal: num(o.subtotal), discount: num(o.discount), deliveryFee: num(o.deliveryFee), total: num(o.total),
      // Legacy-shaped summary fields for older admin views.
      size: lines[0] ? lines[0].size : '', style: lines[0] ? lines[0].style : '',
      pieces: lines.reduce((a, l) => a + l.items.length * (l.qty || 1), 0),
      items: flat, itemCount: flat.length,
      customer
    };
  }
  return {
    ref: line(o.ref, 40),
    placedAt: line(o.placedAt, 40) || null,
    size: line(o.size, 12), style: line(o.style, 40),
    pieces: parseInt(o.pieces, 10) || null,
    set: line(o.set, 20), setName: o.setName ? line(o.setName, 60) : null,
    unitPrice: num(o.unitPrice), subtotal: num(o.subtotal), discount: num(o.discount), total: num(o.total),
    itemCount: items.length,
    items: items.slice(0, MAX_PIECES).map(i => (i && typeof i === 'object' ? {
      name: line(i.name || i.imageName, 80), imageId: line(i.imageId, 60) || null,
      isUpload: !!i.isUpload, fileKind: i.fileKind === 'pdf' ? 'pdf' : (i.isUpload ? 'image' : null),
      fileName: i.fileName ? line(i.fileName, 80) : null,
      unit: num(i.unit), lineTotal: num(i.lineTotal)
    } : { name: 'Frame' })),
    customer
  };
}

// Check a verified Paystack transaction against our own price table.
function checkPayment(data) {
  const order = readMetaOrder(data);
  const exp = expectedTotal(order);
  const paid = Number(data.amount || 0) / 100;
  const problems = [];
  if (data.status !== 'success') problems.push('Paystack status is "' + data.status + '"');
  if (data.currency && data.currency !== 'NGN') problems.push('Currency is ' + data.currency);
  if (order.v === 2) {
    if (order.lineCount > MAX_LINES) problems.push('Order lists ' + order.lineCount + ' cart lines (max ' + MAX_LINES + ')');
    order.lines.forEach((l, i) => {
      if (l.itemCount > MAX_PIECES || l.itemCount < 1) problems.push('Line ' + (i + 1) + ' lists ' + l.itemCount + ' frames (Single or Pair only)');
      if (!l.qty) problems.push('Line ' + (i + 1) + ' has an invalid quantity');
      if (!PRICES[normSize(l.size)]) problems.push('Line ' + (i + 1) + ' has an unknown size "' + l.size + '"');
    });
    if (!deliveryFor(order.customer.state)) problems.push('Unknown delivery state "' + (order.customer.state || '') + '"');
    if (!exp) problems.push('Could not price this order');
    else {
      if (paid !== exp.total) problems.push('Paid ' + naira(paid) + ' but price list + delivery says ' + naira(exp.total));
      if (order.deliveryFee != null && order.deliveryFee !== exp.delivery) problems.push('Delivery fee sent (' + naira(order.deliveryFee) + ') does not match ' + naira(exp.delivery) + ' for ' + order.customer.state);
    }
  } else {
    if (!exp) problems.push('Could not price this order (unknown size "' + (order.size || '') + '")');
    else if (paid !== exp.total) problems.push('Paid ' + naira(paid) + ' but price list says ' + naira(exp.total));
    if (order.itemCount > MAX_PIECES) problems.push('Order lists ' + order.itemCount + ' frames (max ' + MAX_PIECES + ')');
    if (order.pieces && order.itemCount && order.pieces !== order.itemCount) problems.push('Pieces (' + order.pieces + ') does not match frames listed (' + order.itemCount + ')');
  }
  if (order.total != null && Number(order.total) !== paid) problems.push('Paid ' + naira(paid) + ' but receipt total was ' + naira(order.total));
  // The Paystack reference must belong to this order (ref, or ref-R<n> for a retry).
  const pref = String(data.reference || '');
  if (!order.ref || !(pref === order.ref || (pref.startsWith(order.ref + '-R') && /^-R\d{1,3}$/.test(pref.slice(order.ref.length))))) problems.push('Paystack reference does not match the order reference');
  return { order, expected: exp, paid, ok: problems.length === 0, problems };
}

// Sanitised view for the browser receipt (no Paystack internals).
function publicView(data, check) {
  const o = check.order || {};
  // Customer details only come back for crypto-random references; older,
  // guessable references get the order summary without personal data.
  const pii = STRONG_REF_RE.test(o.ref || '') && check.ok;
  const cu = pii ? (o.customer || {}) : {};
  return {
    reference: data.reference,
    orderRef: o.ref || data.reference,
    status: data.status,
    paid: data.status === 'success',
    amountOk: check.ok,
    amount: check.paid,
    // Server-priced total from our own price table (never the browser's).
    expectedTotal: check.expected ? check.expected.total : null,
    balanceDue: check.expected ? Math.max(0, check.expected.total - check.paid) : null,
    // exact | over | under | unknown — the browser only shows success for exact/over.
    amountStatus: !check.expected ? 'unknown' : (check.paid === check.expected.total ? 'exact' : (check.paid > check.expected.total ? 'over' : 'under')),
    currency: data.currency,
    paidAt: data.paid_at || data.paidAt || null,
    channel: data.channel || null,
    order: {
      ref: o.ref, size: o.size, style: o.style, pieces: o.pieces, setName: o.setName,
      unitPrice: o.unitPrice, discount: o.discount, subtotal: o.subtotal, total: o.total,
      items: Array.isArray(o.items) ? o.items.map(i => ({ imageName: i.name, isUpload: !!i.isUpload, fileKind: i.fileKind || null })) : [],
      v: o.v === 2 ? 2 : undefined,
      lines: o.v === 2 ? o.lines.map(l => ({ size: l.size, style: l.style, qty: l.qty, unit: l.unit, setName: l.setName,
        items: l.items.map(i => ({ imageName: i.name, isUpload: !!i.isUpload, fileKind: i.fileKind || null })) })) : undefined,
      deliveryFee: o.v === 2 && check.expected ? check.expected.delivery : undefined,
      name: cu.name, phone: cu.phone, address: cu.address,
      city: cu.city, state: cu.state, notes: cu.notes,
      placedAt: o.placedAt
    }
  };
}

// Nigerian phone -> wa.me link (owner taps it to message the customer).
function waLink(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '234' + d.slice(1);
  else if (d.length === 10) d = '234' + d;
  if (d.length < 11 || d.length > 15) return '';
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}

// Full owner receipt, HTML + plain text.
function receiptEmail(data, check) {
  const o = check.order || {}, c = o.customer || {}, exp = check.expected;
  const v2 = o.v === 2;
  const n = v2 ? (exp ? exp.n : (o.items || []).length) : ((o.items || []).length || Number(o.pieces) || 1);
  const fileTag = it => it.isUpload ? (it.fileKind === 'pdf' ? ' (customer PDF' + (it.fileName ? ': ' + it.fileName : '') + ')' : ' (customer photo' + (it.fileName ? ': ' + it.fileName : '') + ')') : '';
  const files = [];
  const items = v2
    ? o.lines.map(l => {
        const k = l.items.length, unit = PRICES[normSize(l.size)] || 0, each = unit * k; // gross; pair discount shown below
        l.items.forEach(it => { if (it.fileUrl) files.push({ name: it.fileName || it.name, url: it.fileUrl }); });
        return { name: l.items.map(it => it.name + fileTag(it)).join(' + '), piece: k > 1 && l.setName && l.setName !== 'Custom set' ? l.setName : '',
          size: l.size, style: l.style, set: setLabelOf(k), qty: l.qty, unit: each, total: each * l.qty };
      })
    : (o.items || []).map((it, i) => ({
    name: (it.name || it.imageName || 'Frame') + fileTag(it),
    piece: n > 1 ? 'Frame ' + (i + 1) + ' of ' + n : '',
    size: o.size, style: o.style, set: setLabelOf(n) + (o.setName && n > 1 ? ' · ' + o.setName : ''),
    qty: 1, unit: it.unit || o.unitPrice, total: it.lineTotal || it.unit || o.unitPrice
  }));
  const subtotalShown = v2 ? (exp ? exp.gross : o.subtotal) : (o.subtotal != null ? o.subtotal : exp && exp.subtotal);
  const discountShown = v2 ? (exp ? exp.discount : o.discount) : o.discount;
  const discountLabel = v2 ? 'Pair discount' : setLabelOf(n) + ' set discount';
  const deliveryText = v2 && exp ? naira(exp.delivery) + ' (' + exp.region + ' · ' + (c.state || '') + ') · paid' : 'Fee to be confirmed';
  const nextStep = v2 ? 'Next: delivery is paid — start framing and deliver within 3 business days.' : 'Next: confirm the delivery fee with the customer, then start framing.';
  const ref = line(o.ref || data.reference, 40);
  const subject = line((check.ok ? '' : '⚠ CHECK AMOUNT — ') + 'New paid order ' + ref + ' — ' + naira(check.paid), 150);
  const warn = check.ok ? '' : 'CHECK BEFORE SHIPPING: ' + check.problems.join('; ');
  const when = data.paid_at ? new Date(data.paid_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) + ' (WAT)' : '';
  const custRows = [['Name', c.name], ['Email', c.email], ['Phone', c.phone], ['Delivery address', c.address], ['City / State', [c.city, c.state].filter(Boolean).join(', ')], ['Notes', c.notes]].filter(r => r[1]);
  const uploads = (o.items || []).some(i => i.isUpload);
  const wa = waLink(c.phone, 'Hi ' + (c.name || '').split(' ')[0] + ', this is Hanga. Thank you for your order ' + ref + '! ');

  const text = [
    'NEW PAID ORDER — ' + ref, warn, '',
    'Order reference: ' + ref,
    'Paystack reference: ' + data.reference,
    'Paid: ' + naira(check.paid) + (when ? ' on ' + when : '') + (data.channel ? ' via ' + data.channel : ''),
    '', 'ITEMS',
    ...items.map(i => '- ' + i.name + (i.piece ? ' [' + i.piece + ']' : '') + ' | ' + i.size + '" | ' + i.style + ' | ' + i.set + ' | qty ' + i.qty + ' | ' + naira(i.unit) + ' | ' + naira(i.total)),
    '',
    'Subtotal: ' + naira(subtotalShown),
    (discountShown ? (discountLabel + ': -' + naira(discountShown)) : ''),
    'Delivery: ' + deliveryText + ' — nationwide within 3 business days',
    'TOTAL PAID: ' + naira(check.paid),
    '', 'CUSTOMER', ...custRows.map(r => r[0] + ': ' + r[1]),
    wa ? 'WhatsApp the customer: ' + wa : '',
    files.length ? '\nCUSTOMER FILES\n' + files.map(f => '- ' + f.name + ': ' + f.url).join('\n') : '',
    uploads && !files.length ? '\nThis order includes the customer\'s own file(s). Ask them to send the original file(s) on WhatsApp or email.' : '',
    '\n' + nextStep
  ].filter(l => l !== '').join('\n');

  const td = 'padding:8px 6px;border-bottom:1px solid #eee;vertical-align:top;font-size:13px';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<div style="max-width:640px;margin:0 auto;padding:24px">
<div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:24px">
<div style="text-align:center;border-bottom:1px dashed #ccc;padding-bottom:14px">
<div style="font:700 26px Georgia,serif;letter-spacing:2px">HANGA<span style="color:#c9a96e">.</span></div>
<div style="font-size:12px;color:#777">Make your wall speak.</div></div>
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
<tr><td>Subtotal</td><td style="text-align:right">${naira(subtotalShown)}</td></tr>
${discountShown ? `<tr><td>${esc(discountLabel)}</td><td style="text-align:right">−${naira(discountShown)}</td></tr>` : ''}
<tr><td>Delivery</td><td style="text-align:right">${esc(deliveryText)} · Nationwide within 3 business days</td></tr>
<tr><td style="font-weight:bold;font-size:17px;border-top:2px solid #1a1a1a;padding-top:8px">TOTAL PAID</td><td style="text-align:right;font-weight:bold;font-size:17px;border-top:2px solid #1a1a1a;padding-top:8px">${naira(check.paid)}</td></tr>
</table>
<h3 style="font-size:13px;letter-spacing:1px;color:#777;margin:20px 0 6px">CUSTOMER</h3>
<table style="width:100%;font-size:13px">${custRows.map(r => `<tr><td style="color:#777;width:140px;vertical-align:top">${esc(r[0])}</td><td>${esc(r[1]).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>
${wa ? `<p style="margin:14px 0"><a href="${esc(wa)}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:999px;font-size:14px">Message ${esc(c.name || 'customer')} on WhatsApp</a></p>` : ''}
${files.length ? `<p style="font-size:13px;background:#eef6ff;padding:10px;border-radius:4px"><strong>Customer files:</strong><br>${files.map(f => `<a href="${esc(f.url)}">${esc(f.name)}</a>`).join('<br>')}</p>` : ''}
${uploads && !files.length ? '<p style="font-size:13px;background:#fff6e0;padding:10px;border-radius:4px">This order includes the customer\'s own file(s). Ask them to send the original file(s) on WhatsApp or email.</p>' : ''}
<p style="font-size:13px;color:#555;border-top:1px dashed #ccc;padding-top:12px">${esc(nextStep)}</p>
</div></div></body></html>`;
  return { subject, text, html, ref };
}

async function sendResend({ to, subject, html, text, replyTo, idempotencyKey }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: 'RESEND_API_KEY not set' };
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey; // Resend drops duplicates for 24h
  const r = await fetchT('https://api.resend.com/emails', {
    method: 'POST', headers,
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'Hanga Orders <onboarding@resend.dev>', to: [to], subject: line(subject, 150), html, text, reply_to: (replyTo && EMAIL_RE.test(replyTo)) ? replyTo : undefined })
  }, 8000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Resend HTTP ' + r.status + (j && j.name ? ' ' + line(j.name, 60) : ''));
  return j;
}

// Email the owner about a paid order. Called from BOTH the webhook and
// /api/verify so it still fires if the webhook isn't set up; Resend's
// Idempotency-Key ("owner-<paystack ref>") makes the second call a no-op.
async function notifyPaid(data, check, source) {
  if (!data || data.status !== 'success') return { skipped: 'not paid' };
  const mail = receiptEmail(data, check);
  const owner = process.env.OWNER_EMAIL || 'hangaframes@gmail.com';
  // Placeholder payer emails (@orders.hanga.ng, used only to satisfy Paystack) are never mailed.
  let cust = ((check.order || {}).customer || {}).email;
  if (cust && (/@orders\.hanga\.ng$/i.test(cust) || !EMAIL_RE.test(cust))) cust = '';
  const out = {};
  try {
    out.owner = await sendResend({ to: owner, subject: mail.subject, html: mail.html, text: mail.text, replyTo: cust, idempotencyKey: 'owner-' + data.reference });
  } catch (e) { out.ownerError = e.message; }
  if (cust && process.env.SEND_CUSTOMER_COPY === 'true') {
    try { out.customer = await sendResend({ to: cust, subject: 'Your Hanga receipt ' + mail.ref, html: mail.html, text: mail.text, replyTo: owner, idempotencyKey: 'cust-' + data.reference }); }
    catch (e) { out.customerError = e.message; }
  }
  // ── Write order to KV store for the admin dashboard (best-effort, never blocks email) ──
  try {
    const { writeOrder } = require('./admin-orders');
    const o = check.order || {};
    const c = o.customer || {};
    await writeOrder({
      ref:         mail.ref,
      paystackRef: data.reference,
      placedAt:    o.placedAt || data.paid_at || new Date().toISOString(),
      paidAt:      data.paid_at || new Date().toISOString(),
      channel:     data.channel || null,
      price:       check.paid,
      expectedTotal: check.expected ? check.expected.total : null,
      unitPrice:   o.unitPrice,
      subtotal:    o.v === 2 && check.expected ? check.expected.subtotal : o.subtotal,
      discount:    o.v === 2 && check.expected ? check.expected.discount : o.discount,
      v:           o.v === 2 ? 2 : undefined,
      lines:       o.v === 2 ? o.lines : undefined,
      framesTotal: o.v === 2 && check.expected ? check.expected.subtotal : undefined,
      deliveryFee: o.v === 2 && check.expected ? check.expected.delivery : undefined,
      deliveryRegion: o.v === 2 && check.expected ? check.expected.region : undefined,
      size:        o.size,
      style:       o.style,
      pieces:      o.pieces,
      set:         o.set,
      setName:     o.setName || null,
      items:       Array.isArray(o.items) ? o.items : [],
      imageName:   Array.isArray(o.items) && o.items[0] ? o.items[0].name : (o.imageName || ''),
      name:        c.name    || '',
      phone:       c.phone   || '',
      email:       c.email   || '',
      address:     c.address || '',
      city:        c.city    || '',
      state:       c.state   || '',
      notes:       c.notes   || '',
      amountStatus: check.ok ? 'exact' : 'mismatch',
      problems:    check.ok ? [] : (check.problems || [])
    });
  } catch (e) {
    console.warn('[hanga] KV write skipped:', e && e.message);
  }
  console.log('[hanga] paid order', mail.ref, line(data.reference, 60), 'via', source, check.ok ? 'OK' : check.problems.join('; '), 'owner:', out.owner ? 'sent' : (out.ownerError || 'skipped'), 'customer:', out.customer ? 'sent' : (out.customerError || 'off'));
  return out;
}
// Best-effort per-IP rate limit (per warm instance; Vercel may run several).
const _hits = new Map();
function rateLimited(req, limit, windowMs) {
  const ip = String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '?').trim();
  const now = Date.now(), w = _hits.get(ip);
  if (_hits.size > 5000) _hits.clear();
  if (!w || now - w.t > windowMs) { _hits.set(ip, { t: now, n: 1 }); return false; }
  w.n++;
  return w.n > limit;
}

// Emails are only (re)sent for payments younger than Resend's 24h
// idempotency window, so replaying an old reference can't re-trigger mail.
const FRESH_MS = 20 * 3600 * 1000;
function isFresh(data) {
  const t = Date.parse((data && (data.paid_at || data.paidAt)) || '');
  return !t || Date.now() - t < FRESH_MS;
}

module.exports = { fetchT, DELIVERY_REGIONS, deliveryFor, line, block, REF_RE, STRONG_REF_RE, PAYSTACK_REF_RE, EMAIL_RE, rateLimited, isFresh, notifyPaid, waLink, PRICES, SET_DISCOUNTS, naira, expectedTotal, verifySignature, paystackVerify, checkPayment, publicView, receiptEmail, sendResend, readMetaOrder };
