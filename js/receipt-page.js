/* confirmation.html: receipt + PAY button (Paystack) + success screen. */
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
  if (ref === '—') {
    // Nothing to show: a friendly empty state instead of a blank "PAYMENT PENDING" receipt.
    $('emptyScreen').hidden = false;
    ['confirmTitle', 'receiptWrap', 'transferNote'].forEach(function (id) { var el = $(id); if (el) el.remove(); });
    var acts = document.querySelector('.rc-actions'); if (acts) acts.remove();
    document.title = 'No order to show – Hanga';
    return;
  }
  var method = params.get('method') || order.method || 'request';
  document.querySelectorAll('[data-bank]').forEach(function (el) { el.textContent = (H.bank || {})[el.dataset.bank] || ''; });

  // Status: pending | transfer | checking | paid | mismatch. "paid" is ONLY ever
  // set from a server-side /api/verify answer, never from localStorage alone.
  var status = method === 'transfer' ? 'transfer' : 'pending', paystackRef = null, paidAmount = null, verifyRef = psRef;
  try {
    // hangaPaid = verified paid before; hangaPayRef = a Paystack payment exists
    // for this order (e.g. underpaid). Either way we re-verify with the server.
    var pd = JSON.parse(localStorage.getItem('hangaPaid') || 'null') || {};
    if (pd.ref !== ref) pd = JSON.parse(localStorage.getItem('hangaPayRef') || '{}');
    if (pd.ref === ref && pd.paystackRef) { status = 'checking'; paystackRef = pd.paystackRef; verifyRef = verifyRef || pd.paystackRef; }
  } catch (e) {}
  if (psRef) status = 'checking';
  var pk = H.paystackPublicKey || '', attempt = 0, configDone = !!pk;

  function render() {
    H.renderReceipt($('receipt'), order, { ref: ref, status: status, paystackRef: paystackRef, date: order.placedAt });
    var paid = status === 'paid', mismatch = status === 'mismatch', checking = status === 'checking';
    $('confirmTitle').textContent = paid ? 'Payment successful' : (mismatch ? "Payment doesn't match your order" : 'Your Hanga receipt');
    // Receipt + one PAY button. Orders reach Hanga by email automatically.
    var hidePay = paid || mismatch || checking || !pk || !order.price;
    $('payBtn').hidden = hidePay; $('payNote').hidden = true;
    $('payAmt').textContent = order.price ? H.formatNaira(order.price) : '';
    $('payBtn').setAttribute('aria-label', 'Pay ' + (order.price ? H.formatNaira(order.price) : '') + ' securely with Paystack');
    $('continueLink').hidden = !paid;
    // One primary action under the receipt: Paystack, or WhatsApp when payments are off.
    // WhatsApp only as a last resort when online payment can't load at all.
    var wa = $('sendWhatsApp'), waFallback = !paid && !mismatch && !checking && !pk && configDone && !!H.whatsappNumber && !!order.price;
    wa.hidden = !waFallback;
    if (waFallback) { $('primarySlot').appendChild(wa); wa.className = 'btn rc-btn rc-btn-wa'; wa.textContent = 'Send order on WhatsApp'; }
    showSuccess(paid);
    showMismatch(mismatch);
    if (method === 'transfer' && H.bank && H.bank.confirmed && !paid && !mismatch) { $('transferNote').classList.remove('hidden'); $('transferAmount').textContent = H.formatNaira(order.price); }
  }

  // Paid: swap the receipt view for the success screen (receipt stays one tap away).
  var successShown = false, paidAt = null;
  function showSuccess(paid) {
    var ok = $('successScreen');
    ok.hidden = !paid;
    document.body.classList.toggle('is-paid-view', paid);
    if (!paid) return;
    $('okRef').textContent = ref;
    var R = order.price ? H.receiptRows(order) : null, dl = $('okSummary');
    dl.textContent = '';
    var rows = [];
    if (R) {
      rows.push(['Items', R.rows.map(function (r) { return (r.qty > 1 ? r.qty + ' × ' : '') + r.name; }).join(', ')]);
      if (R.v === 2) rows.push(['Frames', R.rows.map(function (r) { return [r.size, r.style.replace(' (no frame)', ''), r.set].join(' · '); }).join(' | ')]);
      else rows.push(['Frame', [order.size ? order.size + '"' : '', H.styleText(order.style), H.setLabel(R.n)].filter(Boolean).join(' · ')]);
      if (R.v === 2) rows.push(['Delivery', R.deliveryText + ' · within 3 business days']);
      rows.push(['Amount paid', H.formatNaira(paidAmount != null ? paidAmount : R.total)]);
    }
    if (paystackRef) rows.push(['Paystack ref', paystackRef]);
    if (!R || R.v !== 2) rows.push(['Delivery', 'Within 3 business days']);
    rows.forEach(function (r) { var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = r[0]; dd.textContent = r[1]; dl.append(dt, dd); });
    var okWa = $('okWhatsApp');
    if (okWa) {
      var waL = H.whatsappLink('Hi Hanga! I just paid for my order.\nOrder reference: ' + ref + (paystackRef ? '\nPaystack ref: ' + paystackRef : '') + (order.name ? '\nName: ' + order.name : ''));
      okWa.hidden = !waL; if (waL) okWa.href = waL;
    }
    var canDl = !!order.price;
    $('dlPdf').disabled = !canDl; $('dlPng').disabled = !canDl;
    if (!successShown) {
      successShown = true;
      $('receiptWrap').hidden = true;
      window.scrollTo(0, 0);
      try { $('okTitle').focus({ preventScroll: true }); } catch (e) {}
    }
  }
  // Underpaid: no success screen, no receipt, no downloads — just the
  // server-verified numbers and a way to reach Hanga.
  var mm = null;
  function showMismatch(on) {
    var sc = $('mismatchScreen');
    sc.hidden = !on;
    document.body.classList.toggle('is-mismatch-view', on);
    if (!on || !mm) return;
    $('mmRef').textContent = ref;
    var dl = $('mmSummary'); dl.textContent = '';
    var due = mm.balanceDue;
    var rows = [
      ['Amount paid', H.formatNaira(mm.amount)],
      ['Order total', mm.expectedTotal != null ? H.formatNaira(mm.expectedTotal) : 'To be confirmed by Hanga'],
      ['Balance due', due != null ? H.formatNaira(due) : 'To be confirmed by Hanga']
    ];
    if (mm.reference && mm.reference !== ref) rows.push(['Paystack ref', mm.reference]);
    rows.forEach(function (r) { var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = r[0]; dd.textContent = r[1]; if (r[0] === 'Balance due') dd.className = 'mm-due'; dl.append(dt, dd); });
    var wa = $('mmWhatsApp');
    var msg = 'Hi Hanga, my payment does not match my order.\n\nOrder reference: ' + ref +
      (mm.reference && mm.reference !== ref ? '\nPaystack reference: ' + mm.reference : '') +
      '\nAmount paid: ' + H.formatNaira(mm.amount) +
      '\nOrder total: ' + (mm.expectedTotal != null ? H.formatNaira(mm.expectedTotal) : 'to be confirmed') +
      '\nBalance due: ' + (due != null ? H.formatNaira(due) : 'to be confirmed') +
      '\n\nPlease help me complete or refund this payment.';
    var link = H.whatsappLink(msg); // wa.me + encodeURIComponent
    wa.hidden = !link; if (link) wa.href = link;
    window.scrollTo(0, 0);
    try { $('mmTitle').focus({ preventScroll: true }); } catch (e) {}
  }
  function receiptOpts() { return { ref: ref, status: status, paystackRef: paystackRef, date: order.placedAt, paidAt: paidAt }; }
  function doDownload(kind, btn) {
    if (status !== 'paid') return; // receipts only for server-confirmed, fully paid orders
    var label = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
    H.downloadReceipt(kind, order, receiptOpts())
      .catch(function () { $('okNote').textContent = 'Could not create the file. Please try again, or take a screenshot of your receipt.'; })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  }
  $('dlPdf').addEventListener('click', function () { doDownload('pdf', this); });
  $('dlPng').addEventListener('click', function () { doDownload('png', this); });
  $('toggleReceipt').addEventListener('click', function () {
    var w = $('receiptWrap'), open = w.hidden;
    w.hidden = !open; this.setAttribute('aria-expanded', String(open));
    this.textContent = open ? 'Hide full receipt' : 'View full receipt';
    if (open) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function summaryText() {
    var R = order.price ? H.receiptRows(order) : null;
    var lines = ['Order reference: ' + ref, 'Status: ' + (status === 'paid' ? 'PAID (Paystack ' + (paystackRef || '') + ')' : 'Payment pending')];
    if (R) {
      lines.push('', 'Items:');
      R.rows.forEach(function (r) { lines.push('• ' + r.name + (r.piece ? ' [' + r.piece + ']' : '') + ' — ' + r.size + ', ' + r.style + ', ' + r.set + ' — ' + r.qty + ' × ' + H.formatNaira(r.unit)); });
      lines.push('Subtotal: ' + H.formatNaira(R.subtotal));
      if (R.discount) lines.push(R.discountLabel + ': −' + H.formatNaira(R.discount));
      lines.push('Delivery: ' + R.deliveryText, 'TOTAL: ' + H.formatNaira(R.total));
    }
    lines.push('', 'Name: ' + (order.name || ''), 'Phone: ' + (order.phone || ''), 'Delivery address: ' + [order.address, order.city, order.state].filter(Boolean).join(', '));
    return lines.join('\n');
  }
  function wireSend() {
    if (H.whatsappNumber) { $('sendWhatsApp').href = H.whatsappLink('Hi Hanga! Here is my order:\n\n' + summaryText()); }
    $('uploadMsg').hidden = !H.orderPieces(order).some(function (p) { return p.isUpload; });

    // Show Cloudinary upload status for customer uploads
    var uploadItems = H.orderPieces(order).filter(function (p) { return p.isUpload; });
    var uploadEl = $('uploadMsg');
    if (uploadItems.length) {
      var allUploaded = uploadItems.every(function (p) { return p.cloudinaryUrl; });
      var anyFailed   = uploadItems.some(function (p) { return p.cloudinaryFailed; });
      if (allUploaded) {
        uploadEl.innerHTML = '<strong>✓ Your photo has been received.</strong> We have everything we need to print your frame.';
        uploadEl.className = 'rc-upload rc-upload-ok';
        uploadEl.hidden = false;
      } else if (anyFailed) {
        var waLink = H.whatsappLink ? H.whatsappLink('Hi Hanga! My order reference is ' + ref + '. Here is my photo for printing.') : '#';
        uploadEl.innerHTML = '<strong>Please send us your photo.</strong> The automatic upload did not go through. ' +
          (waLink !== '#' ? '<a href="' + waLink + '" target="_blank" rel="noopener">Send on WhatsApp →</a>' : 'Email it to hangaframes@gmail.com with your order reference.');
        uploadEl.className = 'rc-upload rc-upload-warn';
        uploadEl.hidden = false;
      } else {
        uploadEl.innerHTML = '<strong>Framing your own photo?</strong> Please send us the original file (PDF or full-size image) so it prints sharply.';
        uploadEl.className = 'rc-upload';
        uploadEl.hidden = false;
      }
    }
  }
  function alertBox(msg, kind, retry, recheck) {
    var a = $('payAlert'); a.textContent = ''; a.className = 'rc-alert ' + (kind || '');
    a.appendChild(document.createTextNode(msg + ' '));
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'rc-link'; b.textContent = 'Retry payment'; b.onclick = pay; a.appendChild(b); }
    if (recheck) { var c = document.createElement('button'); c.type = 'button'; c.className = 'rc-link'; c.textContent = 'Check again'; c.onclick = function () { alertBox('Confirming your payment with Paystack…', 'is-info'); verify(recheck); }; a.appendChild(c); }
    a.hidden = false;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) { if (window.PaystackPop) return res(); var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function forgetPaid(all) {
    try {
      var keys = all ? ['hangaPaid', 'hangaPayRef'] : ['hangaPaid'];
      keys.forEach(function (k) { var pd = JSON.parse(localStorage.getItem(k) || '{}'); if (pd.ref === ref) localStorage.removeItem(k); });
    } catch (e) {}
  }
  function rememberPayRef(reference) { try { localStorage.setItem('hangaPayRef', JSON.stringify({ ref: ref, paystackRef: reference })); } catch (e) {} }
  // Only called after /api/verify says paid AND the amount covers the order.
  function markPaid(reference) {
    status = 'paid'; paystackRef = reference;
    try { localStorage.setItem('hangaPaid', JSON.stringify({ ref: ref, paystackRef: reference })); } catch (e) {}
    render(); wireSend();
  }
  function markMismatch(v) {
    status = 'mismatch'; paystackRef = v.reference || paystackRef;
    mm = { amount: Number(v.amount) || 0, expectedTotal: v.expectedTotal != null ? Number(v.expectedTotal) : null, balanceDue: v.balanceDue != null ? Number(v.balanceDue) : null, reference: v.reference || '' };
    forgetPaid();
    $('payAlert').hidden = true;
    render();
  }
  function verify(reference) {
    if (!reference) return Promise.resolve();
    return fetch('/api/verify?reference=' + encodeURIComponent(reference), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) {
      if (v.ok && v.paid) {
        if (!order.price && v.order) order = Object.assign({}, v.order, { price: v.expectedTotal != null ? v.expectedTotal : v.order.total });
        paidAt = v.paidAt || null;
        if (v.amountStatus !== 'exact' && v.amountStatus !== 'over') return markMismatch(v);
        paidAmount = Number(v.amount) || null;
        markPaid(v.reference);
        $('payAlert').hidden = true;
        $('okNote').textContent = v.amountStatus === 'over'
          ? 'Confirmed by Paystack ✓ You paid ' + H.formatNaira(v.amount - v.expectedTotal) + ' more than the order total. Hanga will sort out the difference with you.'
          : 'Confirmed by Paystack ✓' + (v.notified ? ' Your order has been sent to Hanga.' : '');
      } else if (v.ok && !v.paid) {
        forgetPaid(true);
        status = method === 'transfer' ? 'transfer' : 'pending'; paystackRef = null; render();
        alertBox('Payment was not completed (' + (v.status || 'unknown') + '). No money was taken.', 'is-warn', true);
      } else {
        unconfirmed(reference);
      }
    }).catch(function () { unconfirmed(reference); });
  }
  // Couldn't reach Paystack: never show success; never invite a second payment.
  function unconfirmed(reference) {
    if (status === 'paid' || status === 'mismatch') return;
    status = 'checking'; render();
    alertBox("We couldn't confirm your payment yet. Please don't pay again — check again in a minute or contact Hanga.", 'is-warn', false, reference);
  }
  function pay() {
    if (!pk || !order.price) return;
    $('payAlert').hidden = true; $('payBtn').disabled = true; attempt++;
    var meta = H.paystackOrder(order, ref);
    loadScript('https://js.paystack.co/v2/inline.js').then(function () {
      new window.PaystackPop().newTransaction({
        key: pk,
        email: H.payEmail(order), // the customer's email if given, else a placeholder
        amount: Math.round(Number(order.price) * 100), // kobo; v2 orders include delivery
        currency: 'NGN',
        reference: attempt === 1 ? ref : ref + '-R' + attempt, // Paystack refuses a reused reference
        metadata: {
          order_ref: ref,
          order: meta,
          custom_fields: H.paystackFields(order, meta, ref)
        },
        onSuccess: function (tx) { $('payBtn').disabled = false; status = 'checking'; paystackRef = tx.reference; rememberPayRef(tx.reference); render(); alertBox('Confirming your payment with Paystack…', 'is-info'); verify(tx.reference); },
        onCancel: function () { $('payBtn').disabled = false; alertBox('Payment not completed. Your order is still saved.', 'is-warn', true); },
        onError: function (err) { $('payBtn').disabled = false; alertBox('Paystack could not start (' + ((err && err.message) || 'error') + ').', 'is-warn', true); }
      });
    }).catch(function () { $('payBtn').disabled = false; alertBox('Could not load Paystack. Check your connection.', 'is-warn', true); });
  }
  $('payBtn').addEventListener('click', pay);

  render(); wireSend();
  if (status === 'checking') { alertBox('Confirming your payment with Paystack…', 'is-info'); verify(verifyRef); }
  if (!pk) {
    fetch('/api/config').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (c) { if (c && c.paystackPublicKey) pk = c.paystackPublicKey; })
      .catch(function () {})
      .then(function () { configDone = true; render(); });
  }
})();
