/* confirmation.html: receipt + Pay with Paystack + WhatsApp/email fallback. */
(function () {
  var H = window.HANGA;
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var order = {};
  try { order = JSON.parse(sessionStorage.getItem('hangaOrderData') || 'null') || JSON.parse(localStorage.getItem('hangaLastOrder') || '{}'); } catch (e) { order = {}; }
  // Paystack returns with ?reference=; our own redirect uses ?ref=
  var psRef = params.get('reference') || params.get('trxref');
  var ref = params.get('ref') || (psRef ? psRef.replace(/-R\d+$/, '') : '') || order.ref || '—';
  if (order.ref && order.ref !== ref) order = {}; // stored order belongs to another reference
  var method = params.get('method') || order.method || 'request';
  document.querySelectorAll('[data-bank]').forEach(function (el) { el.textContent = (H.bank || {})[el.dataset.bank] || ''; });

  var status = method === 'transfer' ? 'transfer' : 'pending', paystackRef = null;
  try { var pd = JSON.parse(localStorage.getItem('hangaPaid') || '{}'); if (pd.ref === ref) { status = 'paid'; paystackRef = pd.paystackRef; } } catch (e) {}
  var pk = H.paystackPublicKey || '', attempt = 0;

  function render() {
    H.renderReceipt($('receipt'), order, { ref: ref, status: status, paystackRef: paystackRef, date: order.placedAt });
    var paid = status === 'paid';
    $('confirmTitle').textContent = paid ? 'Payment received, thank you!' : 'Your receipt';
    $('confirmMsg').textContent = paid
      ? 'Hanga has your paid order and will be in touch about delivery. We will confirm your delivery fee after your order.'
      : (pk && order.email ? 'Your order is saved. Pay below, or send it to us on WhatsApp.' : 'Your order is saved. Send it to us on WhatsApp to finish, and we will confirm your total and how to pay.');
    var hidePay = paid || !pk || !order.price || !order.email;
    $('payBtn').hidden = hidePay; $('payNote').hidden = hidePay;
    $('payAmt').textContent = order.price ? H.formatNaira(order.price) : '';
    // One primary action under the receipt: Paystack, or WhatsApp when payments are off.
    var wa = $('sendWhatsApp'), waPrimary = hidePay && !paid && !!H.whatsappNumber;
    if (waPrimary) { $('primarySlot').appendChild(wa); wa.className = 'btn rc-btn rc-btn-wa'; wa.textContent = 'Send order on WhatsApp'; }
    else { $('secondarySlot').appendChild(wa); wa.className = 'btn rc-btn rc-btn-sec'; wa.textContent = paid ? 'Message us on WhatsApp' : 'Send on WhatsApp'; }
    if (method === 'transfer' && H.bank && H.bank.confirmed && !paid) { $('transferNote').classList.remove('hidden'); $('transferAmount').textContent = H.formatNaira(order.price); }
  }

  function summaryText() {
    var R = order.price ? H.receiptRows(order) : null;
    var lines = ['Order reference: ' + ref, 'Status: ' + (status === 'paid' ? 'PAID (Paystack ' + (paystackRef || '') + ')' : 'Payment pending')];
    if (R) {
      lines.push('', 'Items:');
      R.rows.forEach(function (r) { lines.push('• ' + r.name + (r.piece ? ' [' + r.piece + ']' : '') + ' — ' + r.size + ', ' + r.style + ', ' + r.set + ' — ' + r.qty + ' × ' + H.formatNaira(r.unit)); });
      lines.push('Subtotal: ' + H.formatNaira(R.subtotal));
      if (R.discount) lines.push(H.setLabel(R.n) + ' set discount: −' + H.formatNaira(R.discount));
      lines.push('Delivery: to be confirmed', 'TOTAL: ' + H.formatNaira(R.total));
    }
    lines.push('', 'Name: ' + (order.name || ''), 'Phone: ' + (order.phone || ''), 'Email: ' + (order.email || ''), 'Delivery address: ' + (order.address || ''));
    return lines.join('\n');
  }
  function wireSend() {
    if (H.whatsappNumber) { $('sendWhatsApp').href = H.whatsappLink('Hi Hanga! Here is my order:\n\n' + summaryText()); $('sendWhatsApp').hidden = false; }
    $('uploadMsg').hidden = !H.orderPieces(order).some(function (p) { return p.isUpload; });
  }
  function alertBox(msg, kind, retry) {
    var a = $('payAlert'); a.textContent = ''; a.className = 'rc-alert ' + (kind || '');
    a.appendChild(document.createTextNode(msg + ' '));
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'rc-link'; b.textContent = 'Retry payment'; b.onclick = pay; a.appendChild(b); }
    if (retry && H.whatsappNumber) { var w = document.createElement('a'); w.className = 'rc-link'; w.href = $('sendWhatsApp').href; w.target = '_blank'; w.rel = 'noopener'; w.textContent = 'Order via WhatsApp instead'; a.append(' · ', w); }
    a.hidden = false;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) { if (window.PaystackPop) return res(); var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function markPaid(reference) {
    status = 'paid'; paystackRef = reference;
    try { localStorage.setItem('hangaPaid', JSON.stringify({ ref: ref, paystackRef: reference })); } catch (e) {}
    render(); wireSend();
  }
  function verify(reference) {
    return fetch('/api/verify?reference=' + encodeURIComponent(reference)).then(function (r) { return r.json(); }).then(function (v) {
      if (v.ok && v.paid) {
        if (!order.price && v.order) order = Object.assign({}, v.order, { price: v.order.total });
        markPaid(v.reference);
        alertBox(v.amountOk ? 'Payment confirmed by Paystack ✓' : 'Payment received. We will double-check the amount and contact you.', 'is-ok');
      } else if (v.ok && !v.paid) {
        if (status !== 'paid') alertBox('Payment was not completed (' + (v.status || 'unknown') + '). No money was taken.', 'is-warn', true);
      } else if (status === 'paid') {
        alertBox('Payment received — awaiting confirmation. Keep your reference handy.', 'is-ok');
      }
    }).catch(function () { if (status === 'paid') alertBox('Payment received — awaiting confirmation. Keep your reference handy.', 'is-ok'); });
  }
  function pay() {
    if (!pk || !order.price || !order.email) return;
    $('payAlert').hidden = true; $('payBtn').disabled = true; attempt++;
    var meta = H.paystackOrder(order, ref);
    loadScript('https://js.paystack.co/v2/inline.js').then(function () {
      new window.PaystackPop().newTransaction({
        key: pk,
        email: order.email,
        amount: Math.round(Number(order.price) * 100), // kobo; delivery is confirmed after the order
        currency: 'NGN',
        reference: attempt === 1 ? ref : ref + '-R' + attempt, // Paystack refuses a reused reference
        metadata: {
          order_ref: ref,
          order: meta,
          custom_fields: [
            { display_name: 'Order', variable_name: 'order_ref', value: ref },
            { display_name: 'Customer', variable_name: 'customer', value: (order.name || '') + ' · ' + (order.phone || '') },
            { display_name: 'Items', variable_name: 'items', value: meta.items.map(function (i) { return i.name; }).join(', ') + ' (' + meta.size + '", ' + meta.style + ', ' + meta.set + ')' }
          ]
        },
        onSuccess: function (tx) { $('payBtn').disabled = false; markPaid(tx.reference); alertBox('Payment successful. Confirming with Paystack…', 'is-ok'); verify(tx.reference); },
        onCancel: function () { $('payBtn').disabled = false; alertBox('Payment not completed. Your order is still saved.', 'is-warn', true); },
        onError: function (err) { $('payBtn').disabled = false; alertBox('Paystack could not start (' + ((err && err.message) || 'error') + ').', 'is-warn', true); }
      });
    }).catch(function () { $('payBtn').disabled = false; alertBox('Could not load Paystack. Check your connection.', 'is-warn', true); });
  }
  $('payBtn').addEventListener('click', pay);

  render(); wireSend();
  if (psRef) verify(psRef);
  if (!pk) {
    fetch('/api/config').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (c) { if (c && c.paystackPublicKey) { pk = c.paystackPublicKey; render(); } }).catch(function () {});
  }
})();
