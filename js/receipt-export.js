/* Hanga receipt download — draws the receipt on a <canvas> from the real
   order data (no screenshots of the page), then saves it as PNG or PDF.
   HANGA.receiptCanvas(order, {ref, status, paystackRef, date}) -> canvas
   HANGA.downloadReceipt('png' | 'pdf', order, opts) -> Promise           */
(function () {
  var H = window.HANGA;
  var W = 820, PAD = 56, S = 2;               // logical width, padding, pixel scale
  var INK = '#1a1a1a', MUTED = '#6b6458', GOLD = '#a8893e', LINE = '#e3dccf', PAPER = '#fffdf8';
  var SERIF = '"Playfair Display", Georgia, serif', SANS = 'Lato, Arial, sans-serif', MONO = 'ui-monospace, Menlo, Consolas, monospace';

  function wrap(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function fmtDate(d) {
    try { return new Date(d).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  // Two passes: measure (draw=false) to get the height, then paint.
  function paint(ctx, order, opts, draw) {
    var R = H.receiptRows(order), y = PAD, x0 = PAD, x1 = W - PAD;
    var paid = opts.status === 'paid';
    function font(f) { ctx.font = f; }
    function text(t, x, yy, align, color) { if (!draw) return; ctx.fillStyle = color || INK; ctx.textAlign = align || 'left'; ctx.fillText(t, x, yy); }
    function rule(yy, dashed, color) {
      if (!draw) return; ctx.save(); ctx.strokeStyle = color || LINE; ctx.lineWidth = 1;
      if (dashed) ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.restore();
    }
    function row(label, value, opt) {
      opt = opt || {};
      font(opt.font || '400 15px ' + SANS); text(label, x0, y, 'left', opt.labelColor || MUTED);
      font(opt.vfont || opt.font || '400 15px ' + SANS); text(value, x1, y, 'right', opt.color || INK);
      y += opt.gap || 26;
    }

    // Brand header
    y += 30; font('700 40px ' + SERIF); text('HANGA', W / 2 - 8, y, 'center');
    if (draw) { ctx.fillStyle = GOLD; ctx.textAlign = 'left'; ctx.fillText('.', W / 2 - 8 + ctx.measureText('HANGA').width / 2, y); }
    y += 28; font('italic 400 17px ' + SERIF); text('Make your wall speak.', W / 2, y, 'center', MUTED);
    y += 26; rule(y, true);

    // Status badge
    y += 40;
    var badge = paid ? 'PAID' : (opts.status === 'failed' ? 'PAYMENT NOT COMPLETED' : 'PAYMENT PENDING');
    font('700 14px ' + SANS);
    var bw = ctx.measureText(badge).width + 36;
    if (draw) {
      ctx.fillStyle = paid ? '#e7f4ea' : '#fbf1dc';
      var bx = W / 2 - bw / 2, by = y - 22, bh = 32, r = 16;
      ctx.beginPath(); ctx.moveTo(bx + r, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, r); ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
      ctx.arcTo(bx, by + bh, bx, by, r); ctx.arcTo(bx, by, bx + bw, by, r); ctx.closePath(); ctx.fill();
    }
    text(badge, W / 2, y, 'center', paid ? '#1e6b34' : '#8a5a00');

    // Reference block
    y += 46; font('700 12px ' + SANS); text('ORDER REFERENCE', W / 2, y, 'center', MUTED);
    y += 34; font('700 30px ' + MONO); text(opts.ref || '—', W / 2, y, 'center');
    y += 34;
    if (opts.date) row('Date', fmtDate(opts.date));
    if (paid && opts.paystackRef) row('Paystack reference', opts.paystackRef, { vfont: '400 14px ' + MONO });
    if (paid && opts.paidAt) row('Paid at', fmtDate(opts.paidAt));
    y += 4; rule(y); y += 30;

    // Items
    font('700 12px ' + SANS); text('ITEM', x0, y, 'left', MUTED); text('AMOUNT', x1, y, 'right', MUTED);
    y += 14; rule(y); y += 28;
    R.rows.forEach(function (r) {
      font('700 16px ' + SANS);
      var lines = wrap(ctx, r.name, x1 - x0 - 140);
      lines.forEach(function (l, i) { text(l, x0, y, 'left'); if (i === 0) { font('700 16px ' + SANS); text(H.formatNaira(r.total), x1, y, 'right'); } y += 22; font('700 16px ' + SANS); });
      font('400 13px ' + SANS);
      var sub = [r.piece, r.size, r.style, r.set, r.qty > 1 ? r.qty + ' × ' + H.formatNaira(r.unit) : ''].filter(Boolean).join(' · ');
      wrap(ctx, sub, x1 - x0 - 140).forEach(function (l) { text(l, x0, y, 'left', MUTED); y += 19; });
      y += 10; rule(y - 4, true); y += 18;
    });

    // Totals
    y += 4;
    row('Subtotal', H.formatNaira(R.subtotal));
    if (R.discount) row(R.discountLabel, '−' + H.formatNaira(R.discount), { color: '#1e6b34' });
    row('Delivery', R.deliveryText);
    y += 4; if (draw) { ctx.fillStyle = INK; ctx.fillRect(x0, y - 14, x1 - x0, 2); }
    y += 22;
    row(paid ? 'TOTAL PAID' : 'TOTAL', H.formatNaira(R.total), { font: '700 22px ' + SANS, labelColor: INK, gap: 30 });
    font('400 13px ' + SANS); text(R.v === 2 ? 'Nationwide delivery within 3 business days.' : H.DELIVERY_LINE, x0, y, 'left', MUTED);
    y += 26; rule(y); y += 30;

    // Customer
    font('700 12px ' + SANS); text('CUSTOMER', x0, y, 'left', MUTED); y += 26;
    [['Name', order.name], ['Phone', order.phone], ['Delivery address', order.address],
     ['City / State', [order.city, order.state].filter(Boolean).join(', ')], ['Notes', order.notes]]
      .filter(function (r) { return r[1]; })
      .forEach(function (r) {
        font('400 14px ' + SANS); text(r[0], x0, y, 'left', MUTED);
        var lines = wrap(ctx, r[1], x1 - x0 - 190);
        lines.forEach(function (l) { font('400 14px ' + SANS); text(l, x1, y, 'right'); y += 21; });
        y += 4;
      });

    // Footer
    y += 10; rule(y, true); y += 34;
    font('italic 400 18px ' + SERIF); text('Thank you for choosing Hanga.', W / 2, y, 'center');
    y += 22; font('400 12px ' + SANS); text('hangaframes.art · Keep this receipt for your records.', W / 2, y, 'center', MUTED);
    return y + PAD;
  }

  H.receiptCanvas = function (order, opts) {
    var c = document.createElement('canvas'), ctx = c.getContext('2d');
    var h = paint(ctx, order, opts, false);
    c.width = W * S; c.height = Math.ceil(h * S);
    ctx = c.getContext('2d'); ctx.scale(S, S); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, h);
    // Gold double rule border
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.strokeRect(14, 14, W - 28, h - 28);
    ctx.lineWidth = 0.75; ctx.strokeRect(20, 20, W - 40, h - 40);
    // Faint watermark
    ctx.save(); ctx.translate(W / 2, h / 2); ctx.rotate(-Math.PI / 7); ctx.globalAlpha = 0.045;
    ctx.font = '700 150px ' + SERIF; ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText('HANGA', 0, 50); ctx.restore();
    paint(ctx, order, opts, true);
    return c;
  };

  function loadScript(src, sri) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; } s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function save(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  H.downloadReceipt = function (kind, order, opts) {
    var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return ready.then(function () {
      var c = H.receiptCanvas(order, opts), name = 'Hanga-receipt-' + String(opts.ref || 'order').replace(/[^A-Za-z0-9-]/g, '');
      if (kind === 'png') return new Promise(function (res) { c.toBlob(function (b) { save(b, name + '.png'); res(); }, 'image/png'); });
      var lib = window.jspdf ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk');
      return lib.then(function () {
        var wmm = 148, hmm = wmm * c.height / c.width;              // A5-width page, height to fit
        var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [wmm, hmm], orientation: 'portrait', compress: true });
        pdf.setProperties({ title: 'Hanga receipt ' + (opts.ref || ''), author: 'Hanga', subject: 'Order receipt' });
        pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wmm, hmm);
        save(pdf.output('blob'), name + '.pdf');
      });
    });
  };
})();
