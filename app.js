/* FarmGear Zim: hire or buy farm equipment in Zimbabwe.
   Plain HTML/CSS/JS. Listings, sign-in and photos use Supabase (see config.js).
   Without keys the app runs in demo mode with sample listings. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n).toLocaleString('en-US');

  /* ---------- Splash (set up first so it always goes away) ---------- */
  const splash = $('#splash');
  if (splash) {
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let done = false;
    const endSplash = () => {
      if (done) return;
      done = true;
      splash.classList.add('out');
      setTimeout(() => splash.remove(), 600);
    };
    splash.addEventListener('click', endSplash);
    setTimeout(endSplash, reduced ? 1000 : 2900);
  }

  /* ---------- Supabase ---------- */
  const cfg = window.FARMGEAR_CONFIG || {};
  const BUCKET = cfg.BUCKET || 'media';
  let sb = null;
  try {
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
  } catch (e) { sb = null; }
  const live = !!sb;

  const CATS = [
    { id: 'tractor', name: 'Tractors' },
    { id: 'tillage', name: 'Ploughs & planters' },
    { id: 'irrigation', name: 'Irrigation & pumps' },
    { id: 'sprayer', name: 'Sprayers' },
    { id: 'trailer', name: 'Trailers' },
    { id: 'processing', name: 'Shellers & mills' }
  ];
  const TOWNS = ['Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Masvingo', 'Chinhoyi', 'Chiredzi', 'Marondera', 'Bindura', 'Kadoma'];
  const catName = (id) => { const c = CATS.find((x) => x.id === id); return c ? c.name : ''; };
  const MAX_PHOTOS = 4;

  /* Demo listings, shown only when Supabase is not connected. Prices are examples. */
  const SAMPLES = [
    { id: 's1', title: 'Massey Ferguson tractor', cat: 'tractor', town: 'Chinhoyi', cond: 'Used, good', hire: 85, buy: 14500,
      specs: [['Power', 'About 75 hp'], ['Drive', '2WD'], ['Hire includes', 'Operator, fuel extra']] },
    { id: 's2', title: 'John Deere 5E tractor', cat: 'tractor', town: 'Harare', cond: 'Used, very good', hire: 95, buy: 28000,
      specs: [['Power', 'About 90 hp'], ['Drive', '4WD'], ['Hire includes', 'Operator']] },
    { id: 's3', title: '3-disc plough', cat: 'tillage', town: 'Gweru', cond: 'Used, good', hire: 25, buy: 900,
      specs: [['Discs', '3'], ['Fits', '70 to 90 hp tractors'], ['Hire per', 'Day, tractor not included']] },
    { id: 's4', title: '4-row maize planter', cat: 'tillage', town: 'Masvingo', cond: 'Used, fair', hire: 40, buy: null,
      specs: [['Rows', '4'], ['Crops', 'Maize, sunflower, beans'], ['Hire per', 'Day']] },
    { id: 's5', title: 'Solar borehole pump kit', cat: 'irrigation', town: 'Bulawayo', cond: 'New', hire: null, buy: 1850,
      specs: [['Includes', 'Pump, panels, controller'], ['Best for', 'Boreholes up to 60 m'], ['Install', 'Available on request']] },
    { id: 's6', title: 'Drip irrigation kit, 1 hectare', cat: 'irrigation', town: 'Chiredzi', cond: 'New', hire: null, buy: 1200,
      specs: [['Covers', '1 hectare'], ['Includes', 'Tape, filters, fittings'], ['Crops', 'Tomatoes, butternut, vegetables']] },
    { id: 's7', title: '16 litre knapsack sprayer', cat: 'sprayer', town: 'Mutare', cond: 'New', hire: null, buy: 35,
      specs: [['Tank', '16 litres'], ['Type', 'Manual lever'], ['Use', 'Herbicide, pesticide, foliar feed']] },
    { id: 's8', title: '400 litre boom sprayer', cat: 'sprayer', town: 'Marondera', cond: 'Used, good', hire: 30, buy: null,
      specs: [['Tank', '400 litres'], ['Boom', '8 m'], ['Hire per', 'Day']] },
    { id: 's9', title: '5 tonne tipper trailer', cat: 'trailer', town: 'Harare', cond: 'Used, good', hire: 60, buy: 4200,
      specs: [['Load', '5 tonnes'], ['Tipping', 'Hydraulic'], ['Hire per', 'Day']] },
    { id: 's10', title: 'Diesel maize sheller', cat: 'processing', town: 'Bindura', cond: 'Used, good', hire: 20, buy: 1100,
      specs: [['Engine', 'Diesel'], ['Output', 'About 1 tonne per hour'], ['Hire per', 'Day']] },
    { id: 's11', title: '3 inch petrol water pump', cat: 'irrigation', town: 'Chiredzi', cond: 'Used, good', hire: 12, buy: 280,
      specs: [['Outlet', '3 inch'], ['Engine', 'Petrol'], ['Hire per', 'Day']] },
    { id: 's12', title: 'Hammer mill', cat: 'processing', town: 'Kadoma', cond: 'Used, fair', hire: 18, buy: 1600,
      specs: [['Use', 'Maize meal, stock feed'], ['Power', 'Electric or tractor PTO'], ['Hire per', 'Day']] }
  ];

  /* ---------- State ---------- */
  const KEY = 'farmgear-zim-v2';
  const blank = { name: '', role: 'Farmer', town: '', phone: '', province: '', district: '', photo: '', avatarPath: '' };
  let store = { profile: Object.assign({}, blank), saved: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      store.profile = Object.assign({}, blank, p.profile || {});
      store.saved = Array.isArray(p.saved) ? p.saved : [];
    }
  } catch (e) { /* storage unavailable */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };

  let mode = 'hire', cat = 'all', view = 'browse';
  let user = null, remote = [], loading = false, loadErr = '';
  let draft = [];
  let convs = [], activeConv = null, msgs = [], chan = null, pollTimer = null;

  const all = () => (live ? remote : SAMPLES);
  const byId = (id) => all().find((l) => l.id === id);
  const isMine = (l) => !!(live && user && l.owner === user.id);

  const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  function fromRow(r) {
    return {
      id: r.id, owner: r.owner, title: r.title, cat: r.cat, town: r.town, cond: r.cond,
      hire: r.hire, buy: r.buy, description: r.description || '', phone: r.contact_phone || '',
      seller: r.seller_name || '', created: r.created_at,
      paths: r.photo_paths || [], photos: (r.photo_paths || []).map(publicUrl)
    };
  }

  async function loadListings() {
    if (!live) return;
    loading = true; loadErr = ''; renderBrowse();
    const res = await sb.from('listings').select('*').order('created_at', { ascending: false }).limit(200);
    loading = false;
    if (res.error) { loadErr = res.error.message; remote = []; }
    else remote = res.data.map(fromRow);
    renderAll();
  }

  const PHONE_RE = /^[+0-9 ()-]{9,20}$/;
  let isAdmin = false;
  async function loadProfile() {
    if (!live || !user) return;
    const res = await sb.from('user_profiles').select('*').eq('id', user.id).maybeSingle();
    if (res.error) { toast(res.error.message); return; }
    if (res.data) {
      const d = res.data, p = store.profile;
      p.name = d.full_name || '';
      p.role = d.user_type || 'Farmer';
      p.town = d.town || '';
      p.phone = d.phone || '';
      p.province = d.province || '';
      p.district = d.district || '';
      p.avatarPath = d.avatar_path || '';
      if (d.avatar_path) p.photo = publicUrl(d.avatar_path);
      isAdmin = d.role === 'admin' && d.status === 'active';
      persist();
    } else {
      await syncProfileNow();
    }
    renderProfile();
    FG.fire('profile');
  }

  async function syncProfileNow() {
    if (!live || !user) return;
    const p = store.profile;
    const row = {
      full_name: p.name || null, user_type: p.role || 'Farmer', town: p.town || null,
      province: p.province || null, district: p.district || null, avatar_path: p.avatarPath || null
    };
    if (!p.phone) row.phone = null; else if (PHONE_RE.test(p.phone)) row.phone = p.phone;
    let res = await sb.from('user_profiles').update(row).eq('id', user.id).select('id');
    if (!res.error && (!res.data || !res.data.length)) {
      res = await sb.from('user_profiles').insert(Object.assign({ id: user.id }, row)).select('id');
    }
    if (res.error) toast(res.error.message);
  }
  let syncTimer;
  const syncProfile = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncProfileNow, 700); };

  /* ---------- Icons and avatar ---------- */
  const icon = (id, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 48 48" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function avatarHTML() {
    const pr = store.profile;
    if (pr.photo) return '<img src="' + esc(pr.photo) + '" alt="">';
    const ini = initials(pr.name);
    return ini ? esc(ini) : icon('person');
  }
  function paintAvatars() {
    if ($('#hdrAvatar')) $('#hdrAvatar').innerHTML = avatarHTML();
    if ($('#bigAvatar')) $('#bigAvatar').innerHTML = avatarHTML();
  }

  /* ---------- Photos ---------- */
  /* Start reading a picked photo straight away. On some Android WebViews the file can no longer be read
     after the file input is cleared, so the bytes are grabbed first and used later. */
  function keep(file) {
    try { if (file && file.arrayBuffer && !file.__data) { file.__data = file.arrayBuffer(); file.__data.catch(function () {}); } } catch (e) { /* ignore */ }
    return file;
  }
  const loadImg = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
  async function decodePhoto(file) {
    let blob = file;
    if (file && file.__data) {
      try { blob = new Blob([await file.__data], { type: file.type || 'image/jpeg' }); } catch (e) { blob = file; }
    }
    if (window.createImageBitmap) {
      try { const bm = await createImageBitmap(blob); return { img: bm, w: bm.width, h: bm.height }; } catch (e) { /* try next way */ }
    }
    try {
      const url = URL.createObjectURL(blob);
      try { const img = await loadImg(url); return { img: img, w: img.naturalWidth, h: img.naturalHeight }; }
      finally { URL.revokeObjectURL(url); }
    } catch (e) { /* try next way */ }
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('read'));
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
    const img = await loadImg(dataUrl);
    return { img: img, w: img.naturalWidth, h: img.naturalHeight };
  }
  async function toBlob(file, max, square, quality) {
    let d;
    try { d = await decodePhoto(file); }
    catch (e) {
      const name = (file && file.name) || '';
      throw new Error(/\.(heic|heif)$/i.test(name)
        ? 'This photo format (HEIC) is not supported. Take the photo again or choose a JPG or PNG.'
        : 'Could not read the photo. Choose it again, or take a new photo.');
    }
    let sx = 0, sy = 0, sw = d.w, sh = d.h, w, h;
    if (square) {
      const s = Math.min(sw, sh);
      sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; w = h = max;
    } else {
      const k = Math.min(1, max / Math.max(sw, sh));
      w = Math.round(sw * k); h = Math.round(sh * k);
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(d.img, sx, sy, sw, sh, 0, 0, w, h);
    if (d.img.close) { try { d.img.close(); } catch (e) { /* ignore */ } }
    return new Promise((resolve, reject) => {
      c.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('Could not process the photo. Try a smaller one.'))), 'image/jpeg', quality || 0.82);
    });
  }
  const blobToDataURL = (b) => new Promise((resolve) => { const f = new FileReader(); f.onload = () => resolve(f.result); f.readAsDataURL(b); });

  async function setAvatar(file) {
    if (!file) return;
    const msg = $('#photoMsg');
    msg.textContent = 'Saving photo…';
    try {
      const blob = await toBlob(file, 256, true, 0.85);
      if (live && user) {
        const path = user.id + '/avatar.jpg';
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (up.error) throw up.error;
        store.profile.avatarPath = path;
        store.profile.photo = publicUrl(path) + '?v=' + Date.now();
        await syncProfileNow();
      } else {
        store.profile.photo = await blobToDataURL(blob);
      }
      persist();
      msg.textContent = 'Photo updated.';
      renderProfile();
    } catch (err) {
      msg.textContent = err.message || 'Photo upload failed. Try again.';
    }
  }

  /* ---------- Cards ---------- */
  function card(l, activeMode) {
    const saved = store.saved.indexOf(l.id) > -1;
    let tags = '';
    if (isMine(l)) tags += '<span class="tag yours">Yours</span>';
    if (l.hire) tags += '<span class="tag hire' + (activeMode === 'hire' ? ' on' : '') + '">Hire ' + money(l.hire) + '/day</span>';
    if (l.buy) tags += '<span class="tag buy' + (activeMode === 'buy' ? ' on' : '') + '">Buy ' + money(l.buy) + '</span>';
    const thumb = l.photos && l.photos[0]
      ? '<img src="' + esc(l.photos[0]) + '" alt="" loading="lazy">'
      : icon(l.cat);
    return '<li class="card">' +
      '<button type="button" class="card-main" data-open="' + esc(l.id) + '">' +
        '<span class="thumb">' + thumb + '</span>' +
        '<span><h3>' + esc(l.title) + '</h3>' +
        '<span class="meta">' + esc(l.town) + ' · ' + esc(l.cond) + '</span>' +
        '<span class="tags">' + tags + '</span></span>' +
      '</button>' +
      '<button type="button" class="heart" data-save="' + esc(l.id) + '" aria-pressed="' + saved + '" aria-label="' +
        (saved ? 'Remove from saved: ' : 'Save: ') + esc(l.title) + '">' + icon('heart') + '</button>' +
    '</li>';
  }

  function filtered() {
    const q = $('#q').value.trim().toLowerCase();
    const town = $('#town').value;
    return all().filter((l) => {
      if (!(mode === 'hire' ? l.hire : l.buy)) return false;
      if (cat !== 'all' && l.cat !== cat) return false;
      if (town && l.town !== town) return false;
      if (q && (l.title + ' ' + l.town + ' ' + catName(l.cat)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function renderChips() {
    let html = '<button type="button" class="chip" data-cat="all" aria-pressed="' + (cat === 'all') + '">All</button>';
    CATS.forEach((c) => {
      html += '<button type="button" class="chip" data-cat="' + c.id + '" aria-pressed="' + (cat === c.id) + '">' + esc(c.name) + '</button>';
    });
    $('#chips').innerHTML = html;
  }

  function renderBrowse() {
    const rows = filtered();
    $('#notice').hidden = live;
    $('#notice').textContent = 'Demo mode. These listings are examples with sample prices. Add your Supabase keys in config.js to go live.';
    $('#loadMsg').textContent = loading ? 'Loading equipment…' : (loadErr ? 'Could not load listings: ' + loadErr : '');
    $('#list').innerHTML = rows.map((l) => card(l, mode)).join('');
    const noneAtAll = live && !remote.length && !loading && !loadErr;
    $('#empty').hidden = rows.length > 0 || loading;
    $('#empty').innerHTML = noneAtAll
      ? '<p><b>No equipment listed yet.</b></p><p class="meta">Be the first to post yours with photos.</p>'
      : '<p><b>Nothing matches yet.</b></p><p class="meta">Try another town or equipment type, or list your own.</p>';
    $('#count').textContent = rows.length + (rows.length === 1 ? ' item' : ' items') + ' to ' + mode;
    document.querySelectorAll('[data-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });
    renderChips();
  }

  function renderSaved() {
    const rows = all().filter((l) => store.saved.indexOf(l.id) > -1);
    $('#savedList').innerHTML = rows.map((l) => card(l, null)).join('');
    $('#savedEmpty').hidden = rows.length > 0;
  }

  function renderProfile() {
    const pr = store.profile;
    $('#pName').value = pr.name;
    $('#pRole').value = pr.role;
    $('#pTown').value = pr.town;
    if ($('#pPhone')) $('#pPhone').value = pr.phone || '';
    if ($('#pProvince')) {
      $('#pProvince').value = pr.province || '';
      $('#pDistrict').innerHTML = districtOptions(pr.province, pr.district, 'Choose your district');
      $('#pDistrict').value = pr.district || '';
    }
    if ($('#adminLink')) $('#adminLink').hidden = !(live && user && isAdmin);
    $('#photoDel').hidden = !pr.photo;
    paintAvatars();

    let acct;
    if (!live) acct = '<p><b>Demo mode</b></p><p class="meta">Add your Supabase keys in config.js to sign in and post equipment.</p>';
    else if (!user) acct = '<p><b>Not signed in</b></p><p class="meta">Sign in to post equipment with photos and keep your profile on every device.</p><button type="button" class="btn small" data-auth>Sign in or create account</button>';
    else acct = '<p><b>Signed in</b></p><p class="meta">' + esc(user.email || '') + '</p><button type="button" class="btn ghost small" data-signout>Sign out</button>';
    $('#acct').innerHTML = acct;

    const mine = all().filter(isMine);
    $('#stSaved').textContent = store.saved.length;
    $('#stMine').textContent = mine.length;
    $('#myList').innerHTML = mine.map((l) => card(l, null)).join('');
    $('#myEmpty').hidden = mine.length > 0;
  }

  const renderAll = () => { renderBrowse(); renderSaved(); renderProfile(); };

  /* ---------- Router ---------- */
  const VIEWS = ['browse', 'saved', 'messages', 'chat', 'profile', 'market', 'prices', 'community', 'admin'];
  const chatId = () => (location.hash || '').slice(1).replace(/^chat-/, '');
  function route() {
    const raw = (location.hash || '#browse').slice(1);
    const h = raw.indexOf('chat-') === 0 ? 'chat' : raw;
    view = VIEWS.indexOf(h) > -1 ? h : 'browse';
    VIEWS.forEach((v) => { const el = $('#view-' + v); if (el) el.hidden = v !== view; });
    const navKey = view === 'chat' ? 'messages' : (view === 'admin' ? 'profile' : view);
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.getAttribute('data-nav') === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-hnav]').forEach((a) => {
      if (a.getAttribute('data-hnav') === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('.nav').hidden = view === 'chat';
    document.body.style.overflow = view === 'chat' ? 'hidden' : '';
    if (view !== 'chat') activeConv = null;
    const fabEl = $('#fab');
    if (fabEl) fabEl.hidden = view !== 'browse';
    if (view === 'saved') renderSaved();
    if (view === 'profile') renderProfile();
    if (view === 'messages') loadConvs();
    if (view === 'chat') showChat(chatId());
    if (view === 'browse' && live && loadErr) loadListings();
    FG.fire('route', view);
    if (FG.routes[view]) { try { FG.routes[view](); } catch (e) { if (window.console) console.error(e); } }
    window.scrollTo(0, 0);
  }

  /* ---------- Sheet and toast ---------- */
  let lastFocus = null;
  function openSheet(html) {
    lastFocus = document.activeElement;
    $('#sheetBody').innerHTML = html;
    $('#overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#sheetX').focus();
  }
  function closeSheet() {
    draft.forEach((d) => URL.revokeObjectURL(d.url));
    draft = [];
    FG.fire('sheetclose');
    $('#overlay').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  /* ---------- Listing detail ---------- */

  function openDetail(id) {
    const l = byId(id);
    if (!l) return;
    let prices = '';
    if (l.hire) prices += '<div class="price hire"><span>Hire per day</span><b>' + money(l.hire) + '</b></div>';
    if (l.buy) prices += '<div class="price buy"><span>Buy</span><b>' + money(l.buy) + '</b></div>';
    let specs = l.specs || [];
    if (!specs.length) {
      specs = [['Seller', l.seller || 'Equipment owner']];
      if (l.created) specs.push(['Posted', new Date(l.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })]);
    }
    const specHtml = specs.map((s) => '<dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd>').join('');
    let foot = '';
    if (isMine(l)) foot = '<button type="button" class="btn ghost" data-remove="' + esc(l.id) + '">Remove my listing</button>';
    else if (!live) foot = '<p class="sheet-note">Sample listing. Price and seller are examples for this preview.</p>';
    const gallery = l.photos && l.photos.length
      ? '<div class="gallery">' + l.photos.map((u, i) => '<img src="' + esc(u) + '" alt="' + esc(l.title) + ' photo ' + (i + 1) + '" loading="lazy">').join('') + '</div>'
      : '<span class="thumb">' + icon(l.cat) + '</span>';
    openSheet(
      gallery +
      '<h2>' + esc(l.title) + '</h2>' +
      '<p class="meta">' + esc(catName(l.cat)) + ' · ' + esc(l.town) + ' · ' + esc(l.cond) + '</p>' +
      '<div class="price-row">' + prices + '</div>' +
      (l.description ? '<p class="desc">' + esc(l.description) + '</p>' : '') +
      '<dl>' + specHtml + '</dl>' +
      chatBtnHtml(l) +
      foot
    );
  }

  /* ---------- Sign in ---------- */
  function openAuth(msg) {
    openSheet(
      '<h2>Sign in</h2>' +
      '<p class="meta">' + esc(msg || 'Use your email to sign in or create an account.') + '</p>' +
      '<form class="form" id="authForm" style="margin-top:14px">' +
        '<label class="field"><span>Email</span><input id="auEmail" type="email" required autocomplete="email"></label>' +
        '<label class="field"><span>Password</span><input id="auPass" type="password" minlength="6" required autocomplete="current-password" placeholder="At least 6 characters"></label>' +
        '<p class="meta" id="auErr" role="alert"></p>' +
        '<button type="submit" class="btn" id="auIn">Sign in</button>' +
        '<button type="button" class="btn ghost" id="auUp">Create account</button>' +
      '</form>'
    );
    async function go(kind) {
      const email = $('#auEmail').value.trim();
      const pass = $('#auPass').value;
      const err = $('#auErr');
      if (!email || pass.length < 6) { err.textContent = 'Enter your email and a password of at least 6 characters.'; return; }
      err.textContent = 'Please wait…';
      try {
        const res = kind === 'up'
          ? await sb.auth.signUp({ email: email, password: pass })
          : await sb.auth.signInWithPassword({ email: email, password: pass });
        if (res.error) throw res.error;
        if (kind === 'up' && !res.data.session) { err.textContent = 'Check your email to confirm your account, then sign in.'; return; }
        closeSheet();
        toast(kind === 'up' ? 'Account created. You are signed in.' : 'Signed in.');
      } catch (e) {
        err.textContent = e.message || 'Could not sign in. Try again.';
      }
    }
    $('#authForm').addEventListener('submit', (e) => { e.preventDefault(); go('in'); });
    $('#auUp').addEventListener('click', () => go('up'));
  }

  /* ---------- Post equipment ---------- */
  function renderStrip() {
    $('#aPrev').innerHTML = draft.map((d, i) =>
      '<div class="pv"><img src="' + d.url + '" alt="Photo ' + (i + 1) + '">' +
      '<button type="button" data-rmphoto="' + i + '" aria-label="Remove photo ' + (i + 1) + '">' + icon('close') + '</button></div>'
    ).join('');
    $('#aCount').textContent = draft.length ? draft.length + ' of ' + MAX_PHOTOS + ' photos' : 'Up to ' + MAX_PHOTOS + ' photos. Clear photos get more calls.';
  }

  function openAdd() {
    if (!live) {
      openSheet('<h2>List equipment</h2><p class="meta">Posting needs a Supabase project. Add your keys in config.js, run supabase.sql, then reload.</p>');
      return;
    }
    if (!user) { openAuth('Sign in to list your equipment.'); return; }
    draft = [];
    const catOpts = CATS.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const townOpts = TOWNS.map((t) => '<option' + (store.profile.town === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
    openSheet(
      '<h2>List equipment</h2>' +
      '<p class="meta">Add photos and a price to hire, to buy, or both.</p>' +
      '<form class="form" id="addForm" autocomplete="off" style="margin-top:14px">' +
        '<div class="field"><span>Photos of the equipment</span>' +
          '<div class="strip" id="aPrev"></div>' +
          '<label class="btn alt inline" for="aPhotos" style="justify-self:start">' + icon('camera') + 'Take or choose photos' +
            '<input id="aPhotos" type="file" accept="image/*" multiple class="sr-file"></label>' +
          '<span class="meta" id="aCount"></span></div>' +
        '<label class="field"><span>What is it?</span><input id="aTitle" type="text" required maxlength="80" placeholder="e.g. Ferguson tractor"></label>' +
        '<label class="field"><span>Type</span><select id="aCat">' + catOpts + '</select></label>' +
        '<label class="field"><span>Town</span><select id="aTown">' + townOpts + '</select></label>' +
        '<label class="field"><span>Condition</span><select id="aCond"><option>New</option><option>Used, very good</option><option selected>Used, good</option><option>Used, fair</option></select></label>' +
        '<label class="field"><span>Hire price per day (USD)</span><input id="aHire" type="text" inputmode="numeric" placeholder="Leave empty if not for hire"></label>' +
        '<label class="field"><span>Selling price (USD)</span><input id="aBuy" type="text" inputmode="numeric" placeholder="Leave empty if not for sale"></label>' +
        '<label class="field"><span>Details (optional)</span><textarea id="aDesc" maxlength="600" placeholder="Power, size, what is included, when it is free"></textarea></label>' +
                '<p class="meta" id="aErr" role="alert" style="color:var(--clay);font-weight:700;font-size:15px"></p>' +
        '<button type="submit" class="btn alt" id="aSubmit">Post listing</button>' +
      '</form>'
    );
    renderStrip();
    $('#aPhotos').addEventListener('change', function () {
      const files = Array.from(this.files || []);
      const isImage = (f) => f.type.indexOf('image/') === 0 || !f.type || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name || '');
      $('#aErr').textContent = '';
      if (!files.length) { $('#aErr').textContent = 'No photo was picked. Tap Take or choose photos and select a picture.'; }
      for (const f of files) {
        if (draft.length >= MAX_PHOTOS) { $('#aErr').textContent = 'You can add up to ' + MAX_PHOTOS + ' photos.'; break; }
        if (isImage(f)) draft.push({ file: keep(f), url: URL.createObjectURL(f) });
        else $('#aErr').textContent = 'That file is not a photo. Pick a JPG or PNG picture.';
      }
      this.value = '';
      renderStrip();
    });
    $('#addForm').addEventListener('submit', submitListing);
  }

  async function submitListing(e) {
    e.preventDefault();
    const err = $('#aErr');
    const fail = (m) => { err.textContent = m; toast(m); try { err.scrollIntoView({ block: 'center' }); } catch (x) { /* ignore */ } };
    const title = $('#aTitle').value.trim();
    const hire = parseInt($('#aHire').value.replace(/[^\d]/g, ''), 10) || null;
    const buy = parseInt($('#aBuy').value.replace(/[^\d]/g, ''), 10) || null;
    if (!draft.length) { fail('Add at least one photo of the equipment.'); return; }
    if (title.length < 2) { fail('Enter what the equipment is.'); return; }
    if (!hire && !buy) { fail('Add a hire price, a selling price, or both.'); return; }
    const btn = $('#aSubmit');
    btn.disabled = true; btn.textContent = 'Posting…'; err.textContent = '';
    try {
      const paths = [];
      for (let i = 0; i < draft.length; i++) {
        btn.textContent = 'Uploading photo ' + (i + 1) + ' of ' + draft.length + '…';
        const blob = await toBlob(draft[i].file, 1280, false, 0.8);
        const path = user.id + '/' + Date.now() + '-' + i + '.jpg';
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        paths.push(path);
      }
      btn.textContent = 'Posting…';
      const ins = await sb.from('listings').insert({
        owner: user.id, title: title, cat: $('#aCat').value, town: $('#aTown').value, cond: $('#aCond').value,
        hire: hire, buy: buy, description: $('#aDesc').value.trim() || null, contact_phone: null,
        seller_name: store.profile.name || null, photo_paths: paths
      });
      if (ins.error) {
        if (paths.length) sb.storage.from(BUCKET).remove(paths);
        throw ins.error;
      }
      mode = hire ? 'hire' : 'buy';
      cat = 'all'; $('#q').value = ''; $('#town').value = '';
      closeSheet();
      if (location.hash !== '#browse') location.hash = '#browse';
      await loadListings();
      toast('Posted. Your equipment is live.');
    } catch (ex) {
      fail(ex.message || 'Could not post. Check your connection and try again.');
      btn.disabled = false; btn.textContent = 'Post listing';
    }
  }

  async function removeListing(id) {
    const l = byId(id);
    if (!l || !live) return;
    const res = await sb.from('listings').delete().eq('id', id);
    if (res.error) { toast(res.error.message); return; }
    if (l.paths && l.paths.length) sb.storage.from(BUCKET).remove(l.paths);
    remote = remote.filter((x) => x.id !== id);
    store.saved = store.saved.filter((s) => s !== id);
    persist(); closeSheet(); renderAll(); toast('Listing removed.');
  }

  /* ---------- Messages ---------- */
  const unreadOf = (c) => !!(user && c.last_sender && c.last_sender !== user.id &&
    new Date(c.last_at) > new Date(user.id === c.buyer ? c.buyer_read_at : c.seller_read_at));
  const otherName = (c) => (user && user.id === c.buyer ? c.seller_name : c.buyer_name) || 'FarmGear user';
  function fmtTime(iso) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function chatBtnHtml(l) {
    if (!live || isMine(l)) return '';
    return '<button type="button" class="btn alt" data-chat="' + esc(l.id) + '">' + icon('chat') + 'Message in app</button>';
  }
  function paintBadge() {
    const n = convs.filter(unreadOf).length + (FG.extraUnread || 0);
    const b = $('#msgBadge');
    if (!b) return;
    b.textContent = n > 9 ? '9+' : String(n);
    b.hidden = n === 0;
  }

  function renderInbox() {
    const empty = $('#inboxEmpty');
    if (!empty || !$('#inboxList')) return;
    const rows = user ? convs.filter((c) => c.last_body || c.buyer === user.id) : [];
    $('#inboxList').innerHTML = rows.map((c) => {
      const un = unreadOf(c);
      return '<li class="card conv"><button type="button" class="conv-main" data-conv="' + esc(c.id) + '">' +
        '<span class="avatar sm">' + (esc(initials(otherName(c))) || icon('person')) + '</span>' +
        '<span class="conv-body"><b>' + esc(otherName(c)) + '</b>' +
        '<span class="meta">' + esc(c.listing_title || 'Equipment') + '</span>' +
        '<span class="conv-last' + (un ? ' unread' : '') + '">' + esc(c.last_body || 'No messages yet. Say hello.') + '</span></span>' +
        '<span class="conv-time">' + fmtTime(c.last_at) + (un ? '<i class="dot"></i>' : '') + '</span>' +
        '</button></li>';
    }).join('');
    if (!live) {
      empty.hidden = false;
      empty.innerHTML = '<p><b>Messaging is switched off.</b></p><p class="meta">Add your Supabase keys in config.js to message owners inside the app.</p>';
    } else if (!user) {
      empty.hidden = false;
      empty.innerHTML = '<p><b>Sign in to see your messages.</b></p><button type="button" class="btn" data-auth>Sign in or create account</button>';
    } else if (!rows.length) {
      empty.hidden = false;
      empty.innerHTML = '<p><b>No messages yet.</b></p><p class="meta">Open any equipment and tap Message in app to talk to the owner.</p><a class="btn" href="#browse">Browse equipment</a>';
    } else {
      empty.hidden = true;
    }
  }

  async function loadConvs() {
    if (!live || !user) { convs = []; paintBadge(); renderInbox(); return; }
    const res = await sb.from('conversations').select('*').order('last_at', { ascending: false }).limit(100);
    if (res.error) { $('#inboxMsg').textContent = 'Could not load messages: ' + res.error.message; return; }
    $('#inboxMsg').textContent = '';
    convs = res.data;
    paintBadge(); renderInbox();
  }
  let convTimer;
  const loadConvsSoon = () => { clearTimeout(convTimer); convTimer = setTimeout(loadConvs, 400); };

  async function startChat(listingId) {
    const l = byId(listingId);
    if (!l) return;
    if (!user) { openAuth('Sign in to message the owner.'); return; }
    if (l.owner === user.id) { toast('This is your own listing.'); return; }
    let found = convs.find((c) => c.listing_id === l.id && c.buyer === user.id);
    if (!found) {
      const res = await sb.from('conversations').insert({ listing_id: l.id, seller: l.owner }).select().single();
      if (res.error) {
        const ex = await sb.from('conversations').select('*').eq('listing_id', l.id).eq('buyer', user.id).maybeSingle();
        if (!ex.data) { toast('Could not start the chat: ' + res.error.message); return; }
        found = ex.data;
      } else {
        found = res.data;
      }
      convs.unshift(found);
    }
    closeSheet();
    location.hash = '#chat-' + found.id;
  }

  function renderMsgs(scroll) {
    const list = $('#chatList');
    if (!msgs.length) {
      list.innerHTML = '<p class="meta chat-empty">No messages yet. Say hello and ask if the equipment is available.</p>';
      return;
    }
    let html = '', lastDay = '';
    msgs.forEach((m) => {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        html += '<div class="day">' + new Date(m.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + '</div>';
      }
      const mine = m.sender === user.id;
      html += '<div class="bub ' + (mine ? 'me' : 'them') + '"><span>' + esc(m.body) + '</span><time>' +
        fmtTime(m.created_at) + (m.pending ? ' · sending' : '') + '</time></div>';
    });
    list.innerHTML = html;
    if (scroll) list.scrollTop = list.scrollHeight;
  }

  async function markRead(id) {
    const c = convs.find((x) => x.id === id);
    if (!c || !user) return;
    const now = new Date().toISOString();
    if (user.id === c.buyer) c.buyer_read_at = now; else c.seller_read_at = now;
    paintBadge(); renderInbox();
    await sb.rpc('mark_read', { p_conv: id });
  }

  async function showChat(id) {
    activeConv = id;
    const list = $('#chatList');
    $('#chatForm').hidden = !(live && user);
    if (!live || !user) {
      $('#chatTitle').textContent = 'Messages';
      $('#chatSub').textContent = '';
      list.innerHTML = '<div class="chat-empty"><p><b>Sign in to read this chat.</b></p>' +
        (live ? '<button type="button" class="btn" data-auth>Sign in or create account</button>' : '') + '</div>';
      return;
    }
    list.innerHTML = '<p class="meta chat-empty">Loading…</p>';
    let c = convs.find((x) => x.id === id);
    if (!c) {
      const r = await sb.from('conversations').select('*').eq('id', id).maybeSingle();
      if (activeConv !== id) return;
      if (!r.data) {
        $('#chatTitle').textContent = 'Chat not found';
        $('#chatSub').textContent = '';
        list.innerHTML = '<p class="meta chat-empty">This chat does not exist or is not yours.</p>';
        return;
      }
      c = r.data; convs.unshift(c);
    }
    $('#chatTitle').textContent = otherName(c);
    $('#chatSub').textContent = c.listing_title || 'Equipment';
    const res = await sb.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(300);
    if (activeConv !== id) return;
    if (res.error) { list.innerHTML = '<p class="meta chat-empty">Could not load messages: ' + esc(res.error.message) + '</p>'; return; }
    msgs = res.data;
    renderMsgs(true);
    markRead(id);
  }

  async function pullMsgs() {
    if (!live || !user || !activeConv || msgs.some((m) => m.pending)) return;
    const id = activeConv;
    const res = await sb.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(300);
    if (res.error || activeConv !== id) return;
    const lastNew = res.data.length ? res.data[res.data.length - 1].id : null;
    const lastOld = msgs.length ? msgs[msgs.length - 1].id : null;
    if (lastNew === lastOld) return;
    msgs = res.data;
    renderMsgs(true);
    markRead(id);
  }

  function onNewMsg(payload) {
    const m = payload && payload.new;
    if (!m || !user) return;
    if (view === 'chat' && m.conversation_id === activeConv) {
      if (msgs.some((x) => x.id === m.id)) return;
      const t = m.sender === user.id ? msgs.findIndex((x) => x.pending && x.body === m.body) : -1;
      if (t > -1) msgs[t] = m; else msgs.push(m);
      renderMsgs(true);
      if (m.sender !== user.id) markRead(activeConv);
    } else if (m.sender !== user.id) {
      toast('New message');
    }
    loadConvsSoon();
  }

  async function sendMsg(e) {
    e.preventDefault();
    const ta = $('#chatText');
    const body = ta.value.trim();
    const cid = activeConv;
    if (!body || !cid || !user) return;
    ta.value = ''; ta.style.height = 'auto';
    const temp = { id: 'tmp' + Date.now(), conversation_id: cid, sender: user.id, body: body, created_at: new Date().toISOString(), pending: true };
    msgs.push(temp); renderMsgs(true);
    const res = await sb.from('messages').insert({ conversation_id: cid, body: body }).select().single();
    const idx = msgs.indexOf(temp);
    if (res.error) {
      if (idx > -1) msgs.splice(idx, 1);
      if (activeConv === cid) { renderMsgs(); if (!ta.value) ta.value = body; }
      toast('Not sent: ' + res.error.message);
      return;
    }
    if (idx > -1) {
      if (msgs.some((x) => x.id === res.data.id)) msgs.splice(idx, 1); else msgs[idx] = res.data;
    }
    if (activeConv === cid) renderMsgs(true);
    loadConvsSoon();
  }

  function setupChat() {
    if (chan) { sb.removeChannel(chan); chan = null; }
    clearInterval(pollTimer);
    if (!live || !user) {
      convs = []; msgs = [];
      paintBadge(); renderInbox();
      if (view === 'chat') showChat(chatId());
      return;
    }
    chan = sb.channel('fg-chat-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onNewMsg)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, loadConvsSoon)
      .subscribe();
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      loadConvs();
      if (view === 'chat') pullMsgs();
    }, 20000);
    loadConvs();
    if (view === 'chat') showChat(chatId());
  }

  if ($('#chatForm') && $('#chatText')) {
    $('#chatForm').addEventListener('submit', sendMsg);
    $('#chatText').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    $('#chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMsg(e); });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !live || !user) return;
    loadConvs();
    if (view === 'chat') pullMsgs();
  });

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-save],[data-cat],[data-mode],[data-remove],[data-rmphoto],[data-auth],[data-signout],[data-chat],[data-conv]');
    if (!t) return;
    if (t.hasAttribute('data-save')) {
      const id = t.getAttribute('data-save');
      const i = store.saved.indexOf(id);
      if (i > -1) store.saved.splice(i, 1); else store.saved.push(id);
      persist(); renderBrowse(); renderSaved(); renderProfile();
    } else if (t.hasAttribute('data-open')) {
      openDetail(t.getAttribute('data-open'));
    } else if (t.hasAttribute('data-cat')) {
      cat = t.getAttribute('data-cat'); renderBrowse();
    } else if (t.hasAttribute('data-mode')) {
      mode = t.getAttribute('data-mode'); renderBrowse();
    } else if (t.hasAttribute('data-remove')) {
      removeListing(t.getAttribute('data-remove'));
    } else if (t.hasAttribute('data-rmphoto')) {
      const idx = parseInt(t.getAttribute('data-rmphoto'), 10);
      if (draft[idx]) { URL.revokeObjectURL(draft[idx].url); draft.splice(idx, 1); renderStrip(); }
    } else if (t.hasAttribute('data-chat')) {
      startChat(t.getAttribute('data-chat'));
    } else if (t.hasAttribute('data-conv')) {
      location.hash = '#chat-' + t.getAttribute('data-conv');
    } else if (t.hasAttribute('data-auth')) {
      openAuth();
    } else if (t.hasAttribute('data-signout')) {
      sb.auth.signOut().then(() => toast('Signed out.'));
    }
  });

  $('#q').addEventListener('input', renderBrowse);
  $('#town').addEventListener('change', renderBrowse);
  $('#addBtn').addEventListener('click', openAdd);
  if ($('#fab')) $('#fab').addEventListener('click', openAdd);
  $('#addBtn2').addEventListener('click', openAdd);
  $('#sheetX').addEventListener('click', closeSheet);
  $('#overlay').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });

  $('#photoIn').addEventListener('change', function () { setAvatar(keep(this.files && this.files[0])); this.value = ''; });
  $('#photoDel').addEventListener('click', async () => {
    if (live && user && store.profile.avatarPath) sb.storage.from(BUCKET).remove([store.profile.avatarPath]);
    store.profile.photo = ''; store.profile.avatarPath = '';
    persist(); syncProfile();
    $('#photoMsg').textContent = 'Photo removed.';
    renderProfile();
  });
  function bindField(id, key, after) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', function () {
      store.profile[key] = this.value; if (after) after(); persist(); paintAvatars(); syncProfile();
    });
  }
  bindField('#pName', 'name'); bindField('#pRole', 'role'); bindField('#pTown', 'town');
  bindField('#pPhone', 'phone');
  bindField('#pProvince', 'province', () => {
    store.profile.district = '';
    $('#pDistrict').innerHTML = districtOptions(store.profile.province, '', 'Choose your district');
  });
  bindField('#pDistrict', 'district');

  window.addEventListener('hashchange', route);

  /* ---------- Auth state ---------- */
  function afterAuth() {
    renderProfile(); renderBrowse();
    if (user) setTimeout(loadProfile, 0);
    setTimeout(loadListings, 0);
    setupChat();
    if (!user) isAdmin = false;
    FG.fire('user', user);
  }
  if (live) {
    sb.auth.getSession().then((r) => {
      const u = r.data && r.data.session ? r.data.session.user : null;
      if ((u && u.id) !== (user && user.id)) { user = u; afterAuth(); }
      else loadListings();
    });
    sb.auth.onAuthStateChange((event, session) => {
      const u = session ? session.user : null;
      if ((u && u.id) === (user && user.id)) return;
      const signedOut = !u && user;
      user = u;
      if (signedOut) { store.profile = Object.assign({}, blank); persist(); }
      afterAuth();
    });
  }

  /* ---------- Shared API for the marketplace, prices and admin modules ---------- */
  const PROVINCES = {
    'Bulawayo': ['Bulawayo'],
    'Harare': ['Harare', 'Chitungwiza', 'Epworth', 'Ruwa'],
    'Manicaland': ['Buhera', 'Chimanimani', 'Chipinge', 'Makoni', 'Mutare', 'Mutasa', 'Nyanga'],
    'Mashonaland Central': ['Bindura', 'Guruve', 'Mazowe', 'Mbire', 'Mount Darwin', 'Muzarabani', 'Rushinga', 'Shamva'],
    'Mashonaland East': ['Chikomba', 'Goromonzi', 'Hwedza', 'Marondera', 'Mudzi', 'Murehwa', 'Mutoko', 'Seke', 'Uzumba-Maramba-Pfungwe'],
    'Mashonaland West': ['Chegutu', 'Hurungwe', 'Kariba', 'Makonde', 'Mhondoro-Ngezi', 'Sanyati', 'Zvimba'],
    'Masvingo': ['Bikita', 'Chiredzi', 'Chivi', 'Gutu', 'Masvingo', 'Mwenezi', 'Zaka'],
    'Matabeleland North': ['Binga', 'Bubi', 'Hwange', 'Lupane', 'Nkayi', 'Tsholotsho', 'Umguza'],
    'Matabeleland South': ['Beitbridge', 'Bulilima', 'Gwanda', 'Insiza', 'Mangwe', 'Matobo', 'Umzingwane'],
    'Midlands': ['Chirumhanzu', 'Gokwe North', 'Gokwe South', 'Gweru', 'Kwekwe', 'Mberengwa', 'Shurugwi', 'Zvishavane']
  };
  function provinceOptions(sel, placeholder) {
    return '<option value="">' + esc(placeholder || 'All provinces') + '</option>' +
      Object.keys(PROVINCES).map((p) => '<option' + (p === sel ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
  }
  function districtOptions(prov, sel, placeholder) {
    return '<option value="">' + esc(placeholder || 'All districts') + '</option>' +
      (PROVINCES[prov] || []).map((d) => '<option' + (d === sel ? ' selected' : '') + '>' + esc(d) + '</option>').join('');
  }

  function askConfirm(title, msg, okLabel) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'overlay confirm';
      wrap.innerHTML = '<div class="sheet" role="alertdialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<h2>' + esc(title) + '</h2><p class="desc">' + esc(msg) + '</p>' +
        '<button type="button" class="btn alt" data-y>' + esc(okLabel || 'Yes') + '</button>' +
        '<button type="button" class="btn ghost" data-n>Cancel</button></div>';
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-y]')) done(true);
        else if (e.target.closest('[data-n]') || e.target === wrap) done(false);
      });
      document.body.appendChild(wrap);
      const y = wrap.querySelector('[data-y]'); if (y) y.focus();
    });
  }

  let catsPromise = null;
  function loadCats(force) {
    if (!live) return Promise.resolve([]);
    if (!catsPromise || force) {
      catsPromise = sb.from('product_categories').select('*').eq('active', true).order('sort_order')
        .then((r) => { if (r.error) { catsPromise = null; throw r.error; } return r.data; });
    }
    return catsPromise;
  }

  const FG = window.FG = {
    sb: sb, live: live, esc: esc, money: money, icon: icon, toast: toast, BUCKET: BUCKET,
    openSheet: openSheet, closeSheet: closeSheet, openAuth: openAuth, toBlob: toBlob, keep: keep, publicUrl: publicUrl,
    confirm: askConfirm, loadCats: loadCats, PROVINCES: PROVINCES,
    provinceOptions: provinceOptions, districtOptions: districtOptions,
    routes: {}, extraUnread: 0, paintBadge: paintBadge,
    get user() { return user; },
    get view() { return view; },
    get profile() { return store.profile; },
    get isAdmin() { return !!(live && user && isAdmin); },
    _h: {},
    on: function (name, fn) { (FG._h[name] = FG._h[name] || []).push(fn); },
    fire: function (name, arg) {
      (FG._h[name] || []).forEach((fn) => { try { fn(arg); } catch (e) { if (window.console) console.error(e); } });
    },
    requireAuth: function (msg) {
      if (!live) { toast('Connect Supabase in config.js first.'); return false; }
      if (!user) { openAuth(msg || 'Sign in to continue.'); return false; }
      return true;
    },
    phoneOk: (v) => PHONE_RE.test(String(v || '').trim()),
    /* Zimbabwe numbers: 0771234567 or +263771234567 -> 263771234567 for wa.me links */
    waNumber: function (v) {
      let d = String(v || '').replace(/[^\d]/g, '');
      if (d.indexOf('00') === 0) d = d.slice(2);
      if (d.charAt(0) === '0') d = '263' + d.slice(1);
      return d;
    },
    waLink: function (phone, text) {
      return 'https://wa.me/' + FG.waNumber(phone) + (text ? '?text=' + encodeURIComponent(text) : '');
    }
  };

  /* ---------- Init ---------- */
  const townOptions = TOWNS.map((t) => '<option>' + t + '</option>').join('');
  $('#town').innerHTML = '<option value="">All towns</option>' + townOptions;
  $('#pTown').innerHTML = '<option value="">Choose your town</option>' + townOptions;
  renderAll();
  route();

})();
