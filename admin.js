/* FarmGear Zim: administrator dashboard.
   Only users whose user_profiles.role is 'admin' can use it. The database enforces this with
   row level security, so hiding the page here is a convenience, not the protection. */
(function () {
  'use strict';
  const FG = window.FG;
  if (!FG) return;
  const esc = FG.esc, icon = FG.icon, toast = FG.toast, sb = FG.sb, live = FG.live;
  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const money = (n, cur) => (cur === 'ZWG' ? 'ZWG ' : '$') + fmt(n);
  const UNIT = { kg: 'per kg', tonne: 'per tonne', head: 'per animal' };
  const TYPES = { buyer: 'Agricultural buyer', grain_market: 'Grain market', licensed_buyer: 'Licensed commodity buyer', livestock_market: 'Livestock market', trading_centre: 'Trading centre' };
  const REASON = { fraud: 'Looks like a scam', wrong_info: 'Wrong information', already_sold: 'Already sold', inappropriate: 'Not appropriate', spam: 'Spam', other: 'Other' };
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dLong = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const daysSince = (s) => Math.round((new Date(isoToday() + 'T12:00:00') - new Date(String(s).slice(0, 10) + 'T12:00:00')) / 86400000);

  const S = {
    tab: 'overview', cats: [], catMap: {}, busy: false, err: '',
    ov: null, prices: [], priceCat: 'all', staleOnly: false, edit: null,
    lq: '', lst: 'active', listings: [], rq: '', rst: 'open', requests: [],
    rep: [], repSt: 'open', uq: '', users: [], loaded: {}
  };

  let view = $('#view-admin');
  if (!view) {
    view = document.createElement('section');
    view.id = 'view-admin'; view.hidden = true;
    (document.querySelector('main') || document.body).appendChild(view);
  }

  function shell() {
    const tabs = [['overview', 'Overview'], ['prices', 'Prices'], ['listings', 'Listings'], ['requests', 'Requests'], ['reports', 'Reports'], ['users', 'Users']];
    view.innerHTML = '<h1>Admin</h1><p class="lead">Manage the market, official prices and users.</p>' +
      '<div class="tabs scroll" id="adTabs" role="group" aria-label="Admin sections">' +
      tabs.map((t) => '<button type="button" data-ad="tab" data-id="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div id="adBody"></div>';
  }

  function gate() {
    if (!live) { view.innerHTML = '<div class="empty"><p><b>Admin needs a Supabase connection.</b></p></div>'; return false; }
    if (!FG.user) { view.innerHTML = '<h1>Admin</h1><div class="empty"><p><b>Sign in to continue.</b></p><button type="button" class="btn" data-auth>Sign in</button></div>'; return false; }
    if (!FG.isAdmin) {
      view.innerHTML = '<h1>Admin</h1><div class="empty"><p><b>Administrators only.</b></p><p class="meta">Your account is not an administrator. If it should be, ask an existing administrator to make you one.</p><a class="btn" href="#profile">Back to profile</a></div>';
      return false;
    }
    return true;
  }

  async function show() {
    if (!gate()) return;
    if (!$('#adBody')) shell();
    document.querySelectorAll('#adTabs [data-id]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === S.tab)));
    if (!S.cats.length) {
      try { S.cats = await FG.loadCats(); S.cats.forEach((c) => { S.catMap[c.id] = c; }); }
      catch (e) { $('#adBody').innerHTML = '<p class="err">Could not load product types: ' + esc(e.message) + '</p>'; return; }
    }
    const fn = { overview: tabOverview, prices: tabPrices, listings: tabListings, requests: tabRequests, reports: tabReports, users: tabUsers }[S.tab];
    await fn();
  }
  const body = () => $('#adBody');
  const loading = () => { if (body()) body().innerHTML = '<ul class="alist"><li class="skel"></li><li class="skel"></li></ul>'; };
  const failBox = (msg) => { if (body()) body().innerHTML = '<div class="empty"><p class="err">Something went wrong.</p><p class="meta">' + esc(msg) + '</p><button type="button" class="btn" data-ad="reload">Try again</button></div>'; };

  /* ---------- overview ---------- */
  async function count(table, f) {
    let q = sb.from(table).select('id', { count: 'exact', head: true });
    if (f) q = f(q);
    const r = await q;
    return r.error ? null : r.count;
  }
  async function tabOverview() {
    loading();
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    const [users, active, sold, removed, reqs, enq, enq7, reports, prices, board, p, r, e] = await Promise.all([
      count('user_profiles'), count('products', (q) => q.eq('status', 'active')), count('products', (q) => q.eq('status', 'sold')),
      count('products', (q) => q.eq('status', 'removed')), count('buyer_requests', (q) => q.eq('status', 'open')),
      count('enquiries'), count('enquiries', (q) => q.gte('created_at', week)), count('listing_reports', (q) => q.eq('status', 'open')),
      count('agricultural_prices'), sb.from('price_board').select('category_id,recorded_on').limit(2000),
      sb.from('products').select('id,title,seller_name,created_at,status').order('created_at', { ascending: false }).limit(5),
      sb.from('buyer_requests').select('id,product_name,contact_name,created_at').order('created_at', { ascending: false }).limit(5),
      sb.from('enquiries').select('id,subject,sender_name,created_at').order('created_at', { ascending: false }).limit(5)
    ]);
    const stale = board.error ? null : board.data.filter((x) => daysSince(x.recorded_on) > (S.catMap[x.category_id] ? S.catMap[x.category_id].stale_after_days : 14)).length;
    const n = (v) => (v == null ? '—' : v);
    const act = [].concat(
      (p.data || []).map((x) => ({ at: x.created_at, t: 'Listing', s: x.title + ' by ' + (x.seller_name || 'seller') })),
      (r.data || []).map((x) => ({ at: x.created_at, t: 'Buy request', s: x.product_name + ' by ' + (x.contact_name || 'buyer') })),
      (e.data || []).map((x) => ({ at: x.created_at, t: 'Enquiry', s: (x.subject || 'Enquiry') + ' from ' + (x.sender_name || 'user') }))
    ).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
    body().innerHTML =
      '<div class="sgrid">' +
        [['Users', users], ['Active listings', active], ['Sold listings', sold], ['Removed listings', removed], ['Open buy requests', reqs],
          ['Enquiries, all time', enq], ['Enquiries, last 7 days', enq7], ['Open reports', reports], ['Price records', prices], ['Outdated prices', stale]]
          .map((x) => '<div><b>' + n(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>').join('') + '</div>' +
      '<h2 class="sub-h">Recent activity</h2>' +
      (act.length ? '<ul class="alist">' + act.map((a) => '<li class="arow"><h3>' + esc(a.t) + ': ' + esc(a.s) + '</h3><span class="meta">' + esc(new Date(a.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</span></li>').join('') + '</ul>'
        : '<p class="meta">No activity yet.</p>');
  }

  /* ---------- prices ---------- */
  async function loadPrices() {
    const res = await sb.from('price_board').select('*').order('recorded_on', { ascending: false }).limit(1000);
    if (res.error) throw res.error;
    S.prices = res.data;
  }
  async function tabPrices() {
    loading();
    try { await loadPrices(); } catch (e) { failBox(e.message); return; }
    renderPrices();
  }
  function priceForm() {
    const e = S.edit, c0 = e ? S.catMap[e.category_id] : S.cats[0];
    const mk = Array.from(new Set(S.prices.map((r) => r.market_name))).sort();
    const unit0 = e ? e.unit : (c0 ? c0.price_unit : 'kg');
    return '<form class="form" id="adPriceForm" autocomplete="off">' +
      '<h2 class="sub-h" style="margin-top:0">' + (e ? 'Update price' : 'Add a price') + '</h2>' +
      '<p class="meta">Only enter prices you can show a source for. Never guess. The source and date are shown to every farmer.</p>' +
      '<label class="field"><span>Product</span><select id="apCat"' + (e ? ' disabled' : '') + '>' + S.cats.map((c) => '<option value="' + esc(c.id) + '"' + (c0 && c.id === c0.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Market or buyer name</span><input id="apMkt" type="text" list="apMkts" required maxlength="80" value="' + esc(e ? e.market_name : '') + '"' + (e ? ' readonly' : '') + ' placeholder="e.g. Grain Marketing Board, Harare depot"><datalist id="apMkts">' + mk.map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist></label>' +
      '<label class="field"><span>Type</span><select id="apType">' + Object.keys(TYPES).map((k) => '<option value="' + k + '"' + (e && e.market_type === k ? ' selected' : '') + '>' + esc(TYPES[k]) + '</option>').join('') + '</select></label>' +
      '<div class="two"><label class="field"><span>Province</span><select id="apProv">' + FG.provinceOptions(e ? e.province : '', 'Not stated') + '</select></label>' +
      '<label class="field"><span>District</span><select id="apDist">' + FG.districtOptions(e ? e.province : '', e ? e.district : '', 'Not stated') + '</select></label></div>' +
      '<label class="field"><span>Place or depot</span><input id="apLoc" type="text" maxlength="80" value="' + esc(e ? (e.location || '') : '') + '" placeholder="e.g. Msasa, Harare"></label>' +
      '<div class="two"><label class="field"><span>Price is</span><select id="apUnit"' + (e ? ' disabled' : '') + '>' + Object.keys(UNIT).map((u) => '<option value="' + u + '"' + (u === unit0 ? ' selected' : '') + '>' + UNIT[u] + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Currency</span><select id="apCur"' + (e ? ' disabled' : '') + '><option' + (e && e.currency === 'USD' || !e ? ' selected' : '') + '>USD</option><option' + (e && e.currency === 'ZWG' ? ' selected' : '') + '>ZWG</option></select></label></div>' +
      '<div class="two"><label class="field"><span>Price</span><input id="apPrice" type="number" inputmode="decimal" min="0" step="any" required value="' + (e ? esc(e.price) : '') + '"></label>' +
      '<label class="field"><span>Date of this price</span><input id="apDate" type="date" required max="' + isoToday() + '" value="' + (e ? esc(e.recorded_on) : isoToday()) + '"></label></div>' +
      '<label class="field"><span>Source name (required)</span><input id="apSrc" type="text" required maxlength="120" value="' + esc(e ? e.source_name : '') + '" placeholder="e.g. GMB price notice, phone call to buyer, ZMX report"></label>' +
      '<label class="field"><span>Source link (optional)</span><input id="apUrl" type="url" maxlength="300" value="' + esc(e && e.source_url ? e.source_url : '') + '" placeholder="https://"></label>' +
      '<label class="field"><span>Note (optional)</span><input id="apNote" type="text" maxlength="300" value="' + esc(e && e.notes ? e.notes : '') + '" placeholder="Grade, delivery terms"></label>' +
      '<p class="err" id="apErr" role="alert"></p>' +
      '<div class="mact"><button type="submit" class="btn alt" id="apGo">' + (e ? 'Save update' : 'Save price') + '</button>' +
      (e ? '<button type="button" class="btn ghost" data-ad="canceledit">Cancel</button>' : '') + '</div></form>';
  }
  function renderPrices() {
    let rows = S.prices.filter((r) => S.priceCat === 'all' || r.category_id === S.priceCat);
    const stale = (r) => daysSince(r.recorded_on) > (S.catMap[r.category_id] ? S.catMap[r.category_id].stale_after_days : 14);
    if (S.staleOnly) rows = rows.filter(stale);
    body().innerHTML = priceForm() +
      '<h2 class="sub-h">Recorded prices</h2>' +
      '<div class="fpanel" style="margin-top:0"><label class="field"><span>Product</span><select data-ad="pfcat"><option value="all">All products</option>' + S.cats.map((c) => '<option value="' + esc(c.id) + '"' + (S.priceCat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Show</span><select data-ad="pfstale"><option value="0">All prices</option><option value="1"' + (S.staleOnly ? ' selected' : '') + '>Outdated only</option></select></label></div>' +
      (rows.length ? '<ul class="alist" style="margin-top:10px">' + rows.map((r) => {
        const old = stale(r);
        return '<li class="arow"><h3>' + esc((S.catMap[r.category_id] || {}).name || 'Product') + ': ' + esc(money(r.price, r.currency)) + ' ' + esc(UNIT[r.unit]) + ' ' + (old ? '<span class="pill warn">Outdated</span>' : '<span class="pill ok">Current</span>') + '</h3>' +
          '<span class="meta">' + esc(r.market_name) + ' · ' + esc(TYPES[r.market_type] || '') + '</span>' +
          '<span class="meta">' + esc(dLong(r.recorded_on)) + ' (' + daysSince(r.recorded_on) + ' days ago) · Source: ' + esc(r.source_name) + '</span>' +
          '<div class="mact"><button type="button" class="btn ghost" data-ad="pedit" data-id="' + esc(r.id) + '">' + icon('edit') + 'Update</button>' +
          '<button type="button" class="btn ghost" data-ad="phist" data-id="' + esc(r.id) + '">History</button>' +
          '<button type="button" class="btn ghost" data-ad="pdel" data-id="' + esc(r.id) + '" aria-label="Delete price">' + icon('trash') + '</button></div></li>';
      }).join('') + '</ul>' : '<div class="empty"><p><b>No prices recorded' + (S.staleOnly ? ' as outdated' : ' yet') + '.</b></p><p class="meta">Use the form above to add the first one with its source.</p></div>');
    wirePriceForm();
  }
  function wirePriceForm() {
    const f = $('#adPriceForm');
    if (!f) return;
    $('#apProv').addEventListener('change', () => { $('#apDist').innerHTML = FG.districtOptions($('#apProv').value, '', 'Not stated'); });
    $('#apCat').addEventListener('change', () => { const c = S.catMap[$('#apCat').value]; if (c) $('#apUnit').value = c.price_unit; });
    f.addEventListener('submit', savePrice);
  }
  async function savePrice(ev) {
    ev.preventDefault();
    const err = $('#apErr'), btn = $('#apGo');
    const bad = (m) => { err.textContent = m; toast(m); };
    const e = S.edit;
    const row = {
      category_id: e ? e.category_id : $('#apCat').value, market_name: $('#apMkt').value.trim(), market_type: $('#apType').value,
      province: $('#apProv').value || null, district: $('#apDist').value || null, location: $('#apLoc').value.trim() || null,
      unit: e ? e.unit : $('#apUnit').value, currency: e ? e.currency : $('#apCur').value,
      price: parseFloat($('#apPrice').value), recorded_on: $('#apDate').value,
      source_name: $('#apSrc').value.trim(), source_url: $('#apUrl').value.trim() || null, notes: $('#apNote').value.trim() || null
    };
    if (row.market_name.length < 2) return bad('Enter the market or buyer name.');
    if (!(row.price > 0)) return bad('Enter a price greater than zero.');
    if (!row.recorded_on || row.recorded_on > isoToday()) return bad('Choose the date the price was recorded. It cannot be in the future.');
    if (row.source_name.length < 2) return bad('A source is required. Say where this price came from.');
    if (row.source_url && !/^https?:\/\//i.test(row.source_url)) return bad('The source link must start with http:// or https://');
    btn.disabled = true; btn.textContent = 'Saving…'; err.textContent = '';
    try {
      const cur = await sb.from('agricultural_prices').select('*').eq('category_id', row.category_id).eq('market_name', row.market_name).eq('unit', row.unit).eq('currency', row.currency).maybeSingle();
      if (cur.error) throw cur.error;
      const old = cur.data;
      if (old && old.price > 0 && Math.abs(row.price - old.price) / old.price > 0.4 && row.recorded_on >= old.recorded_on) {
        const ok = await FG.confirm('Big price change', 'This is ' + fmt(Math.abs(row.price - old.price) / old.price * 100) + '% different from the current ' + money(old.price, old.currency) + '. Is the price correct?', 'Yes, save it');
        if (!ok) { btn.disabled = false; btn.textContent = e ? 'Save update' : 'Save price'; return; }
      }
      let msg;
      if (old && row.recorded_on < old.recorded_on) {
        const ok = await FG.confirm('Older than the current price', 'The current price here is from ' + dLong(old.recorded_on) + '. This earlier date will be saved as a history record only. The current price stays.', 'Save to history');
        if (!ok) { btn.disabled = false; btn.textContent = e ? 'Save update' : 'Save price'; return; }
        const h = await sb.from('price_history').upsert({
          price_id: old.id, category_id: row.category_id, market_name: row.market_name, market_type: row.market_type, province: row.province, district: row.district,
          location: row.location, unit: row.unit, currency: row.currency, price: row.price, recorded_on: row.recorded_on, source_name: row.source_name, source_url: row.source_url, recorded_by: FG.user.id
        }, { onConflict: 'category_id,market_name,unit,currency,recorded_on' });
        if (h.error) throw h.error;
        msg = 'Saved to price history.';
      } else {
        const res = await sb.from('agricultural_prices').upsert(row, { onConflict: 'category_id,market_name,unit,currency' }).select();
        if (res.error) throw res.error;
        msg = old ? 'Price updated.' : 'Price added.';
      }
      S.edit = null;
      toast(msg);
      if (FG.refreshPrices) FG.refreshPrices();
      await loadPrices(); renderPrices();
      window.scrollTo(0, 0);
    } catch (x) {
      bad(x.message || 'Could not save the price.');
      btn.disabled = false; btn.textContent = e ? 'Save update' : 'Save price';
    }
  }
  async function openPriceHistory(id) {
    const p = S.prices.find((x) => x.id === id);
    if (!p) return;
    FG.openSheet('<h2>Price history</h2><p class="meta">' + esc((S.catMap[p.category_id] || {}).name || '') + ' · ' + esc(p.market_name) + ' · ' + esc(UNIT[p.unit]) + ' (' + esc(p.currency) + ')</p><div id="adHist" style="margin-top:12px"><div class="skel"></div></div>');
    const res = await sb.from('price_history').select('*').eq('category_id', p.category_id).eq('market_name', p.market_name).eq('unit', p.unit).eq('currency', p.currency).order('recorded_on', { ascending: false }).limit(60);
    const box = $('#adHist');
    if (!box) return;
    if (res.error) { box.innerHTML = '<p class="err">' + esc(res.error.message) + '</p>'; return; }
    box.innerHTML = '<p class="meta">Delete a wrong entry here. To change the current price, use Update instead.</p><div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Date</th><th>Price</th><th>Source</th><th></th></tr></thead><tbody>' +
      res.data.map((h) => '<tr><td>' + esc(dLong(h.recorded_on)) + '</td><td>' + esc(money(h.price, h.currency)) + '</td><td>' + esc(h.source_name) + '</td><td><button type="button" class="btn ghost small" style="min-height:32px;width:auto;margin:0" data-ad="hdel" data-id="' + esc(h.id) + '" aria-label="Delete entry">' + icon('trash') + '</button></td></tr>').join('') + '</tbody></table></div>';
  }

  /* ---------- listings and requests ---------- */
  const statusFilter = (cur, attr, opts) => '<label class="field"><span>Show</span><select data-ad="' + attr + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
  async function tabListings() {
    loading();
    let q = sb.from('products').select('*').order('created_at', { ascending: false }).limit(60);
    if (S.lst !== 'all') q = q.eq('status', S.lst);
    const t = S.lq.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (t) q = q.ilike('title', '%' + t + '%');
    const res = await q;
    if (res.error) { failBox(res.error.message); return; }
    S.listings = res.data;
    const bar = '<div class="fpanel" style="margin-top:0"><label class="field"><span>Search title</span><input type="search" id="adLq" value="' + esc(S.lq) + '" style="padding-left:12px"></label>' +
      statusFilter(S.lst, 'lst', [['active', 'Active'], ['sold', 'Sold'], ['removed', 'Removed'], ['all', 'All']]) + '</div>';
    body().innerHTML = bar + '<p class="meta" style="margin:10px 0">' + res.data.length + ' shown</p>' +
      (res.data.length ? '<ul class="alist">' + res.data.map((p) => {
        const thumb = p.photo_paths && p.photo_paths[0] ? FG.publicUrl(p.photo_paths[0].replace(/\.jpg$/, '-t.jpg')) : '';
        return '<li class="arow"><h3>' + (thumb ? '<img src="' + esc(thumb) + '" alt="" width="40" height="40" style="border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:8px" onerror="this.remove()">' : '') + esc(p.title) + ' <span class="pill ' + (p.status === 'active' ? 'ok' : 'bad') + '">' + esc(p.status) + '</span></h3>' +
          '<span class="meta">' + esc(p.seller_name || 'Seller') + ' · ' + esc(p.contact_phone) + ' · $' + fmt(p.price) + ' ' + esc({ kg: 'per kg', tonnes: 'per tonne', bags: 'per bag', crates: 'per crate', animals: 'per animal' }[p.unit]) + ' · ' + esc(p.province) + ' · ' + esc(dLong(p.created_at)) + '</span>' +
          '<div class="mact">' + (p.status === 'removed'
            ? '<button type="button" class="btn ghost" data-ad="lrestore" data-id="' + esc(p.id) + '">Restore</button>'
            : '<button type="button" class="btn danger" data-ad="lremove" data-id="' + esc(p.id) + '">Remove (fraud or abuse)</button>') +
          '<button type="button" class="btn ghost" data-ad="ldel" data-id="' + esc(p.id) + '" aria-label="Delete for good">' + icon('trash') + '</button></div></li>';
      }).join('') + '</ul>' : '<div class="empty"><p><b>No listings here.</b></p></div>');
  }
  async function tabRequests() {
    loading();
    let q = sb.from('buyer_requests').select('*').order('created_at', { ascending: false }).limit(60);
    if (S.rst !== 'all') q = q.eq('status', S.rst);
    const t = S.rq.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (t) q = q.ilike('product_name', '%' + t + '%');
    const res = await q;
    if (res.error) { failBox(res.error.message); return; }
    S.requests = res.data;
    const bar = '<div class="fpanel" style="margin-top:0"><label class="field"><span>Search product</span><input type="search" id="adRq" value="' + esc(S.rq) + '" style="padding-left:12px"></label>' +
      statusFilter(S.rst, 'rst', [['open', 'Open'], ['fulfilled', 'Found a seller'], ['closed', 'Closed'], ['removed', 'Removed'], ['all', 'All']]) + '</div>';
    body().innerHTML = bar + '<p class="meta" style="margin:10px 0">' + res.data.length + ' shown</p>' +
      (res.data.length ? '<ul class="alist">' + res.data.map((r) =>
        '<li class="arow"><h3>Wanted: ' + esc(r.product_name) + ' <span class="pill ' + (r.status === 'open' ? 'ok' : 'bad') + '">' + esc(r.status) + '</span></h3>' +
        '<span class="meta">' + esc(r.contact_name || 'Buyer') + ' · ' + esc(r.contact_phone) + ' · ' + esc(fmt(r.quantity) + ' ' + r.unit) + ' · ' + esc(r.province) + ' · ' + esc(dLong(r.created_at)) + '</span>' +
        (r.notes ? '<span>' + esc(r.notes) + '</span>' : '') +
        '<div class="mact">' + (r.status === 'removed'
          ? '<button type="button" class="btn ghost" data-ad="rrestore" data-id="' + esc(r.id) + '">Restore</button>'
          : '<button type="button" class="btn danger" data-ad="rremove" data-id="' + esc(r.id) + '">Remove (fraud or abuse)</button>') +
        '<button type="button" class="btn ghost" data-ad="rdel" data-id="' + esc(r.id) + '" aria-label="Delete for good">' + icon('trash') + '</button></div></li>').join('') + '</ul>'
        : '<div class="empty"><p><b>No requests here.</b></p></div>');
  }

  /* ---------- reports ---------- */
  async function tabReports() {
    loading();
    let q = sb.from('listing_reports').select('*, products(id,title,status,owner,seller_name), buyer_requests(id,product_name,status,owner,contact_name)').order('created_at', { ascending: false }).limit(60);
    if (S.repSt !== 'all') q = q.eq('status', S.repSt);
    const res = await q;
    if (res.error) { failBox(res.error.message); return; }
    S.rep = res.data;
    body().innerHTML = '<div class="fpanel" style="margin-top:0">' + statusFilter(S.repSt, 'repst', [['open', 'Open'], ['reviewed', 'Reviewed'], ['actioned', 'Action taken'], ['dismissed', 'Dismissed'], ['all', 'All']]) + '</div>' +
      (res.data.length ? '<ul class="alist" style="margin-top:10px">' + res.data.map((r) => {
        const p = r.products, q2 = r.buyer_requests, tgt = p || q2;
        const name = p ? p.title : q2 ? 'Wanted: ' + q2.product_name : 'Listing no longer exists';
        return '<li class="arow"><h3>' + esc(name) + ' <span class="pill ' + (r.status === 'open' ? 'warn' : '') + '">' + esc(r.status) + '</span></h3>' +
          '<span class="meta"><b>' + esc(REASON[r.reason] || r.reason) + '</b> · reported ' + esc(dLong(r.created_at)) + (tgt ? ' · now ' + esc(tgt.status) : '') + '</span>' +
          (r.details ? '<span>' + esc(r.details) + '</span>' : '') +
          '<div class="mact">' +
          (tgt && tgt.status !== 'removed' ? '<button type="button" class="btn danger" data-ad="repremove" data-id="' + esc(r.id) + '">Remove listing</button>' : '') +
          (tgt ? '<button type="button" class="btn ghost" data-ad="repsuspend" data-id="' + esc(r.id) + '">Suspend poster</button>' : '') +
          (r.status === 'open' ? '<button type="button" class="btn ghost" data-ad="repdismiss" data-id="' + esc(r.id) + '">Dismiss</button><button type="button" class="btn ghost" data-ad="repreview" data-id="' + esc(r.id) + '">Mark reviewed</button>' : '') + '</div></li>';
      }).join('') + '</ul>' : '<div class="empty"><p><b>No reports here.</b></p><p class="meta">Reports from users appear here.</p></div>');
  }

  /* ---------- users ---------- */
  async function tabUsers() {
    loading();
    let q = sb.from('user_profiles').select('*').order('created_at', { ascending: false }).limit(60);
    const t = S.uq.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (t) q = q.or('full_name.ilike.*' + t + '*,email.ilike.*' + t + '*,phone.ilike.*' + t + '*');
    const res = await q;
    if (res.error) { failBox(res.error.message); return; }
    S.users = res.data;
    body().innerHTML = '<div class="fpanel" style="margin-top:0"><label class="field full"><span>Search name, email or phone</span><input type="search" id="adUq" value="' + esc(S.uq) + '" style="padding-left:12px"></label></div>' +
      '<p class="meta" style="margin:10px 0">' + res.data.length + ' shown</p>' +
      (res.data.length ? '<ul class="alist">' + res.data.map((u) => {
        const me = FG.user && u.id === FG.user.id;
        return '<li class="arow"><h3>' + esc(u.full_name || 'No name yet') + (me ? ' (you)' : '') + ' ' +
          (u.role === 'admin' ? '<span class="pill sun">Admin</span> ' : '') + (u.status === 'suspended' ? '<span class="pill bad">Suspended</span>' : '') + '</h3>' +
          '<span class="meta">' + esc(u.email || '') + ' · ' + esc(u.user_type) + (u.phone ? ' · ' + esc(u.phone) : '') + ' · joined ' + esc(dLong(u.created_at)) + '</span>' +
          (me ? '' : '<div class="mact">' +
            '<button type="button" class="btn ' + (u.status === 'suspended' ? 'ghost' : 'danger') + '" data-ad="usus" data-id="' + esc(u.id) + '">' + (u.status === 'suspended' ? 'Reactivate' : 'Suspend') + '</button>' +
            '<button type="button" class="btn ghost" data-ad="uadmin" data-id="' + esc(u.id) + '">' + (u.role === 'admin' ? 'Remove admin' : 'Make admin') + '</button></div>') + '</li>';
      }).join('') + '</ul>' : '<div class="empty"><p><b>No users found.</b></p></div>');
  }

  /* ---------- actions ---------- */
  async function run(promise, okMsg, reload) {
    const res = await promise;
    if (res.error) { toast(res.error.message); return false; }
    if (okMsg) toast(okMsg);
    if (reload !== false) show();
    return true;
  }
  async function removePaths(table, id) {
    const r = await sb.from(table).select('photo_paths').eq('id', id).maybeSingle();
    const paths = r.data && r.data.photo_paths ? r.data.photo_paths : [];
    return paths.concat(paths.map((p) => p.replace(/\.jpg$/, '-t.jpg')));
  }
  let sTimer;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!view.contains(t)) return;
    const map = { adLq: 'lq', adRq: 'rq', adUq: 'uq' };
    if (!map[t.id]) return;
    S[map[t.id]] = t.value;
    clearTimeout(sTimer);
    sTimer = setTimeout(() => { const el = t; show().then(() => { const n = document.getElementById(t.id); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400);
  });
  document.addEventListener('change', (e) => {
    const t = e.target, a = t.getAttribute && t.getAttribute('data-ad');
    if (!a || !view.contains(t)) return;
    if (a === 'pfcat') { S.priceCat = t.value; renderPrices(); }
    else if (a === 'pfstale') { S.staleOnly = t.value === '1'; renderPrices(); }
    else if (a === 'lst') { S.lst = t.value; show(); }
    else if (a === 'rst') { S.rst = t.value; show(); }
    else if (a === 'repst') { S.repSt = t.value; show(); }
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-ad]');
    if (!t || t.tagName === 'SELECT' || t.tagName === 'OPTION') return;
    const a = t.getAttribute('data-ad'), id = t.getAttribute('data-id');
    switch (a) {
      case 'tab': S.tab = id; S.edit = null; show(); break;
      case 'reload': show(); break;
      case 'pedit': S.edit = S.prices.find((x) => x.id === id) || null; renderPrices(); window.scrollTo(0, 0); break;
      case 'canceledit': S.edit = null; renderPrices(); break;
      case 'phist': openPriceHistory(id); break;
      case 'hdel': {
        if (!(await FG.confirm('Delete this history entry?', 'It will no longer appear on price charts.', 'Delete'))) break;
        const r = await sb.from('price_history').delete().eq('id', id);
        if (r.error) toast(r.error.message); else { const tr = t.closest('tr'); if (tr) tr.remove(); toast('Entry deleted.'); if (FG.refreshPrices) FG.refreshPrices(); }
        break;
      }
      case 'pdel': {
        if (!(await FG.confirm('Delete this price?', 'The price disappears from the dashboard. Its history stays for charts.', 'Delete'))) break;
        if (await run(sb.from('agricultural_prices').delete().eq('id', id), 'Price deleted.', false)) { if (FG.refreshPrices) FG.refreshPrices(); await loadPrices(); renderPrices(); }
        break;
      }
      case 'lremove':
        if (await FG.confirm('Remove this listing?', 'Buyers will no longer see it. The seller cannot bring it back.', 'Remove')) run(sb.from('products').update({ status: 'removed' }).eq('id', id), 'Listing removed.');
        break;
      case 'lrestore': run(sb.from('products').update({ status: 'active' }).eq('id', id), 'Listing restored.'); break;
      case 'ldel':
        if (await FG.confirm('Delete for good?', 'The listing and its photos are erased. This cannot be undone.', 'Delete')) {
          const paths = await removePaths('products', id);
          if (await run(sb.from('products').delete().eq('id', id), 'Listing deleted.') && paths.length) sb.storage.from(FG.BUCKET).remove(paths);
        }
        break;
      case 'rremove':
        if (await FG.confirm('Remove this request?', 'Farmers will no longer see it.', 'Remove')) run(sb.from('buyer_requests').update({ status: 'removed' }).eq('id', id), 'Request removed.');
        break;
      case 'rrestore': run(sb.from('buyer_requests').update({ status: 'open' }).eq('id', id), 'Request restored.'); break;
      case 'rdel':
        if (await FG.confirm('Delete for good?', 'This cannot be undone.', 'Delete')) run(sb.from('buyer_requests').delete().eq('id', id), 'Request deleted.');
        break;
      case 'repremove': case 'repsuspend': case 'repdismiss': case 'repreview': {
        const r = S.rep.find((x) => x.id === id);
        if (!r) break;
        if (a === 'repremove') {
          if (!(await FG.confirm('Remove the reported listing?', 'It is hidden from everyone and the report is closed.', 'Remove'))) break;
          const res = r.product_id
            ? await sb.from('products').update({ status: 'removed' }).eq('id', r.product_id)
            : await sb.from('buyer_requests').update({ status: 'removed' }).eq('id', r.buyer_request_id);
          if (res.error) { toast(res.error.message); break; }
          run(sb.from('listing_reports').update({ status: 'actioned' }).eq('id', id), 'Listing removed.');
        } else if (a === 'repsuspend') {
          const owner = (r.products || r.buyer_requests || {}).owner;
          if (!owner) { toast('Poster not found.'); break; }
          if (!(await FG.confirm('Suspend this user?', 'They cannot post, send enquiries or edit listings until you reactivate them.', 'Suspend'))) break;
          if (FG.user && owner === FG.user.id) { toast('You cannot suspend yourself.'); break; }
          if (await run(sb.from('user_profiles').update({ status: 'suspended' }).eq('id', owner), 'User suspended.', false)) run(sb.from('listing_reports').update({ status: 'actioned' }).eq('id', id), null);
        } else {
          run(sb.from('listing_reports').update({ status: a === 'repdismiss' ? 'dismissed' : 'reviewed' }).eq('id', id), 'Report updated.');
        }
        break;
      }
      case 'usus': {
        const u = S.users.find((x) => x.id === id); if (!u) break;
        const to = u.status === 'suspended' ? 'active' : 'suspended';
        if (to === 'suspended' && !(await FG.confirm('Suspend ' + (u.full_name || u.email) + '?', 'They cannot post, send enquiries or edit listings.', 'Suspend'))) break;
        run(sb.from('user_profiles').update({ status: to }).eq('id', id), to === 'active' ? 'User reactivated.' : 'User suspended.');
        break;
      }
      case 'uadmin': {
        const u = S.users.find((x) => x.id === id); if (!u) break;
        const to = u.role === 'admin' ? 'user' : 'admin';
        if (!(await FG.confirm(to === 'admin' ? 'Make an administrator?' : 'Remove administrator?', to === 'admin' ? (u.full_name || u.email) + ' will be able to edit official prices, remove listings and manage users.' : (u.full_name || u.email) + ' will lose admin access.', 'Yes'))) break;
        run(sb.from('user_profiles').update({ role: to }).eq('id', id), to === 'admin' ? 'User is now an administrator.' : 'Admin access removed.');
        break;
      }
      default: break;
    }
  });

  FG.routes.admin = () => { if (!gate()) return; shell(); show(); };
  const refresh = () => { if (FG.view === 'admin') FG.routes.admin(); };
  FG.on('profile', refresh);
  FG.on('user', () => { S.tab = 'overview'; S.edit = null; refresh(); });
  if (FG.view === 'admin') FG.routes.admin();
})();
