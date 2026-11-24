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

  // Multi-frame sets: naira taken off the WHOLE set (per-frame price × pieces).
  // Single frames get no discount. Change the numbers here to change every
  // price on the site (builder, checkout, confirmation, order messages).
  setDiscounts: { 2: 500, 3: 1000 }
};

(function () {
  var H = window.HANGA;

  H.formatNaira = function (n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); };

  // ── Sets: Single (1) / Pair (2) / Trio (3) ───────────────────
  H.setLabel = function (n) { return ({ 1: 'Single', 2: 'Pair', 3: 'Trio' })[n] || 'Single'; };
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
    lines.push('• Total: ' + H.formatNaira(o.price) + ' + delivery');
    return lines;
  };

  H.whatsappLink = function (text) {
    if (!H.whatsappNumber) return '';
    return 'https://wa.me/' + H.whatsappNumber.replace(/\D/g, '') + (text ? '?text=' + encodeURIComponent(text) : '');
  };

  H.mailtoLink = function (subject, body) {
    return 'mailto:' + H.email + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
  };

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

  // ── Filter chips: expose the active chip to screen readers ───
  document.querySelectorAll('.gallery-filters').forEach(function (group) {
    var chips = group.querySelectorAll('.filter-chip');
    var sync = function () { chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.classList.contains('active'))); }); };
    sync();
    chips.forEach(function (c) { c.addEventListener('click', function () { setTimeout(sync, 0); }); });
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

  // ── Footer year ───────────────────────────────────────────────
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
