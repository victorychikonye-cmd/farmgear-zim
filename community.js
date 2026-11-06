/* FarmGear Zim: farmer community.
   Farmers share tips and questions, comment, and mark posts as helpful.
   Everything is stored in Supabase (community_* tables). Posts are advice from other farmers, not expert advice. */
(function () {
  'use strict';
  const FG = window.FG;
  if (!FG) return;
  const esc = FG.esc, icon = FG.icon, toast = FG.toast, sb = FG.sb, live = FG.live;
  const $ = (s, r) => (r || document).querySelector(s);
  const PAGE = 15;
  const TOPICS = [
    ['crops', 'Crops'], ['livestock', 'Livestock'], ['pests_diseases', 'Pests and diseases'], ['soil_water', 'Soil and water'],
    ['equipment', 'Equipment'], ['markets', 'Selling and markets'], ['weather', 'Weather'], ['question', 'Questions'], ['other', 'Other']
  ];
  const REASONS = [['wrong_advice', 'Wrong or misleading advice'], ['dangerous', 'Dangerous advice'], ['spam', 'Spam or selling'], ['abuse', 'Rude or abusive'], ['other', 'Something else']];
  const topicName = (k) => { const t = TOPICS.filter((x) => x[0] === k)[0]; return t ? t[1] : 'Other'; };

  const S = { built: false, topic: 'all', q: '', rows: [], page: 0, total: 0, loading: false, loaded: false, err: '', tok: 0, flagged: {}, comments: [], cOpen: null };
  let photo = null;

  const fab = document.createElement('button');
  fab.type = 'button'; fab.id = 'fabCommunity'; fab.className = 'fab'; fab.hidden = true;
  fab.setAttribute('data-cm', 'new');
  fab.innerHTML = icon('plus') + 'Share a tip';
  document.body.appendChild(fab);

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' days ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const isMine = (r) => !!(FG.user && r.author === FG.user.id);
  const canDelete = (r) => isMine(r) || FG.isAdmin;
  const clip = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t);
  const photoUrl = (p) => (p.photo_path ? FG.publicUrl(p.photo_path) : '');

  /* ---------- screen ---------- */
  function build() {
    if (S.built) return;
    const host = $('#view-community');
    if (!host) return;
    S.built = true;
    host.innerHTML =
      '<h1>Farmer community</h1>' +
      '<p class="lead">Share what works on your farm and ask other farmers for help.</p>' +
      '<p class="banner">Tips come from other farmers, not experts. Before you use chemicals or treat a sick animal, check with your AGRITEX extension officer or a vet.</p>' +
      '<div class="fbar"><label class="search"><span class="sr">Search the community</span>' + icon('search') +
        '<input id="cmQ" type="search" placeholder="Search tips and questions" autocomplete="off"></label></div>' +
      '<div class="chips" id="cmTopics" role="group" aria-label="Topic"></div>' +
      '<p class="meta" id="cmCount" aria-live="polite"></p>' +
      '<ul class="ccards" id="cmList"></ul>' +
      '<div class="empty" id="cmEmpty" hidden></div>' +
      '<div class="loadmore" id="cmMore" hidden><button type="button" class="btn ghost" data-cm="more">Show more</button></div>';
    let t;
    $('#cmQ').addEventListener('input', function () {
      clearTimeout(t);
      const v = this.value;
      t = setTimeout(() => { S.q = v.trim(); load(true); }, 350);
    });
    renderTopics();
  }

  function renderTopics() {
    const el = $('#cmTopics'); if (!el) return;
    el.innerHTML = '<button type="button" class="chip" data-cm="topic" data-id="all" aria-pressed="' + (S.topic === 'all') + '">All</button>' +
      TOPICS.map((t) => '<button type="button" class="chip" data-cm="topic" data-id="' + t[0] + '" aria-pressed="' + (S.topic === t[0]) + '">' + esc(t[1]) + '</button>').join('');
  }

  function card(p) {
    const url = photoUrl(p);
    const place = p.province ? ' · ' + esc(p.province) : '';
    return '<li class="ccard">' +
      '<button type="button" class="ccard-main" data-cm="open" data-id="' + esc(p.id) + '">' +
        '<span class="cmeta"><b>' + (isMine(p) ? 'You' : esc(p.author_name || 'Farmer')) + '</b>' + place + ' · ' + esc(ago(p.created_at)) + '</span>' +
        '<span class="statusline"><span class="pill ok">' + esc(topicName(p.topic)) + '</span>' +
          (S.flagged[p.id] ? '<span class="pill bad">Reported</span>' : '') + '</span>' +
        '<h3>' + esc(p.title) + '</h3>' +
        '<span class="cbody">' + esc(clip(p.body, 200)) + '</span>' +
        (url ? '<span class="cimg"><img src="' + esc(url) + '" alt="" loading="lazy"></span>' : '') +
      '</button>' +
      '<div class="cfoot">' +
        '<button type="button" class="cbtn" data-cm="like" data-id="' + esc(p.id) + '" aria-pressed="' + !!p.liked_by_me + '">' + icon('check') + 'Helpful ' + (+p.helpful_count || 0) + '</button>' +
        '<button type="button" class="cbtn" data-cm="open" data-id="' + esc(p.id) + '">' + icon('chat') + (+p.comment_count || 0) + (+p.comment_count === 1 ? ' comment' : ' comments') + '</button>' +
      '</div></li>';
  }

  function render() {
    if (!S.built) return;
    const list = $('#cmList'), empty = $('#cmEmpty');
    list.innerHTML = S.rows.map(card).join('');
    $('#cmMore').hidden = !(S.rows.length < S.total && !S.loading);
    $('#cmCount').textContent = S.loading && !S.rows.length ? '' : (S.rows.length && !S.err ? S.total + (S.total === 1 ? ' post' : ' posts') : '');
    if (!live) {
      empty.hidden = false;
      empty.innerHTML = '<p><b>The community needs Supabase.</b></p><p class="meta">Add your keys in config.js to share tips with other farmers.</p>';
    } else if (S.loading && !S.rows.length) {
      empty.hidden = false;
      empty.innerHTML = '<div class="skel" style="width:100%"></div><div class="skel" style="width:100%;margin-top:12px"></div>';
    } else if (S.err) {
      empty.hidden = false;
      empty.innerHTML = '<p class="err">Could not load the community.</p><p class="meta">' + esc(S.err) + '</p><button type="button" class="btn" data-cm="retry">Try again</button>';
    } else if (!S.rows.length) {
      empty.hidden = false;
      empty.innerHTML = (S.q || S.topic !== 'all')
        ? '<p><b>Nothing found.</b></p><p class="meta">Try another word or topic.</p>'
        : '<p><b>No posts yet.</b></p><p class="meta">Be the first to share a tip or ask a question.</p><button type="button" class="btn alt" data-cm="new">Share a tip</button>';
    } else {
      empty.hidden = true;
    }
  }

  async function load(reset) {
    if (!live) { render(); return; }
    if (reset) { S.rows = []; S.page = 0; S.total = 0; S.loaded = false; }
    const tok = ++S.tok;
    S.loading = true; S.err = ''; render();
    let q = sb.from('community_feed').select('*', { count: 'exact' });
    if (S.topic !== 'all') q = q.eq('topic', S.topic);
    if (S.q) {
      const s = S.q.replace(/[,()%*\\]/g, ' ').trim();
      if (s) q = q.or('title.ilike.%' + s + '%,body.ilike.%' + s + '%');
    }
    const from = S.page * PAGE;
    const res = await q.order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (tok !== S.tok) return;
    S.loading = false; S.loaded = true;
    if (res.error) S.err = res.error.message;
    else { S.rows = S.rows.concat(res.data); S.total = res.count == null ? S.rows.length : res.count; S.page += 1; }
    if (FG.isAdmin) await loadFlags();
    if (tok === S.tok) render();
  }

  async function loadFlags() {
    const r = await sb.from('community_reports').select('post_id').eq('status', 'open').limit(500);
    S.flagged = {};
    if (!r.error) r.data.forEach((x) => { S.flagged[x.post_id] = true; });
  }

  /* ---------- helpful ---------- */
  async function toggleLike(id) {
    if (!FG.requireAuth('Sign in to mark posts as helpful.')) return;
    const p = S.rows.filter((x) => x.id === id)[0];
    if (!p) return;
    const was = !!p.liked_by_me;
    p.liked_by_me = !was; p.helpful_count = Math.max(0, (+p.helpful_count || 0) + (was ? -1 : 1));
    render(); paintSheetLike(p);
    const res = was
      ? await sb.from('community_likes').delete().eq('post_id', id).eq('user_id', FG.user.id)
      : await sb.from('community_likes').insert({ post_id: id });
    if (res.error && !(res.error.code === '23505')) {
      p.liked_by_me = was; p.helpful_count = Math.max(0, (+p.helpful_count || 0) + (was ? 1 : -1));
      render(); paintSheetLike(p); toast('Could not save: ' + res.error.message);
    }
  }
  function paintSheetLike(p) {
    const b = $('#cmSheetLike');
    if (!b || b.getAttribute('data-id') !== p.id) return;
    b.setAttribute('aria-pressed', String(!!p.liked_by_me));
    b.innerHTML = icon('check') + 'Helpful ' + (+p.helpful_count || 0);
  }

  /* ---------- post detail and comments ---------- */
  async function openPost(id) {
    let p = S.rows.filter((x) => x.id === id)[0];
    if (!p) {
      const r = await sb.from('community_feed').select('*').eq('id', id).maybeSingle();
      if (!r.data) { toast('This post is no longer there.'); return; }
      p = r.data; S.rows.unshift(p); S.total += 1;
    }
    S.cOpen = id; S.comments = [];
    const url = photoUrl(p);
    let acts = '';
    if (canDelete(p)) acts += '<button type="button" class="btn danger" data-cm="delpost" data-id="' + esc(p.id) + '">' + icon('trash') + (isMine(p) ? 'Delete my post' : 'Remove this post') + '</button>';
    FG.openSheet(
      '<p class="cmeta"><b>' + (isMine(p) ? 'You' : esc(p.author_name || 'Farmer')) + '</b>' + (p.province ? ' · ' + esc(p.province) : '') + ' · ' + esc(ago(p.created_at)) + '</p>' +
      '<div class="statusline" style="margin:6px 0 8px"><span class="pill ok">' + esc(topicName(p.topic)) + '</span></div>' +
      '<h2 style="margin-right:44px">' + esc(p.title) + '</h2>' +
      (url ? '<div class="gallery" style="margin-top:12px"><img src="' + esc(url) + '" alt="Photo from ' + esc(p.author_name || 'a farmer') + '" loading="lazy"></div>' : '') +
      '<p class="desc">' + esc(p.body) + '</p>' +
      '<div class="grid2"><button type="button" class="btn ghost" id="cmSheetLike" data-cm="like" data-id="' + esc(p.id) + '" aria-pressed="' + !!p.liked_by_me + '">' + icon('check') + 'Helpful ' + (+p.helpful_count || 0) + '</button>' +
      '<button type="button" class="btn ghost" data-cm="report" data-id="' + esc(p.id) + '">' + icon('flag') + 'Report</button></div>' +
      '<div id="cmAdmin"></div>' +
      '<h3 class="sub-h">Comments</h3>' +
      '<div id="cmComments"><p class="meta">Loading…</p></div>' +
      '<form class="form" id="cmCForm" autocomplete="off" style="margin-top:12px">' +
        '<label class="field"><span class="sr">Your comment</span><textarea id="cmText" maxlength="800" rows="2" placeholder="Write a helpful comment"></textarea></label>' +
        '<p class="err" id="cmCErr" role="alert"></p>' +
        '<button type="submit" class="btn" id="cmCSend">Add comment</button></form>' +
      acts
    );
    $('#cmCForm').addEventListener('submit', (e) => { e.preventDefault(); sendComment(id); });
    loadComments(id);
    if (FG.isAdmin) loadPostReports(id);
  }

  async function loadComments(id) {
    const r = await sb.from('community_comments').select('*').eq('post_id', id).order('created_at', { ascending: true }).limit(200);
    if (S.cOpen !== id) return;
    if (r.error) { const el = $('#cmComments'); if (el) el.innerHTML = '<p class="err">Could not load comments: ' + esc(r.error.message) + '</p>'; return; }
    S.comments = r.data; renderComments();
  }
  function renderComments() {
    const el = $('#cmComments'); if (!el) return;
    if (!S.comments.length) { el.innerHTML = '<p class="meta">No comments yet. Add the first one.</p>'; return; }
    el.innerHTML = S.comments.map((c) =>
      '<div class="ccom"><p class="cmeta"><b>' + (FG.user && c.author === FG.user.id ? 'You' : esc(c.author_name || 'Farmer')) + '</b> · ' + esc(ago(c.created_at)) +
      (FG.user && (c.author === FG.user.id || FG.isAdmin) ? ' · <button type="button" class="linkbtn" data-cm="delcom" data-id="' + esc(c.id) + '">Delete</button>' : '') +
      '</p><p class="ctext">' + esc(c.body) + '</p></div>').join('');
  }
  async function sendComment(postId) {
    if (!FG.requireAuth('Sign in to comment.')) return;
    const ta = $('#cmText'), err = $('#cmCErr'), btn = $('#cmCSend');
    const body = ta.value.trim();
    err.textContent = '';
    if (!body) { err.textContent = 'Write your comment first.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    const r = await sb.from('community_comments').insert({ post_id: postId, body: body }).select().single();
    btn.disabled = false; btn.textContent = 'Add comment';
    if (r.error) { err.textContent = r.error.message; toast(r.error.message); return; }
    ta.value = '';
    S.comments.push(r.data); renderComments();
    const p = S.rows.filter((x) => x.id === postId)[0];
    if (p) { p.comment_count = (+p.comment_count || 0) + 1; render(); }
  }
  async function deleteComment(id) {
    if (!(await FG.confirm('Delete this comment?', 'This cannot be undone.', 'Delete'))) return;
    const r = await sb.from('community_comments').delete().eq('id', id);
    if (r.error) { toast(r.error.message); return; }
    S.comments = S.comments.filter((c) => c.id !== id); renderComments();
    const p = S.rows.filter((x) => x.id === S.cOpen)[0];
    if (p) { p.comment_count = Math.max(0, (+p.comment_count || 0) - 1); render(); }
  }

  async function deletePost(id) {
    const p = S.rows.filter((x) => x.id === id)[0];
    if (!p) return;
    if (!(await FG.confirm(isMine(p) ? 'Delete your post?' : 'Remove this post?', 'The post and its comments will be deleted for everyone.', 'Delete'))) return;
    const r = await sb.from('community_posts').delete().eq('id', id);
    if (r.error) { toast(r.error.message); return; }
    if (p.photo_path && isMine(p)) sb.storage.from(FG.BUCKET).remove([p.photo_path]);
    S.rows = S.rows.filter((x) => x.id !== id); S.total = Math.max(0, S.total - 1);
    FG.closeSheet(); render(); toast('Post deleted.');
  }

  /* ---------- reports ---------- */
  function openReport(id) {
    if (!FG.requireAuth('Sign in to report a post.')) return;
    FG.openSheet(
      '<h2>Report post</h2><p class="meta">Tell us what is wrong. An administrator will look at it.</p>' +
      '<form class="form" id="cmRForm" style="margin-top:14px">' +
        '<label class="field"><span>Reason</span><select id="cmRReason">' + REASONS.map((r) => '<option value="' + r[0] + '">' + esc(r[1]) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Details (optional)</span><textarea id="cmRDetails" maxlength="300" placeholder="What should we know?"></textarea></label>' +
        '<p class="err" id="cmRErr" role="alert"></p>' +
        '<button type="submit" class="btn alt" id="cmRGo">Send report</button></form>');
    $('#cmRForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = $('#cmRGo'); b.disabled = true;
      const r = await sb.from('community_reports').insert({ post_id: id, reason: $('#cmRReason').value, details: $('#cmRDetails').value.trim() || null });
      b.disabled = false;
      if (r.error) { $('#cmRErr').textContent = r.error.code === '23505' ? 'You already reported this post.' : r.error.message; return; }
      FG.closeSheet(); toast('Report sent. Thank you.');
    });
  }
  async function loadPostReports(id) {
    const r = await sb.from('community_reports').select('*').eq('post_id', id).eq('status', 'open').order('created_at', { ascending: false });
    const el = $('#cmAdmin');
    if (!el || S.cOpen !== id || r.error || !r.data.length) return;
    el.innerHTML = '<h3 class="sub-h">Reports (' + r.data.length + ')</h3>' +
      r.data.map((x) => '<p class="meta">' + esc((REASONS.filter((q) => q[0] === x.reason)[0] || [0, x.reason])[1]) + (x.details ? ': ' + esc(x.details) : '') + '</p>').join('') +
      '<button type="button" class="btn ghost" data-cm="dismiss" data-id="' + esc(id) + '">Dismiss reports, post is fine</button>';
  }
  async function dismissReports(id) {
    const r = await sb.from('community_reports').update({ status: 'dismissed' }).eq('post_id', id).eq('status', 'open');
    if (r.error) { toast(r.error.message); return; }
    delete S.flagged[id]; const el = $('#cmAdmin'); if (el) el.innerHTML = ''; render(); toast('Reports dismissed.');
  }

  /* ---------- new post ---------- */
  function dropPhoto() { if (photo && photo.url) URL.revokeObjectURL(photo.url); photo = null; }
  FG.on('sheetclose', dropPhoto);

  function openForm() {
    if (!live) { toast('Connect Supabase in config.js first.'); return; }
    if (!FG.requireAuth('Sign in to share with other farmers.')) return;
    dropPhoto();
    FG.openSheet(
      '<h2>Share a tip</h2><p class="meta">Share what worked for you, or ask other farmers a question.</p>' +
      '<form class="form" id="cmForm" autocomplete="off" style="margin-top:14px">' +
        '<label class="field"><span>Topic</span><select id="cmTopic">' + TOPICS.map((t) => '<option value="' + t[0] + '">' + esc(t[1]) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Title</span><input id="cmTitle" type="text" maxlength="100" placeholder="e.g. How I stopped fall armyworm in my maize"></label>' +
        '<label class="field"><span>Your tip or question</span><textarea id="cmBody" maxlength="1500" rows="6" placeholder="Explain what you did, what happened and when. Short and clear helps."></textarea></label>' +
        '<label class="field"><span>Province (optional)</span><select id="cmProv">' + FG.provinceOptions(FG.profile.province || '', 'Not stated') + '</select></label>' +
        '<div class="field"><span>Photo (optional)</span><div class="strip" id="cmPrev"></div>' +
          '<label class="btn ghost inline" for="cmPhoto" style="justify-self:start">' + icon('camera') + 'Add a photo<input id="cmPhoto" type="file" accept="image/*" class="sr-file"></label></div>' +
        '<p class="err" id="cmErr" role="alert"></p>' +
        '<button type="submit" class="btn alt" id="cmGo">Post to community</button></form>');
    $('#cmPhoto').addEventListener('change', function () {
      const f = this.files && this.files[0]; this.value = '';
      if (!f) return;
      if (!(f.type.indexOf('image/') === 0 || !f.type || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name || ''))) { $('#cmErr').textContent = 'That file is not a photo. Pick a JPG or PNG.'; return; }
      dropPhoto(); photo = { file: f, url: URL.createObjectURL(f) };
      $('#cmErr').textContent = '';
      $('#cmPrev').innerHTML = '<div class="pv"><img src="' + esc(photo.url) + '" alt="Your photo"><button type="button" data-cm="rmphoto" aria-label="Remove photo">' + icon('close') + '</button></div>';
    });
    $('#cmForm').addEventListener('submit', submitPost);
  }

  async function submitPost(e) {
    e.preventDefault();
    const err = $('#cmErr'), btn = $('#cmGo');
    const fail = (m) => { err.textContent = m; toast(m); try { err.scrollIntoView({ block: 'center' }); } catch (x) { /* ignore */ } };
    const title = $('#cmTitle').value.trim(), body = $('#cmBody').value.trim();
    if (title.length < 3) { fail('Write a short title.'); return; }
    if (body.length < 3) { fail('Write your tip or question.'); return; }
    btn.disabled = true; btn.textContent = 'Posting…'; err.textContent = '';
    let path = null;
    try {
      if (photo) {
        btn.textContent = 'Uploading photo…';
        const blob = await FG.toBlob(photo.file, 1024, false, 0.78);
        path = FG.user.id + '/community-' + Date.now() + '.jpg';
        const up = await sb.storage.from(FG.BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) { path = null; throw up.error; }
      }
      btn.textContent = 'Posting…';
      const ins = await sb.from('community_posts').insert({
        topic: $('#cmTopic').value, title: title, body: body, province: $('#cmProv').value || null, photo_path: path
      });
      if (ins.error) { if (path) sb.storage.from(FG.BUCKET).remove([path]); throw ins.error; }
      FG.closeSheet();
      S.topic = 'all'; S.q = ''; const q = $('#cmQ'); if (q) q.value = '';
      renderTopics(); await load(true);
      toast('Posted. Thank you for sharing.');
    } catch (ex) {
      fail(ex.message || 'Could not post. Check your connection and try again.');
      btn.disabled = false; btn.textContent = 'Post to community';
    }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cm]');
    if (!t) return;
    const id = t.getAttribute('data-id');
    switch (t.getAttribute('data-cm')) {
      case 'new': openForm(); break;
      case 'open': openPost(id); break;
      case 'like': toggleLike(id); break;
      case 'topic': S.topic = id; renderTopics(); load(true); break;
      case 'more': load(false); break;
      case 'retry': load(true); break;
      case 'delpost': deletePost(id); break;
      case 'delcom': deleteComment(id); break;
      case 'report': openReport(id); break;
      case 'dismiss': dismissReports(id); break;
      case 'rmphoto': dropPhoto(); { const pv = $('#cmPrev'); if (pv) pv.innerHTML = ''; } break;
      default: break;
    }
  });

  /* ---------- routing and session ---------- */
  FG.routes.community = () => { fab.hidden = false; build(); if (!S.loaded && !S.loading) load(true); };
  FG.on('route', (v) => { fab.hidden = v !== 'community'; });
  FG.on('user', () => { if (S.built && S.loaded) load(true); });
  FG.on('profile', () => { if (S.built && S.loaded && FG.isAdmin) load(true); });
  if (FG.view === 'community') FG.routes.community();
})();
