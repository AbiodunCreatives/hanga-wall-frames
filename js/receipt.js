/* Hanga receipt — one shared component for every post-order page
   (WhatsApp / email orders now, Paystack "paid" receipts later).

   HANGA.renderReceipt(el, order, opts)
     order: the saved order (see checkout.html saveAndConfirm)
     opts:  { ref, status: 'pending' | 'transfer' | 'paid' | 'failed',
              paystackRef, date }
   Only figures that exist in the order are shown — nothing is invented. */
(function () {
  var H = window.HANGA;
  var DELIVERY_LINE = 'Nationwide delivery within 3 business days. Delivery: ' + H.DELIVERY_SUMMARY + '.';
  H.DELIVERY_LINE = DELIVERY_LINE;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtDate(d) {
    try {
      return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return d.toString(); }
  }
  var STATUS = {
    pending:  { text: 'Payment pending', note: '', cls: 'is-pending' },
    transfer: { text: 'Awaiting bank transfer', note: 'Use your order reference as the transfer description.', cls: 'is-pending' },
    paid:     { text: 'Paid', note: '', cls: 'is-paid' },
    failed:   { text: 'Payment not completed', note: 'No money was taken. You can try again below.', cls: 'is-failed' }
  };

  function uploadTag(p) { return p.isUpload ? (p.fileKind === 'pdf' ? ' (your PDF)' : ' (your photo)') : ''; }
  // v2 (cart) orders: one row per cart line, delivery fee included in the total.
  function cartRows(o) {
    var gross = 0, discount = 0, frames = 0;
    var rows = o.lines.map(function (l) {
      var items = l.items || [], n = items.length || 1, q = Math.max(1, Number(l.qty) || 1);
      var unit = Number(l.unit || 0) * n; // gross; the pair discount is its own line below
      gross += Number(l.unit || 0) * n * q; discount += H.setDiscount(n) * q; frames += n * q;
      return {
        name: n > 1 ? (l.setName && l.setName !== 'Custom set' ? l.setName + ': ' : '') + items.map(function (i) { return i.imageName + uploadTag(i); }).join(' + ')
                    : (items[0] ? items[0].imageName + uploadTag(items[0]) : 'Frame'),
        piece: '', size: l.size ? l.size + '"' : '—', style: H.styleText(l.style),
        set: H.setLabel(n) + (n > 1 && H.setDiscount(n) ? ' (−' + H.formatNaira(H.setDiscount(n)) + ')' : ''),
        qty: q, unit: unit, total: unit * q
      };
    });
    var fee = Number(o.deliveryFee || 0);
    return { rows: rows, n: frames, v: 2, subtotal: gross, discount: discount, discountLabel: 'Pair discount',
             delivery: fee, deliveryText: fee ? H.formatNaira(fee) + (o.state ? ' · ' + o.state : '') : 'To be confirmed',
             total: o.price };
  }

  H.receiptRows = function (o) {
    if (o && Array.isArray(o.lines) && o.lines.length) return cartRows(o);
    var pieces = H.orderPieces(o), n = o.pieces || pieces.length || 1;
    var unit = o.unitPrice || (n === 1 ? o.price : 0);
    var setTxt = H.setLabel(n) + (n > 1 && o.setName ? ' · ' + o.setName : '');
    var rows = pieces.map(function (p, i) {
      return {
        name: p.imageName + (p.isUpload ? (p.fileKind === 'pdf' ? ' (your PDF)' : ' (your photo)') : ''),
        piece: n > 1 ? 'Frame ' + (i + 1) + ' of ' + n : '',
        size: o.size ? o.size + '"' : '—',
        style: H.styleText(o.style),
        set: setTxt, qty: 1, unit: unit, total: unit
      };
    });
    if (!rows.length) rows.push({ name: o.imageName || 'Frame', piece: '', size: o.size ? o.size + '"' : '—', style: H.styleText(o.style), set: setTxt, qty: n, unit: unit, total: o.price });
    var discount = n > 1 ? (o.discount != null ? Number(o.discount) : H.setDiscount(n)) : 0;
    return { rows: rows, n: n, subtotal: unit ? unit * n : o.price, discount: discount, discountLabel: H.setLabel(n) + ' set discount', delivery: null, deliveryText: 'To be confirmed', total: o.price };
  };

  // Everything the server needs to process a paid order, sent to Paystack as
  // metadata (there is no database). Server re-prices it before trusting it.
  // Paystack requires an email, but we no longer ask customers for one.
  // Build a valid-format, non-deliverable placeholder from the phone number
  // (orders.hanga.ng has no mail server). It is only sent to Paystack as the
  // payer "email" and never shown on receipts or stored in the order.
  H.payEmail = function (o) {
    if (o && H.validEmail && H.validEmail(o.email)) return String(o.email).trim();
    var d = String((o && o.phone) || '').replace(/\D/g, '');
    if (d.startsWith('234')) d = '0' + d.slice(3);
    return 'customer-' + (d || 'guest') + '@orders.hanga.ng';
  };

  // First-touch campaign for this order: the copy saved on the order at
  // checkout, else this tab's sessionStorage record (attribution only).
  H.orderUtm = function (o) { return (H.normUtm && (H.normUtm(o && o.utm) || (H.getUtm && H.getUtm()))) || null; };

  H.paystackOrder = function (o, ref) {
    var utm = H.orderUtm(o);
    var cust = { name: o.name || '', email: (H.validEmail && H.validEmail(o.email)) ? String(o.email).trim() : '', phone: o.phone || '', address: o.address || '', city: o.city || '', state: o.state || '', notes: o.notes || '' };
    if (Array.isArray(o.lines) && o.lines.length) {
      var C = cartRows(o);
      return {
        v: 2, ref: ref, placedAt: o.placedAt || null,
        lines: o.lines.map(function (l) {
          return { size: l.size, style: H.normStyle(l.style), qty: Math.max(1, Number(l.qty) || 1), unit: l.unit,
            setName: (l.items || []).length > 1 ? (l.setName || 'Custom set') : null,
            items: (l.items || []).map(function (p) {
              return { name: p.imageName, imageId: p.imageId || null, isUpload: !!p.isUpload, fileKind: p.fileKind || null,
                       fileName: p.fileName || null, fileUrl: p.cloudinaryUrl || null };
            }) };
        }),
        subtotal: C.subtotal, discount: C.discount, deliveryFee: C.delivery, total: C.total,
        customer: cust, utm: utm || undefined
      };
    }
    var R = H.receiptRows(o), pieces = H.orderPieces(o);
    return {
      ref: ref,
      placedAt: o.placedAt || null,
      size: o.size, style: H.normStyle(o.style), pieces: R.n,
      set: H.setLabel(R.n), setName: R.n > 1 ? (o.setName || 'Custom set') : null,
      unitPrice: o.unitPrice || (R.n === 1 ? o.price : 0),
      items: R.rows.map(function (r, i) {
        var p = pieces[i] || {};
        return { name: p.imageName || r.name, imageId: p.imageId || null, isUpload: !!p.isUpload, fileKind: p.fileKind || null, fileName: p.fileName || null,
          size: o.size, style: H.normStyle(o.style), set: r.set, piece: r.piece, qty: r.qty, unit: r.unit, lineTotal: r.total };
      }),
      subtotal: R.subtotal, discount: R.discount, total: R.total,
      delivery: 'To be confirmed after order',
      customer: cust, utm: utm || undefined
    };
  };

  // Readable fields on the Paystack dashboard / receipt.
  H.paystackFields = function (o, meta, ref) {
    var items = meta.lines
      ? meta.lines.map(function (l) { return (l.qty > 1 ? l.qty + '× ' : '') + l.items.map(function (i) { return i.name; }).join(' + ') + ' (' + l.size + '", ' + l.style + ')'; }).join('; ')
      : meta.items.map(function (i) { return i.name; }).join(', ') + ' (' + meta.size + '", ' + meta.style + ', ' + meta.set + ')';
    var f = [
      { display_name: 'Order', variable_name: 'order_ref', value: ref },
      { display_name: 'Customer', variable_name: 'customer', value: (o.name || '') + ' · ' + (o.phone || '') },
      { display_name: 'Items', variable_name: 'items', value: items.slice(0, 480) }
    ];
    if (meta.lines) f.push({ display_name: 'Delivery', variable_name: 'delivery', value: H.formatNaira(meta.deliveryFee) + ' · ' + (o.state || '') });
    var camp = H.utmSummary ? H.utmSummary(meta.utm) : '';
    if (camp) f.push({ display_name: 'Campaign', variable_name: 'campaign', value: camp });
    return f;
  };

  H.renderReceipt = function (root, o, opts) {
    opts = opts || {};
    o = o || {};
    if (o.style) o.style = H.normStyle(o.style);
    root.textContent = '';
    root.classList.add('receipt');
    var st = STATUS[opts.status] || STATUS.pending;

    // Header
    var head = el('div', 'rc-head');
    var brand = el('div', 'rc-brand'); brand.append('HANGA', el('span', null, '.'));
    head.append(brand, el('div', 'rc-addr rc-tagline', 'Make your wall speak.'));
    root.appendChild(head);

    // Reference
    var refBox = el('div', 'rc-ref');
    refBox.appendChild(el('div', 'rc-label', 'Order reference'));
    var refRow = el('div', 'rc-ref-row');
    var refVal = el('div', 'rc-ref-val', opts.ref || '—');
    refVal.id = 'rcRef';
    var copy = el('button', 'rc-copy no-print', 'Copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy order reference');
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = 'Copied ✓'; setTimeout(function () { copy.textContent = 'Copy'; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(opts.ref || '').then(done, function () {});
      else { var r = document.createRange(); r.selectNodeContents(refVal); var s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); done(); } catch (e) {} }
    });
    refRow.append(refVal, copy);
    refBox.appendChild(refRow);
    var meta = el('dl', 'rc-meta');
    function metaRow(k, v, cls) { var d = el('div', cls || null); d.append(el('dt', null, k), el('dd', null, v)); meta.appendChild(d); return d; }
    metaRow('Date', fmtDate(opts.date ? new Date(opts.date) : new Date()));
    var sRow = metaRow('Status', st.text, 'rc-status ' + st.cls);
    if (opts.status === 'paid' && opts.paystackRef) metaRow('Paystack ref', opts.paystackRef);
    refBox.appendChild(meta);
    if (st.note) refBox.appendChild(el('p', 'rc-status-note', st.note));
    root.appendChild(refBox);

    if (!o.price) {
      root.appendChild(el('p', 'rc-empty', 'Order details are not saved on this device. Quote your order reference and we will look it up.'));
      return;
    }

    // Items
    var R = H.receiptRows(o);
    var table = el('table', 'rc-items');
    var cap = el('caption', 'rc-label', 'Items'); table.appendChild(cap);
    var thead = el('thead'), htr = el('tr');
    [['Item', ''], ['Size', 'rc-col-x'], ['Style', 'rc-col-x'], ['Set', 'rc-col-x'], ['Qty', 'rc-num'], ['Unit', 'rc-num'], ['Total', 'rc-num']].forEach(function (c) {
      var th = el('th', c[1], c[0]); th.scope = 'col'; htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead);
    var tb = el('tbody');
    R.rows.forEach(function (r) {
      var tr = el('tr');
      var td = el('td', 'rc-item');
      td.appendChild(el('span', 'rc-item-name', r.name));
      td.appendChild(el('span', 'rc-item-sub', [r.size, r.style, r.set + (r.piece ? ' · ' + r.piece : '')].join(' · ')));
      tr.appendChild(td);
      tr.appendChild(el('td', 'rc-col-x', r.size));
      tr.appendChild(el('td', 'rc-col-x', r.style.replace(' (no frame)', '')));
      tr.appendChild(el('td', 'rc-col-x', r.set + (r.piece ? ' · ' + r.piece.replace('Frame ', '#').replace(' of ', '/') : '')));
      tr.appendChild(el('td', 'rc-num', String(r.qty)));
      tr.appendChild(el('td', 'rc-num', r.unit ? H.formatNaira(r.unit) : '—'));
      tr.appendChild(el('td', 'rc-num', r.total ? H.formatNaira(r.total) : '—'));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    root.appendChild(table);

    // Totals
    var tot = el('dl', 'rc-totals');
    function tRow(k, v, cls) { var d = el('div', cls || null); d.append(el('dt', null, k), el('dd', null, v)); tot.appendChild(d); }
    tRow('Subtotal', H.formatNaira(R.subtotal));
    if (R.discount) tRow(R.discountLabel, '−' + H.formatNaira(R.discount), 'rc-discount');
    tRow('Delivery', R.deliveryText);
    tRow('Total' + (opts.status === 'paid' ? ' paid' : ''), H.formatNaira(R.total), 'rc-grand');
    root.appendChild(tot);
    root.appendChild(el('p', 'rc-delivery-note', R.v === 2 ? 'Nationwide delivery within 3 business days.' : DELIVERY_LINE));

    // Customer
    var cust = el('div', 'rc-cust');
    cust.appendChild(el('div', 'rc-label', 'Customer'));
    var cdl = el('dl', 'rc-meta');
    [['Name', o.name], ['Phone', o.phone], ['Deliver to', [o.address, o.city, o.state].filter(Boolean).join(', ')], ['Notes', o.notes]]
      .forEach(function (p) { if (p[1]) { var d = el('div'); d.append(el('dt', null, p[0]), el('dd', null, p[1])); cdl.appendChild(d); } });
    cust.appendChild(cdl);
    root.appendChild(cust);

    root.appendChild(el('p', 'rc-foot', 'Thank you for choosing Hanga ✦ hangaframes.art'));
  };
})();
