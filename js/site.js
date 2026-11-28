/* Hanga — shared site settings and behaviour (loaded on every page).
 *
 * ── EDIT YOUR BUSINESS DETAILS HERE ─────────────────────────────────
 * Anything left empty is hidden on the site instead of showing a dead link.
 */
window.HANGA = {
  email: 'hangaframes@gmail.com',

  // TODO(owner): your WhatsApp number in international format, digits only,
  // e.g. '2348012345678'. Leave '' to hide every WhatsApp button and link.
  whatsappNumber: '2348151533349',

  // TODO(owner): your Instagram handle without the @, e.g. 'hanga.ng'.
  instagramHandle: 'hangaframes_',

  // TODO(owner): Paystack PUBLIC key (starts with pk_live_ or pk_test_).
  // Public keys are safe to put here; never put the secret key (sk_...) in this file.
  // You can ALSO (preferably) set it in Vercel as the env var PAYSTACK_PUBLIC_KEY;
  // the receipt page reads it from /api/config. While neither is set, the
  // "Pay with Paystack" button stays hidden and customers order on WhatsApp/email.
  // See SETUP-PAYSTACK.md.
  paystackPublicKey: '',

  // Pairs: naira taken off the WHOLE pair (per-frame price × pieces).
  // Single frames get no discount. Change the numbers here to change every
  // price on the site (builder, checkout, confirmation, order messages).
  setDiscounts: { 2: 500 }
};

(function () {
  var H = window.HANGA;

  // ── First-touch campaign (UTM) capture — first-party only ────
  // Saved once per tab session in sessionStorage.hangaUtm the first time a
  // page is opened with at least one utm_* parameter; never overwritten after
  // that. Attribution only: it is copied into the order / Paystack metadata
  // and never affects the price. No third-party tags, no cookies.
  var UTM_KEY = 'hangaUtm', UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'], CLICK_IDS = ['gclid', 'fbclid'];
  H.UTM_FIELDS = UTM_FIELDS;
  // One line of plain text: no control chars, no HTML-ish characters, capped.
  H.cleanUtm = function (v, max) {
    return String(typeof v === 'string' || typeof v === 'number' ? v : '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/[<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 200);
  };
  H.normUtm = function (u) {
    if (!u || typeof u !== 'object') return null;
    var out = {}, any = false;
    UTM_FIELDS.forEach(function (k) { var v = H.cleanUtm(u[k]); if (v) { out[k] = v; any = true; } });
    if (!any) return null;
    CLICK_IDS.forEach(function (k) { var v = H.cleanUtm(u[k]); if (v) out[k] = v; });
    var lp = H.cleanUtm(u.landing_path, 300); if (lp) out.landing_path = lp;
    var at = H.cleanUtm(u.capturedAt, 40); if (at) out.capturedAt = at;
    return out;
  };
  H.captureUtm = function (search, path) {
    try {
      if (sessionStorage.getItem(UTM_KEY)) return false; // first touch wins
      var q = new URLSearchParams(search == null ? location.search : search), raw = {};
      UTM_FIELDS.concat(CLICK_IDS).forEach(function (k) { raw[k] = q.get(k); });
      raw.landing_path = (path == null ? location.pathname : path) + (search == null ? location.search : search);
      raw.capturedAt = new Date().toISOString();
      var rec = H.normUtm(raw);
      if (!rec) return false; // no utm_* on this view: write nothing
      sessionStorage.setItem(UTM_KEY, JSON.stringify(rec));
      return true;
    } catch (e) { return false; }
  };
  H.getUtm = function () {
    try { return H.normUtm(JSON.parse(sessionStorage.getItem(UTM_KEY) || 'null')); } catch (e) { return null; }
  };
  // "instagram / social / detty_december_2026 / bio" (empty parts skipped)
  H.utmSummary = function (u) {
    u = H.normUtm(u);
    if (!u) return '';
    return ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].map(function (k) { return u[k]; }).filter(Boolean).join(' / ').slice(0, 200);
  };
  H.captureUtm();

  H.formatNaira = function (n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); };

  // ── Sets: Single (1) / Pair (2) ─────────────────────────────
  H.setLabel = function (n) { return ({ 1: 'Single', 2: 'Pair' })[n] || (n > 1 ? n + ' frames' : 'Single'); };
  H.setDiscount = function (n) { return n > 1 ? Number((H.setDiscounts || {})[n] || 0) : 0; };
  H.setTotal = function (perFrame, n) { n = n || 1; return Math.max(0, Number(perFrame || 0) * n - H.setDiscount(n)); };

  // Normalise a saved order (old single-frame orders had no `items`).
  H.orderPieces = function (o) {
    o = o || {};
    if (o.items && o.items.length) return o.items;
    return o.imageName ? [{ imageId: o.imageId, imageName: o.imageName, isUpload: !!o.isUpload }] : [];
  };
  // One source of truth for frame styles: 'Black' | 'White' | 'Borderless'.
  // Accepts any casing / older values ('borderless', 'none', 'No frame').
  H.normStyle = function (style) {
    var s = String(style || '').trim().toLowerCase();
    if (/borderless|no ?frame|none|frameless/.test(s)) return 'Borderless';
    if (s.indexOf('white') === 0) return 'White';
    return 'Black';
  };
  H.styleText = function (style) { style = H.normStyle(style); return style === 'Borderless' ? 'Borderless (no frame)' : style + ' frame'; };
  // CSS class that draws thumbnails with the right frame (or none)
  H.styleClass = function (style) { return 'fstyle-' + H.normStyle(style).toLowerCase(); };

  // Plain-text lines describing an order, used in WhatsApp / email messages.
  H.uploadNote = function (p) {
    if (!p || !p.isUpload) return '';
    return p.fileKind === 'pdf' ? ' (my own PDF: ' + (p.fileName || p.imageName) + ')' : ' (my own photo' + (p.fileName ? ': ' + p.fileName : '') + ')';
  };
  H.orderLines = function (o) {
    var pieces = H.orderPieces(o), n = o.pieces || pieces.length || 1, lines = [];
    var unit = o.unitPrice || (n === 1 ? o.price : 0);
    if (n > 1) {
      lines.push('• ' + (o.setName ? o.setName + ' — ' : '') + H.setLabel(n) + ' (' + n + ' frames, sent together)');
      pieces.forEach(function (p, i) { lines.push('   Frame ' + (i + 1) + ': ' + p.imageName + H.uploadNote(p)); });
    } else if (pieces[0]) {
      lines.push('• Image: ' + pieces[0].imageName + H.uploadNote(pieces[0]));
    }
    lines.push('• Size: ' + (o.size ? o.size + '"' + (n > 1 ? ' each' : '') : '—'));
    lines.push('• Style: ' + H.styleText(o.style));
    if (n > 1 && unit) {
      lines.push('• Frames: ' + n + ' × ' + H.formatNaira(unit) + ' = ' + H.formatNaira(unit * n));
      var d = o.discount != null ? o.discount : H.setDiscount(n);
      if (d) lines.push('• ' + H.setLabel(n) + ' saving: −' + H.formatNaira(d));
    }
    lines.push('• Total: ' + H.formatNaira(o.price) + ' + delivery (' + H.DELIVERY_SUMMARY + ')');
    return lines;
  };

  H.whatsappLink = function (text) {
    if (!H.whatsappNumber) return '';
    return 'https://wa.me/' + H.whatsappNumber.replace(/\D/g, '') + (text ? '?text=' + encodeURIComponent(text) : '');
  };

  H.mailtoLink = function (subject, body) {
    return 'mailto:' + H.email + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
  };

  // ── One upload rule for the whole site (customizer, FAQ, schema) ──
  // PDF, JPG, PNG or WEBP; images up to 10 MB, PDFs up to 20 MB.
  H.UPLOAD = {
    imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    imageMaxMB: 10, pdfMaxMB: 20,
    accept: 'application/pdf,image/jpeg,image/png,image/webp',
    rule: 'PDF, JPG, PNG or WEBP — images up to 10 MB, PDFs up to 20 MB',
    heicHelp: "This iPhone photo is HEIC, which we can't read here. Upload it as a JPG: choose it from your Photos library (not the Files app) so your iPhone converts it, or set Settings › Camera › Formats to “Most Compatible”. You can also send the original on WhatsApp after you order."
  };
  H.isHeic = function (f) { return !!f && (/^image\/hei[cf](-sequence)?$/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || '')); };
  // → { ok, kind: 'pdf'|'image'|'heic', msg }
  H.checkUpload = function (f) {
    var U = H.UPLOAD, MB = 1024 * 1024;
    if (!f) return { ok: false, msg: 'No file selected.' };
    var isPdf = f.type === 'application/pdf' || (!f.type && /\.pdf$/i.test(f.name || '')) || (/\.pdf$/i.test(f.name || '') && f.type === 'application/octet-stream');
    if (isPdf) return f.size > U.pdfMaxMB * MB ? { ok: false, kind: 'pdf', msg: 'That PDF is too large. PDFs can be up to ' + U.pdfMaxMB + ' MB.' } : { ok: true, kind: 'pdf' };
    if (H.isHeic(f)) return { ok: false, kind: 'heic', msg: U.heicHelp };
    if (U.imageTypes.indexOf(f.type) === -1) return { ok: false, msg: 'Please upload a PDF, JPG, PNG or WEBP file (images up to ' + U.imageMaxMB + ' MB, PDFs up to ' + U.pdfMaxMB + ' MB).' };
    if (f.size > U.imageMaxMB * MB) return { ok: false, kind: 'image', msg: 'That image is too large. Images can be up to ' + U.imageMaxMB + ' MB (PDFs up to ' + U.pdfMaxMB + ' MB).' };
    return { ok: true, kind: 'image' };
  };

  // ── Delivery: flat fee by region (must match api/_lib.js) ───
  H.DELIVERY_REGIONS = [
    { key: 'south-west', label: 'South-West', fee: 2500,
      states: ['Lagos', 'Ogun', 'Oyo', 'Osun', 'Ondo', 'Ekiti'] },
    { key: 'east', label: 'East & South', fee: 4500,
      states: ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo', 'Akwa Ibom', 'Bayelsa', 'Cross River', 'Delta', 'Edo', 'Rivers'] },
    { key: 'north', label: 'North & FCT', fee: 6000,
      states: ['FCT (Abuja)', 'Benue', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Plateau', 'Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Sokoto', 'Zamfara'] }
  ];
  H.NG_STATES = H.DELIVERY_REGIONS.reduce(function (a, r) { return a.concat(r.states); }, []).sort(function (a, b) { return a.localeCompare(b); });
  H.DELIVERY_SUMMARY = '₦2,500 South-West · ₦4,500 East & South · ₦6,000 North & FCT · one fee per order';
  H.deliveryFor = function (state) {
    var s = String(state || '').trim().toLowerCase().replace(/\s*\(abuja\)$/, '');
    if (s === 'abuja') s = 'fct';
    for (var i = 0; i < H.DELIVERY_REGIONS.length; i++) {
      var r = H.DELIVERY_REGIONS[i];
      for (var j = 0; j < r.states.length; j++) {
        if (r.states[j].toLowerCase().replace(/\s*\(abuja\)$/, '') === s) return { region: r.key, label: r.label, fee: r.fee, state: r.states[j] };
      }
    }
    return null;
  };

  // ── Cart (localStorage) ─────────────────────────────────────
  // A cart line is one Single or one Pair:
  // { id, pieces, size, style, setName, unit, qty, items:[{ imageId, imageName, isUpload,
  //   fileKind, fileName, thumb, cloudinaryUrl, cloudinaryId, cloudinaryFailed }] }
  var CART_KEY = 'hangaCart', MAX_LINES = 10, MAX_QTY = 10;
  H.lineTotal = function (l) {
    var n = (l.items && l.items.length) || l.pieces || 1;
    return H.setTotal(l.unit, n) * Math.max(1, Number(l.qty) || 1);
  };
  H.lineName = function (l) {
    var items = l.items || [];
    if (items.length > 1) return (l.setName && l.setName !== 'Custom set' ? l.setName + ' — ' : '') + items.map(function (i) { return i.imageName; }).join(' + ');
    return items[0] ? items[0].imageName : 'Frame';
  };
  // DETTY26 automatic discount — display copy only. The server decides
  // whether it applies (dates, phone limit) via /api/promo and re-checks it
  // when the payment is verified; the browser never sets the amount itself.
  H.PROMO = { name: 'DETTY26', amount: 1000, minSubtotal: 13000, label: 'DETTY26 – ₦1,000 off' };
  // promoOn: the server said DETTY26 is running for this phone right now.
  H.cartTotals = function (lines, state, promoOn) {
    var gross = 0, discount = 0, frames = 0, count = 0;
    (lines || []).forEach(function (l) {
      var n = (l.items && l.items.length) || 1, q = Math.max(1, Number(l.qty) || 1);
      gross += Number(l.unit || 0) * n * q; discount += H.setDiscount(n) * q; frames += n * q; count += q;
    });
    var d = state ? H.deliveryFor(state) : null;
    var subtotal = gross - discount;
    var P = H.PROMO, promo = promoOn && subtotal >= P.minSubtotal ? P.amount : 0; // once per order
    return { gross: gross, discount: discount, subtotal: subtotal, frames: frames, count: count,
             promoDiscount: promo, promoShort: Math.max(0, P.minSubtotal - subtotal),
             delivery: d, deliveryFee: d ? d.fee : 0, total: subtotal - promo + (d ? d.fee : 0) };
  };
  H.cart = {
    load: function () {
      try { var c = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; }
    },
    save: function (lines) {
      lines = (lines || []).slice(0, MAX_LINES);
      try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); }
      catch (e) {
        // Over quota: drop the local photo previews (the file itself is on Cloudinary).
        lines.forEach(function (l) { (l.items || []).forEach(function (i) { if (i.isUpload) i.thumb = null; }); });
        try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch (e2) { return false; }
      }
      try { window.dispatchEvent(new CustomEvent('hanga:cart')); } catch (e3) {}
      return true;
    },
    add: function (line) {
      var lines = H.cart.load();
      if (lines.length >= MAX_LINES) return false;
      line.id = line.id || ('L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      line.qty = Math.min(MAX_QTY, Math.max(1, Number(line.qty) || 1));
      lines.push(line);
      return H.cart.save(lines);
    },
    remove: function (id) { H.cart.save(H.cart.load().filter(function (l) { return l.id !== id; })); },
    setQty: function (id, q) {
      var lines = H.cart.load();
      lines.forEach(function (l) { if (l.id === id) l.qty = Math.min(MAX_QTY, Math.max(1, Number(q) || 1)); });
      H.cart.save(lines);
    },
    clear: function () { try { localStorage.removeItem(CART_KEY); } catch (e) {} try { window.dispatchEvent(new CustomEvent('hanga:cart')); } catch (e3) {} },
    count: function () { return H.cart.load().reduce(function (a, l) { return a + (Math.max(1, Number(l.qty) || 1)); }, 0); },
    MAX_QTY: MAX_QTY, MAX_LINES: MAX_LINES
  };

  // Cart icon + count badge in every header (and the mobile header bar).
  (function () {
    var header = document.querySelector('body > header');
    if (!header || header.querySelector('.cart-link')) return;
    var a = document.createElement('a');
    a.href = 'checkout.html'; a.className = 'cart-link';
    a.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.2L20.6 8H6.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor"/><circle cx="17" cy="19.5" r="1.4" fill="currentColor"/></svg><span class="cart-badge" hidden></span>';
    var toggleBtn = header.querySelector('.nav-toggle');
    if (toggleBtn) header.insertBefore(a, toggleBtn); else header.appendChild(a);
    function sync() {
      var n = H.cart.count(), b = a.querySelector('.cart-badge');
      b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n;
      a.setAttribute('aria-label', n ? 'Cart, ' + n + ' item' + (n === 1 ? '' : 's') : 'Cart is empty');
      a.classList.toggle('has-items', !!n);
    }
    sync();
    window.addEventListener('hanga:cart', sync);
    window.addEventListener('storage', function (e) { if (e.key === CART_KEY) sync(); });
    window.addEventListener('pageshow', sync);
  })();

  // Paystack payer email: the customer's own if valid, else a placeholder.
  H.validEmail = function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); };
  // Nigerian mobile: 080…, 070…, 090…, 081…, +234…, 234…
  H.normPhone = function (p) { return String(p || '').replace(/[\s\-().]/g, ''); };
  H.validPhone = function (p) { return /^(\+?234|0)[789][01]\d{8}$/.test(H.normPhone(p)); };

  // ── Featured Makers "get featured" CTA ──────────────────────
  document.querySelectorAll('[data-makers-wa]').forEach(function (a) {
    var link = H.whatsappLink("Hi Hanga! I'm a frame maker / artist and I'd love to be listed in Featured Makers. Here's a bit about my work: ");
    if (link) a.href = link; else a.hidden = true;
  });
  document.querySelectorAll('[data-makers-mail]').forEach(function (a) {
    if (H.email) { a.href = H.mailtoLink('Featured Makers — I would like to be featured', "Hi Hanga,\n\nI'm a frame maker / artist and I'd love to be listed in Featured Makers.\n\nName:\nCity:\nInstagram / portfolio:\n"); a.textContent = 'or email ' + H.email; }
  });

  // ── Mobile menu ──────────────────────────────────────────────
  var toggle = document.getElementById('navToggle');
  var drawer = document.getElementById('navDrawer');
  if (toggle && drawer) {
    var setOpen = function (open) {
      drawer.classList.toggle('open', open);
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', function () { setOpen(!drawer.classList.contains('open')); });
    drawer.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  // ── Contact links (footer etc.) ──────────────────────────────
  document.querySelectorAll('[data-contact]').forEach(function (el) {
    var kind = el.getAttribute('data-contact');
    var href = '';
    if (kind === 'whatsapp') href = H.whatsappLink('Hi Hanga! I have a question about a frame.');
    if (kind === 'instagram' && H.instagramHandle) href = 'https://instagram.com/' + H.instagramHandle.replace(/^@/, '');
    if (kind === 'email') href = 'mailto:' + H.email;
    var item = el.closest('li') || el;
    if (!href) { item.hidden = true; return; }
    el.href = href;
    if (kind !== 'email') { el.target = '_blank'; el.rel = 'noopener'; }
  });

  // Elements that only make sense when a contact channel is configured
  document.querySelectorAll('[data-show-if]').forEach(function (el) {
    var need = el.getAttribute('data-show-if');
    var ok = (need === 'whatsapp' && H.whatsappNumber) || (need === 'instagram' && H.instagramHandle);
    el.hidden = !ok;
  });

  // ── Keyboard support for clickable tiles that are not buttons ─
  H.makePressable = function (el, label) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  };

  // ── Filter chips: active state, keep the chosen chip in view, edge fades ──
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function updateFilterFades(wrap, scroller) {
    if (!wrap || !scroller) return;
    var max = scroller.scrollWidth - scroller.clientWidth;
    var overflow = max > 2;
    wrap.classList.toggle('is-overflow-start', overflow && scroller.scrollLeft > 2);
    wrap.classList.toggle('is-overflow-end', overflow && (max - scroller.scrollLeft) > 2);
  }
  function scrollChipIntoView(chip) {
    if (!chip || !chip.scrollIntoView) return;
    try {
      chip.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'instant' : 'smooth'
      });
    } catch (e) { chip.scrollIntoView(); }
  }
  document.querySelectorAll('.gallery-filters').forEach(function (group) {
    var chips = group.querySelectorAll('.filter-chip');
    var wrap = group.closest('[data-filter-scroll]') || group.parentElement;
    var sync = function () {
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.classList.contains('active'))); });
    };
    sync();
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        setTimeout(function () {
          sync();
          var active = group.querySelector('.filter-chip.active');
          if (active) scrollChipIntoView(active);
          updateFilterFades(wrap, group);
        }, 0);
      });
    });
    group.addEventListener('scroll', function () { updateFilterFades(wrap, group); }, { passive: true });
    window.addEventListener('resize', function () { updateFilterFades(wrap, group); });
    try { group.scrollLeft = 0; } catch (e) {}
    updateFilterFades(wrap, group);
  });

  // ── Mobile keyboard handling ─────────────────────────────────
  // Hide floating bottom bars while a field is focused / the keyboard is up,
  // and keep the focused field centred in the visible area so users see what they type.
  (function () {
    var root = document.documentElement, vv = window.visualViewport, active = null, t;
    function isField(el) {
      return el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
        (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range|color|hidden)$/i.test(el.type)));
    }
    function reveal() {
      if (!active || document.activeElement !== active) return;
      var top = active.getBoundingClientRect().top, h = vv ? vv.height : window.innerHeight;
      var bottom = active.getBoundingClientRect().bottom;
      if (top < 80 || bottom > h - 16) {
        try { active.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { active.scrollIntoView(); }
      }
    }
    function sync() {
      var kb = vv ? (window.innerHeight - vv.height > 120) : false;
      root.classList.toggle('kb-open', !!(active || kb));
    }
    document.addEventListener('focusin', function (e) {
      if (!isField(e.target)) return;
      active = e.target; sync();
      clearTimeout(t); t = setTimeout(reveal, 300);
    });
    document.addEventListener('focusout', function () {
      setTimeout(function () { if (!isField(document.activeElement)) { active = null; sync(); } }, 50);
    });
    if (vv) vv.addEventListener('resize', function () { sync(); clearTimeout(t); t = setTimeout(reveal, 120); });
  })();

  // ── Deep links to an FAQ answer (e.g. index.html#faq-returns) open it ──
  function openHashDetails() {
    var id = (location.hash || '').slice(1), d = id && document.getElementById(id);
    if (d && d.tagName === 'DETAILS') d.open = true;
  }
  openHashDetails();
  window.addEventListener('hashchange', openHashDetails);
  // Text the delivery rules wherever a page asks for them (one shared string).
  document.querySelectorAll('[data-delivery-summary]').forEach(function (el) { el.textContent = H.DELIVERY_SUMMARY; });

  // Christmas order cut-off (confirmed): Friday 18 December 2026, Africa/Lagos.
  // Shown through 18 Dec 23:59:59 Lagos; hidden from 19 Dec 00:00. Not a promo line.
  H.XMAS_CUTOFF = {
    label: 'Order by 18 Dec for Christmas delivery.',
    endMs: Date.parse('2026-12-19T00:00:00+01:00') // exclusive
  };
  H.nowMs = function () { return Date.now(); };
  H.xmasCutoffActive = function (ms) {
    ms = Number.isFinite(ms) ? ms : H.nowMs();
    return ms < H.XMAS_CUTOFF.endMs;
  };
  H.renderXmasCutoff = function () {
    var on = H.xmasCutoffActive(), label = H.XMAS_CUTOFF.label;
    document.querySelectorAll('[data-xmas-cutoff]').forEach(function (el) {
      el.textContent = on ? label : '';
      el.hidden = !on;
    });
  };
  H.renderXmasCutoff();

  // ── Footer year ───────────────────────────────────────────────
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
