/* Hanga — shared site settings and behaviour (loaded on every page).
 *
 * ── EDIT YOUR BUSINESS DETAILS HERE ─────────────────────────────────
 * Anything left empty is hidden on the site instead of showing a dead link.
 */
window.HANGA = {
  email: 'hello@hanga.ng',

  // TODO(owner): your WhatsApp number in international format, digits only,
  // e.g. '2348012345678'. Leave '' to hide every WhatsApp button and link.
  whatsappNumber: '',

  // TODO(owner): your Instagram handle without the @, e.g. 'hanga.ng'.
  instagramHandle: '',

  // TODO(owner): Paystack PUBLIC key (starts with pk_live_ or pk_test_).
  // Public keys are safe to put here; never put the secret key (sk_...) in this file.
  // While this is empty, card payment is hidden and orders are sent to you
  // as order requests that you confirm by WhatsApp or email.
  paystackPublicKey: '',

  // TODO(owner): the bank account customers should pay into.
  // The details below were already on the site but look like a placeholder
  // (account 2234567890). They stay hidden until you set confirmed: true.
  bank: {
    confirmed: false,
    bankName: 'Zenith Bank',
    accountName: 'Hanga Frames Ltd',
    accountNumber: '2234567890'
  }
};

(function () {
  var H = window.HANGA;

  H.formatNaira = function (n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); };

  H.whatsappLink = function (text) {
    if (!H.whatsappNumber) return '';
    return 'https://wa.me/' + H.whatsappNumber.replace(/\D/g, '') + (text ? '?text=' + encodeURIComponent(text) : '');
  };

  H.mailtoLink = function (subject, body) {
    return 'mailto:' + H.email + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
  };

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

  // ── Footer year ───────────────────────────────────────────────
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
