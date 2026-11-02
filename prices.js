/* FarmGear Zim: market prices.
   Shows ONLY prices that an administrator has recorded, each with its market, date and source.
   Nothing here is invented or estimated. Old prices are labelled outdated; missing data says "Price unavailable". */
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
  const KINDS = [['all', 'All'], ['crop', 'Crops'], ['livestock', 'Livestock'], ['produce', 'Vegetables and fruit']];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PERIODS = [['30', '30 days'], ['90', '3 months'], ['180', '6 months'], ['365', '1 year'], ['all', 'All']];
  const GRANS = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];

  const S = {
    built: false, loading: false, loaded: false, err: '', at: 0, cats: [], catMap: {}, board: [],
    tab: 'dash', kind: 'all', cat: '', series: '', type: 'all',
    hist: { market: '__avg', period: '180', gran: 'week', rows: [], loading: false, err: '', key: '', table: false },
    alerts: [], alertsLoaded: false
  };

  /* ---------- dates and freshness ---------- */
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseD = (s) => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const daysSince = (s) => Math.round((today() - parseD(s)) / 86400000);
  const dLong = (s) => { const d = parseD(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
  function agoText(s) {
    const n = daysSince(s);
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 60) return n + ' days ago';
    return Math.round(n / 30) + ' months ago';
  }
  const catOf = (id) => S.catMap[id];
  const staleDays = (id) => (catOf(id) ? catOf(id).stale_after_days : 14);
  const isStale = (r) => daysSince(r.recorded_on) > staleDays(r.category_id);
  const place = (r) => [r.location, r.district, r.province].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'Location not stated';

  /* ---------- data ---------- */
  const rowsOf = (cid) => S.board.filter((r) => r.category_id === cid);
  function seriesOf(cid) {
    const m = {};
    rowsOf(cid).forEach((r) => { const k = r.unit + '|' + r.currency; (m[k] = m[k] || []).push(r); });
    return m;
  }
  const latest = (rows) => rows.slice().sort((a, b) => b.recorded_on.localeCompare(a.recorded_on) || b.price - a.price)[0];
  function primaryKey(cid) {
    const m = seriesOf(cid); let best = null, bd = '';
    Object.keys(m).forEach((k) => { const l = latest(m[k]).recorded_on; if (!best || l > bd || (l === bd && m[k].length > m[best].length)) { best = k; bd = l; } });
    return best;
  }
  const serLabel = (k) => { const p = k.split('|'); return UNIT[p[0]] + ' (' + p[1] + ')'; };

  async function load(force) {
    if (!live) { render(); return; }
    if (S.loading) return;
    if (!force && S.loaded && Date.now() - S.at < 60000) { render(); return; }
    S.loading = true; S.err = ''; render();
    try {
      const [cats, b] = await Promise.all([FG.loadCats(), sb.from('price_board').select('*').order('recorded_on', { ascending: false }).limit(2000)]);
      if (b.error) throw b.error;
      S.cats = cats; S.catMap = {}; cats.forEach((c) => { S.catMap[c.id] = c; });
      S.board = b.data; S.loaded = true; S.at = Date.now();
      if (!S.cat || !S.catMap[S.cat]) S.cat = (cats.find((c) => rowsOf(c.id).length) || cats[0] || {}).id || '';
      if (!seriesOf(S.cat)[S.series]) S.series = primaryKey(S.cat) || (S.catMap[S.cat] ? S.catMap[S.cat].price_unit + '|USD' : '');
    } catch (e) { S.err = e.message || 'Could not load prices.'; }
    S.loading = false;
    render();
    if (S.tab === 'history') loadHist();
    if (FG.user) loadAlerts();
  }

  /* ---------- view shell ---------- */
  let view = $('#view-prices');
  if (!view) {
    view = document.createElement('section');
    view.id = 'view-prices'; view.hidden = true;
    (document.querySelector('main') || document.body).appendChild(view);
  }
  function build() {
    if (S.built) return;
    S.built = true;
    view.innerHTML =
      '<h1>Market prices</h1>' +
      '<p class="lead">What buyers and markets are paying, with the date and source of every price.</p>' +
      '<p class="banner"><b>Recorded prices, not live prices.</b> Each price was entered by a FarmGear administrator from the source shown. Old prices are marked <b>Outdated</b>. Always confirm the price with the buyer before you sell.</p>' +
      '<div class="tabs" id="prTabs" role="group" aria-label="Price sections">' +
        '<button type="button" data-pr="tab" data-id="dash" aria-pressed="true">Prices</button>' +
        '<button type="button" data-pr="tab" data-id="compare" aria-pressed="false">Compare</button>' +
        '<button type="button" data-pr="tab" data-id="history" aria-pressed="false">History</button>' +
        '<button type="button" data-pr="tab" data-id="alerts" aria-pressed="false">Alerts</button></div>' +
      '<div id="prBody"></div>';
  }

  function render() {
    build();
    document.querySelectorAll('#prTabs [data-id]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === S.tab)));
    const body = $('#prBody');
    if (!live) { body.innerHTML = '<div class="empty"><p><b>Prices need a Supabase connection.</b></p><p class="meta">Add your keys in config.js.</p></div>'; return; }
    if (S.err) {
      body.innerHTML = '<div class="empty"><p class="err">Could not load prices.</p><p class="meta">' + esc(S.err) + '</p><button type="button" class="btn" data-pr="retry">Try again</button></div>';
      return;
    }
    if (S.loading && !S.loaded) { body.innerHTML = '<ul class="mcards"><li class="skel"></li><li class="skel"></li><li class="skel"></li></ul>'; return; }
    if (S.tab === 'dash') renderDash(body);
    else if (S.tab === 'compare') renderCompare(body);
    else if (S.tab === 'history') renderHistory(body);
    else renderAlerts(body);
  }

  /* ---------- dashboard ---------- */
  function changeHtml(r) {
    if (r.change_pct == null || r.previous_price == null) return '<span class="chg flat">No earlier record to compare</span>';
    const c = Number(r.change_pct);
    const cls = c > 0 ? 'up' : c < 0 ? 'down' : 'flat';
    const arrow = c > 0 ? '▲ Up ' : c < 0 ? '▼ Down ' : '● No change ';
    return '<span class="chg ' + cls + '">' + arrow + (c === 0 ? '' : fmt(Math.abs(c)) + '%') + '</span>' +
      ' <span class="meta">from ' + esc(money(r.previous_price, r.currency)) + '' + (r.previous_recorded_on ? ' on ' + esc(dLong(r.previous_recorded_on)) : '') + '</span>';
  }
  function srcHtml(r) {
    const link = r.source_url && /^https?:\/\//i.test(r.source_url)
      ? '<a href="' + esc(r.source_url) + '" target="_blank" rel="noopener">' + esc(r.source_name) + '</a>' : esc(r.source_name);
    return 'Source: ' + link;
  }
  function mcard(c) {
    const rows = rowsOf(c.id);
    if (!rows.length) {
      return '<li class="mcard na"><h3>' + esc(c.name) + ' <span class="pill">Price unavailable</span></h3>' +
        '<p class="meta">No verified price has been recorded for this product yet.</p>' +
        '<div class="mact"><button type="button" class="btn ghost small" data-pr="follow" data-id="' + esc(c.id) + '">' + icon('bell') + 'Tell me when one is added</button></div></li>';
    }
    const key = primaryKey(c.id), ser = seriesOf(c.id)[key], r = latest(ser);
    const stale = isStale(r);
    const markets = ser.length;
    const pill = stale
      ? '<span class="pill warn">Outdated</span>'
      : '<span class="pill ok">Recorded ' + esc(agoText(r.recorded_on)) + '</span>';
    return '<li class="mcard"><h3>' + esc(c.name) + ' ' + pill + '</h3>' +
      '<div class="mprice">' + esc(money(r.price, r.currency)) + '<small>' + UNIT[r.unit] + ' · ' + esc(r.currency) + '</small></div>' +
      '<div>' + changeHtml(r) + '</div>' +
      '<div class="kv"><div><span>Previous</span><b>' + (r.previous_price != null ? esc(money(r.previous_price, r.currency)) : '—') + '</b></div>' +
        '<div><span>Highest recorded</span><b>' + esc(money(r.highest_price, r.currency)) + '</b></div>' +
        '<div><span>Lowest recorded</span><b>' + esc(money(r.lowest_price, r.currency)) + '</b></div></div>' +
      '<p class="meta"><b>' + esc(r.market_name) + '</b> · ' + esc(TYPES[r.market_type] || '') + '<br>' + esc(place(r)) + '</p>' +
      '<p class="src">' + (stale ? '<b>Outdated:</b> last recorded ' + esc(agoText(r.recorded_on)) + ' (' + esc(dLong(r.recorded_on)) + '). Do not rely on it. ' : 'Updated ' + esc(dLong(r.recorded_on)) + '. ') +
        srcHtml(r) + (markets > 1 ? ' · ' + markets + ' markets reporting' : '') + '</p>' +
      '<div class="mact">' +
        (markets > 1 ? '<button type="button" class="btn ghost small" data-pr="goto" data-to="compare" data-id="' + esc(c.id) + '">Compare</button>' : '') +
        '<button type="button" class="btn ghost small" data-pr="goto" data-to="history" data-id="' + esc(c.id) + '">' + icon('chart') + 'History</button>' +
        '<button type="button" class="btn ghost small" data-pr="follow" data-id="' + esc(c.id) + '">' + icon('bell') + 'Follow</button></div></li>';
  }
  function renderDash(body) {
    const chips = '<div class="chips" role="group" aria-label="Product kind">' + KINDS.map((k) =>
      '<button type="button" class="chip" data-pr="kind" data-id="' + k[0] + '" aria-pressed="' + (S.kind === k[0]) + '">' + k[1] + '</button>').join('') + '</div>';
    let cats = S.cats.filter((c) => S.kind === 'all' || c.kind === S.kind);
    cats = cats.filter((c) => rowsOf(c.id).length).concat(cats.filter((c) => !rowsOf(c.id).length));
    const any = S.board.length > 0;
    body.innerHTML = chips +
      (!any ? '<div class="empty"><p><b>No prices have been recorded yet.</b></p><p class="meta">Prices appear here once an administrator adds them with their source. Until then every product shows Price unavailable.</p></div>' : '') +
      '<ul class="mcards">' + cats.map(mcard).join('') + '</ul>' +
      (FG.isAdmin ? '<p class="meta" style="margin-top:14px">You are an administrator. <a href="#admin">Add or update prices</a>.</p>' : '');
  }

  /* ---------- selectors shared by compare / history / alerts ---------- */
  function selectors(opts) {
    const cats = S.cats;
    let h = '<div class="fpanel" style="margin-top:0"><label class="field' + (opts.noSeries ? ' full' : '') + '"><span>Product</span><select data-pr="selcat">' +
      cats.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === S.cat ? ' selected' : '') + '>' + esc(c.name) + (rowsOf(c.id).length ? '' : ' (no prices yet)') + '</option>').join('') + '</select></label>';
    const keys = Object.keys(seriesOf(S.cat));
    if (!opts.noSeries) {
      h += '<label class="field"><span>Unit</span><select data-pr="selser"' + (keys.length < 2 ? ' disabled' : '') + '>' +
        (keys.length ? keys.map((k) => '<option value="' + esc(k) + '"' + (k === S.series ? ' selected' : '') + '>' + esc(serLabel(k)) + '</option>').join('') : '<option>—</option>') + '</select></label>';
    }
    return h + '</div>';
  }
  const curRows = () => (seriesOf(S.cat)[S.series] || []);

  /* ---------- compare ---------- */
  function renderCompare(body) {
    let rows = curRows();
    const types = Object.keys(TYPES).filter((t) => rows.some((r) => r.market_type === t));
    if (S.type !== 'all' && types.indexOf(S.type) === -1) S.type = 'all';
    if (S.type !== 'all') rows = rows.filter((r) => r.market_type === S.type);
    rows = rows.slice().sort((a, b) => b.price - a.price);
    let html = selectors({});
    if (!curRows().length) {
      html += '<div class="empty"><p><b>Price unavailable</b></p><p class="meta">No verified prices have been recorded for this product yet.</p></div>';
      body.innerHTML = html; return;
    }
    html += '<div class="chips" role="group" aria-label="Market type"><button type="button" class="chip" data-pr="type" data-id="all" aria-pressed="' + (S.type === 'all') + '">All</button>' +
      types.map((t) => '<button type="button" class="chip" data-pr="type" data-id="' + t + '" aria-pressed="' + (S.type === t) + '">' + esc(TYPES[t]) + '</button>').join('') + '</div>';
    const top = rows[0].price, cur = rows[0].currency;
    html += '<h2 class="sub-h">Highest reported ' + esc(UNIT[rows[0].unit]) + '</h2>' +
      '<p class="meta">Each buyer or market reports its own price on its own date. Check the date and source before you decide.</p><ul class="bars" style="list-style:none;padding:0">';
    html += rows.map((r, i) => {
      const w = Math.max(3, Math.round(r.price / top * 100));
      const diff = r.price < top ? ' · ' + esc(money(top - r.price, cur)) + ' (' + fmt((top - r.price) / top * 100) + '%) below the highest' : '';
      const stale = isStale(r);
      return '<li class="bar-row' + (stale ? ' old' : '') + '"><div class="bar-top"><span><b>' + esc(r.market_name) + '</b> ' +
        (i === 0 ? '<span class="pill ok">Highest reported</span> ' : '') + (stale ? '<span class="pill warn">Outdated</span>' : '') + '</span><b>' + esc(money(r.price, cur)) + '</b></div>' +
        '<div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
        '<span class="meta">' + esc(TYPES[r.market_type] || '') + ' · ' + esc(place(r)) + ' · ' + esc(dLong(r.recorded_on)) + diff + '</span>' +
        '<span class="src">' + srcHtml(r) + '</span></li>';
    }).join('') + '</ul>';
    body.innerHTML = html;
  }

  /* ---------- history ---------- */
  const histKey = () => [S.cat, S.series, S.hist.period].join('|');
  async function loadHist() {
    const h = S.hist;
    if (!S.cat || !S.series) { h.rows = []; h.key = ''; return; }
    const key = histKey();
    if (key === h.key && !h.err) return;
    const p = S.series.split('|');
    h.loading = true; h.err = ''; render();
    let q = sb.from('price_history').select('market_name,recorded_on,price,source_name').eq('category_id', S.cat).eq('unit', p[0]).eq('currency', p[1]);
    if (h.period !== 'all') { const d = today(); d.setDate(d.getDate() - parseInt(h.period, 10)); q = q.gte('recorded_on', iso(d)); }
    const res = await q.order('recorded_on', { ascending: true }).limit(2000);
    h.loading = false;
    if (res.error) { h.err = res.error.message; } else { h.rows = res.data; h.key = key; }
    render();
  }
  function bucket(dateStr, gran) {
    if (gran === 'day') return dateStr;
    const d = parseD(dateStr);
    if (gran === 'month') return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  }
  function makePoints() {
    const h = S.hist, rows = h.market === '__avg' ? h.rows : h.rows.filter((r) => r.market_name === h.market);
    const b = {};
    rows.forEach((r) => {
      const k = bucket(r.recorded_on, h.gran);
      b[k] = b[k] || {};
      (b[k][r.market_name] = b[k][r.market_name] || []).push(Number(r.price));
    });
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return Object.keys(b).sort().map((k) => {
      const ms = Object.keys(b[k]);
      const per = ms.map((m) => mean(b[k][m]));
      const n = ms.reduce((t, m) => t + b[k][m].length, 0);
      return { key: k, t: parseD(k).getTime(), price: mean(per), markets: ms.length, records: n };
    });
  }
  function ptLabel(p) {
    const d = parseD(p.key);
    if (S.hist.gran === 'month') return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    if (S.hist.gran === 'week') return 'Week of ' + dLong(p.key);
    return dLong(p.key);
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo || Math.abs(hi) || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function chartSvg(pts, cur, unit) {
    const W = 360, H = 230, L = 50, R = 16, T = 16, B = 30;
    let x0 = pts[0].t, x1 = pts[pts.length - 1].t;
    if (x0 === x1) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
    const ps = pts.map((p) => p.price);
    let lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    const padY = (hi - lo) * 0.18 || hi * 0.1 || 1;
    lo = Math.max(0, lo - padY); hi = hi + padY;
    const X = (t) => L + (t - x0) / (x1 - x0) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = niceTicks(lo, hi, 4);
    let g = '';
    ticks.forEach((v) => {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + esc(fmt(v)) + '</text>';
    });
    const span = (x1 - x0) / 86400000, nx = Math.min(4, Math.max(2, pts.length));
    for (let i = 0; i < nx; i++) {
      const t = x0 + (x1 - x0) * i / (nx - 1), d = new Date(t);
      const lab = span > 150 ? MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2) : d.getDate() + ' ' + MONTHS[d.getMonth()];
      g += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle') + '" font-size="11" fill="var(--muted)">' + lab + '</text>';
    }
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.price).toFixed(1)).join('');
    const area = pts.length > 1 ? '<path d="' + line + 'L' + X(pts[pts.length - 1].t).toFixed(1) + ' ' + (H - B) + 'L' + X(pts[0].t).toFixed(1) + ' ' + (H - B) + 'Z" fill="var(--chart-wash)"/>' : '';
    let dots = '';
    if (pts.length <= 14) pts.forEach((p) => { dots += '<circle cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p.price).toFixed(1) + '" r="4" fill="var(--chart)" stroke="var(--surface)" stroke-width="2"/>'; });
    const last = pts[pts.length - 1];
    const endDot = '<circle cx="' + X(last.t).toFixed(1) + '" cy="' + Y(last.price).toFixed(1) + '" r="5" fill="var(--chart)" stroke="var(--surface)" stroke-width="2"/>';
    const lx = X(last.t), anchor = lx > W - 60 ? 'end' : 'middle';
    const endLab = '<text x="' + (anchor === 'end' ? lx - 8 : lx).toFixed(1) + '" y="' + (Y(last.price) - 10).toFixed(1) + '" text-anchor="' + anchor + '" font-size="12" font-weight="700" fill="var(--fg)">' + esc(money(last.price, cur)) + '</text>';
    const aria = 'Price history line chart. ' + pts.length + ' points from ' + ptLabel(pts[0]) + ' to ' + ptLabel(last) + '. Latest ' + money(last.price, cur) + ' ' + UNIT[unit] + '. A table view is available.';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(aria) + '" tabindex="0" id="prSvg">' + g + area +
      '<path d="' + line + '" fill="none" stroke="var(--chart)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' + dots + endDot + endLab +
      '<line id="prX" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>' +
      '<circle id="prDot" r="6" fill="var(--chart)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>' +
      '<rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent" id="prHit"/></svg>' +
      '<div class="tip" id="prTip" hidden></div>';
  }
  function wireChart(pts, cur, unit) {
    const svg = $('#prSvg'), tip = $('#prTip'), wrap = $('.chart-wrap');
    if (!svg) return;
    const W = 360, H = 230, L = 50, R = 16, T = 16, B = 30;
    let x0 = pts[0].t, x1 = pts[pts.length - 1].t;
    if (x0 === x1) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
    const ps = pts.map((p) => p.price);
    let lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    const padY = (hi - lo) * 0.18 || hi * 0.1 || 1; lo = Math.max(0, lo - padY); hi = hi + padY;
    const X = (t) => L + (t - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let idx = pts.length - 1;
    function show(i) {
      idx = Math.max(0, Math.min(pts.length - 1, i));
      const p = pts[idx], cx = X(p.t), cy = Y(p.price);
      $('#prX').setAttribute('x1', cx); $('#prX').setAttribute('x2', cx); $('#prX').setAttribute('visibility', 'visible');
      $('#prDot').setAttribute('cx', cx); $('#prDot').setAttribute('cy', cy); $('#prDot').setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.textContent = '';
      const b = document.createElement('b'); b.textContent = money(p.price, cur) + ' ' + UNIT[unit];
      const d = document.createElement('span'); d.textContent = ptLabel(p);
      const n = document.createElement('div');
      n.textContent = S.hist.market === '__avg' ? 'Average of ' + p.markets + (p.markets === 1 ? ' market' : ' markets') : p.records + (p.records === 1 ? ' record' : ' records averaged');
      tip.appendChild(b); tip.appendChild(d); tip.appendChild(n);
      const sr = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const px = sr.left - wr.left + cx / W * sr.width, py = sr.top - wr.top + cy / H * sr.height;
      tip.style.left = Math.max(70, Math.min(wr.width - 70, px)) + 'px'; tip.style.top = py + 'px';
    }
    function hide() { $('#prX').setAttribute('visibility', 'hidden'); $('#prDot').setAttribute('visibility', 'hidden'); tip.hidden = true; }
    function at(ev) {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
      let best = 0, bd = 1e9;
      pts.forEach((p, i) => { const d = Math.abs(X(p.t) - x); if (d < bd) { bd = d; best = i; } });
      show(best);
    }
    svg.addEventListener('pointermove', at);
    svg.addEventListener('pointerdown', at);
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('focus', () => show(idx));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
      else if (e.key === 'Escape') hide();
    });
  }

  function renderHistory(body) {
    const h = S.hist, ser = curRows();
    let html = selectors({});
    if (!ser.length) {
      body.innerHTML = html + '<div class="empty"><p><b>Price unavailable</b></p><p class="meta">No price history has been recorded for this product yet.</p></div>';
      return;
    }
    const markets = Array.from(new Set(ser.map((r) => r.market_name))).sort();
    if (h.market !== '__avg' && markets.indexOf(h.market) === -1) h.market = '__avg';
    html += '<div class="fpanel" style="margin-top:10px"><label class="field full"><span>Market or buyer</span><select data-pr="selmkt">' +
      '<option value="__avg"' + (h.market === '__avg' ? ' selected' : '') + '>Average of all markets reporting</option>' +
      markets.map((m) => '<option value="' + esc(m) + '"' + (h.market === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></label></div>' +
      '<div class="chips" role="group" aria-label="Period">' + PERIODS.map((p) => '<button type="button" class="chip" data-pr="period" data-id="' + p[0] + '" aria-pressed="' + (h.period === p[0]) + '">' + p[1] + '</button>').join('') + '</div>' +
      '<div class="chips" role="group" aria-label="Step">' + GRANS.map((p) => '<button type="button" class="chip" data-pr="gran" data-id="' + p[0] + '" aria-pressed="' + (h.gran === p[0]) + '">' + p[1] + '</button>').join('') + '</div>';
    if (h.err) {
      body.innerHTML = html + '<div class="empty"><p class="err">Could not load history.</p><p class="meta">' + esc(h.err) + '</p><button type="button" class="btn" data-pr="hretry">Try again</button></div>';
      return;
    }
    const pts = h.key === histKey() ? makePoints() : [];
    const p0 = S.series.split('|'), unit = p0[0], cur = p0[1];
    html += '<h2 class="sub-h">' + esc(catOf(S.cat).name) + ' ' + esc(UNIT[unit]) + '</h2>' +
      '<p class="meta">' + (h.market === '__avg' ? 'Average of the prices recorded by each market' : esc(h.market)) + ' · ' + (h.gran === 'day' ? 'daily' : h.gran === 'week' ? 'weekly average' : 'monthly average') + '</p>';
    if (h.loading && !pts.length) html += '<div class="skel" style="height:230px;margin-top:8px"></div>';
    else if (!pts.length) html += '<div class="empty"><p><b>No prices recorded in this period.</b></p><p class="meta">Try a longer period or another market.</p></div>';
    else {
      html += '<div class="chart-wrap' + (h.loading ? ' busy' : '') + '">' + chartSvg(pts, cur, unit) + '</div>';
      if (pts.length === 1) html += '<p class="meta">Only one date recorded so far. A trend needs at least two dates.</p>';
      const first = pts[0].price, last = pts[pts.length - 1].price;
      const ch = pts.length > 1 && first > 0 ? (last - first) / first * 100 : null;
      const mx = Math.max.apply(null, pts.map((p) => p.price)), mn = Math.min.apply(null, pts.map((p) => p.price));
      html += '<div class="sumrow"><div><span>Change in period</span><b>' + (ch == null ? '—' : (ch > 0 ? '▲ ' : ch < 0 ? '▼ ' : '') + fmt(Math.abs(ch)) + '%') + '</b></div>' +
        '<div><span>Highest</span><b>' + esc(money(mx, cur)) + '</b></div><div><span>Lowest</span><b>' + esc(money(mn, cur)) + '</b></div></div>';
      const lastRec = latest(ser);
      if (isStale(lastRec)) html += '<p class="banner">The newest price for this product is from ' + esc(dLong(lastRec.recorded_on)) + ' and is outdated.</p>';
      html += '<button type="button" class="btn ghost small" data-pr="table">' + (h.table ? 'Hide table' : 'Show as table') + '</button>';
      if (h.table) {
        html += '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Date</th><th>Price</th><th>' + (h.market === '__avg' ? 'Markets' : 'Records') + '</th></tr></thead><tbody>' +
          pts.slice().reverse().map((p) => '<tr><td>' + esc(ptLabel(p)) + '</td><td>' + esc(money(p.price, cur)) + '</td><td>' + (h.market === '__avg' ? p.markets : p.records) + '</td></tr>').join('') + '</tbody></table></div>';
      }
    }
    body.innerHTML = html;
    if (pts.length) wireChart(pts, cur, unit);
  }

  /* ---------- alerts ---------- */
  async function loadAlerts() {
    if (!live || !FG.user) { S.alerts = []; S.alertsLoaded = false; paintBadge(); if (S.tab === 'alerts') render(); return; }
    const res = await sb.from('price_alerts').select('*').order('created_at', { ascending: false }).limit(100);
    if (!res.error) { S.alerts = res.data; S.alertsLoaded = true; }
    paintBadge();
    if (S.tab === 'alerts') render();
  }
  const unseen = (a) => a.triggered_at && (!a.seen_at || new Date(a.seen_at) < new Date(a.triggered_at));
  let announced = false;
  function paintBadge() {
    const b = $('#priceBadge'); if (!b) return;
    const n = S.alerts.filter(unseen).length;
    b.textContent = n > 9 ? '9+' : String(n); b.hidden = n === 0;
    if (n && !announced) { announced = true; toast(n === 1 ? 'A price alert was reached. See Prices > Alerts.' : n + ' price alerts were reached. See Prices > Alerts.'); }
  }
  function condText(a) {
    const c = catOf(a.category_id), per = UNIT[a.unit] || '';
    const parts = [];
    if (a.target_price) parts.push('price is ' + (a.direction === 'above' ? 'at or above ' : 'at or below ') + money(a.target_price, a.currency) + ' ' + per);
    if (a.change_pct) parts.push('price moves by ' + fmt(a.change_pct) + '% or more');
    return 'Tell me when ' + parts.join(', or when ') + (a.market_name ? ' at ' + a.market_name : ' at any market') + '.';
  }
  function renderAlerts(body) {
    if (!FG.user) {
      body.innerHTML = '<div class="empty"><p><b>Sign in to follow prices.</b></p><p class="meta">Set a target price and FarmGear will flag it here when a recorded price reaches it.</p><button type="button" class="btn" data-auth>Sign in or create account</button></div>';
      return;
    }
    let html = '<button type="button" class="btn alt wide" data-pr="newalert">' + icon('bell') + 'New price alert</button>' +
      '<p class="meta" style="margin:8px 0 14px">Alerts are checked when an administrator records a new price. They show here and on the Prices tab. They are not text messages.</p>';
    if (!S.alertsLoaded) html += '<div class="skel"></div>';
    else if (!S.alerts.length) html += '<div class="empty"><p><b>No alerts yet.</b></p><p class="meta">Follow a product to hear when its price reaches your target.</p></div>';
    else html += '<ul class="alist">' + S.alerts.map((a) => {
      const hit = unseen(a);
      const c = catOf(a.category_id);
      return '<li class="alert-card' + (hit ? ' hit' : '') + '"><h3>' + esc(c ? c.name : 'Product') + ' ' +
        (hit ? '<span class="pill sun">Reached</span>' : a.active ? '<span class="pill ok">Waiting</span>' : '<span class="pill">Paused</span>') + '</h3>' +
        '<span>' + esc(condText(a)) + '</span>' +
        (a.triggered_at ? '<span class="meta"><b>' + esc(a.trigger_reason || 'Triggered') + '</b>: ' + esc(money(a.triggered_price, a.currency)) + ' at ' + esc(a.triggered_market || '') + ' · ' + esc(dLong(a.triggered_at.slice(0, 10))) + '</span>' : '') +
        '<div class="mact">' + (hit ? '<button type="button" class="btn small" data-pr="seen" data-id="' + esc(a.id) + '">' + icon('check') + 'Got it</button>' : '') +
        '<button type="button" class="btn ghost small" data-pr="pause" data-id="' + esc(a.id) + '">' + (a.active ? 'Pause' : 'Turn on') + '</button>' +
        '<button type="button" class="btn ghost small" data-pr="delalert" data-id="' + esc(a.id) + '" aria-label="Delete alert">' + icon('trash') + '</button></div></li>';
    }).join('') + '</ul>';
    body.innerHTML = html;
  }

  function openAlertForm(cid) {
    if (!FG.requireAuth('Sign in to set a price alert.')) return;
    if (!S.cats.length) { toast('Prices are still loading. Try again.'); return; }
    if (cid) { S.cat = cid; const pk = primaryKey(cid); S.series = pk || (S.catMap[cid].price_unit + '|USD'); }
    const keys = Object.keys(seriesOf(S.cat));
    const ser = S.series || (S.catMap[S.cat].price_unit + '|USD');
    const markets = Array.from(new Set((seriesOf(S.cat)[ser] || []).map((r) => r.market_name))).sort();
    const quick = !!cid;
    FG.openSheet(
      '<h2>Price alert</h2><p class="meta">FarmGear will flag it when a recorded price matches.</p>' +
      '<form class="form" id="prAlertForm" style="margin-top:14px" autocomplete="off">' +
        '<label class="field"><span>Product</span><select id="alCat">' + S.cats.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === S.cat ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Unit</span><select id="alSer">' + (keys.length ? keys : [ser]).map((k) => '<option value="' + esc(k) + '"' + (k === ser ? ' selected' : '') + '>' + esc(serLabel(k)) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Market or buyer</span><select id="alMkt"><option value="">Any market</option>' + markets.map((m) => '<option>' + esc(m) + '</option>').join('') + '</select></label>' +
        '<div class="two"><label class="field"><span>Tell me when price is</span><select id="alDir"><option value="above">At or above</option><option value="below">At or below</option></select></label>' +
        '<label class="field"><span>My target price</span><input id="alTarget" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 300"></label></div>' +
        '<label class="field"><span>Also tell me if the price moves by (%)</span><input id="alPct" type="number" inputmode="decimal" min="1" max="100" step="any" value="' + (quick ? '5' : '') + '" placeholder="e.g. 5"><small>Leave empty to use only your target price.</small></label>' +
        '<p class="err" id="alErr" role="alert"></p><button type="submit" class="btn alt" id="alGo">Save alert</button></form>');
    $('#alCat').addEventListener('change', () => { openAlertForm($('#alCat').value); });
    $('#alSer').addEventListener('change', () => {
      S.series = $('#alSer').value; const mk = Array.from(new Set((seriesOf(S.cat)[S.series] || []).map((r) => r.market_name))).sort();
      $('#alMkt').innerHTML = '<option value="">Any market</option>' + mk.map((m) => '<option>' + esc(m) + '</option>').join('');
    });
    $('#prAlertForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#alErr'), target = parseFloat($('#alTarget').value), pct = parseFloat($('#alPct').value);
      if (!(target > 0) && !(pct > 0)) { err.textContent = 'Enter a target price, a percentage, or both.'; return; }
      if (pct > 100) { err.textContent = 'The percentage must be 100 or less.'; return; }
      const p = $('#alSer').value.split('|');
      $('#alGo').disabled = true; $('#alGo').textContent = 'Saving…';
      const res = await sb.from('price_alerts').insert({
        category_id: $('#alCat').value, market_name: $('#alMkt').value || null, unit: p[0], currency: p[1],
        direction: $('#alDir').value, target_price: target > 0 ? target : null, change_pct: pct > 0 ? pct : null
      });
      if (res.error) { err.textContent = res.error.message; $('#alGo').disabled = false; $('#alGo').textContent = 'Save alert'; return; }
      FG.closeSheet(); toast('Alert saved.');
      S.tab = 'alerts'; await loadAlerts(); render();
    });
  }

  /* ---------- events ---------- */
  view.addEventListener('change', (e) => {
    const t = e.target, a = t.getAttribute && t.getAttribute('data-pr');
    if (a === 'selcat') {
      S.cat = t.value; S.series = primaryKey(S.cat) || (S.catMap[S.cat].price_unit + '|USD'); S.type = 'all'; S.hist.market = '__avg';
      if (S.tab === 'history') loadHist(); else render();
    } else if (a === 'selser') {
      S.series = t.value; S.type = 'all'; S.hist.market = '__avg';
      if (S.tab === 'history') loadHist(); else render();
    } else if (a === 'selmkt') { S.hist.market = t.value; render(); }
  });
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pr]');
    if (!t || t.tagName === 'SELECT') return;
    const a = t.getAttribute('data-pr'), id = t.getAttribute('data-id');
    switch (a) {
      case 'tab': S.tab = id; render(); if (id === 'history') loadHist(); if (id === 'alerts' && FG.user && !S.alertsLoaded) loadAlerts(); break;
      case 'retry': load(true); break;
      case 'kind': S.kind = id; render(); break;
      case 'type': S.type = id; render(); break;
      case 'goto':
        S.cat = id; S.series = primaryKey(id) || ''; S.type = 'all'; S.hist.market = '__avg'; S.tab = t.getAttribute('data-to');
        render(); if (S.tab === 'history') loadHist(); window.scrollTo(0, 0); break;
      case 'follow': openAlertForm(id); break;
      case 'period': S.hist.period = id; S.hist.key = ''; loadHist(); break;
      case 'gran': S.hist.gran = id; render(); break;
      case 'hretry': S.hist.key = ''; loadHist(); break;
      case 'table': S.hist.table = !S.hist.table; render(); break;
      case 'newalert': openAlertForm(); break;
      case 'seen': {
        const r = await sb.from('price_alerts').update({ seen_at: new Date().toISOString() }).eq('id', id);
        if (r.error) toast(r.error.message); else { announced = true; await loadAlerts(); toast('Done. This alert is watching again.'); }
        break;
      }
      case 'pause': {
        const al = S.alerts.find((x) => x.id === id); if (!al) break;
        const r = await sb.from('price_alerts').update({ active: !al.active }).eq('id', id);
        if (r.error) toast(r.error.message); else loadAlerts();
        break;
      }
      case 'delalert': {
        if (!(await FG.confirm('Delete this alert?', 'You will stop hearing about this price.', 'Delete'))) break;
        const r = await sb.from('price_alerts').delete().eq('id', id);
        if (r.error) toast(r.error.message); else loadAlerts();
        break;
      }
      default: break;
    }
  });

  /* ---------- routing and session ---------- */
  FG.routes.prices = () => { build(); load(false); if (S.tab === 'history') loadHist(); };
  FG.on('user', () => { S.alerts = []; S.alertsLoaded = false; announced = false; paintBadge(); if (FG.user && live) loadAlerts(); if (S.built && S.tab === 'alerts') render(); });
  FG.on('profile', () => { if (S.built && S.tab === 'dash') render(); });
  FG.refreshPrices = () => { S.loaded = false; return load(true); };
  if (FG.view === 'prices') FG.routes.prices();
  if (FG.user && live) loadAlerts();
})();
