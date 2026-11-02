/* FarmGear Zim: agricultural marketplace.
   Farmers post crops and livestock with photos. Buyers search, filter, save, enquire and use WhatsApp.
   Buy requests let buyers say what they need. Needs app.js (window.FG) and Supabase. */
(function () {
  'use strict';
  const FG = window.FG;
  if (!FG) return;
  const esc = FG.esc, icon = FG.icon, toast = FG.toast, sb = FG.sb, live = FG.live;
  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const UNITS = ['kg', 'tonnes', 'bags', 'crates', 'animals'];
  const PER = { kg: 'per kg', tonnes: 'per tonne', bags: 'per bag', crates: 'per crate', animals: 'per animal' };
  const PER1 = { kg: 'kg', tonnes: 'tonne', bags: 'bag', crates: 'crate', animals: 'animal' };
  const PAGE = 12, MAX_PHOTOS = 6;
  const REASONS = [['fraud', 'Looks like a scam'], ['wrong_info', 'Wrong information'], ['already_sold', 'Already sold'],
    ['inappropriate', 'Not appropriate'], ['spam', 'Spam or repeated'], ['other', 'Something else']];

  const S = {
    tab: 'sale', cats: [], catMap: {}, built: false,
    sale: { q: '', cat: 'all', prov: '', dist: '', pmin: '', pmax: '', qmin: '', rows: [], total: 0, page: 0, loading: false, err: '', loaded: false, tok: 0 },
    req: { q: '', cat: 'all', prov: '', rows: [], total: 0, page: 0, loading: false, err: '', loaded: false, tok: 0 },
    saved: new Set(), savedRows: [], savedLoaded: false, mine: [], myReq: [],
    enq: { tab: 'in', rows: [], loaded: false, err: '' }
  };
  let photos = [];          /* photos being edited in the form */
  let unitTouched = false;

  /* ---------- helpers ---------- */
  const catName = (id) => (S.catMap[id] ? S.catMap[id].name : 'Produce');
  const place = (r) => [r.town, r.district, r.province].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    const d = Math.round(s / 86400);
    return d === 1 ? 'Yesterday' : d + ' days ago';
  }
  const qtyText = (q, u) => fmt(q) + ' ' + (u === 'animals' ? 'animals' : u);
  const thumbPath = (p) => p.replace(/\.jpg$/, '-t.jpg');
  const urlOf = (p) => FG.publicUrl(p);
  function norm(p) {
    p.photos = (p.photo_paths || []).map(urlOf);
    p.thumbs = (p.photo_paths || []).map((x) => urlOf(thumbPath(x)));
    return p;
  }
  const mine = (r) => !!(FG.user && r.owner === FG.user.id);
  const findP = (id) => [S.sale.rows, S.mine, S.savedRows].reduce((a, arr) => a || arr.find((x) => x.id === id), null);
  const findR = (id) => [S.req.rows, S.myReq].reduce((a, arr) => a || arr.find((x) => x.id === id), null);
  const needLive = () => { if (!live) { toast('Connect Supabase in config.js to use the market.'); return false; } return true; };

  /* ---------- build the view ---------- */
  let view = $('#view-market');
  if (!view) {
    view = document.createElement('section');
    view.id = 'view-market'; view.hidden = true;
    (document.querySelector('main') || document.body).appendChild(view);
  }
  const fab = document.createElement('button');
  fab.type = 'button'; fab.id = 'fabMarket'; fab.className = 'fab'; fab.hidden = true;
  fab.setAttribute('data-mk', 'fab');
  document.body.appendChild(fab);

  function build() {
    if (S.built) return;
    S.built = true;
    view.innerHTML =
      '<h1>Farm produce</h1>' +
      '<p class="lead">Sell crops and livestock straight to buyers, or tell farmers what you want to buy.</p>' +
      '<p class="notice" id="mkNotice" hidden></p>' +
      '<div class="tabs" id="mkTabs" role="group" aria-label="Market sections">' +
        '<button type="button" data-mk="tab" data-id="sale" aria-pressed="true">For sale</button>' +
        '<button type="button" data-mk="tab" data-id="req" aria-pressed="false">Buy requests</button></div>' +
      '<div id="mkSale">' +
        '<div class="fbar"><label class="search"><span class="sr">Search produce</span>' + icon('search') +
          '<input type="search" id="mkQ" data-f="q" data-s="sale" placeholder="Search maize, cattle, beans" autocomplete="off"></label>' +
          '<button type="button" class="btn ghost small" id="mkFbtn" data-mk="filters" aria-expanded="false">' + icon('filter') + 'Filters <span class="fcount" id="mkFcnt" hidden></span></button></div>' +
        '<div class="fpanel" id="mkPanel" hidden>' +
          '<label class="field"><span>Province</span><select id="mkProv" data-f="prov" data-s="sale"></select></label>' +
          '<label class="field"><span>District</span><select id="mkDist" data-f="dist" data-s="sale"></select></label>' +
          '<label class="field"><span>Lowest price (USD)</span><input type="number" inputmode="decimal" min="0" step="any" data-f="pmin" data-s="sale" placeholder="0"></label>' +
          '<label class="field"><span>Highest price (USD)</span><input type="number" inputmode="decimal" min="0" step="any" data-f="pmax" data-s="sale" placeholder="Any"></label>' +
          '<label class="field full"><span>Smallest quantity you need</span><input type="number" inputmode="decimal" min="0" step="any" data-f="qmin" data-s="sale" placeholder="Any">' +
            '<small>Price and quantity use the unit each seller chose (kg, tonne, bag, crate or animal).</small></label>' +
          '<button type="button" class="btn ghost small full" data-mk="clear">Clear filters</button></div>' +
        '<div class="chips" id="mkChips" role="group" aria-label="Product type"></div>' +
        '<div class="result-row"><p class="meta" id="mkCount" aria-live="polite"></p></div>' +
        '<ul class="pcards" id="mkList"></ul>' +
        '<div class="empty" id="mkEmpty" hidden></div>' +
        '<div class="loadmore" id="mkMore" hidden><button type="button" class="btn ghost" data-mk="more" data-id="sale">Show more</button></div>' +
      '</div>' +
      '<div id="mkReq" hidden>' +
        '<div class="fbar"><label class="search"><span class="sr">Search buy requests</span>' + icon('search') +
          '<input type="search" id="mkRQ" data-f="q" data-s="req" placeholder="What are buyers looking for?" autocomplete="off"></label></div>' +
        '<div class="filters"><label class="sel"><span class="sr">Province</span><select id="mkRProv" data-f="prov" data-s="req"></select></label></div>' +
        '<div class="chips" id="mkRChips" role="group" aria-label="Product type"></div>' +
        '<div class="result-row"><p class="meta" id="mkRCount" aria-live="polite"></p></div>' +
        '<ul class="cards" id="mkRList" style="grid-template-columns:1fr"></ul>' +
        '<div class="empty" id="mkREmpty" hidden></div>' +
        '<div class="loadmore" id="mkRMore" hidden><button type="button" class="btn ghost" data-mk="more" data-id="req">Show more</button></div>' +
      '</div>';
    $('#mkProv').innerHTML = FG.provinceOptions('', 'All provinces');
    $('#mkDist').innerHTML = FG.districtOptions('', '', 'All districts');
    $('#mkRProv').innerHTML = FG.provinceOptions('', 'All provinces');
    renderChips();
  }

  function chipsHtml(sel, action) {
    return '<button type="button" class="chip" data-mk="' + action + '" data-id="all" aria-pressed="' + (sel === 'all') + '">All</button>' +
      S.cats.map((c) => '<button type="button" class="chip" data-mk="' + action + '" data-id="' + esc(c.id) + '" aria-pressed="' + (sel === c.id) + '">' + esc(c.name) + '</button>').join('');
  }
  function renderChips() {
    if ($('#mkChips')) $('#mkChips').innerHTML = chipsHtml(S.sale.cat, 'cat');
    if ($('#mkRChips')) $('#mkRChips').innerHTML = chipsHtml(S.req.cat, 'rcat');
  }

  /* ---------- produce cards ---------- */
  function pcard(p) {
    const saved = S.saved.has(p.id);
    const img = p.thumbs && p.thumbs[0]
      ? '<img src="' + esc(p.thumbs[0]) + '" data-full="' + esc(p.photos[0]) + '" alt="" loading="lazy" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full}else{this.remove()}">'
      : icon('wheat');
    let pill = '';
    if (p.status === 'sold') pill = '<span class="pill bad">Sold</span>';
    else if (p.status === 'removed') pill = '<span class="pill bad">Removed</span>';
    else if (mine(p)) pill = '<span class="pill sun">Yours</span>';
    return '<li class="pcard">' +
      '<button type="button" class="pcard-main" data-mk="open" data-id="' + esc(p.id) + '">' +
        '<span class="pimg">' + img + '</span>' +
        '<span class="pbody"><span class="pprice">$' + fmt(p.price) + '<small>' + PER[p.unit] + '</small></span>' +
          '<h3>' + esc(p.title) + '</h3>' +
          '<span class="meta">' + esc(qtyText(p.quantity, p.unit)) + ' available</span>' +
          '<span class="meta">' + esc(place(p)) + '</span></span></button>' + pill +
      '<button type="button" class="heart" data-mk="save" data-id="' + esc(p.id) + '" aria-pressed="' + saved + '" aria-label="' +
        (saved ? 'Remove from saved: ' : 'Save: ') + esc(p.title) + '">' + icon('heart') + '</button></li>';
  }

  function activeFilterCount() {
    const f = S.sale;
    return ['prov', 'dist', 'pmin', 'pmax', 'qmin'].filter((k) => String(f[k]).trim() !== '').length;
  }

  function renderSale() {
    if (!S.built) return;
    const f = S.sale;
    $('#mkNotice').hidden = live;
    $('#mkNotice').textContent = 'The market needs a Supabase connection. Add your keys in config.js.';
    const n = activeFilterCount();
    $('#mkFcnt').hidden = !n; $('#mkFcnt').textContent = n;
    renderChips();
    let html = f.rows.map(pcard).join('');
    if (f.loading && !f.rows.length) html = '<li class="skel"></li><li class="skel"></li><li class="skel"></li>';
    $('#mkList').innerHTML = html;
    const empty = $('#mkEmpty');
    empty.hidden = true;
    if (!live) { $('#mkCount').textContent = ''; return; }
    if (f.err) {
      empty.hidden = false;
      empty.innerHTML = '<p class="err">Could not load produce.</p><p class="meta">' + esc(f.err) + '</p><button type="button" class="btn" data-mk="retry" data-id="sale">Try again</button>';
    } else if (f.loaded && !f.rows.length && !f.loading) {
      const filtered = n || f.q.trim() || f.cat !== 'all';
      empty.hidden = false;
      empty.innerHTML = filtered
        ? '<p><b>Nothing matches your search.</b></p><p class="meta">Try another product, a wider area or fewer filters.</p><button type="button" class="btn ghost" data-mk="clear">Clear search and filters</button>'
        : '<p><b>No produce listed yet.</b></p><p class="meta">Be the first. Post your crops or livestock with photos.</p><button type="button" class="btn alt" data-mk="sell">Sell produce</button>';
    }
    $('#mkCount').textContent = f.loaded ? f.total + (f.total === 1 ? ' listing' : ' listings') : (f.loading ? 'Loading produce…' : '');
    $('#mkMore').hidden = !(f.rows.length < f.total);
    const mb = $('#mkMore button'); if (mb) { mb.disabled = f.loading; mb.textContent = f.loading ? 'Loading…' : 'Show more'; }
  }

  function applySale(q) {
    const f = S.sale;
    q = q.eq('status', 'active');
    if (f.cat !== 'all') q = q.eq('category_id', f.cat);
    if (f.prov) q = q.eq('province', f.prov);
    if (f.dist) q = q.eq('district', f.dist);
    const pmin = parseFloat(f.pmin), pmax = parseFloat(f.pmax), qmin = parseFloat(f.qmin);
    if (pmin > 0) q = q.gte('price', pmin);
    if (pmax > 0) q = q.lte('price', pmax);
    if (qmin > 0) q = q.gte('quantity', qmin);
    const t = f.q.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (t) q = q.ilike('title', '%' + t + '%');
    return q;
  }

  async function loadSale(reset) {
    if (!live) { renderSale(); return; }
    const f = S.sale;
    if (reset) { f.page = 0; f.rows = []; f.total = 0; }
    const tok = ++f.tok;
    f.loading = true; f.err = ''; renderSale();
    const from = f.page * PAGE;
    const res = await applySale(sb.from('products').select('*', { count: 'exact' }))
      .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (tok !== f.tok) return;
    f.loading = false; f.loaded = true;
    if (res.error) { f.err = res.error.message; }
    else {
      f.rows = f.rows.concat(res.data.map(norm));
      f.total = res.count == null ? f.rows.length : res.count;
      f.page += 1;
    }
    renderSale();
  }

  /* ---------- buy requests ---------- */
  function rcard(r) {
    const price = r.target_price ? 'Wants to pay about $' + fmt(r.target_price) + ' ' + PER[r.unit] : 'Price open: make an offer';
    let pill = '';
    if (r.status !== 'open') pill = '<span class="pill ' + (r.status === 'fulfilled' ? 'ok' : 'bad') + '">' + esc(r.status === 'fulfilled' ? 'Found a seller' : r.status === 'closed' ? 'Closed' : 'Removed') + '</span> ';
    else if (mine(r)) pill = '<span class="pill sun">Yours</span> ';
    return '<li class="rcard"><button type="button" class="rcard-main" data-mk="ropen" data-id="' + esc(r.id) + '">' +
      '<span>' + pill + '<span class="pill">' + esc(catName(r.category_id)) + '</span></span>' +
      '<h3>Wanted: ' + esc(r.product_name) + '</h3>' +
      '<span><b>' + esc(qtyText(r.quantity, r.unit)) + '</b> needed</span>' +
      '<span class="meta">' + esc(price) + '</span>' +
      '<span class="meta">' + esc(place(r)) + ' · ' + esc(r.contact_name || 'Buyer') + ' · ' + ago(r.created_at) + '</span></button></li>';
  }
  function renderReq() {
    if (!S.built) return;
    const f = S.req;
    renderChips();
    let html = f.rows.map(rcard).join('');
    if (f.loading && !f.rows.length) html = '<li class="skel"></li><li class="skel"></li>';
    $('#mkRList').innerHTML = html;
    const empty = $('#mkREmpty'); empty.hidden = true;
    if (!live) return;
    if (f.err) {
      empty.hidden = false;
      empty.innerHTML = '<p class="err">Could not load buy requests.</p><p class="meta">' + esc(f.err) + '</p><button type="button" class="btn" data-mk="retry" data-id="req">Try again</button>';
    } else if (f.loaded && !f.rows.length && !f.loading) {
      const filtered = f.q.trim() || f.prov || f.cat !== 'all';
      empty.hidden = false;
      empty.innerHTML = filtered
        ? '<p><b>No buy requests match.</b></p><p class="meta">Try another product or province.</p>'
        : '<p><b>No buy requests yet.</b></p><p class="meta">Buyers can post what they need and farmers will contact them.</p><button type="button" class="btn alt" data-mk="rnew">Post a buy request</button>';
    }
    $('#mkRCount').textContent = f.loaded ? f.total + (f.total === 1 ? ' request' : ' requests') + ' open' : (f.loading ? 'Loading requests…' : '');
    $('#mkRMore').hidden = !(f.rows.length < f.total);
    const mb = $('#mkRMore button'); if (mb) { mb.disabled = f.loading; mb.textContent = f.loading ? 'Loading…' : 'Show more'; }
  }
  async function loadReq(reset) {
    if (!live) { renderReq(); return; }
    const f = S.req;
    if (reset) { f.page = 0; f.rows = []; f.total = 0; }
    const tok = ++f.tok;
    f.loading = true; f.err = ''; renderReq();
    let q = sb.from('buyer_requests').select('*', { count: 'exact' }).eq('status', 'open');
    if (f.cat !== 'all') q = q.eq('category_id', f.cat);
    if (f.prov) q = q.eq('province', f.prov);
    const t = f.q.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (t) q = q.ilike('product_name', '%' + t + '%');
    const from = f.page * PAGE;
    const res = await q.order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (tok !== f.tok) return;
    f.loading = false; f.loaded = true;
    if (res.error) f.err = res.error.message;
    else { f.rows = f.rows.concat(res.data); f.total = res.count == null ? f.rows.length : res.count; f.page += 1; }
    renderReq();
  }

  function setTab(t) {
    S.tab = t === 'req' ? 'req' : 'sale';
    document.querySelectorAll('#mkTabs [data-id]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === S.tab)));
    $('#mkSale').hidden = S.tab !== 'sale';
    $('#mkReq').hidden = S.tab !== 'req';
    fab.innerHTML = icon(S.tab === 'sale' ? 'camera' : 'plus') + (S.tab === 'sale' ? 'Sell produce' : 'Post buy request');
    if (S.tab === 'sale' && !S.sale.loaded && !S.sale.loading) loadSale(true);
    if (S.tab === 'req' && !S.req.loaded && !S.req.loading) loadReq(true);
  }

  /* ---------- saved produce ---------- */
  async function loadSavedIds() {
    S.saved = new Set(); S.savedLoaded = false;
    if (!live || !FG.user) { renderSale(); return; }
    const res = await sb.from('saved_listings').select('product_id').limit(1000);
    if (!res.error) { S.saved = new Set(res.data.map((r) => r.product_id)); S.savedLoaded = true; }
    renderSale(); renderSavedProducts();
  }
  async function toggleSave(id) {
    if (!FG.requireAuth('Sign in to save produce.')) return;
    const had = S.saved.has(id);
    if (had) S.saved.delete(id); else S.saved.add(id);
    repaintHearts();
    const res = had
      ? await sb.from('saved_listings').delete().eq('product_id', id)
      : await sb.from('saved_listings').insert({ product_id: id });
    if (res.error && !(res.error.code === '23505')) {
      if (had) S.saved.add(id); else S.saved.delete(id);
      repaintHearts(); toast('Could not save: ' + res.error.message);
      return;
    }
    if (had) S.savedRows = S.savedRows.filter((p) => p.id !== id);
    else toast('Saved. Find it under the heart at the top.');
    renderSavedProducts();
  }
  function repaintHearts() {
    document.querySelectorAll('[data-mk="save"]').forEach((b) => {
      const on = S.saved.has(b.getAttribute('data-id'));
      b.setAttribute('aria-pressed', String(on));
    });
    const sb2 = $('#mkSheetSave');
    if (sb2) { const on = S.saved.has(sb2.getAttribute('data-id')); sb2.setAttribute('aria-pressed', String(on)); sb2.lastChild.textContent = on ? 'Saved' : 'Save'; }
  }
  function ensureSavedBox() {
    let box = $('#mkSavedBox');
    if (box) return box;
    const host = $('#view-saved');
    if (!host) return null;
    box = document.createElement('div');
    box.id = 'mkSavedBox';
    box.innerHTML = '<h2 class="sec-h">Produce</h2><p class="meta" id="mkSavedMsg"></p><ul class="pcards" id="mkSavedList"></ul>' +
      '<div class="empty" id="mkSavedEmpty" hidden><p><b>No saved produce.</b></p><p class="meta">Tap the heart on any listing to keep it here.</p><a class="btn" href="#market">Browse produce</a></div>';
    host.appendChild(box);
    return box;
  }
  async function loadSavedProducts() {
    const box = ensureSavedBox();
    if (!box) return;
    if (!live) { box.hidden = true; return; }
    if (!FG.user) {
      $('#mkSavedList').innerHTML = ''; $('#mkSavedEmpty').hidden = true;
      $('#mkSavedMsg').innerHTML = 'Sign in to save produce. <button type="button" class="btn small" data-auth>Sign in</button>';
      return;
    }
    $('#mkSavedMsg').textContent = 'Loading…';
    const ids = Array.from(S.saved);
    if (!ids.length) { S.savedRows = []; $('#mkSavedMsg').textContent = ''; renderSavedProducts(); return; }
    const res = await sb.from('products').select('*').in('id', ids.slice(0, 100)).neq('status', 'removed');
    if (res.error) { $('#mkSavedMsg').textContent = 'Could not load saved produce: ' + res.error.message; return; }
    S.savedRows = res.data.map(norm);
    $('#mkSavedMsg').textContent = '';
    renderSavedProducts();
  }
  function renderSavedProducts() {
    const box = $('#mkSavedBox');
    if (!box || !FG.user) return;
    const rows = S.savedRows.filter((p) => S.saved.has(p.id));
    $('#mkSavedList').innerHTML = rows.map(pcard).join('');
    $('#mkSavedEmpty').hidden = rows.length > 0 || $('#mkSavedMsg').textContent === 'Loading…';
  }

  /* ---------- product detail ---------- */
  function waProduct(p) {
    return 'Hello ' + (p.seller_name || '') + ', I saw your ' + p.title + ' on FarmGear Zim (' + qtyText(p.quantity, p.unit) + ' at $' + fmt(p.price) + ' ' + PER[p.unit] + '). Is it still available?';
  }
  function openProduct(id) {
    const p = findP(id);
    if (!p) return;
    const own = mine(p);
    const gallery = p.photos.length
      ? '<div class="gallery">' + p.photos.map((u, i) => '<img src="' + esc(u) + '" alt="' + esc(p.title) + ' photo ' + (i + 1) + '" loading="lazy">').join('') + '</div>'
      : '<span class="thumb">' + icon('wheat') + '</span>';
    const status = p.status === 'sold' ? '<span class="pill bad">Sold</span>' : p.status === 'removed' ? '<span class="pill bad">Removed by an administrator</span>' : '<span class="pill ok">Available</span>';
    let acts = '';
    if (own) {
      acts = '<div class="grid2"><button type="button" class="btn ghost" data-mk="edit" data-id="' + esc(p.id) + '">' + icon('edit') + 'Edit</button>' +
        (p.status === 'sold'
          ? '<button type="button" class="btn ghost" data-mk="relist" data-id="' + esc(p.id) + '">Mark available</button>'
          : '<button type="button" class="btn alt" data-mk="sold" data-id="' + esc(p.id) + '">' + icon('check') + 'Mark as sold</button>') + '</div>' +
        '<button type="button" class="btn danger" data-mk="del" data-id="' + esc(p.id) + '">' + icon('trash') + 'Delete listing</button>';
    } else if (p.status === 'active') {
      const wa = FG.waLink(p.contact_phone, waProduct(p));
      acts = '<a class="btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon('phone') + 'WhatsApp the seller</a>' +
        '<div class="grid2"><a class="btn ghost" href="tel:' + esc(p.contact_phone.replace(/[^\d+]/g, '')) + '">' + icon('phone') + 'Call</a>' +
        '<button type="button" class="btn alt" data-mk="enq" data-id="' + esc(p.id) + '">Send enquiry</button></div>' +
        '<div class="grid2"><button type="button" class="btn ghost" id="mkSheetSave" data-mk="save" data-id="' + esc(p.id) + '" aria-pressed="' + S.saved.has(p.id) + '">' + icon('heart') + '<span>' + (S.saved.has(p.id) ? 'Saved' : 'Save') + '</span></button>' +
        '<button type="button" class="btn ghost" data-mk="report" data-id="' + esc(p.id) + '">' + icon('flag') + 'Report</button></div>';
    }
    FG.openSheet(
      gallery + '<p>' + status + '</p>' +
      '<h2>' + esc(p.title) + '</h2>' +
      '<p class="meta">' + esc(catName(p.category_id)) + ' · ' + esc(place(p)) + '</p>' +
      '<div class="price-row"><div class="price hire"><span>Asking price ' + esc(PER[p.unit]) + '</span><b>$' + fmt(p.price) + '</b></div>' +
      '<div class="price buy"><span>Available</span><b>' + esc(qtyText(p.quantity, p.unit)) + '</b></div></div>' +
      (p.description ? '<p class="desc">' + esc(p.description) + '</p>' : '') +
      '<dl><dt>Seller</dt><dd>' + esc(p.seller_name || 'Farmer') + '</dd><dt>Posted</dt><dd>' + esc(day(p.created_at)) + '</dd></dl>' + acts
    );
  }

  /* ---------- enquiry and report ---------- */
  function openEnquiry(kind, id) {
    if (!FG.requireAuth('Sign in to send an enquiry.')) return;
    const p = kind === 'p' ? findP(id) : findR(id);
    if (!p) return;
    if (mine(p)) { toast('This is your own listing.'); return; }
    const isP = kind === 'p';
    const text = isP
      ? 'Hello, I am interested in your ' + p.title + '. Is it still available?'
      : 'Hello, I can supply ' + p.product_name + '. Let us talk about quantity, price and delivery.';
    FG.openSheet(
      '<h2>' + (isP ? 'Send enquiry' : 'Reply to buyer') + '</h2>' +
      '<p class="meta">' + esc(isP ? p.title : 'Wanted: ' + p.product_name) + '</p>' +
      '<form class="form" id="mkEnqForm" style="margin-top:14px" autocomplete="off">' +
        '<label class="field"><span>Your message</span><textarea id="eMsg" maxlength="800" required>' + esc(text) + '</textarea></label>' +
        '<div class="two"><label class="field"><span>' + (isP ? 'Quantity you want' : 'Quantity you can supply') + '</span><input id="eQty" type="number" inputmode="decimal" min="0" step="any" placeholder="Optional"></label>' +
        '<label class="field"><span>' + (isP ? 'Your offer (USD ' + esc(PER[p.unit]) + ')' : 'Your price (USD ' + esc(PER[p.unit]) + ')') + '</span><input id="ePrice" type="number" inputmode="decimal" min="0" step="any" placeholder="Optional"></label></div>' +
        '<label class="field"><span>Your phone or WhatsApp</span><input id="ePhone" type="tel" inputmode="tel" maxlength="20" value="' + esc(FG.profile.phone || '') + '" placeholder="0771 234 567"><small>So they can reply on WhatsApp. Leave empty to reply only in the app.</small></label>' +
        '<p class="err" id="eErr" role="alert"></p>' +
        '<button type="submit" class="btn alt" id="eGo">Send</button></form>');
    $('#mkEnqForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#eErr'), btn = $('#eGo');
      const msg = $('#eMsg').value.trim(), phone = $('#ePhone').value.trim();
      const qty = parseFloat($('#eQty').value), price = parseFloat($('#ePrice').value);
      if (msg.length < 2) { err.textContent = 'Write a short message.'; return; }
      if (phone && !FG.phoneOk(phone)) { err.textContent = 'Check the phone number. Use digits, for example 0771234567.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
      const row = { message: msg, contact_phone: phone || null, quantity_wanted: qty > 0 ? qty : null, offer_price: price > 0 ? price : null };
      if (isP) row.product_id = p.id; else row.buyer_request_id = p.id;
      const res = await sb.from('enquiries').insert(row);
      if (res.error) { err.textContent = res.error.message; btn.disabled = false; btn.textContent = 'Send'; return; }
      FG.closeSheet(); toast('Sent. The ' + (isP ? 'seller' : 'buyer') + ' will see it in Messages.');
      if (S.enq.loaded) loadEnquiries();
    });
  }

  function openReport(kind, id) {
    if (!FG.requireAuth('Sign in to report a listing.')) return;
    FG.openSheet(
      '<h2>Report</h2><p class="meta">Tell us what is wrong. An administrator will check it.</p>' +
      '<form class="form" id="mkRepForm" style="margin-top:14px">' +
        '<label class="field"><span>What is the problem?</span><select id="rReason">' + REASONS.map((r) => '<option value="' + r[0] + '">' + esc(r[1]) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Details (optional)</span><textarea id="rDet" maxlength="500"></textarea></label>' +
        '<p class="err" id="rErr" role="alert"></p><button type="submit" class="btn alt" id="rGo">Send report</button></form>');
    $('#mkRepForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#rGo'); btn.disabled = true; btn.textContent = 'Sending…';
      const row = { reason: $('#rReason').value, details: $('#rDet').value.trim() || null };
      if (kind === 'p') row.product_id = id; else row.buyer_request_id = id;
      const res = await sb.from('listing_reports').insert(row);
      if (res.error) {
        $('#rErr').textContent = res.error.code === '23505' ? 'You already reported this. Thank you.' : res.error.message;
        btn.disabled = false; btn.textContent = 'Send report'; return;
      }
      FG.closeSheet(); toast('Report sent. Thank you.');
    });
  }

  /* ---------- post / edit produce ---------- */
  function renderStrip() {
    const el = $('#mkPrev'); if (!el) return;
    el.innerHTML = photos.map((d, i) =>
      '<div class="pv"><img src="' + esc(d.url) + '" alt="Photo ' + (i + 1) + '">' +
      '<button type="button" data-mk="rmphoto" data-id="' + i + '" aria-label="Remove photo ' + (i + 1) + '">' + icon('close') + '</button></div>').join('');
    $('#mkCnt').textContent = photos.length ? photos.length + ' of ' + MAX_PHOTOS + ' photos' : 'Up to ' + MAX_PHOTOS + ' photos. Clear photos sell faster.';
  }
  function dropPhotoUrls() { photos.forEach((d) => { if (d.file) URL.revokeObjectURL(d.url); }); photos = []; }
  FG.on('sheetclose', dropPhotoUrls);

  async function openForm(p) {
    if (!needLive()) return;
    if (!FG.requireAuth('Sign in to sell your produce.')) return;
    dropPhotoUrls();
    try { S.cats = await FG.loadCats(); S.cats.forEach((c) => { S.catMap[c.id] = c; }); }
    catch (e) { toast('Could not load product types: ' + e.message); return; }
    const edit = !!p;
    const pr = FG.profile;
    unitTouched = edit;
    if (edit) photos = (p.photo_paths || []).map((path, i) => ({ path: path, url: p.photos[i] }));
    const cat0 = edit ? S.catMap[p.category_id] : S.cats[0];
    const unit0 = edit ? p.unit : (cat0 ? cat0.default_unit : 'kg');
    const prov0 = edit ? p.province : (pr.province || '');
    FG.openSheet(
      '<h2>' + (edit ? 'Edit listing' : 'Sell produce') + '</h2>' +
      '<p class="meta">Buyers contact you on WhatsApp or by phone.</p>' +
      '<form class="form" id="mkForm" autocomplete="off" style="margin-top:14px">' +
        '<div class="field"><span>Photos</span><div class="strip" id="mkPrev"></div>' +
          '<label class="btn alt inline" for="mkPhotos" style="justify-self:start">' + icon('camera') + 'Take or choose photos' +
          '<input id="mkPhotos" type="file" accept="image/*" multiple class="sr-file"></label><span class="meta" id="mkCnt"></span></div>' +
        '<label class="field"><span>Product type</span><select id="mkCat">' + S.cats.map((c) => '<option value="' + esc(c.id) + '"' + (cat0 && c.id === cat0.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>What are you selling?</span><input id="mkTitle" type="text" required maxlength="80" value="' + esc(edit ? p.title : '') + '" placeholder="e.g. White maize, grade A"></label>' +
        '<div class="two"><label class="field"><span>How much?</span><input id="mkQty" type="number" inputmode="decimal" min="0" step="any" required value="' + (edit ? esc(p.quantity) : '') + '" placeholder="e.g. 20"></label>' +
        '<label class="field"><span>Unit</span><select id="mkUnit">' + UNITS.map((u) => '<option value="' + u + '"' + (u === unit0 ? ' selected' : '') + '>' + (u === 'animals' ? 'Number of animals' : u) + '</option>').join('') + '</select></label></div>' +
        '<label class="field"><span id="mkPriceLbl">Asking price (USD)</span><input id="mkPrice" type="number" inputmode="decimal" min="0" step="any" required value="' + (edit ? esc(p.price) : '') + '" placeholder="e.g. 280"></label>' +
        '<div class="two"><label class="field"><span>Province</span><select id="mkProvF" required>' + FG.provinceOptions(prov0, 'Choose') + '</select></label>' +
        '<label class="field"><span>District</span><select id="mkDistF">' + FG.districtOptions(prov0, edit ? p.district : pr.district, 'Choose') + '</select></label></div>' +
        '<label class="field"><span>Town or village</span><input id="mkTown" type="text" maxlength="60" value="' + esc(edit ? (p.town || '') : (pr.town || '')) + '" placeholder="Nearest town"></label>' +
        '<label class="field"><span>Phone or WhatsApp</span><input id="mkPhone" type="tel" inputmode="tel" required maxlength="20" value="' + esc(edit ? p.contact_phone : (pr.phone || '')) + '" placeholder="0771 234 567"></label>' +
        '<label class="field"><span>Details (optional)</span><textarea id="mkDesc" maxlength="800" placeholder="Quality, variety, when it can be collected">' + esc(edit ? (p.description || '') : '') + '</textarea></label>' +
        '<p class="err" id="mkErr" role="alert"></p>' +
        '<button type="submit" class="btn alt" id="mkGo">' + (edit ? 'Save changes' : 'Post listing') + '</button></form>');
    renderStrip(); updatePriceLabel();
    $('#mkUnit').addEventListener('change', () => { unitTouched = true; updatePriceLabel(); });
    $('#mkCat').addEventListener('change', () => {
      const c = S.catMap[$('#mkCat').value];
      if (c && !unitTouched) { $('#mkUnit').value = c.default_unit; updatePriceLabel(); }
    });
    $('#mkProvF').addEventListener('change', () => { $('#mkDistF').innerHTML = FG.districtOptions($('#mkProvF').value, '', 'Choose'); });
    $('#mkPhotos').addEventListener('change', function () {
      const files = Array.from(this.files || []);
      const err = $('#mkErr'); err.textContent = '';
      const isImg = (f) => f.type.indexOf('image/') === 0 || !f.type || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name || '');
      if (!files.length) err.textContent = 'No photo was picked. Tap Take or choose photos.';
      for (const f of files) {
        if (photos.length >= MAX_PHOTOS) { err.textContent = 'You can add up to ' + MAX_PHOTOS + ' photos.'; break; }
        if (isImg(f)) photos.push({ file: FG.keep(f), url: URL.createObjectURL(f) });
        else err.textContent = 'That file is not a photo. Pick a JPG or PNG picture.';
      }
      this.value = ''; renderStrip();
    });
    $('#mkForm').addEventListener('submit', (e) => submitForm(e, p));
  }
  function updatePriceLabel() {
    const u = $('#mkUnit') ? $('#mkUnit').value : 'kg';
    if ($('#mkPriceLbl')) $('#mkPriceLbl').textContent = 'Asking price ' + PER[u] + ' (USD)';
  }

  async function submitForm(e, p) {
    e.preventDefault();
    const edit = !!p;
    const err = $('#mkErr'), btn = $('#mkGo');
    const fail = (m) => { err.textContent = m; toast(m); try { err.scrollIntoView({ block: 'center' }); } catch (x) { /* ignore */ } };
    const title = $('#mkTitle').value.trim();
    const qty = parseFloat($('#mkQty').value), price = parseFloat($('#mkPrice').value);
    const phone = $('#mkPhone').value.trim();
    const prov = $('#mkProvF').value;
    if (!photos.length) { fail('Add at least one photo of your produce.'); return; }
    if (title.length < 2) { fail('Write what you are selling.'); return; }
    if (!(qty > 0)) { fail('Enter how much you have.'); return; }
    if (!(price > 0)) { fail('Enter your asking price.'); return; }
    if (!prov) { fail('Choose your province.'); return; }
    if (!FG.phoneOk(phone)) { fail('Check your phone number. Use digits, for example 0771234567.'); return; }
    btn.disabled = true; err.textContent = '';
    const uid = FG.user.id, uploaded = [], keep = [];
    try {
      const stamp = Date.now();
      for (let i = 0; i < photos.length; i++) {
        const d = photos[i];
        if (!d.file) { keep.push(d.path); continue; }
        btn.textContent = 'Uploading photo ' + (i + 1) + ' of ' + photos.length + '…';
        const full = await FG.toBlob(d.file, 1280, false, 0.8);
        const thumb = await FG.toBlob(d.file, 480, false, 0.72);
        const path = uid + '/p-' + stamp + '-' + i + '.jpg';
        let up = await sb.storage.from(FG.BUCKET).upload(path, full, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        uploaded.push(path);
        up = await sb.storage.from(FG.BUCKET).upload(thumbPath(path), thumb, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        uploaded.push(thumbPath(path));
        keep.push(path);
      }
      btn.textContent = 'Saving…';
      const row = {
        category_id: $('#mkCat').value, title: title, description: $('#mkDesc').value.trim() || null,
        quantity: qty, unit: $('#mkUnit').value, price: price, province: prov,
        district: $('#mkDistF').value || null, town: $('#mkTown').value.trim() || null,
        contact_phone: phone, photo_paths: keep
      };
      let res;
      if (edit) res = await sb.from('products').update(row).eq('id', p.id).select().single();
      else { row.owner = uid; row.seller_name = FG.profile.name || null; res = await sb.from('products').insert(row).select().single(); }
      if (res.error) { if (uploaded.length) sb.storage.from(FG.BUCKET).remove(uploaded); throw res.error; }
      if (edit) {
        const gone = (p.photo_paths || []).filter((x) => keep.indexOf(x) === -1);
        if (gone.length) sb.storage.from(FG.BUCKET).remove(gone.concat(gone.map(thumbPath)));
      }
      if (!FG.profile.phone) {   /* remember the number for next time */
        FG.profile.phone = phone;
        sb.from('user_profiles').update({ phone: phone, province: prov, district: row.district }).eq('id', uid).then(() => {});
      }
      FG.closeSheet();
      toast(edit ? 'Listing updated.' : 'Posted. Your produce is live.');
      if (location.hash !== '#market') location.hash = '#market';
      setTab('sale');
      loadSale(true); loadMine();
    } catch (ex) {
      fail(ex.message || 'Could not save. Check your connection and try again.');
      btn.disabled = false; btn.textContent = edit ? 'Save changes' : 'Post listing';
    }
  }

  async function setStatus(id, status) {
    const res = await sb.from('products').update({ status: status }).eq('id', id).select().single();
    if (res.error) { toast(res.error.message); return; }
    FG.closeSheet();
    toast(status === 'sold' ? 'Marked as sold. It no longer shows to buyers.' : 'Listing is available again.');
    loadSale(true); loadMine();
  }
  async function deleteProduct(id) {
    const p = findP(id);
    if (!p) return;
    const ok = await FG.confirm('Delete this listing?', 'It will be removed for good, with its photos.', 'Delete');
    if (!ok) return;
    const res = await sb.from('products').delete().eq('id', id);
    if (res.error) { toast(res.error.message); return; }
    const paths = (p.photo_paths || []);
    if (paths.length) sb.storage.from(FG.BUCKET).remove(paths.concat(paths.map(thumbPath)));
    FG.closeSheet(); toast('Listing deleted.');
    S.saved.delete(id);
    loadSale(true); loadMine();
  }

  /* ---------- buy request detail and form ---------- */
  function openRequest(id) {
    const r = findR(id);
    if (!r) return;
    const own = mine(r);
    const price = r.target_price ? '$' + fmt(r.target_price) : 'Open';
    let acts = '';
    if (own) {
      acts = '<div class="grid2"><button type="button" class="btn ghost" data-mk="redit" data-id="' + esc(r.id) + '">' + icon('edit') + 'Edit</button>' +
        (r.status === 'open'
          ? '<button type="button" class="btn alt" data-mk="rstat" data-id="' + esc(r.id) + '" data-st="fulfilled">' + icon('check') + 'Found a seller</button>'
          : '<button type="button" class="btn ghost" data-mk="rstat" data-id="' + esc(r.id) + '" data-st="open">Open again</button>') + '</div>' +
        (r.status === 'open' ? '<button type="button" class="btn ghost" data-mk="rstat" data-id="' + esc(r.id) + '" data-st="closed">Close request</button>' : '') +
        '<button type="button" class="btn danger" data-mk="rdel" data-id="' + esc(r.id) + '">' + icon('trash') + 'Delete request</button>';
    } else if (r.status === 'open') {
      const wa = FG.waLink(r.contact_phone, 'Hello ' + (r.contact_name || '') + ', I saw your request for ' + qtyText(r.quantity, r.unit) + ' of ' + r.product_name + ' on FarmGear Zim. I can supply. Can we talk?');
      acts = '<a class="btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon('phone') + 'WhatsApp the buyer</a>' +
        '<div class="grid2"><a class="btn ghost" href="tel:' + esc(r.contact_phone.replace(/[^\d+]/g, '')) + '">' + icon('phone') + 'Call</a>' +
        '<button type="button" class="btn alt" data-mk="renq" data-id="' + esc(r.id) + '">Reply in app</button></div>' +
        '<button type="button" class="btn ghost" data-mk="rreport" data-id="' + esc(r.id) + '">' + icon('flag') + 'Report this request</button>';
    }
    FG.openSheet(
      '<p><span class="pill">' + esc(catName(r.category_id)) + '</span> ' + (r.status === 'open' ? '<span class="pill ok">Open</span>' : '<span class="pill bad">' + esc(r.status) + '</span>') + '</p>' +
      '<h2>Wanted: ' + esc(r.product_name) + '</h2>' +
      '<p class="meta">' + esc(place(r)) + '</p>' +
      '<div class="price-row"><div class="price buy"><span>Needed</span><b>' + esc(qtyText(r.quantity, r.unit)) + '</b></div>' +
      '<div class="price hire"><span>Target price ' + esc(PER[r.unit]) + '</span><b>' + esc(price) + '</b></div></div>' +
      (r.notes ? '<p class="desc">' + esc(r.notes) + '</p>' : '') +
      '<dl><dt>Buyer</dt><dd>' + esc(r.contact_name || 'Buyer') + '</dd><dt>Posted</dt><dd>' + esc(day(r.created_at)) + '</dd></dl>' + acts);
  }

  async function openReqForm(r) {
    if (!needLive()) return;
    if (!FG.requireAuth('Sign in to post a buy request.')) return;
    try { S.cats = await FG.loadCats(); S.cats.forEach((c) => { S.catMap[c.id] = c; }); }
    catch (e) { toast('Could not load product types: ' + e.message); return; }
    const edit = !!r, pr = FG.profile;
    const prov0 = edit ? r.province : (pr.province || '');
    const unit0 = edit ? r.unit : (S.cats[0] ? S.cats[0].default_unit : 'kg');
    FG.openSheet(
      '<h2>' + (edit ? 'Edit request' : 'Buy request') + '</h2><p class="meta">Tell farmers what you want to buy. They will contact you.</p>' +
      '<form class="form" id="mkReqForm" autocomplete="off" style="margin-top:14px">' +
        '<label class="field"><span>Product type</span><select id="qCat">' + S.cats.map((c) => '<option value="' + esc(c.id) + '"' + (edit && c.id === r.category_id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>What do you want to buy?</span><input id="qName" type="text" required maxlength="80" value="' + esc(edit ? r.product_name : '') + '" placeholder="e.g. Yellow maize"></label>' +
        '<div class="two"><label class="field"><span>How much?</span><input id="qQty" type="number" inputmode="decimal" min="0" step="any" required value="' + (edit ? esc(r.quantity) : '') + '"></label>' +
        '<label class="field"><span>Unit</span><select id="qUnit">' + UNITS.map((u) => '<option value="' + u + '"' + (u === unit0 ? ' selected' : '') + '>' + (u === 'animals' ? 'Number of animals' : u) + '</option>').join('') + '</select></label></div>' +
        '<label class="field"><span id="qPriceLbl">Target price (USD)</span><input id="qPrice" type="number" inputmode="decimal" min="0" step="any" value="' + (edit && r.target_price ? esc(r.target_price) : '') + '" placeholder="Optional"></label>' +
        '<div class="two"><label class="field"><span>Province</span><select id="qProv" required>' + FG.provinceOptions(prov0, 'Choose') + '</select></label>' +
        '<label class="field"><span>District</span><select id="qDist">' + FG.districtOptions(prov0, edit ? r.district : pr.district, 'Choose') + '</select></label></div>' +
        '<label class="field"><span>Town</span><input id="qTown" type="text" maxlength="60" value="' + esc(edit ? (r.town || '') : (pr.town || '')) + '"></label>' +
        '<label class="field"><span>Your name</span><input id="qWho" type="text" maxlength="80" value="' + esc(edit ? (r.contact_name || '') : (pr.name || '')) + '"></label>' +
        '<label class="field"><span>Phone or WhatsApp</span><input id="qPhone" type="tel" inputmode="tel" required maxlength="20" value="' + esc(edit ? r.contact_phone : (pr.phone || '')) + '" placeholder="0771 234 567"></label>' +
        '<label class="field"><span>Notes (optional)</span><textarea id="qNotes" maxlength="600" placeholder="Quality needed, delivery, when you need it">' + esc(edit ? (r.notes || '') : '') + '</textarea></label>' +
        '<p class="err" id="qErr" role="alert"></p><button type="submit" class="btn alt" id="qGo">' + (edit ? 'Save changes' : 'Post request') + '</button></form>');
    const lbl = () => { $('#qPriceLbl').textContent = 'Target price ' + PER[$('#qUnit').value] + ' (USD)'; };
    lbl();
    $('#qUnit').addEventListener('change', lbl);
    $('#qCat').addEventListener('change', () => {
      const c = S.catMap[$('#qCat').value];
      if (c && !edit) { $('#qUnit').value = c.default_unit; lbl(); }
      if (!$('#qName').value.trim() && c) $('#qName').placeholder = 'e.g. ' + c.name;
    });
    $('#qProv').addEventListener('change', () => { $('#qDist').innerHTML = FG.districtOptions($('#qProv').value, '', 'Choose'); });
    $('#mkReqForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#qErr'), btn = $('#qGo');
      const fail = (m) => { err.textContent = m; toast(m); };
      const name = $('#qName').value.trim(), qty = parseFloat($('#qQty').value), price = parseFloat($('#qPrice').value);
      const phone = $('#qPhone').value.trim(), prov = $('#qProv').value;
      if (name.length < 2) { fail('Write what you want to buy.'); return; }
      if (!(qty > 0)) { fail('Enter how much you need.'); return; }
      if (!prov) { fail('Choose a province.'); return; }
      if (!FG.phoneOk(phone)) { fail('Check your phone number. Use digits, for example 0771234567.'); return; }
      btn.disabled = true; btn.textContent = 'Saving…'; err.textContent = '';
      const row = {
        category_id: $('#qCat').value, product_name: name, quantity: qty, unit: $('#qUnit').value,
        target_price: price > 0 ? price : null, province: prov, district: $('#qDist').value || null,
        town: $('#qTown').value.trim() || null, contact_name: $('#qWho').value.trim() || null,
        contact_phone: phone, notes: $('#qNotes').value.trim() || null
      };
      const res = edit
        ? await sb.from('buyer_requests').update(row).eq('id', r.id).select().single()
        : await sb.from('buyer_requests').insert(Object.assign({ owner: FG.user.id }, row)).select().single();
      if (res.error) { fail(res.error.message); btn.disabled = false; btn.textContent = edit ? 'Save changes' : 'Post request'; return; }
      FG.closeSheet(); toast(edit ? 'Request updated.' : 'Request posted. Farmers can now see it.');
      if (location.hash !== '#market') location.hash = '#market';
      setTab('req'); loadReq(true); loadMine();
    });
  }
  async function setReqStatus(id, st) {
    const res = await sb.from('buyer_requests').update({ status: st }).eq('id', id);
    if (res.error) { toast(res.error.message); return; }
    FG.closeSheet(); toast(st === 'open' ? 'Request is open again.' : 'Request updated.');
    loadReq(true); loadMine();
  }
  async function deleteReq(id) {
    const ok = await FG.confirm('Delete this request?', 'It will be removed for good.', 'Delete');
    if (!ok) return;
    const res = await sb.from('buyer_requests').delete().eq('id', id);
    if (res.error) { toast(res.error.message); return; }
    FG.closeSheet(); toast('Request deleted.'); loadReq(true); loadMine();
  }

  /* ---------- profile: my listings and requests ---------- */
  function ensureMineBox() {
    let box = $('#mkMineBox');
    if (box) return box;
    const host = $('#view-profile');
    if (!host) return null;
    box = document.createElement('div');
    box.id = 'mkMineBox';
    box.innerHTML =
      '<h2 class="sec-h">My produce</h2>' +
      '<div class="row-btns" style="justify-content:flex-start;margin-bottom:12px"><button type="button" class="btn small alt" data-mk="sell">' + icon('plus') + 'Sell produce</button>' +
      '<button type="button" class="btn small ghost" data-mk="rnew">' + icon('plus') + 'Buy request</button></div>' +
      '<ul class="pcards" id="mkMine"></ul><p class="meta" id="mkMineEmpty">Produce you post will show here.</p>' +
      '<h2 class="sec-h">My buy requests</h2><ul class="cards" id="mkMyReq" style="grid-template-columns:1fr"></ul><p class="meta" id="mkMyReqEmpty">Requests you post will show here.</p>';
    host.appendChild(box);
    return box;
  }
  async function loadMine() {
    const box = ensureMineBox();
    if (!box) return;
    if (!live || !FG.user) { S.mine = []; S.myReq = []; renderMine(); box.hidden = !live; return; }
    box.hidden = false;
    const uid = FG.user.id;
    const [a, b] = await Promise.all([
      sb.from('products').select('*').eq('owner', uid).order('created_at', { ascending: false }).limit(100),
      sb.from('buyer_requests').select('*').eq('owner', uid).order('created_at', { ascending: false }).limit(100)
    ]);
    S.mine = a.error ? [] : a.data.map(norm);
    S.myReq = b.error ? [] : b.data;
    renderMine();
  }
  function renderMine() {
    if (!$('#mkMine')) return;
    $('#mkMine').innerHTML = S.mine.map(pcard).join('');
    $('#mkMineEmpty').hidden = S.mine.length > 0;
    $('#mkMyReq').innerHTML = S.myReq.map(rcard).join('');
    $('#mkMyReqEmpty').hidden = S.myReq.length > 0;
  }

  /* ---------- enquiries inside Messages ---------- */
  function ensureEnqBox() {
    let box = $('#mkEnq');
    if (box) return box;
    const host = $('#view-messages');
    if (!host) return null;
    box = document.createElement('div');
    box.id = 'mkEnq';
    box.innerHTML = '<h2 class="sec-h">Produce enquiries</h2>' +
      '<div class="tabs" role="group" aria-label="Enquiries"><button type="button" data-mk="enqtab" data-id="in" aria-pressed="true">Received</button>' +
      '<button type="button" data-mk="enqtab" data-id="out" aria-pressed="false">Sent</button></div>' +
      '<p class="meta" id="enqMsg" aria-live="polite"></p><ul class="alist" id="enqList"></ul><div class="empty" id="enqEmpty" hidden></div>';
    host.appendChild(box);
    return box;
  }
  async function loadEnquiries() {
    const box = ensureEnqBox();
    if (!box) return;
    if (!live) { box.hidden = true; return; }
    box.hidden = !FG.user;
    if (!FG.user) { S.enq.rows = []; FG.extraUnread = 0; FG.paintBadge(); return; }
    const uid = FG.user.id;
    $('#enqMsg').textContent = S.enq.loaded ? '' : 'Loading…';
    const res = await sb.from('enquiries').select('*').or('sender.eq.' + uid + ',recipient.eq.' + uid).order('created_at', { ascending: false }).limit(100);
    if (res.error) { $('#enqMsg').textContent = 'Could not load enquiries: ' + res.error.message; return; }
    S.enq.rows = res.data; S.enq.loaded = true;
    $('#enqMsg').textContent = '';
    renderEnq();
    FG.extraUnread = res.data.filter((e) => e.recipient === uid && e.status === 'new').length;
    FG.paintBadge();
  }
  function renderEnq() {
    if (!$('#enqList') || !FG.user) return;
    const uid = FG.user.id, tab = S.enq.tab;
    document.querySelectorAll('[data-mk="enqtab"]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === tab)));
    const rows = S.enq.rows.filter((e) => (tab === 'in' ? e.recipient === uid : e.sender === uid));
    $('#enqList').innerHTML = rows.map((e) => {
      const incoming = tab === 'in';
      const bits = [];
      if (e.quantity_wanted) bits.push('Quantity: ' + fmt(e.quantity_wanted));
      if (e.offer_price) bits.push('Price: $' + fmt(e.offer_price));
      let acts = '';
      if (incoming) {
        if (e.contact_phone) acts += '<a class="btn wa" href="' + esc(FG.waLink(e.contact_phone, 'Hello ' + (e.sender_name || '') + ', about your enquiry on "' + (e.subject || '') + '" on FarmGear Zim.')) + '" target="_blank" rel="noopener">' + icon('phone') + 'Reply on WhatsApp</a>';
        else acts += '<span class="meta">No phone number given.</span>';
        if (e.status !== 'replied') acts += '<button type="button" class="btn ghost" data-mk="enqdone" data-id="' + esc(e.id) + '">Mark as replied</button>';
      }
      acts += '<button type="button" class="btn ghost" data-mk="enqdel" data-id="' + esc(e.id) + '" aria-label="Delete enquiry">' + icon('trash') + '</button>';
      return '<li class="arow"><h3>' + (e.status === 'new' && incoming ? '<span class="pill sun">New</span> ' : '') + esc(e.subject || 'Enquiry') + '</h3>' +
        '<span class="meta">' + (incoming ? 'From ' + esc(e.sender_name || 'FarmGear user') : 'Sent by you') + ' · ' + ago(e.created_at) + (e.status === 'replied' ? ' · Replied' : '') + '</span>' +
        '<span style="white-space:pre-line">' + esc(e.message) + '</span>' +
        (bits.length ? '<span class="meta">' + esc(bits.join(' · ')) + '</span>' : '') +
        '<div class="mact">' + acts + '</div></li>';
    }).join('');
    const empty = $('#enqEmpty');
    empty.hidden = rows.length > 0;
    empty.innerHTML = tab === 'in'
      ? '<p><b>No enquiries yet.</b></p><p class="meta">When a buyer asks about your produce, it appears here.</p>'
      : '<p><b>You have not sent any enquiries.</b></p><p class="meta">Open any produce listing and tap Send enquiry.</p>';
    if (tab === 'in' && rows.some((e) => e.status === 'new')) {
      sb.from('enquiries').update({ status: 'read' }).eq('recipient', uid).eq('status', 'new').then(() => {
        FG.extraUnread = 0; FG.paintBadge();
      });
    }
  }

  /* ---------- events ---------- */
  let qTimer;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute('data-f') || !view.contains(t)) return;
    const scope = S[t.getAttribute('data-s')], key = t.getAttribute('data-f');
    scope[key] = t.value;
    if (t.tagName === 'SELECT' && key === 'prov' && t.getAttribute('data-s') === 'sale') {
      scope.dist = ''; $('#mkDist').innerHTML = FG.districtOptions(scope.prov, '', 'All districts');
    }
    clearTimeout(qTimer);
    const reload = () => (t.getAttribute('data-s') === 'sale' ? loadSale(true) : loadReq(true));
    if (t.tagName === 'INPUT') qTimer = setTimeout(reload, 350); else reload();
  });
  document.addEventListener('change', (e) => {   /* selects fire "change" on some WebViews instead of "input" */
    const t = e.target;
    if (t && t.tagName === 'SELECT' && t.getAttribute && t.getAttribute('data-f') && view.contains(t) && S[t.getAttribute('data-s')][t.getAttribute('data-f')] !== t.value) {
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-mk]');
    if (!t) return;
    const a = t.getAttribute('data-mk'), id = t.getAttribute('data-id');
    switch (a) {
      case 'tab': setTab(id); break;
      case 'cat': S.sale.cat = id; loadSale(true); break;
      case 'rcat': S.req.cat = id; loadReq(true); break;
      case 'filters': {
        const p = $('#mkPanel'); p.hidden = !p.hidden;
        t.setAttribute('aria-expanded', String(!p.hidden)); break;
      }
      case 'clear': {
        Object.assign(S.sale, { q: '', cat: 'all', prov: '', dist: '', pmin: '', pmax: '', qmin: '' });
        view.querySelectorAll('#mkSale [data-f]').forEach((el) => { el.value = ''; });
        $('#mkDist').innerHTML = FG.districtOptions('', '', 'All districts');
        loadSale(true); break;
      }
      case 'more': if (id === 'sale') loadSale(false); else loadReq(false); break;
      case 'retry': if (id === 'sale') loadSale(true); else loadReq(true); break;
      case 'fab': if (S.tab === 'sale') openForm(); else openReqForm(); break;
      case 'sell': FG.closeSheet(); openForm(); break;
      case 'rnew': openReqForm(); break;
      case 'open': openProduct(id); break;
      case 'save': toggleSave(id); break;
      case 'edit': FG.closeSheet(); openForm(findP(id)); break;
      case 'sold': setStatus(id, 'sold'); break;
      case 'relist': setStatus(id, 'active'); break;
      case 'del': deleteProduct(id); break;
      case 'enq': openEnquiry('p', id); break;
      case 'report': openReport('p', id); break;
      case 'rmphoto': {
        const i = parseInt(id, 10);
        if (photos[i]) { if (photos[i].file) URL.revokeObjectURL(photos[i].url); photos.splice(i, 1); renderStrip(); }
        break;
      }
      case 'ropen': openRequest(id); break;
      case 'redit': FG.closeSheet(); openReqForm(findR(id)); break;
      case 'rstat': setReqStatus(id, t.getAttribute('data-st')); break;
      case 'rdel': deleteReq(id); break;
      case 'renq': openEnquiry('r', id); break;
      case 'rreport': openReport('r', id); break;
      case 'enqtab': S.enq.tab = id; renderEnq(); break;
      case 'enqdone': {
        const res = await sb.from('enquiries').update({ status: 'replied' }).eq('id', id);
        if (res.error) toast(res.error.message);
        else { const r = S.enq.rows.find((x) => x.id === id); if (r) r.status = 'replied'; renderEnq(); }
        break;
      }
      case 'enqdel': {
        const ok = await FG.confirm('Delete this enquiry?', 'It is removed from your list.', 'Delete');
        if (!ok) break;
        const res = await sb.from('enquiries').delete().eq('id', id);
        if (res.error) toast(res.error.message);
        else { S.enq.rows = S.enq.rows.filter((x) => x.id !== id); renderEnq(); }
        break;
      }
      default: break;
    }
  });

  /* ---------- routing and session ---------- */
  async function onRoute() {
    build();
    if (!live) { renderSale(); return; }
    try {
      S.cats = await FG.loadCats();
      S.cats.forEach((c) => { S.catMap[c.id] = c; });
      renderChips();
    } catch (e) { S.sale.err = 'Could not load product types: ' + e.message; }
    setTab(S.tab);
    if (S.sale.loaded) renderSale();
    if (S.req.loaded) renderReq();
  }
  FG.routes.market = onRoute;

  const routeHook = (v) => {
    fab.hidden = v !== 'market' || !live;
    if (v === 'saved') { if (S.savedLoaded || !FG.user) loadSavedProducts(); else loadSavedIds().then(loadSavedProducts); }
    if (v === 'profile') { ensureMineBox(); loadMine(); }
    if (v === 'messages') loadEnquiries();
  };
  FG.on('route', routeHook);
  FG.on('user', () => {
    S.enq = { tab: 'in', rows: [], loaded: false, err: '' };
    S.mine = []; S.myReq = []; S.savedRows = [];
    FG.extraUnread = 0; FG.paintBadge();
    loadSavedIds();
    if (FG.user) { loadEnquiries(); if (FG.view === 'profile') loadMine(); if (FG.view === 'saved') loadSavedProducts(); }
    else { renderMine(); }
    if (S.built) { renderSale(); renderReq(); }
  });
  setInterval(() => { if (!document.hidden && live && FG.user) loadEnquiries(); }, 60000);

  if (FG.view === 'market') onRoute();
  if (FG.view) routeHook(FG.view);
})();
