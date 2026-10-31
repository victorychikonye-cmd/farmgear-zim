/* FarmGear Zim: hire or buy farm equipment in Zimbabwe.
   Plain HTML/CSS/JS. Listings, sign-in and photos use Supabase (see config.js).
   Without keys the app runs in demo mode with sample listings. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n).toLocaleString('en-US');

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
  const blank = { name: '', role: 'Farmer', town: '', phone: '', photo: '', avatarPath: '' };
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

  async function loadProfile() {
    if (!live || !user) return;
    const res = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (res.error) { toast(res.error.message); return; }
    if (res.data) {
      const d = res.data;
      store.profile.name = d.name || '';
      store.profile.role = d.role || 'Farmer';
      store.profile.town = d.town || '';
      store.profile.phone = d.phone || '';
      store.profile.avatarPath = d.avatar_path || '';
      if (d.avatar_path) store.profile.photo = publicUrl(d.avatar_path);
      persist();
    } else {
      syncProfileNow();
    }
    renderProfile();
  }

  async function syncProfileNow() {
    if (!live || !user) return;
    const p = store.profile;
    const res = await sb.from('profiles').upsert({
      id: user.id, name: p.name, role: p.role, town: p.town, phone: p.phone,
      avatar_path: p.avatarPath || null, updated_at: new Date().toISOString()
    });
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
    $('#hdrAvatar').innerHTML = avatarHTML();
    $('#bigAvatar').innerHTML = avatarHTML();
  }

  /* ---------- Photos ---------- */
  function toBlob(file, max, square, quality) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read the photo.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a photo. Pick a JPG or PNG.'));
        img.onload = () => {
          let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
          if (square) {
            const s = Math.min(sw, sh);
            sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; w = h = max;
          } else {
            const k = Math.min(1, max / Math.max(sw, sh));
            w = Math.round(sw * k); h = Math.round(sh * k);
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', quality || 0.82);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
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
    $('#pPhone').value = pr.phone;
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
  const VIEWS = ['browse', 'saved', 'profile'];
  function route() {
    const h = (location.hash || '#browse').slice(1);
    view = VIEWS.indexOf(h) > -1 ? h : 'browse';
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.getAttribute('data-nav') === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (view === 'saved') renderSaved();
    if (view === 'profile') renderProfile();
    if (view === 'browse' && live && loadErr) loadListings();
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
  function waNumber(p) {
    let d = (p || '').replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (d.indexOf('0') === 0) d = '263' + d.slice(1);
    return d;
  }

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
    const want = mode === 'buy' && l.buy ? 'buy' : (l.hire ? 'hire' : 'buy');
    const msg = 'Hi, I saw "' + l.title + '" in ' + l.town + ' on FarmGear Zim. Is it still available to ' + want + '?';
    const num = waNumber(l.phone);
    const wa = 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
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
      '<a class="btn" href="' + wa + '" target="_blank" rel="noopener">' + icon('whatsapp') + 'Message on WhatsApp</a>' +
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
        '<div class="field"><span>Photos</span>' +
          '<div class="strip" id="aPrev"></div>' +
          '<label class="btn ghost inline" for="aPhotos" style="justify-self:start">Add photos' +
            '<input id="aPhotos" type="file" accept="image/*" multiple class="sr-file"></label>' +
          '<span class="meta" id="aCount"></span></div>' +
        '<label class="field"><span>What is it?</span><input id="aTitle" type="text" required maxlength="80" placeholder="e.g. Ferguson tractor"></label>' +
        '<label class="field"><span>Type</span><select id="aCat">' + catOpts + '</select></label>' +
        '<label class="field"><span>Town</span><select id="aTown">' + townOpts + '</select></label>' +
        '<label class="field"><span>Condition</span><select id="aCond"><option>New</option><option>Used, very good</option><option selected>Used, good</option><option>Used, fair</option></select></label>' +
        '<label class="field"><span>Hire price per day (USD)</span><input id="aHire" type="text" inputmode="numeric" placeholder="Leave empty if not for hire"></label>' +
        '<label class="field"><span>Selling price (USD)</span><input id="aBuy" type="text" inputmode="numeric" placeholder="Leave empty if not for sale"></label>' +
        '<label class="field"><span>Details (optional)</span><textarea id="aDesc" maxlength="600" placeholder="Power, size, what is included, when it is free"></textarea></label>' +
        '<label class="field"><span>WhatsApp number</span><input id="aPhone" type="tel" inputmode="tel" required placeholder="+263 77 000 0000" value="' + esc(store.profile.phone) + '"></label>' +
        '<p class="meta" id="aErr" role="alert"></p>' +
        '<button type="submit" class="btn alt" id="aSubmit">Post listing</button>' +
      '</form>'
    );
    renderStrip();
    $('#aPhotos').addEventListener('change', function () {
      const files = Array.from(this.files || []);
      for (const f of files) {
        if (draft.length >= MAX_PHOTOS) { $('#aErr').textContent = 'You can add up to ' + MAX_PHOTOS + ' photos.'; break; }
        if (f.type.indexOf('image/') === 0) draft.push({ file: f, url: URL.createObjectURL(f) });
      }
      this.value = '';
      renderStrip();
    });
    $('#addForm').addEventListener('submit', submitListing);
  }

  async function submitListing(e) {
    e.preventDefault();
    const err = $('#aErr');
    const title = $('#aTitle').value.trim();
    const hire = parseInt($('#aHire').value.replace(/[^\d]/g, ''), 10) || null;
    const buy = parseInt($('#aBuy').value.replace(/[^\d]/g, ''), 10) || null;
    const phone = $('#aPhone').value.trim();
    if (title.length < 2) { err.textContent = 'Enter what the equipment is.'; return; }
    if (!hire && !buy) { err.textContent = 'Add a hire price, a selling price, or both.'; return; }
    if (waNumber(phone).length < 9) { err.textContent = 'Enter a WhatsApp number buyers can reach you on.'; return; }
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
        hire: hire, buy: buy, description: $('#aDesc').value.trim() || null, contact_phone: phone,
        seller_name: store.profile.name || null, photo_paths: paths
      });
      if (ins.error) {
        if (paths.length) sb.storage.from(BUCKET).remove(paths);
        throw ins.error;
      }
      if (!store.profile.phone) { store.profile.phone = phone; persist(); syncProfile(); }
      mode = hire ? 'hire' : 'buy';
      cat = 'all'; $('#q').value = ''; $('#town').value = '';
      closeSheet();
      if (location.hash !== '#browse') location.hash = '#browse';
      await loadListings();
      toast('Posted. Your equipment is live.');
    } catch (ex) {
      err.textContent = ex.message || 'Could not post. Check your connection and try again.';
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

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-save],[data-cat],[data-mode],[data-remove],[data-rmphoto],[data-auth],[data-signout]');
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
    } else if (t.hasAttribute('data-auth')) {
      openAuth();
    } else if (t.hasAttribute('data-signout')) {
      sb.auth.signOut().then(() => toast('Signed out.'));
    }
  });

  $('#q').addEventListener('input', renderBrowse);
  $('#town').addEventListener('change', renderBrowse);
  $('#addBtn').addEventListener('click', openAdd);
  $('#addBtn2').addEventListener('click', openAdd);
  $('#sheetX').addEventListener('click', closeSheet);
  $('#overlay').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });

  $('#photoIn').addEventListener('change', function () { setAvatar(this.files && this.files[0]); this.value = ''; });
  $('#photoDel').addEventListener('click', async () => {
    if (live && user && store.profile.avatarPath) sb.storage.from(BUCKET).remove([store.profile.avatarPath]);
    store.profile.photo = ''; store.profile.avatarPath = '';
    persist(); syncProfile();
    $('#photoMsg').textContent = 'Photo removed.';
    renderProfile();
  });
  function bindField(id, key) {
    $(id).addEventListener('input', function () {
      store.profile[key] = this.value; persist(); paintAvatars(); syncProfile();
    });
  }
  bindField('#pName', 'name'); bindField('#pRole', 'role'); bindField('#pTown', 'town'); bindField('#pPhone', 'phone');

  window.addEventListener('hashchange', route);

  /* ---------- Auth state ---------- */
  function afterAuth() {
    renderProfile(); renderBrowse();
    if (user) setTimeout(loadProfile, 0);
    setTimeout(loadListings, 0);
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

  /* ---------- Init ---------- */
  const townOptions = TOWNS.map((t) => '<option>' + t + '</option>').join('');
  $('#town').innerHTML = '<option value="">All towns</option>' + townOptions;
  $('#pTown').innerHTML = '<option value="">Choose your town</option>' + townOptions;
  renderAll();
  route();

  /* ---------- Splash ---------- */
  const splash = $('#splash');
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done = false;
  function endSplash() {
    if (done) return;
    done = true;
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 600);
  }
  splash.addEventListener('click', endSplash);
  setTimeout(endSplash, reduced ? 1000 : 2900);
})();
