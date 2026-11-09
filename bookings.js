/* FarmGear Zim: bookings, reviews and trust.
   Renters ask to hire equipment for dates; owners accept or decline. After a hire is marked completed both sides can
   leave a rating. Administrators review "Get verified" requests. Tables: bookings, listing_busy, reviews,
   public_profiles, verification_requests (see booking_trust.sql). No ID documents are collected. */
(function () {
  'use strict';
  const FG = window.FG;
  if (!FG) return;
  const esc = FG.esc, icon = FG.icon, toast = FG.toast, sb = FG.sb, live = FG.live;
  const $ = (s, r) => (r || document).querySelector(s);
  const view = $('#view-bookings');
  const S = { tab: 'renter', rows: [], reviewed: {}, loading: false, err: '' };
  const trustCache = {};

  /* Zimbabwe is UTC+2 all year */
  const todayStr = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const parse = (s) => new Date(s + 'T00:00:00Z');
  const dShort = (s) => parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dLong = (s) => parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const range = (b) => (b.start_date === b.end_date ? dShort(b.start_date) : dShort(b.start_date) + ' to ' + dShort(b.end_date));
  const nice = (m) => String(m || '').replace(/^.*?(exception|ERROR):\s*/i, '');
  const friendly = (e) => {
    const m = (e && e.message) || '';
    if (/conflicting key value|exclusion/i.test(m)) return 'Those dates overlap another accepted booking for this equipment.';
    return nice(m) || 'Something went wrong. Try again.';
  };

  /* ---------- trust line on listings ---------- */
  function stars(avg) {
    const n = Math.round(avg);
    let h = '';
    for (let i = 1; i <= 5; i++) h += '<span class="star' + (i <= n ? ' on' : '') + '">' + icon('star') + '</span>';
    return '<span class="stars" role="img" aria-label="' + Number(avg).toFixed(1) + ' out of 5">' + h + '</span>';
  }
  function trustHtml(p, uid) {
    if (!p) return '<span class="meta">New member</span>';
    const mine = FG.user && FG.user.id === uid;
    return (p.verified ? '<span class="pill ok vbadge">' + icon('shield') + 'Verified</span> ' : '<span class="pill">Not verified yet</span> ') +
      (p.rating_count ? '<button type="button" class="linkbtn" data-bk="reviews" data-id="' + esc(uid) + '">' + stars(p.rating_avg) + ' ' + Number(p.rating_avg).toFixed(1) + ' (' + p.rating_count + ')</button>' : '<span class="meta">No reviews yet</span>') +
      '<span class="meta"> · ' + p.jobs_done + ' hire' + (p.jobs_done === 1 ? '' : 's') + ' done · member since ' + esc(new Date(p.member_since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })) + (mine ? ' (you)' : '') + '</span>';
  }
  async function getTrust(uid) {
    if (trustCache[uid] !== undefined) return trustCache[uid];
    const r = await sb.from('public_profiles').select('*').eq('id', uid).maybeSingle();
    trustCache[uid] = r.error ? null : r.data;
    return trustCache[uid];
  }
  FG.on('sheetopen', () => {
    document.querySelectorAll('#sheetBody [data-trust]').forEach(async (el) => {
      const uid = el.getAttribute('data-trust');
      try { el.innerHTML = trustHtml(await getTrust(uid), uid); } catch (e) { el.innerHTML = ''; }
    });
  });

  async function openReviews(uid) {
    FG.openSheet('<h2>Reviews</h2><p class="meta">Loading…</p>');
    const [p, r] = await Promise.all([getTrust(uid), sb.from('reviews').select('*').eq('reviewee', uid).order('created_at', { ascending: false }).limit(30)]);
    if (r.error) { FG.openSheet('<h2>Reviews</h2><p class="meta">Could not load reviews.</p>'); return; }
    FG.openSheet('<h2>Reviews</h2><div class="trust">' + trustHtml(p, uid) + '</div>' +
      (r.data.length ? '<ul class="revlist">' + r.data.map((x) => '<li>' + stars(x.rating) + ' <b>' + esc(x.reviewer_name || 'Member') + '</b> <span class="meta">' + esc(dLong(x.created_at.slice(0, 10))) + '</span>' +
        (x.comment ? '<p>' + esc(x.comment) + '</p>' : '') + '</li>').join('') + '</ul>' : '<p class="meta">No reviews yet.</p>'));
  }

  /* ---------- book equipment ---------- */
  async function openBook(id) {
    if (!FG.requireAuth('Sign in to book equipment.')) return;
    const l = FG.listing(id);
    if (!l) return;
    FG.openSheet('<h2>Book ' + esc(l.title) + '</h2><p class="meta">Loading dates…</p>');
    const t = todayStr();
    const b = await sb.from('listing_busy').select('start_date,end_date').eq('listing_id', id).gte('end_date', t).order('start_date');
    const busy = b.error ? [] : b.data;
    const today = t;
    FG.openSheet(
      '<h2>Book ' + esc(l.title) + '</h2>' +
      '<p class="meta">' + esc(l.town) + ' · ' + esc(FG.money(l.hire)) + ' per day</p>' +
      '<div class="banner" style="margin-top:10px">' + (busy.length
        ? '<b>Already booked:</b> ' + busy.map((x) => esc(range(x))).join(', ')
        : 'No booked dates. All days are free.') + '</div>' +
      '<form class="form" id="bkForm" autocomplete="off">' +
        '<label class="field"><span>First day</span><input id="bkStart" type="date" min="' + today + '" required></label>' +
        '<label class="field"><span>Last day</span><input id="bkEnd" type="date" min="' + today + '" required></label>' +
        '<label class="field"><span>Your phone or WhatsApp</span><input id="bkPhone" type="tel" inputmode="tel" maxlength="20" required value="' + esc((FG.profile && FG.profile.phone) || '') + '" placeholder="e.g. 0771 234 567"></label>' +
        '<label class="field"><span>Where is the work? (farm, town)</span><input id="bkLoc" type="text" maxlength="100"></label>' +
        '<label class="field"><span>Note for the owner (optional)</span><textarea id="bkNote" rows="3" maxlength="400" placeholder="What do you need it for?"></textarea></label>' +
        '<p class="total" id="bkTotal" aria-live="polite"></p>' +
        '<p class="meta" id="bkErr" role="alert"></p>' +
        '<button type="submit" class="btn" id="bkGo">Send booking request</button>' +
        '<p class="sheet-note">The owner accepts or declines. Agree on pickup, fuel and payment with the owner. FarmGear does not handle payments.</p>' +
      '</form>');
    const s = $('#bkStart'), e = $('#bkEnd');
    const total = () => {
      const el = $('#bkTotal'); if (!el) return;
      if (!s.value || !e.value || e.value < s.value) { el.textContent = ''; return; }
      const days = Math.round((parse(e.value) - parse(s.value)) / 864e5) + 1;
      el.innerHTML = days + ' day' + (days > 1 ? 's' : '') + ' × ' + esc(FG.money(l.hire)) + ' = <b>' + esc(FG.money(days * l.hire)) + '</b>';
    };
    s.addEventListener('change', () => { if (!e.value || e.value < s.value) e.value = s.value; e.min = s.value; total(); });
    e.addEventListener('change', total);
    $('#bkForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('#bkErr'), phone = $('#bkPhone').value.trim();
      if (!s.value || !e.value || e.value < s.value) { err.textContent = 'Choose the first and last day.'; return; }
      if (!FG.phoneOk(phone)) { err.textContent = 'Enter a valid phone number.'; return; }
      const clash = busy.filter((x) => x.start_date <= e.value && x.end_date >= s.value)[0];
      if (clash) { err.textContent = 'Those dates overlap a booked period (' + range(clash) + ').'; return; }
      const btn = $('#bkGo'); btn.disabled = true; err.textContent = 'Sending…';
      const r = await sb.from('bookings').insert({
        listing_id: id, start_date: s.value, end_date: e.value, renter_phone: phone,
        location: $('#bkLoc').value.trim() || null, note: $('#bkNote').value.trim() || null
      });
      if (r.error) { btn.disabled = false; err.textContent = friendly(r.error); return; }
      FG.closeSheet();
      toast('Request sent. The owner will accept or decline.');
      S.tab = 'renter';
      location.hash = '#bookings';
    });
  }

  /* ---------- my bookings ---------- */
  const STATUS = { pending: ['warn', 'Waiting for owner'], accepted: ['ok', 'Accepted'], declined: ['bad', 'Declined'], cancelled: ['bad', 'Cancelled'], completed: ['sun', 'Completed'] };

  async function loadBookings() {
    if (!live || !FG.user) return;
    S.loading = true; S.err = ''; paint();
    const uid = FG.user.id;
    const [b, r] = await Promise.all([
      sb.from('bookings').select('*').or('renter.eq.' + uid + ',owner.eq.' + uid).order('created_at', { ascending: false }).limit(100),
      sb.from('reviews').select('booking_id').eq('reviewer', uid)
    ]);
    S.loading = false;
    if (b.error) { S.err = 'Could not load bookings. Check your connection.'; paint(); return; }
    S.rows = b.data; S.reviewed = {};
    (r.data || []).forEach((x) => { S.reviewed[x.booking_id] = true; });
    paint();
  }

  function row(b) {
    const uid = FG.user.id, asOwner = b.owner === uid;
    const st = STATUS[b.status] || ['', b.status];
    const other = asOwner ? b.renter_name : b.owner_name;
    const t = todayStr();
    let acts = '';
    if (asOwner && b.status === 'pending') acts = '<button type="button" class="btn" data-bk="accept" data-id="' + esc(b.id) + '">Accept</button><button type="button" class="btn ghost" data-bk="decline" data-id="' + esc(b.id) + '">Decline</button>';
    else if (asOwner && b.status === 'accepted') {
      acts = (b.start_date <= t ? '<button type="button" class="btn" data-bk="complete" data-id="' + esc(b.id) + '">Mark completed</button>' : '') +
        '<button type="button" class="btn ghost" data-bk="cancel" data-id="' + esc(b.id) + '">Cancel booking</button>';
    } else if (!asOwner && (b.status === 'pending' || b.status === 'accepted')) acts = '<button type="button" class="btn ghost" data-bk="cancel" data-id="' + esc(b.id) + '">Cancel</button>';
    if (b.status === 'completed' && !S.reviewed[b.id]) acts += '<button type="button" class="btn alt" data-bk="review" data-id="' + esc(b.id) + '">' + icon('star') + 'Leave a review</button>';
    const contact = asOwner && (b.status === 'pending' || b.status === 'accepted')
      ? '<span class="meta">Renter phone: <a href="tel:' + esc(b.renter_phone.replace(/[^\d+]/g, '')) + '">' + esc(b.renter_phone) + '</a> · <a href="' + esc(FG.waLink(b.renter_phone, 'Hello ' + (b.renter_name || '') + ', about your FarmGear booking for ' + (b.listing_title || 'my equipment') + ' (' + range(b) + ').')) + '" target="_blank" rel="noopener">WhatsApp</a></span>' : '';
    return '<li class="arow bkrow"><h3>' + esc(b.listing_title || 'Equipment') + ' <span class="pill ' + st[0] + '">' + esc(st[1]) + '</span></h3>' +
      '<span><b>' + esc(range(b)) + '</b> · ' + b.days + ' day' + (b.days > 1 ? 's' : '') + (b.total_price != null ? ' · ' + esc(FG.money(b.total_price)) : '') + '</span>' +
      '<span class="meta">' + (asOwner ? 'Renter: ' : 'Owner: ') + esc(other || 'FarmGear member') + (b.location ? ' · ' + esc(b.location) : '') + '</span>' +
      (b.note ? '<span class="meta">“' + esc(b.note) + '”</span>' : '') + contact +
      (acts ? '<div class="mact">' + acts + '</div>' : '') + '</li>';
  }

  function paint() {
    if (!view) return;
    const uid = FG.user && FG.user.id;
    const mineAsRenter = S.rows.filter((b) => b.renter === uid), asOwner = S.rows.filter((b) => b.owner === uid);
    const rows = S.tab === 'renter' ? mineAsRenter : asOwner;
    const waiting = asOwner.filter((b) => b.status === 'pending').length;
    view.innerHTML = '<h1>Bookings</h1><p class="lead">Equipment you hire and requests for your own equipment.</p>' +
      '<div class="tabs" role="group" aria-label="Bookings">' +
        '<button type="button" data-bk="tab" data-id="renter" aria-pressed="' + (S.tab === 'renter') + '">I am hiring (' + mineAsRenter.length + ')</button>' +
        '<button type="button" data-bk="tab" data-id="owner" aria-pressed="' + (S.tab === 'owner') + '">My equipment (' + asOwner.length + ')' + (waiting ? ' · ' + waiting + ' new' : '') + '</button></div>' +
      (S.err ? '<p class="banner">' + esc(S.err) + ' <button type="button" class="linkbtn" data-bk="reload">Try again</button></p>' : '') +
      (S.loading ? '<p class="meta">Loading…</p>' : '') +
      (rows.length ? '<ul class="alist">' + rows.map(row).join('') + '</ul>'
        : (!S.loading && !S.err ? '<div class="empty"><p><b>' + (S.tab === 'renter' ? 'No bookings yet.' : 'No requests yet.') + '</b></p><p class="meta">' +
          (S.tab === 'renter' ? 'Open equipment for hire and tap Book for dates.' : 'When someone books your equipment it appears here.') + '</p>' +
          (S.tab === 'renter' ? '<a class="btn" href="#browse">Browse equipment</a>' : '') + '</div>' : ''));
  }

  function gate() {
    if (!live) { view.innerHTML = '<h1>Bookings</h1><div class="empty"><p><b>Bookings are switched off.</b></p><p class="meta">Add your Supabase keys in config.js.</p></div>'; return false; }
    if (!FG.user) { view.innerHTML = '<h1>Bookings</h1><div class="empty"><p><b>Sign in to see your bookings.</b></p><button type="button" class="btn" data-auth>Sign in or create account</button></div>'; return false; }
    return true;
  }
  FG.routes.bookings = () => { if (!gate()) return; paint(); loadBookings(); };

  async function setStatus(id, status, okMsg) {
    const r = await sb.from('bookings').update({ status: status }).eq('id', id);
    if (r.error) { toast(friendly(r.error)); return; }
    toast(okMsg); loadBookings();
  }

  function openReview(id) {
    const b = S.rows.filter((x) => x.id === id)[0]; if (!b) return;
    const who = b.owner === FG.user.id ? b.renter_name : b.owner_name;
    let val = 0;
    FG.openSheet('<h2>Review ' + esc(who || 'member') + '</h2><p class="meta">' + esc(b.listing_title || '') + ' · ' + esc(range(b)) + '</p>' +
      '<form class="form" id="rvForm"><div class="rate" role="radiogroup" aria-label="Rating">' +
      [1, 2, 3, 4, 5].map((n) => '<button type="button" class="ratebtn" role="radio" aria-checked="false" data-bk="rate" data-id="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">' + icon('star') + '</button>').join('') + '</div>' +
      '<label class="field"><span>Comment (optional)</span><textarea id="rvText" rows="3" maxlength="300" placeholder="How was it? Was the equipment as described? Did they pay and return on time?"></textarea></label>' +
      '<p class="meta" id="rvErr" role="alert"></p><button type="submit" class="btn">Post review</button></form>');
    $('#rvForm').addEventListener('click', (e) => {
      const t = e.target.closest('[data-bk="rate"]'); if (!t) return;
      val = Number(t.getAttribute('data-id'));
      document.querySelectorAll('#rvForm .ratebtn').forEach((x) => { const on = Number(x.getAttribute('data-id')) <= val; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(Number(x.getAttribute('data-id')) === val)); });
    });
    $('#rvForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!val) { $('#rvErr').textContent = 'Tap the stars to choose a rating.'; return; }
      const r = await sb.from('reviews').insert({ booking_id: id, rating: val, comment: $('#rvText').value.trim() || null });
      if (r.error) { $('#rvErr').textContent = /duplicate|unique/i.test(r.error.message) ? 'You already reviewed this booking.' : friendly(r.error); return; }
      delete trustCache[b.owner === FG.user.id ? b.renter : b.owner];
      FG.closeSheet(); toast('Thanks. Your review is posted.'); loadBookings();
    });
  }

  /* ---------- Get verified ---------- */
  const T = { prof: null, req: null };
  async function loadTrustBox() {
    const box = $('#trustBox'); if (!box) return;
    if (!live || !FG.user) { box.innerHTML = ''; return; }
    const uid = FG.user.id;
    const [p, r] = await Promise.all([
      sb.from('public_profiles').select('*').eq('id', uid).maybeSingle(),
      sb.from('verification_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)
    ]);
    T.prof = p.data || null; T.req = (r.data && r.data[0]) || null;
    const verified = T.prof && T.prof.verified, req = T.req;
    let ver;
    if (verified) ver = '<p><span class="pill ok vbadge">' + icon('shield') + 'Verified</span></p><p class="meta">Other people see this badge on your listings.</p>';
    else if (req && req.status === 'pending') ver = '<p><span class="pill warn">Verification under review</span></p><p class="meta">An administrator will check your details and may call you.</p>';
    else ver = (req && (req.status === 'rejected' || req.status === 'revoked') ? '<p class="meta">Your last request was ' + esc(req.status) + (req.admin_note ? ': ' + esc(req.admin_note) : '') + '.</p>' : '') +
      '<p class="meta">A Verified badge shows people you are a real person they can contact. It helps you get more bookings and sales.</p>' +
      '<button type="button" class="btn alt small" data-bk="verify">' + icon('shield') + 'Get verified</button>';
    box.innerHTML = '<div class="acct trustcard"><p><b>Trust</b></p><div class="trust">' + (T.prof ? trustHtml(T.prof, uid) : '') + '</div>' + ver +
      '<a class="btn ghost small" href="#bookings" style="margin-top:10px">' + icon('calendar') + 'My bookings</a></div>';
  }
  FG.on('route', (v) => { if (v === 'profile') loadTrustBox(); });
  FG.on('user', () => { trustCache && Object.keys(trustCache).forEach((k) => delete trustCache[k]); if (FG.view === 'profile') loadTrustBox(); if (FG.view === 'bookings') FG.routes.bookings(); });
  FG.on('profile', () => { if (FG.view === 'profile') loadTrustBox(); });

  function openVerify() {
    if (!FG.requireAuth('Sign in to get verified.')) return;
    const p = FG.profile || {};
    FG.openSheet('<h2>Get verified</h2>' +
      '<p class="meta">An administrator checks your details and may call you or your reference. Do not send ID numbers or documents here.</p>' +
      '<form class="form" id="vfForm" autocomplete="off">' +
        '<label class="field"><span>Full name</span><input id="vfName" required maxlength="80" value="' + esc(p.name || '') + '"></label>' +
        '<label class="field"><span>Phone or WhatsApp</span><input id="vfPhone" type="tel" required maxlength="20" value="' + esc(p.phone || '') + '"></label>' +
        '<label class="field"><span>Province</span><select id="vfProv">' + FG.provinceOptions(p.province, 'Choose province') + '</select></label>' +
        '<label class="field"><span>Town</span><input id="vfTown" maxlength="60" value="' + esc(p.town || '') + '"></label>' +
        '<label class="field"><span>About you (what you farm or hire out)</span><textarea id="vfAbout" rows="3" required minlength="10" maxlength="500"></textarea></label>' +
        '<label class="field"><span>Reference name (optional)</span><input id="vfRef" maxlength="80" placeholder="Neighbour, AGRITEX officer, chief"></label>' +
        '<label class="field"><span>Reference phone (optional)</span><input id="vfRefPhone" type="tel" maxlength="20"></label>' +
        '<p class="meta" id="vfErr" role="alert"></p><button type="submit" class="btn">Send for review</button></form>');
    $('#vfForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#vfErr'), phone = $('#vfPhone').value.trim(), ref = $('#vfRefPhone').value.trim();
      if ($('#vfName').value.trim().length < 3) { err.textContent = 'Enter your full name.'; return; }
      if (!FG.phoneOk(phone) || (ref && !FG.phoneOk(ref))) { err.textContent = 'Check the phone numbers.'; return; }
      if ($('#vfAbout').value.trim().length < 10) { err.textContent = 'Tell us a little more about you (at least 10 characters).'; return; }
      err.textContent = 'Sending…';
      const r = await sb.from('verification_requests').insert({
        full_name: $('#vfName').value.trim(), phone: phone, province: $('#vfProv').value || null, town: $('#vfTown').value.trim() || null,
        about: $('#vfAbout').value.trim(), reference_name: $('#vfRef').value.trim() || null, reference_phone: ref || null
      });
      if (r.error) { err.textContent = /duplicate|unique/i.test(r.error.message) ? 'You already have a request waiting.' : friendly(r.error); return; }
      FG.closeSheet(); toast('Sent. We will review it soon.'); loadTrustBox();
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-bk]'); if (!t) return;
    const a = t.getAttribute('data-bk'), id = t.getAttribute('data-id');
    if (a === 'rate') return;
    switch (a) {
      case 'book': openBook(id); break;
      case 'reviews': openReviews(id); break;
      case 'verify': openVerify(); break;
      case 'tab': S.tab = id; paint(); break;
      case 'reload': loadBookings(); break;
      case 'accept': setStatus(id, 'accepted', 'Booking accepted. The dates are now blocked.'); break;
      case 'decline':
        FG.confirm('Decline this request?', 'The renter is told it was declined.', 'Decline').then((ok) => { if (ok) setStatus(id, 'declined', 'Request declined.'); }); break;
      case 'cancel':
        FG.confirm('Cancel this booking?', 'The dates become free again.', 'Cancel booking').then((ok) => { if (ok) setStatus(id, 'cancelled', 'Booking cancelled.'); }); break;
      case 'complete':
        FG.confirm('Mark as completed?', 'Both of you can then leave a review.', 'Completed').then((ok) => { if (ok) setStatus(id, 'completed', 'Marked completed. You can leave a review.'); }); break;
      case 'review': openReview(id); break;
      default: break;
    }
  });
})();
