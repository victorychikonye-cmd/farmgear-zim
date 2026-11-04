/* FarmGear Zim: weather and farm weather analysis.
   Forecast numbers come from Open-Meteo (open-meteo.com), a free weather service, for the chosen town.
   The "analysis" cards are simple rules applied to those numbers. They are guidance, not promises.
   For official warnings, see the Zimbabwe Meteorological Services Department. */
(function () {
  'use strict';
  const FG = window.FG;
  if (!FG) return;
  const esc = FG.esc, toast = FG.toast;
  const $ = (s, r) => (r || document).querySelector(s);

  /* Town centres (approximate coordinates, enough for a weather grid cell) */
  const TOWNS = {
    'Harare': [-17.83, 31.05], 'Bulawayo': [-20.15, 28.58], 'Mutare': [-18.97, 32.67], 'Gweru': [-19.45, 29.82],
    'Masvingo': [-20.07, 30.83], 'Chinhoyi': [-17.36, 30.20], 'Chiredzi': [-21.05, 31.67], 'Marondera': [-18.19, 31.55],
    'Bindura': [-17.30, 31.33], 'Kadoma': [-18.33, 29.92], 'Kwekwe': [-18.92, 29.81], 'Victoria Falls': [-17.93, 25.83],
    'Hwange': [-18.37, 26.50], 'Beitbridge': [-22.22, 30.00], 'Gwanda': [-20.94, 29.00], 'Karoi': [-16.81, 29.69],
    'Chegutu': [-18.13, 30.14], 'Rusape': [-18.53, 32.13], 'Chipinge': [-20.19, 32.62], 'Zvishavane': [-20.33, 30.07],
    'Gokwe': [-18.21, 28.93], 'Kariba': [-16.52, 28.80], 'Mount Darwin': [-16.77, 31.58], 'Shurugwi': [-19.67, 30.00],
    'Lupane': [-18.93, 27.81], 'Plumtree': [-20.48, 27.81], 'Triangle': [-21.03, 31.45], 'Mutoko': [-17.40, 32.22],
    'Nyanga': [-18.22, 32.75], 'Chimanimani': [-19.80, 32.87], 'Gutu': [-19.65, 31.15], 'Murehwa': [-17.65, 31.78]
  };
  const NAMES = Object.keys(TOWNS).sort();
  const PAST = 14, AHEAD = 7;
  const KEY = 'farmgear-weather-v1';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const S = { built: false, town: '', data: null, at: 0, loading: false, err: '', stale: false, table: false, tok: 0 };

  /* ---------- storage ---------- */
  const readCache = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const writeCache = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } };

  /* ---------- helpers ---------- */
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const r1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString());
  const r0 = (v) => (v == null ? '–' : String(Math.round(v)));
  const parseD = (s) => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const dayLabel = (s) => { const d = parseD(s); return DAYS[d.getDay()] + ' ' + d.getDate(); };
  const dayLong = (s) => { const d = parseD(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };
  const sum = (a) => a.reduce((t, v) => t + (v || 0), 0);

  /* WMO weather codes used by Open-Meteo */
  function sky(code) {
    if (code === 0) return ['Clear', 'sun'];
    if (code === 1) return ['Mostly clear', 'sun'];
    if (code === 2) return ['Partly cloudy', 'cloud'];
    if (code === 3) return ['Cloudy', 'cloud'];
    if (code === 45 || code === 48) return ['Fog', 'cloud'];
    if (code >= 51 && code <= 57) return ['Drizzle', 'rain'];
    if (code >= 61 && code <= 67) return ['Rain', 'rain'];
    if (code >= 80 && code <= 82) return ['Showers', 'rain'];
    if (code >= 95) return ['Thunderstorm', 'storm'];
    return ['Mixed', 'cloud'];
  }

  /* ---------- data ---------- */
  function url(town) {
    const c = TOWNS[town];
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + c[0] + '&longitude=' + c[1] +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max' +
      '&past_days=' + PAST + '&forecast_days=' + AHEAD + '&timezone=Africa%2FHarare';
  }

  function tidy(j) {
    if (!j || !j.daily || !j.daily.time || !j.daily.time.length) throw new Error('The weather service sent no data.');
    const d = j.daily, rows = [];
    for (let i = 0; i < d.time.length; i++) {
      rows.push({
        date: d.time[i], code: num(d.weather_code && d.weather_code[i]),
        max: num(d.temperature_2m_max[i]), min: num(d.temperature_2m_min[i]),
        rain: num(d.precipitation_sum[i]), prob: num(d.precipitation_probability_max && d.precipitation_probability_max[i]),
        wind: num(d.wind_speed_10m_max && d.wind_speed_10m_max[i])
      });
    }
    const c = j.current || {};
    return {
      now: { temp: num(c.temperature_2m), feels: num(c.apparent_temperature), hum: num(c.relative_humidity_2m), rain: num(c.precipitation), wind: num(c.wind_speed_10m), code: num(c.weather_code), time: c.time || '' },
      days: rows
    };
  }

  async function fetchTown(town) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 12000);
    try {
      const res = await fetch(url(town), ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error('The weather service answered with an error (' + res.status + ').');
      return tidy(await res.json());
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('The weather service took too long to answer.');
      if (e && e.name === 'TypeError') throw new Error('Could not reach the weather service. You may be offline.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function load(force) {
    if (!S.town) return;
    const cache = readCache(), hit = cache[S.town];
    if (!force && hit && Date.now() - hit.at < 30 * 60 * 1000) { S.data = hit.data; S.at = hit.at; S.err = ''; S.stale = false; render(); return; }
    const tok = ++S.tok;
    S.loading = true; S.err = ''; render();
    try {
      const data = await fetchTown(S.town);
      if (tok !== S.tok) return;
      S.data = data; S.at = Date.now(); S.stale = false;
      cache[S.town] = { at: S.at, data: data }; writeCache(cache);
    } catch (e) {
      if (tok !== S.tok) return;
      if (hit) { S.data = hit.data; S.at = hit.at; S.stale = true; S.err = ''; }
      else { S.data = null; S.err = (e && e.message) || 'Could not load the weather.'; }
    }
    S.loading = false; render();
  }

  /* ---------- analysis (simple rules on the numbers) ---------- */
  function analyse(days) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let ti = days.findIndex((d) => parseD(d.date).getTime() >= today.getTime());
    if (ti < 0) ti = Math.max(0, days.length - AHEAD);
    const past = days.slice(Math.max(0, ti - PAST), ti), next = days.slice(ti);
    const out = [];
    const rainNext = sum(next.map((d) => d.rain)), rainPast = sum(past.map((d) => d.rain));

    // 1. rain coming
    let lvl, txt;
    if (rainNext < 5) { lvl = 'warn'; txt = 'Mostly dry. Very little rain is expected in the next ' + next.length + ' days.'; }
    else if (rainNext < 25) { lvl = 'ok'; txt = 'Light rain expected. It will wet the top of the soil but may not soak it deeply.'; }
    else if (rainNext <= 80) { lvl = 'ok'; txt = 'Good rain expected over the next ' + next.length + ' days.'; }
    else { lvl = 'bad'; txt = 'Heavy rain expected. Watch for waterlogged fields, washed-away soil and flooded roads.'; }
    out.push({ t: 'Rain coming', lvl: lvl, big: r0(rainNext) + ' mm', txt: txt });

    // 2. recent rain and planting
    let pl, pt;
    if (past.length < 3) { pl = 'warn'; pt = 'Not enough past data for this place.'; }
    else if (rainPast >= 40) { pl = 'ok'; pt = 'Soil has had good rain recently. A common rule of thumb is to wait for about 25 mm of rain over a few days before planting. Check with your AGRITEX officer for your area and crop.'; }
    else if (rainPast >= 15) { pl = 'warn'; pt = 'Some rain recently, but it may not be enough yet for planting. Check the soil by digging down with a hoe before you plant.'; }
    else { pl = 'warn'; pt = 'Very little rain recently. The soil is probably dry. Planting now is risky unless you can irrigate.'; }
    out.push({ t: 'Last ' + past.length + ' days', lvl: pl, big: r0(rainPast) + ' mm', txt: pt });

    // 3. dry spell
    let run = 0, best = 0;
    next.forEach((d) => { if ((d.rain || 0) < 1) { run++; best = Math.max(best, run); } else run = 0; });
    if (best >= 5) out.push({ t: 'Dry spell', lvl: 'warn', big: best + ' days', txt: 'About ' + best + ' dry days in a row are expected. Plan watering for seedlings, vegetables and livestock.' });
    else out.push({ t: 'Dry spell', lvl: 'ok', big: best + ' days', txt: 'No long dry spell is expected in this forecast. The longest dry run is ' + best + (best === 1 ? ' day.' : ' days.') });

    // 4. heat
    const hot = next.filter((d) => d.max != null && d.max >= 35);
    const warm = next.filter((d) => d.max != null && d.max >= 30);
    const maxT = Math.max.apply(null, next.map((d) => (d.max == null ? -99 : d.max)));
    if (hot.length) out.push({ t: 'Heat', lvl: 'bad', big: r0(maxT) + '°C', txt: hot.length + (hot.length === 1 ? ' day' : ' days') + ' of 35°C or more. Give animals shade and water, and avoid working in the middle of the day.' });
    else if (warm.length) out.push({ t: 'Heat', lvl: 'warn', big: r0(maxT) + '°C', txt: 'Hot days ahead (30°C or more on ' + warm.length + (warm.length === 1 ? ' day' : ' days') + '). Water early in the morning or late in the afternoon.' });
    else out.push({ t: 'Heat', lvl: 'ok', big: r0(maxT) + '°C', txt: 'No extreme heat expected. The hottest day reaches about ' + r0(maxT) + '°C.' });

    // 5. frost
    const minT = Math.min.apply(null, next.map((d) => (d.min == null ? 99 : d.min)));
    if (minT <= 3) out.push({ t: 'Frost risk', lvl: minT <= 0 ? 'bad' : 'warn', big: r0(minT) + '°C', txt: 'Very cold nights are expected (as low as about ' + r0(minT) + '°C). Frost can burn young crops and tobacco seedlings. Cover them if you can.' });
    else out.push({ t: 'Frost risk', lvl: 'ok', big: r0(minT) + '°C', txt: 'No frost expected. The coldest night is about ' + r0(minT) + '°C.' });

    // 6. spraying window
    const good = next.filter((d) => d.wind != null && d.wind <= 15 && (d.rain || 0) < 1 && (d.prob == null || d.prob <= 20));
    if (good.length) out.push({ t: 'Good spraying days', lvl: 'ok', big: String(good.length), txt: good.slice(0, 4).map((d) => dayLabel(d.date)).join(', ') + (good.length > 4 ? ' and more' : '') + '. Calm and dry. Spray early in the morning and follow the label on the chemical.' });
    else out.push({ t: 'Good spraying days', lvl: 'warn', big: '0', txt: 'No calm, dry days in this forecast. Wind carries spray away and rain washes it off. Wait for a better day.' });
    return { cards: out, past: past, next: next, rainNext: rainNext, rainPast: rainPast };
  }

  /* ---------- screen ---------- */
  function build() {
    if (S.built) return;
    const host = $('#view-weather'); if (!host) return;
    S.built = true;
    const saved = readCache().__town;
    const prof = FG.profile && FG.profile.town;
    S.town = (saved && TOWNS[saved]) ? saved : (prof && TOWNS[prof] ? prof : 'Harare');
    host.innerHTML =
      '<h1>Farm weather</h1>' +
      '<p class="lead">Rain, heat and wind for your town, with simple advice for your farm work.</p>' +
      '<label class="field"><span>Choose your nearest town</span><select id="wxTown">' +
        NAMES.map((n) => '<option' + (n === S.town ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' +
      '<div id="wxBody" aria-live="polite"></div>';
    $('#wxTown').addEventListener('change', function () {
      S.town = this.value; S.data = null; S.table = false;
      const c = readCache(); c.__town = S.town; writeCache(c);
      load(false);
    });
  }

  const pill = (lvl) => '<span class="pill ' + lvl + '">' + (lvl === 'ok' ? 'OK' : lvl === 'warn' ? 'Take care' : 'Warning') + '</span>';
  const ico = (k) => '<svg class="ic wxic" viewBox="0 0 48 48" aria-hidden="true"><use href="#i-wx-' + k + '"/></svg>';

  function chart(a) {
    const rows = a.past.concat(a.next);
    const W = 340, H = 186, L = 34, R = 8, T = 22, B = 30, pw = W - L - R, ph = H - T - B;
    const vals = rows.map((d) => d.rain || 0);
    let max = Math.max.apply(null, vals.concat([5]));
    const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : 20;
    max = Math.ceil(max / step) * step;
    const bw = pw / rows.length;
    let g = '';
    for (let v = 0; v <= max; v += step) {
      const y = T + ph - (v / max) * ph;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="var(--chart-grid)" stroke-width="1"/>' +
        '<text x="' + (L - 5) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + v + '</text>';
    }
    let bars = '';
    rows.forEach((d, i) => {
      const fut = i >= a.past.length, h = ((d.rain || 0) / max) * ph, x = L + i * bw + 1.5;
      bars += '<rect x="' + x + '" y="' + (T + ph - h) + '" width="' + Math.max(1, bw - 3) + '" height="' + Math.max(h, (d.rain || 0) > 0 ? 1 : 0) + '" rx="2" fill="var(--chart)"' + (fut ? '' : ' opacity=".4"') + '/>';
    });
    const sepX = L + a.past.length * bw;
    const lab = (i) => '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + dayLabel(rows[i].date) + '</text>';
    let xs = lab(0) + lab(Math.min(rows.length - 1, a.past.length)) + lab(rows.length - 1);
    return '<div class="chart-wrap"><svg id="wxSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily rain in millimetres: the last ' + a.past.length + ' days and the next ' + a.next.length + ' days">' +
      g + bars +
      '<line x1="' + sepX + '" x2="' + sepX + '" y1="' + T + '" y2="' + (T + ph) + '" stroke="var(--muted)" stroke-dasharray="3 3"/>' +
      '<text x="' + (sepX + 4) + '" y="' + (T + 10) + '" font-size="10" fill="var(--muted)">Today</text>' + xs +
      '<text x="4" y="10" font-size="10" fill="var(--muted)">mm</text>' +
      '<rect id="wxHit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" fill="transparent"/></svg>' +
      '<div class="tip" id="wxTip" hidden></div></div>' +
      '<p class="legend"><span class="sw" style="opacity:.4"></span>Past days (model estimate) <span class="sw"></span>Forecast</p>';
  }

  function render() {
    if (!S.built) return;
    const el = $('#wxBody'); if (!el) return;
    if (S.loading && !S.data) { el.innerHTML = '<div class="skel" style="margin-top:14px"></div><div class="skel" style="margin-top:12px"></div><div class="skel" style="margin-top:12px"></div>'; return; }
    if (S.err && !S.data) {
      el.innerHTML = '<div class="empty"><p class="err">Could not load the weather.</p><p class="meta">' + esc(S.err) + '</p><p class="meta">Check your internet and try again.</p><button type="button" class="btn" data-wx="retry">Try again</button></div>';
      return;
    }
    if (!S.data) { el.innerHTML = ''; return; }
    const a = analyse(S.data.days), n = S.data.now, k = sky(n.code);
    const when = new Date(S.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    let h = '';
    if (S.stale) h += '<p class="banner">You are offline or the weather service is not answering. Showing the weather saved at ' + esc(when) + '. It may be out of date.</p>';
    h += '<div class="wxnow">' + ico(k[1]) + '<div><div class="wxtemp">' + r0(n.temp) + '°C</div><div class="meta">' + esc(k[0]) + ' in ' + esc(S.town) + ' now</div></div></div>' +
      '<div class="kv wxkv"><div><span>Feels like</span><b>' + r0(n.feels) + '°C</b></div><div><span>Humidity</span><b>' + r0(n.hum) + '%</b></div><div><span>Wind</span><b>' + r0(n.wind) + ' km/h</b></div></div>';
    h += '<h2 class="sub-h">Farm advice</h2><div class="wxcards">' + a.cards.map((c) =>
      '<div class="wxcard"><div class="wxhead"><b>' + esc(c.t) + '</b>' + pill(c.lvl) + '</div><div class="wxbig">' + esc(c.big) + '</div><p class="meta">' + esc(c.txt) + '</p></div>').join('') + '</div>';
    h += '<h2 class="sub-h">Next ' + a.next.length + ' days</h2><ul class="wxdays">' + a.next.map((d) => {
      const s = sky(d.code);
      return '<li>' + ico(s[1]) + '<span class="wxd"><b>' + esc(dayLong(d.date)) + '</b><span class="meta">' + esc(s[0]) + '</span></span>' +
        '<span class="wxt"><b>' + r0(d.max) + '°</b> / ' + r0(d.min) + '°</span>' +
        '<span class="wxr">' + r1(d.rain) + ' mm' + (d.prob != null ? '<span class="meta">' + r0(d.prob) + '% chance</span>' : '') + '</span></li>';
    }).join('') + '</ul>';
    h += '<h2 class="sub-h">Rain, day by day</h2><p class="meta">Total for the next ' + a.next.length + ' days: <b>' + r0(a.rainNext) + ' mm</b>. Last ' + a.past.length + ' days: <b>' + r0(a.rainPast) + ' mm</b>.</p>' + chart(a) +
      '<button type="button" class="btn ghost small" data-wx="table">' + (S.table ? 'Hide table' : 'Show as table') + '</button>';
    if (S.table) {
      h += '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Day</th><th>Rain (mm)</th><th>High</th><th>Low</th></tr></thead><tbody>' +
        a.past.concat(a.next).map((d) => '<tr><td>' + esc(dayLong(d.date)) + '</td><td>' + r1(d.rain) + '</td><td>' + r0(d.max) + '°</td><td>' + r0(d.min) + '°</td></tr>').join('') + '</tbody></table></div>';
    }
    h += '<p class="banner" style="margin-top:16px">Weather data: <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a>, updated ' + esc(when) + '. Forecasts can be wrong, and past rain is a model estimate, not a rain gauge reading. The advice cards are simple guides. For official warnings, follow the Zimbabwe Meteorological Services Department, and ask your AGRITEX officer about your crop.</p>' +
      '<button type="button" class="btn ghost wide" data-wx="refresh">Refresh weather</button>';
    el.innerHTML = h;
    wireChart(a);
  }

  function wireChart(a) {
    const hit = $('#wxHit'), svg = $('#wxSvg'), tip = $('#wxTip');
    if (!hit || !svg || !tip) return;
    const rows = a.past.concat(a.next);
    function at(ev) {
      const box = svg.getBoundingClientRect();
      const x = ((ev.clientX - box.left) / box.width) * 340 - 34;
      const i = Math.max(0, Math.min(rows.length - 1, Math.floor(x / ((340 - 34 - 8) / rows.length))));
      const d = rows[i];
      tip.hidden = false;
      tip.innerHTML = '<b>' + r1(d.rain) + ' mm</b>' + esc(dayLong(d.date)) + (i >= a.past.length ? ' · forecast' : ' · estimate');
      const wrap = tip.parentNode.getBoundingClientRect();
      tip.style.left = Math.max(60, Math.min(wrap.width - 60, ev.clientX - wrap.left)) + 'px';
      tip.style.top = '30px';
    }
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-wx]'); if (!t) return;
    const a = t.getAttribute('data-wx');
    if (a === 'retry' || a === 'refresh') { load(true); if (a === 'refresh') toast('Updating the weather…'); }
    else if (a === 'table') { S.table = !S.table; render(); }
  });

  FG.routes.weather = () => { build(); if (!S.data && !S.loading) load(false); else if (S.data && Date.now() - S.at > 30 * 60 * 1000 && !S.loading) load(false); else render(); };
  if (FG.view === 'weather') FG.routes.weather();
})();
