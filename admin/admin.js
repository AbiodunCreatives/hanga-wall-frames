/* Hanga Admin Dashboard — admin.js */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  var token        = '';
  var currentFilter = '';
  var currentPage   = 1;
  var searchTimer   = null;
  var allStats      = {};
  var drawerOrder   = null;

  // ── Storage ────────────────────────────────────────────────────
  var STORAGE_KEY = 'hangaAdminToken';
  function saveToken(t) { try { localStorage.setItem(STORAGE_KEY, t); } catch (e) {} token = t; }
  function loadToken()  { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; } }
  function clearToken() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} token = ''; }

  // ── Init ───────────────────────────────────────────────────────
  token = loadToken();

  // If token exists but is already expired, clear it immediately
  // so we show login rather than a broken empty dashboard.
  if (token) {
    var dot = token.indexOf('.');
    var expiry = dot > 0 ? parseInt(token.slice(0, dot), 10) : 0;
    if (!expiry || expiry < Date.now()) {
      clearToken();
      token = '';
    }
  }

  // Wire all static buttons via addEventListener (no onclick attributes)
  function wireStaticButtons() {
    // Hamburger
    var tog = document.getElementById('sidebarToggle');
    if (tog) tog.addEventListener('click', function () { toggleSidebar(); });

    // Sidebar overlay
    var sov = document.getElementById('sidebarOverlay');
    if (sov) sov.addEventListener('click', function () { closeSidebar(); });

    // Sidebar nav items
    document.querySelectorAll('.snav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setFilter(btn.getAttribute('data-filter') || '', btn);
      });
    });

    // Sign out
    var so = document.getElementById('signoutBtn');
    if (so) so.addEventListener('click', function () { signOut(); });

    // Refresh
    var rb = document.getElementById('refreshBtn');
    if (rb) rb.addEventListener('click', function () { loadOrders(); });

    // Drawer overlay + close button
    var dov = document.getElementById('drawerOverlay');
    if (dov) dov.addEventListener('click', function () { closeDrawer(); });
    var dc = document.getElementById('drawerClose');
    if (dc) dc.addEventListener('click', function () { closeDrawer(); });

    // Pagination
    var pp = document.getElementById('pagePrev');
    var pn = document.getElementById('pageNext');
    if (pp) pp.addEventListener('click', function () { goPage(-1); });
    if (pn) pn.addEventListener('click', function () { goPage(1); });

    // Search — handle input, search (clear ✕), and change for mobile
    var si = document.getElementById('searchInput');
    if (si) {
      si.addEventListener('input',  function () { onSearch(); });
      si.addEventListener('search', function () { onSearch(); });
      si.addEventListener('change', function () { onSearch(); });
    }
  }

  wireStaticButtons();

  if (token) {
    showDashboard();
    loadOrders();
  }

  // ── Login ──────────────────────────────────────────────────────
  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pin = document.getElementById('pinInput').value.trim();
    var btn = document.getElementById('loginBtn');
    var err = document.getElementById('loginError');
    if (!pin) return;
    btn.disabled = true; btn.textContent = 'Signing in…'; err.hidden = true;
    fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      btn.disabled = false; btn.textContent = 'Sign in';
      if (d.ok && d.token) {
        saveToken(d.token);
        document.getElementById('pinInput').value = '';
        showDashboard();
        loadOrders();
      } else {
        var msgs = { wrong_pin: 'Incorrect PIN.', too_many_requests: 'Too many attempts. Wait a minute.', admin_not_configured: 'Admin not set up on the server yet.' };
        err.textContent = msgs[d.error] || 'Sign in failed.';
        err.hidden = false;
      }
    })
    .catch(function () {
      btn.disabled = false; btn.textContent = 'Sign in';
      err.textContent = 'Network error. Try again.'; err.hidden = false;
    });
  });

  // ── Show/hide screens ──────────────────────────────────────────
  function showDashboard() {
    document.body.classList.remove('page-login');
    document.getElementById('loginScreen').hidden = true;
    document.getElementById('dashboard').hidden = false;
  }
  function showLogin() {
    document.body.classList.add('page-login');
    document.getElementById('loginScreen').hidden = false;
    document.getElementById('dashboard').hidden = true;
    // Reset table state so spinner doesn't persist after sign-out
    var loading = document.getElementById('tableLoading');
    if (loading) loading.classList.remove('visible');
    document.body.style.overflow = '';
  }

  window.signOut = function () {
    clearToken();
    closeSidebar();
    showLogin();
  };

  // ── Sidebar toggle (mobile) ────────────────────────────────────
  window.toggleSidebar = function () {
    var sb  = document.getElementById('sidebar');
    var ov  = document.getElementById('sidebarOverlay');
    var open = sb.classList.toggle('open');
    if (ov) { ov.classList.toggle('open', open); }
    document.body.style.overflow = open ? 'hidden' : '';
  };

  window.closeSidebar = function () {
    var sb = document.getElementById('sidebar');
    var ov = document.getElementById('sidebarOverlay');
    sb.classList.remove('open');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
  };

  function isMobile() { return window.innerWidth <= 860; }

  // ── Filter / search / pagination ──────────────────────────────
  window.setFilter = function (status, btn) {
    currentFilter = status; currentPage = 1;
    document.querySelectorAll('.snav-item').forEach(function (b) {
      b.classList.toggle('active', btn ? b === btn : b.getAttribute('data-filter') === status);
    });
    if (isMobile()) closeSidebar();
    loadOrders();
  };

  window.onSearch = function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { currentPage = 1; loadOrders(); }, 350);
  };

  window.goPage = function (dir) {
    currentPage += dir;
    loadOrders();
  };

  // ── Load orders ────────────────────────────────────────────────
  window.loadOrders = function () {
    if (!token) return;
    var q = document.getElementById('searchInput').value.trim();
    var url = '/api/admin-orders?page=' + currentPage;
    if (currentFilter) url += '&status=' + encodeURIComponent(currentFilter);
    if (q) url += '&q=' + encodeURIComponent(q);

    setTableState('loading');
    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(function (r) {
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('auth'); }
      return r.json();
    })
    .then(function (d) {
      if (!d.ok) { setTableState('error', d.error || 'Unknown error'); return; }
      if (d.stats) updateStats(d.stats);
      renderTable(d.orders || [], d.total, d.page, d.pages);
    })
    .catch(function (e) { if (e.message !== 'auth') setTableState('error', e.message || 'Network error'); });
  };

  function setTableState(state, msg) {
    var loading = document.getElementById('tableLoading');
    var empty   = document.getElementById('tableEmpty');
    var error   = document.getElementById('tableError');
    var table   = document.getElementById('ordersTable');
    var paging  = document.getElementById('pagination');
    loading.classList.toggle('visible', state === 'loading');
    empty.classList.toggle('visible',   state === 'empty');
    error.classList.toggle('visible',   state === 'error');
    table.hidden   = state !== 'table';
    paging.hidden  = state !== 'table';
    if (state === 'error' && msg) {
      document.getElementById('tableErrorMsg').textContent = msg;
    }
  }

  // ── Stats ──────────────────────────────────────────────────────
  function updateStats(s) {
    allStats = s;
    document.getElementById('cntAll').textContent        = s.total       || 0;
    document.getElementById('cntPaid').textContent       = s.paid        || 0;
    document.getElementById('cntProcessing').textContent = s.processing  || 0;
    document.getElementById('cntShipped').textContent    = s.shipped     || 0;
    document.getElementById('cntDelivered').textContent  = s.delivered   || 0;
    document.getElementById('cntCancelled').textContent  = s.cancelled   || 0;
    document.getElementById('statTotal').textContent     = s.total       || 0;
    document.getElementById('statRevenue').textContent   = fmt(s.revenue || 0);
    document.getElementById('revenueVal').textContent    = fmt(s.revenue || 0);
    document.getElementById('statPending').textContent   = (s.paid || 0) + (s.processing || 0);
    document.getElementById('statDelivered').textContent = s.delivered   || 0;
  }

  // ── Render table ───────────────────────────────────────────────
  function renderTable(orders, total, page, pages) {
    var tbody = document.getElementById('ordersBody');
    tbody.textContent = '';
    if (!orders.length) { setTableState('empty'); return; }
    setTableState('table');

    orders.forEach(function (o) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><div class="order-ref">' + esc(shortRef(o.ref)) + '</div>' +
              '<div class="order-date">' + fmtDate(o.paidAt || o.placedAt) + '</div></td>' +
        '<td><div class="cust-name">' + esc(o.name || '—') + '</div>' +
              '<div class="cust-phone">' + esc(o.phone || '') + '</div></td>' +
        '<td><div class="items-name">' + esc(itemsLabel(o)) + '</div>' +
              '<div class="items-detail">' + esc(frameDetail(o)) + '</div></td>' +
        '<td><div class="order-total">' + fmt(o.price) + '</div>' +
              (o.deliveryFee != null ? '<div class="delivery-fee">+' + fmt(o.deliveryFee) + ' delivery</div>' : '') + '</td>' +
        '<td>' + fmtDate(o.paidAt || o.placedAt) + '</td>' +
        '<td>' + statusBadge(o) + '</td>' +
        '<td><button class="action-btn" type="button">View</button></td>';
      tr.addEventListener('click', function () { openDrawer(o); });
      tr.querySelector('.action-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        openDrawer(o);
      });
      tbody.appendChild(tr);
    });

    // Pagination
    var pgEl = document.getElementById('pagination');
    var info = document.getElementById('pageInfo');
    var prev = document.getElementById('pagePrev');
    var next = document.getElementById('pageNext');
    pgEl.hidden = pages <= 1;
    info.textContent = 'Page ' + page + ' of ' + pages + ' (' + total + ' orders)';
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    currentPage = page;
  }

  // ── Drawer ─────────────────────────────────────────────────────
  window.openDrawer = function (order) {
    drawerOrder = order;
    document.getElementById('drawerTitle').textContent = shortRef(order.ref);
    document.getElementById('drawerBody').innerHTML = buildDrawerHTML(order);
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawerOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    wireDrawer(order);
  };

  window.closeDrawer = function () {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawerOverlay').classList.remove('open');
    document.body.style.overflow = '';
    drawerOrder = null;
  };

  function buildDrawerHTML(o) {
    var items = Array.isArray(o.items) && o.items.length ? o.items : [{ imageName: o.imageName || 'Frame' }];
    var n = o.pieces || items.length || 1;
    var mismatch = o.amountStatus === 'mismatch' || (o.problems && o.problems.length);

    var html = '';

    if (mismatch) {
      html += '<div class="mismatch-warn">⚠ Payment amount mismatch — check before shipping.<br>' +
        esc((o.problems || []).join('; ')) + '</div>';
    }

    // Order info
    html += '<div class="dsec"><div class="dsec-title">Order</div>';
    html += drow('Reference', '<span class="dref">' + esc(o.ref) + '</span>');
    html += drow('Paystack ref', esc(o.paystackRef || '—'));
    html += drow('Placed', fmtDateFull(o.placedAt));
    html += drow('Paid at', fmtDateFull(o.paidAt));
    html += drow('Channel', esc(o.channel || '—'));
    html += '</div>';

    // Items
    html += '<div class="dsec"><div class="dsec-title">Items</div>';
    items.forEach(function (it, i) {
      var label = n > 1 ? 'Frame ' + (i + 1) : 'Image';
      html += drow(label, esc(it.imageName || it.name || '—') + (it.isUpload ? ' <em style="color:var(--muted)">(upload)</em>' : ''));
    });
    html += drow('Size', esc(o.size ? o.size + '"' : '—'));
    html += drow('Style', esc(o.style || '—'));
    html += drow('Set', esc(setLabel(n) + (o.setName && n > 1 ? ' · ' + o.setName : '')));
    html += '</div>';

    // Payment
    html += '<div class="dsec"><div class="dsec-title">Payment</div>';
    if (n > 1 && o.unitPrice) html += drow('Unit price', fmt(o.unitPrice) + ' × ' + n);
    if (o.discount) html += drow('Set discount', '−' + fmt(o.discount));
    html += drow('Frame total', fmt(o.price));
    html += drow('Delivery fee', o.deliveryFee != null ? fmt(o.deliveryFee) : '<em style="color:var(--muted)">Not set</em>');
    html += drow('Grand total', o.deliveryFee != null ? fmt((o.price || 0) + (o.deliveryFee || 0)) : '<em style="color:var(--muted)">Pending delivery fee</em>');
    html += '</div>';

    // Customer
    html += '<div class="dsec"><div class="dsec-title">Customer</div>';
    html += drow('Name', esc(o.name || '—'));
    html += drow('Phone', o.phone ? '<a href="tel:' + esc(o.phone) + '" style="color:var(--black)">' + esc(o.phone) + '</a>' : '—');
    if (o.email) html += drow('Email', esc(o.email));
    html += drow('Address', esc([o.address, o.city, o.state].filter(Boolean).join(', ') || '—'));
    if (o.notes) html += drow('Notes', esc(o.notes));
    html += '</div>';

    // Update form
    html += '<div class="dsec"><div class="dsec-title">Update Order</div>';
    html += '<div class="d-field"><label class="d-label">Fulfilment Status</label>' +
      '<select class="status-select" id="dStatus">' +
      ['paid','processing','shipped','delivered','cancelled'].map(function (s) {
        return '<option value="' + s + '"' + (o.fulfilmentStatus === s ? ' selected' : '') + '>' + statusName(s) + '</option>';
      }).join('') +
      '</select></div>';
    html += '<div class="d-field"><label class="d-label">Delivery Fee (₦)</label>' +
      '<input type="number" class="d-input" id="dFee" min="0" max="50000" step="100" ' +
      'value="' + (o.deliveryFee != null ? o.deliveryFee : '') + '" placeholder="e.g. 2000"></div>';
    html += '<div class="d-field"><label class="d-label">Admin Notes</label>' +
      '<textarea class="d-input" id="dNotes" rows="3" placeholder="Internal notes…">' + esc(o.adminNotes || '') + '</textarea></div>';
    html += '<div class="d-save-row">' +
      '<button class="d-btn d-btn-primary" id="dSaveBtn" onclick="saveDrawer()">Save Changes</button>' +
      '</div>';
    html += '<p class="d-toast" id="dToast">Saved ✓</p>';
    html += '</div>';

    // Actions
    html += '<div class="dsec"><div class="dsec-title">Actions</div><div class="d-actions">';
    var waLink = waUrl(o.phone, 'Hi ' + (o.name || '').split(' ')[0] + ', this is Hanga! Your order ' + o.ref + ' is on the way 🎉');
    if (waLink) html += '<a class="d-btn d-btn-gold" href="' + esc(waLink) + '" target="_blank" rel="noopener">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;margin-right:6px"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.656 1.438 5.168L2 22l4.979-1.418A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2Z" fill="#25D366"/><path d="M9.14 7.5c-.21 0-.44.005-.635.44l-.8 2.389c0 .433.223.853.447 1.136 1.343 2.059 3.272 2.808 3.272 2.808.628.504 1.93.504 2.278.473.348-.031 1.123-.459 1.282-.902.158-.443.158-.822.11-.902-.047-.08-.175-.127-.365-.222-.19-.095-1.123-.554-1.297-.617-.174-.063-.3-.095-.427.095-.126.19-.49.617-.601.743-.11.127-.222.143-.412.048-.19-.096-.803-.296-1.53-.944-.565-.504-.946-1.126-1.058-1.316-.11-.19-.012-.293.084-.388.085-.085.19-.222.285-.333.063-.127.032-.238-.016-.333-.047-.095-.427-1.03-.585-1.41-.158-.381-.317-.317-.427-.317Z" fill="#fff"/></svg>' +
      'Message on WhatsApp</a>';
    html += '<button class="d-btn d-btn-outline" onclick="copyRef(\'' + esc(o.ref) + '\')">Copy Order Reference</button>';
    html += '<button class="d-btn d-btn-danger" onclick="archiveOrder(\'' + esc(o.ref) + '\')">Archive Order</button>';
    html += '</div></div>';

    return html;
  }

  function wireDrawer(order) {
    // nothing extra needed — all wired via inline onclick
  }

  window.saveDrawer = function () {
    if (!drawerOrder) return;
    var status = document.getElementById('dStatus').value;
    var feeVal = document.getElementById('dFee').value.trim();
    var notes  = document.getElementById('dNotes').value;
    var fee    = feeVal === '' ? null : Number(feeVal);
    var btn    = document.getElementById('dSaveBtn');
    var toast  = document.getElementById('dToast');
    btn.disabled = true; btn.textContent = 'Saving…';

    fetch('/api/admin-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ ref: drawerOrder.ref, fulfilmentStatus: status, deliveryFee: fee, adminNotes: notes })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      btn.disabled = false; btn.textContent = 'Save Changes';
      if (d.ok) {
        drawerOrder = d.order;
        toast.style.display = 'block';
        setTimeout(function () { toast.style.display = 'none'; }, 2000);
        loadOrders(); // refresh table
      } else {
        btn.textContent = 'Error — try again';
      }
    })
    .catch(function () { btn.disabled = false; btn.textContent = 'Error — try again'; });
  };

  window.copyRef = function (ref) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ref).then(function () { alert('Copied: ' + ref); });
    } else {
      prompt('Copy this reference:', ref);
    }
  };

  window.archiveOrder = function (ref) {
    if (!confirm('Archive order ' + ref + '? It will be hidden from the dashboard.')) return;
    fetch('/api/admin-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ ref: ref, deleted: true })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) { closeDrawer(); loadOrders(); }
    })
    .catch(function () {});
  };

  // ── Helpers ────────────────────────────────────────────────────
  function fmt(n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function shortRef(r) { return r ? r.replace(/^HNG-/, '') : '—'; }
  function setLabel(n) { return ({ 1:'Single', 2:'Pair', 3:'Trio' })[n] || 'Single'; }
  function statusName(s) { return ({ paid:'Paid – New', processing:'Processing', shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled' })[s] || s; }
  function statusBadge(o) {
    var s = o.fulfilmentStatus || 'paid';
    var cls = 's-' + s;
    // Only show mismatch badge if order is NOT yet delivered/cancelled
    var showMismatch = o.amountStatus === 'mismatch' &&
                       s !== 'delivered' && s !== 'cancelled';
    if (showMismatch) cls = 's-mismatch';
    var label = showMismatch ? 'Mismatch' : statusName(s);
    return '<span class="status-badge ' + cls + '">' + esc(label) + '</span>';
  }
  function itemsLabel(o) {
    if (Array.isArray(o.items) && o.items.length > 1) {
      return o.items.map(function (i) { return i.imageName || i.name || 'Frame'; }).join(', ');
    }
    return o.imageName || (o.items && o.items[0] && o.items[0].imageName) || 'Frame';
  }
  function frameDetail(o) {
    var n = o.pieces || (Array.isArray(o.items) ? o.items.length : 1) || 1;
    return [setLabel(n), o.size ? o.size + '"' : null, o.style].filter(Boolean).join(' · ');
  }
  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });
    } catch (e) { return String(d).slice(0, 10); }
  }
  function fmtDateFull(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('en-NG', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' });
    } catch (e) { return String(d); }
  }
  function drow(label, val) {
    return '<div class="drow"><span class="drow-label">' + esc(label) + '</span><span class="drow-val">' + val + '</span></div>';
  }
  function waUrl(phone, text) {
    var d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '234' + d.slice(1);
    else if (d.length === 10) d = '234' + d;
    if (d.length < 11 || d.length > 15) return '';
    return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
  }

})();
