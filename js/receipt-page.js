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
  var method = params.get('method') || order.method || 'request';
  document.querySelectorAll('[data-bank]').forEach(function (el) { el.textContent = (H.bank || {})[el.dataset.bank] || ''; });

  var status = method === 'transfer' ? 'transfer' : 'pending', paystackRef = null;
  try { var pd = JSON.parse(localStorage.getItem('hangaPaid') || '{}'); if (pd.ref === ref) { status = 'paid'; paystackRef = pd.paystackRef; } } catch (e) {}
  var pk = H.paystackPublicKey || '', attempt = 0, configDone = !!pk;

  function render() {
    H.renderReceipt($('receipt'), order, { ref: ref, status: status, paystackRef: paystackRef, date: order.placedAt });
    var paid = status === 'paid';
    $('confirmTitle').textContent = paid ? 'Payment successful' : 'Your Hanga receipt';
    // Receipt + one PAY button. Orders reach Hanga by email automatically.
    var hidePay = paid || !pk || !order.price;
    $('payBtn').hidden = hidePay; $('payNote').hidden = true;
    $('payAmt').textContent = order.price ? H.formatNaira(order.price) : '';
    $('payBtn').setAttribute('aria-label', 'Pay ' + (order.price ? H.formatNaira(order.price) : '') + ' securely with Paystack');
    $('continueLink').hidden = !paid;
    // One primary action under the receipt: Paystack, or WhatsApp when payments are off.
    // WhatsApp only as a last resort when online payment can't load at all.
    var wa = $('sendWhatsApp'), waFallback = !paid && !pk && configDone && !!H.whatsappNumber && !!order.price;
    wa.hidden = !waFallback;
    if (waFallback) { $('primarySlot').appendChild(wa); wa.className = 'btn rc-btn rc-btn-wa'; wa.textContent = 'Send order on WhatsApp'; }
    showSuccess(paid);
    if (method === 'transfer' && H.bank && H.bank.confirmed && !paid) { $('transferNote').classList.remove('hidden'); $('transferAmount').textContent = H.formatNaira(order.price); }
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
      rows.push(['Items', R.rows.map(function (r) { return r.name; }).join(', ')]);
      rows.push(['Frame', [order.size ? order.size + '"' : '', H.styleText(order.style), H.setLabel(R.n)].filter(Boolean).join(' · ')]);
      rows.push(['Amount paid', H.formatNaira(R.total)]);
    }
    if (paystackRef) rows.push(['Paystack ref', paystackRef]);
    rows.push(['Delivery', 'Fee confirmed after your order']);
    rows.forEach(function (r) { var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = r[0]; dd.textContent = r[1]; dl.append(dt, dd); });
    var canDl = !!order.price;
    $('dlPdf').disabled = !canDl; $('dlPng').disabled = !canDl;
    if (!successShown) {
      successShown = true;
      $('receiptWrap').hidden = true;
      window.scrollTo(0, 0);
      try { $('okTitle').focus({ preventScroll: true }); } catch (e) {}
    }
  }
  function receiptOpts() { return { ref: ref, status: status, paystackRef: paystackRef, date: order.placedAt, paidAt: paidAt }; }
  function doDownload(kind, btn) {
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
      if (R.discount) lines.push(H.setLabel(R.n) + ' set discount: −' + H.formatNaira(R.discount));
      lines.push('Delivery: to be confirmed', 'TOTAL: ' + H.formatNaira(R.total));
    }
    lines.push('', 'Name: ' + (order.name || ''), 'Phone: ' + (order.phone || ''), 'Delivery address: ' + (order.address || ''));
    return lines.join('\n');
  }
  function wireSend() {
    if (H.whatsappNumber) { $('sendWhatsApp').href = H.whatsappLink('Hi Hanga! Here is my order:\n\n' + summaryText()); }
    $('uploadMsg').hidden = !H.orderPieces(order).some(function (p) { return p.isUpload; });
  }
  function alertBox(msg, kind, retry) {
    var a = $('payAlert'); a.textContent = ''; a.className = 'rc-alert ' + (kind || '');
    a.appendChild(document.createTextNode(msg + ' '));
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'rc-link'; b.textContent = 'Retry payment'; b.onclick = pay; a.appendChild(b); }
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
        paidAt = v.paidAt || null;
        markPaid(v.reference);
        $('payAlert').hidden = true;
        $('okNote').textContent = v.amountOk ? 'Confirmed by Paystack ✓' + (v.notified ? ' Your order has been sent to Hanga.' : '') : 'Payment received. We will double-check the amount and contact you.';
      } else if (v.ok && !v.paid) {
        if (status !== 'paid') alertBox('Payment was not completed (' + (v.status || 'unknown') + '). No money was taken.', 'is-warn', true);
      } else if (status === 'paid') {
        $('okNote').textContent = 'Payment received — awaiting confirmation. Keep your reference handy.';
      }
    }).catch(function () { if (status === 'paid') $('okNote').textContent = 'Payment received — awaiting confirmation. Keep your reference handy.'; });
  }
  function pay() {
    if (!pk || !order.price) return;
    $('payAlert').hidden = true; $('payBtn').disabled = true; attempt++;
    var meta = H.paystackOrder(order, ref);
    loadScript('https://js.paystack.co/v2/inline.js').then(function () {
      new window.PaystackPop().newTransaction({
        key: pk,
        email: H.payEmail(order), // placeholder; we don't collect customer email
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
        onSuccess: function (tx) { $('payBtn').disabled = false; markPaid(tx.reference); $('okNote').textContent = 'Confirming with Paystack…'; verify(tx.reference); },
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
      .then(function (c) { if (c && c.paystackPublicKey) pk = c.paystackPublicKey; })
      .catch(function () {})
      .then(function () { configDone = true; render(); });
  }
})();
