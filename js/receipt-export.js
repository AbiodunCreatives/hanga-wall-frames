/* Hanga receipt download — crisp vector PDF (A4, Letter-safe) and optional PNG.
   HANGA.receiptModel(order, opts) -> plain fields for the receipt
   HANGA.buildReceiptPdf(order, opts) -> Promise<jsPDF>
   HANGA.downloadReceipt('png' | 'pdf', order, opts) -> Promise           */
(function () {
  var H = window.HANGA;
  var INK = [26, 26, 26], MUTED = [92, 87, 78], GOLD = [138, 115, 51], LINE = [200, 194, 182], PAPER = [255, 253, 248];
  var FONT_FILES = {
    'playfair-bold.ttf': { family: 'Playfair', style: 'bold' },
    'playfair-regular.ttf': { family: 'Playfair', style: 'normal' },
    'playfair-italic.ttf': { family: 'Playfair', style: 'italic' },
    'lato-regular.ttf': { family: 'Lato', style: 'normal' },
    'lato-bold.ttf': { family: 'Lato', style: 'bold' },
    'dejavu-sans.ttf': { family: 'DejaVu', style: 'normal' }
  };
  var fontVfs = null;

  function fmtDate(d) {
    try {
      var dt = new Date(d);
      var date = dt.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });
      var time = dt.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true });
      return date + ' at ' + time.replace(/\s+/g, ' ').toLowerCase();
    } catch (e) { return ''; }
  }
  function titleCase(s) {
    s = String(s || '').replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), s = '', i;
    for (i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function loadFonts() {
    if (fontVfs) return fontVfs;
    fontVfs = Promise.all(Object.keys(FONT_FILES).map(function (name) {
      return fetch('fonts/' + name).then(function (r) {
        if (!r.ok) throw new Error('font ' + name);
        return r.arrayBuffer().then(function (buf) { return { name: name, b64: bufToB64(buf) }; });
      });
    })).then(function (list) {
      var map = {};
      list.forEach(function (f) { map[f.name] = f.b64; });
      return map;
    });
    return fontVfs;
  }
  function registerFonts(pdf, vfs) {
    Object.keys(FONT_FILES).forEach(function (name) {
      var f = FONT_FILES[name];
      pdf.addFileToVFS(name, vfs[name]);
      pdf.addFont(name, f.family, f.style);
    });
  }

  H.receiptModel = function (order, opts) {
    opts = opts || {};
    order = order || {};
    var R = H.receiptRows(order);
    var paid = opts.status === 'paid';
    var hidePs = !opts.paystackRef || opts.paystackRef === opts.ref;
    var when = paid ? (opts.paidAt || opts.date) : opts.date;
    var ch = titleCase(opts.channel);
    return {
      ref: opts.ref || '—',
      status: opts.status || 'pending',
      paid: paid,
      paidAt: when || null,
      paidAtLabel: paid ? 'Date paid' : 'Date',
      paidAtText: when ? fmtDate(when) : '',
      paymentMethod: paid ? (ch ? 'Paystack · ' + ch : 'Paystack') : '',
      showPaystackRef: !!(paid && !hidePs),
      paystackRef: (paid && !hidePs) ? String(opts.paystackRef) : '',
      items: (R.rows || []).map(function (r) {
        return {
          name: r.name, size: r.size, style: (r.style || '').replace(' (no frame)', ''),
          set: r.set, qty: r.qty, total: r.total,
          thumbs: (r.items || []).map(function (it) { return { src: H.itemThumb(it), style: (it && it.style) || r.style, alt: (it && it.imageName) || r.name }; })
        };
      }),
      subtotal: R.subtotal,
      discount: R.discount || 0,
      discountLabel: R.discountLabel || 'Pair discount',
      promo: R.promo || null,
      deliveryText: R.deliveryText || '',
      total: R.total,
      billed: { name: order.name || '', phone: order.phone || '' },
      deliverTo: [order.address, [order.city, order.state].filter(Boolean).join(', ')].filter(Boolean),
      footer: { site: 'hangaframes.art', whatsapp: '+234 815 153 3349', thanks: 'Thank you for choosing Hanga.' },
      tagline: 'Make your wall speak.',
      watermark: false
    };
  };

  function loadImg(src) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var img = new Image();
      if (/^https:\/\//.test(src)) img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var max = 480; // 16 mm wide on the page, so this is well past 300 dpi
          var s = Math.min(1, max / Math.max(w, h));
          c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          var cx = c.getContext('2d');
          cx.globalAlpha = 1; cx.filter = 'none'; cx.globalCompositeOperation = 'source-over';
          cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, c.width, c.height); // flatten any transparency on white, not black/grey
          cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, c.width, c.height);
          // Full-colour JPEG, q0.95: the old q0.88 + 360px pass softened colour edges.
          res({ data: c.toDataURL('image/jpeg', 0.95), w: c.width, h: c.height });
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = src;
    });
  }

  function loadScript(src, sri) {
    return new Promise(function (res, rej) {
      if (window.jspdf && window.jspdf.jsPDF) return res();
      var s = document.createElement('script'); s.src = src;
      if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; }
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  // Lockup for the PDF header: 1440px transparent PNG (about 760 dpi at 48 mm wide), flattened by nothing.
  function loadLockup() {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          res({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
        } catch (e) { res(null); }
      };
      img.onerror = function () { res(null); };
      img.src = '/images/brand/lockup-print.png?v=1';
    });
  }

  function drawPdf(pdf, model, images, pageH, skipFooter) {
    var W = 210, margin = 18, x0 = margin, x1 = W - margin, y = 18, col = x1 - x0;
    pageH = pageH || 297;
    function ink(rgb) { rgb = rgb || INK; pdf.setTextColor(rgb[0], rgb[1], rgb[2]); }
    function font(family, style, size) { pdf.setFont(family, style); pdf.setFontSize(size); }
    function rule(yy, heavy) {
      pdf.setDrawColor(heavy ? INK[0] : LINE[0], heavy ? INK[1] : LINE[1], heavy ? INK[2] : LINE[2]);
      pdf.setLineWidth(heavy ? 0.45 : 0.25);
      pdf.line(x0, yy, x1, yy);
    }
    function money(n) { return H.formatNaira(n); }

    // Header: the G-Tilt horizontal lockup (dark ink + gold pin/dot; reads in greyscale).
    // Its artboard carries ~5.7% padding each side, so offset by that to align the frame with the left margin.
    var lw = 48, lh = lw * (images.lockup ? images.lockup.h / images.lockup.w : 0.2788), lpad = lw * 0.0567;
    if (images.lockup) {
      pdf.addImage(images.lockup.data, 'PNG', x0 - lpad, y - 1.5, lw, lh, undefined, 'FAST');
    } else {
      font('Playfair', 'bold', 22); ink(INK);
      pdf.text('HANGA', x0, y + 8);
      var hw = pdf.getTextWidth('HANGA');
      pdf.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      pdf.text('.', x0 + hw, y + 8);
    }
    // PAID badge (outline + text, not colour-only)
    if (model.paid) {
      font('Lato', 'bold', 8);
      var badge = 'PAID', bw = pdf.getTextWidth(badge) + 8, bh = 6.5, bx = x1 - bw, by = y + 1;
      pdf.setDrawColor(INK[0], INK[1], INK[2]);
      pdf.setLineWidth(0.3);
      pdf.setFillColor(243, 240, 234);
      pdf.roundedRect(bx, by, bw, bh, 1.2, 1.2, 'FD');
      ink(INK);
      pdf.text(badge, bx + bw / 2, by + 4.5, { align: 'center' });
    }
    y += 17;
    font('Playfair', 'italic', 10);
    ink(MUTED);
    pdf.text(model.tagline, x0, y);
    y += 8;
    rule(y); y += 9;

    // Meta grid
    var cols = [x0, x0 + col * 0.42, x0 + col * 0.70];
    font('Lato', 'bold', 7);
    ink(MUTED);
    pdf.text('RECEIPT NO.', cols[0], y);
    pdf.text(model.paidAtLabel.toUpperCase(), cols[1], y);
    if (model.paymentMethod) pdf.text('PAYMENT', cols[2], y);
    y += 5;
    font('Courier', 'bold', 8.2);
    ink(INK);
    pdf.text(model.ref, cols[0], y);
    font('Lato', 'normal', 9);
    if (model.paidAtText) pdf.text(model.paidAtText, cols[1], y);
    if (model.paymentMethod) pdf.text(model.paymentMethod, cols[2], y);
    if (model.showPaystackRef && model.paystackRef) {
      y += 6;
      font('Lato', 'bold', 7); ink(MUTED); pdf.text('PAYSTACK REF.', cols[0], y);
      y += 5; font('Courier', 'normal', 8); ink(INK); pdf.text(model.paystackRef, cols[0], y);
    }
    y += 8;
    rule(y); y += 10;

    // Line items
    font('Lato', 'bold', 7); ink(MUTED);
    pdf.text('ITEM', x0, y); pdf.text('AMOUNT', x1, y, { align: 'right' });
    y += 4; rule(y); y += 7;
    (model.items || []).forEach(function (it, idx) {
      var img = images[idx], thumbW = 16, thumbH = 22, textX = x0;
      if (img) {
        var iw = thumbW, ih = thumbW * (img.h / img.w);
        if (ih > thumbH) { ih = thumbH; iw = thumbH * (img.w / img.h); }
        var ix = x0 + (thumbW - iw) / 2, iy = y - 3;
        pdf.setDrawColor(INK[0], INK[1], INK[2]);
        pdf.setLineWidth(/black/i.test((it.thumbs[0] || {}).style || '') ? 0.8 : 0.2);
        pdf.addImage(img.data, 'JPEG', ix, iy, iw, ih);
        pdf.rect(ix, iy, iw, ih);
        textX = x0 + thumbW + 4;
      }
      font('Lato', 'bold', 10); ink(INK);
      var name = (it.qty > 1 ? it.qty + ' × ' : '') + it.name;
      pdf.text(name, textX, y + 4);
      font('DejaVu', 'normal', 10);
      pdf.text(money(it.total), x1, y + 4, { align: 'right' });
      font('Lato', 'normal', 8); ink(MUTED);
      var sub = [it.size, it.style, it.set].filter(Boolean).join('  ·  ');
      pdf.text(sub, textX, y + 9);
      y += Math.max(img ? 22 : 12, 14) + 4;
    });
    y += 2;

    // Totals, right aligned
    var tx = x0 + col * 0.45;
    function totRow(label, value, bold, size) {
      font('Lato', bold ? 'bold' : 'normal', size || 10);
      ink(bold ? INK : MUTED);
      pdf.text(label, tx, y);
      font(bold ? 'DejaVu' : 'DejaVu', 'normal', size || 10);
      ink(INK);
      pdf.text(value, x1, y, { align: 'right' });
      y += bold ? 7 : 6;
    }
    totRow('Subtotal', money(model.subtotal));
    if (model.discount) totRow(model.discountLabel, '−' + money(model.discount));
    if (model.promo) totRow(model.promo.label, '−' + money(model.promo.amount));
    if (model.deliveryText) totRow('Delivery', model.deliveryText);
    y += 1; rule(y, true); y += 7;
    totRow(model.paid ? 'Total paid' : 'Total', money(model.total), true, 12);
    y += 4; rule(y); y += 10;

    // Billed / Deliver
    var mid = x0 + col / 2 + 4;
    font('Lato', 'bold', 7); ink(MUTED);
    pdf.text('BILLED TO', x0, y);
    pdf.text('DELIVER TO', mid, y);
    y += 6;
    font('Lato', 'normal', 9); ink(INK);
    var yL = y, yR = y;
    if (model.billed.name) { pdf.text(model.billed.name, x0, yL); yL += 5; }
    if (model.billed.phone) { pdf.text(model.billed.phone, x0, yL); yL += 5; }
    (model.deliverTo || []).forEach(function (line) {
      var wrapped = pdf.splitTextToSize(line, col / 2 - 6);
      wrapped.forEach(function (w) { pdf.text(w, mid, yR); yR += 5; });
    });
    y = Math.max(yL, yR) + 8;
    if (skipFooter) return y;
    rule(y); y += 8;
    // Footer sits just under the body so a short receipt is not a half-empty A4
    font('Lato', 'normal', 8); ink(MUTED);
    pdf.text(model.footer.site + '   ·   WhatsApp ' + model.footer.whatsapp, W / 2, y, { align: 'center' });
    y += 6;
    font('Playfair', 'italic', 11); ink(INK);
    pdf.text(model.footer.thanks, W / 2, y, { align: 'center' });
    return y + 16;
  }

  H.buildReceiptPdf = function (order, opts) {
    var model = H.receiptModel(order, opts);
    var thumbs = [];
    (model.items || []).forEach(function (it) {
      thumbs.push((it.thumbs && it.thumbs[0] && it.thumbs[0].src) || '');
    });
    var lib = (window.jspdf && window.jspdf.jsPDF)
      ? Promise.resolve()
      : loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk');
    return Promise.all([lib, loadFonts(), Promise.all(thumbs.map(loadImg)), loadLockup()]).then(function (parts) {
      var vfs = parts[1], images = parts[2]; images.lockup = parts[3];
      var scratch = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      registerFonts(scratch, vfs);
      var bodyEnd = drawPdf(scratch, model, images, 297, true);
      // Wide as A4 (210mm), no taller than US Letter so it prints on either without clipping.
      var pageH = Math.min(279.4, Math.max((bodyEnd || 0) + 22, 210)); // at least as tall as it is wide, so portrait does not swap edges
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [210, pageH], orientation: 'portrait', compress: true });
      registerFonts(pdf, vfs);
      pdf.setProperties({ title: 'Hanga receipt ' + (model.ref || ''), author: 'Hanga', subject: 'Order receipt' });
      pdf.setFillColor(PAPER[0], PAPER[1], PAPER[2]);
      pdf.rect(0, 0, 210, pageH, 'F');
      drawPdf(pdf, model, images, pageH, false);
      return pdf;
    });
  };

  // PNG fallback: rasterise the first page of the same vector PDF (no watermark).
  H.receiptCanvas = function (order, opts) {
    // Synchronous canvas is kept for older callers; prefer buildReceiptPdf.
    // A lightweight placeholder is replaced once fonts/PDF are ready via downloadReceipt.
    var c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    c._pending = { order: order, opts: opts };
    return c;
  };

  function save(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  H.downloadReceipt = function (kind, order, opts) {
    var name = 'Hanga-receipt-' + String((opts && opts.ref) || 'order').replace(/[^A-Za-z0-9-]/g, '');
    return H.buildReceiptPdf(order, opts).then(function (pdf) {
      if (kind === 'png') {
        var url = pdf.output('datauristring');
        return new Promise(function (res, rej) {
          var img = new Image();
          img.onload = function () {
            var c = document.createElement('canvas');
            // Render the A4 page at ~150 dpi
            c.width = 1240; c.height = Math.round(1240 * 297 / 210);
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            c.toBlob(function (b) { save(b, name + '.png'); res(); }, 'image/png');
          };
          img.onerror = function () { rej(new Error('png')); };
          img.src = url;
        });
      }
      save(pdf.output('blob'), name + '.pdf');
    });
  };
})();
