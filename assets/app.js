/* Council service costs across Scotland. No dependencies; data comes from data/*.js. */
(() => {
  'use strict';

  const D = window.LGBF;
  const MAP = window.COUNCIL_MAP;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  if (!D || !MAP) {
    $('#main').textContent = 'The data files did not load. Check that the data folder sits next to index.html.';
    return;
  }

  /* ------------------------------------------------------------------ data */
  const YEARS = D.years;
  const IND = Object.fromEntries(D.indicators.map((i) => [i.code, i]));
  const COUNCILS = MAP.councils;
  const BY_NAME = Object.fromEntries(COUNCILS.map((c) => [c.lgbf, c]));
  const SERVICE_LABEL = {
    'Adult Social Care Services': 'Adult social care',
    "Children's Services": "Children's services",
    'Corporate Services': 'Corporate services',
    'Culture & Leisure Services': 'Culture and leisure',
    'Economic Development': 'Economic development',
    'Environmental Services': 'Environment',
  };

  const state = {
    ind: IND.CHN01 ? 'CHN01' : D.indicators[0].code,
    year: YEARS[YEARS.length - 1],
    basis: 'real',
    scale: 'year',       // 'year': colour groups fitted to the selected year; 'all': pooled across every year
    council: null,
    playing: false,
  };

  const bi = () => (state.basis === 'real' ? 1 : 0);
  const val = (ind, council, year) => {
    const r = D.data[ind] && D.data[ind][council] && D.data[ind][council][year];
    return r ? r[bi()] : null;
  };
  const scot = (ind, year) => {
    const r = D.scotland[ind] && D.scotland[ind][year];
    return r ? r[bi()] : null;
  };
  const basisNote = () => (state.basis === 'real' ? 'in 2024-25 prices' : 'as reported, not adjusted for inflation');

  /* ------------------------------------------------------------------ formatting */
  const nf0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v) => (v == null ? 'No data' : (Math.abs(v) >= 100 ? nf0 : nf2).format(v));
  const moneyShort = (v) => {
    if (Math.abs(v) < 10000) return money(v);
    const k = v / 1000;
    return '£' + (Math.abs(v) >= 100000 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  };
  const tickFmt = (v, step) => {
    if (Math.abs(v) >= 10000) return moneyShort(v);
    const d = step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step)));
    return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const rankText = (rank, n) =>
    rank === 1 ? `Highest of ${n} councils` : rank === n ? `Lowest of ${n} councils` : `${ordinal(rank)} highest of ${n} councils`;

  function niceTicks(lo, hi, n) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(+t.toFixed(10));
    return { min, max, step, ticks };
  }

  /* ------------------------------------------------------------------ derived values */
  const breaksCache = new Map();
  function getBreaks(ind) {
    const pooled = state.scale === 'all';
    const key = [ind, state.basis, pooled ? 'all' : state.year].join('|');
    if (breaksCache.has(key)) return breaksCache.get(key);
    const vals = [];
    for (const c of Object.keys(D.data[ind])) for (const y of (pooled ? YEARS : [state.year])) { const v = val(ind, c, y); if (v != null) vals.push(v); }
    if (!vals.length) return { min: 0, max: 0, cuts: [0, 0, 0, 0] };
    vals.sort((a, b) => a - b);
    const q = (p) => {
      const i = (vals.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return vals[lo] + (vals[hi] - vals[lo]) * (i - lo);
    };
    const res = { min: vals[0], max: vals[vals.length - 1], cuts: [q(0.2), q(0.4), q(0.6), q(0.8)] };
    breaksCache.set(key, res);
    return res;
  }
  const klass = (v, b) => (v == null ? -1 : v <= b.cuts[0] ? 0 : v <= b.cuts[1] ? 1 : v <= b.cuts[2] ? 2 : v <= b.cuts[3] ? 3 : 4);
  const rangeText = (k, b) => {
    const e = [b.min, ...b.cuts, b.max];
    return `${money(e[k])} to ${money(e[k + 1])}`;
  };

  const rankCache = new Map();
  function ranking(ind, year) {
    const key = [ind, year, state.basis].join('|');
    if (rankCache.has(key)) return rankCache.get(key);
    const rows = COUNCILS.map((c) => ({ name: c.lgbf, v: val(ind, c.lgbf, year) }));
    const have = rows.filter((r) => r.v != null).sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
    have.forEach((r, i) => { r.rank = i + 1; });
    const none = rows.filter((r) => r.v == null);
    const byName = new Map(have.map((r) => [r.name, r]));
    const res = { have, none, byName };
    rankCache.set(key, res);
    return res;
  }

  function compute() {
    return { ind: IND[state.ind], b: getBreaks(state.ind), rk: ranking(state.ind, state.year), scotV: scot(state.ind, state.year) };
  }

  /* ------------------------------------------------------------------ tooltip */
  const tip = el('div', 'tip');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(x, y, nodes) {
    tip.replaceChildren(...nodes);
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let tx = x + 14, ty = y + 14;
    if (tx + r.width > window.innerWidth - 8) tx = x - r.width - 14;
    if (ty + r.height > window.innerHeight - 8) ty = y - r.height - 14;
    tip.style.transform = `translate(${Math.max(8, tx)}px, ${Math.max(8, ty)}px)`;
  }
  const hideTip = () => { tip.hidden = true; };

  /* ------------------------------------------------------------------ map */
  const svg = $('#map');
  const regionEls = new Map();
  let hoverPath, selPath;

  function buildMap() {
    const [W, H] = MAP.viewBox;
    const ib = MAP.inset && MAP.inset.box;
    const minX = Math.min(0, ib ? ib[0] : 0) - 60;
    const maxX = Math.max(W, ib ? ib[2] : W) + 60;
    const minY = Math.min(0, ib ? ib[1] : 0) - 60;
    const maxY = H + 60;
    const vw = maxX - minX, vh = maxY - minY;
    svg.setAttribute('viewBox', `${minX} ${minY} ${vw} ${vh}`);

    const g = svgEl('g', {});
    for (const c of COUNCILS) {
      const p = svgEl('path', { d: c.d, class: 'region na', 'fill-rule': 'evenodd', tabindex: '0', role: 'button' });
      p.dataset.c = c.lgbf;
      g.appendChild(p);
      regionEls.set(c.lgbf, p);
    }
    svg.appendChild(g);
    if (ib) {
      svg.appendChild(svgEl('rect', { class: 'inset-frame', x: ib[0], y: ib[1], width: ib[2] - ib[0], height: ib[3] - ib[1] }));
      const note = $('#insetNote');
      note.style.right = (100 - ((ib[2] - minX) / vw) * 100) + '%';
      note.style.top = (((ib[3] - minY) / vh) * 100 + 0.6) + '%';
    } else {
      $('#insetNote').hidden = true;
    }
    hoverPath = svgEl('path', { class: 'outline', id: 'hoverOutline', 'fill-rule': 'evenodd' });
    selPath = svgEl('path', { class: 'outline', id: 'selOutline', 'fill-rule': 'evenodd' });
    svg.append(hoverPath, selPath);

    const tipLines = (name) => {
      const v = val(state.ind, name, state.year);
      const rk = ranking(state.ind, state.year);
      if (v == null) return [el('div', 'tip-name', name), el('div', 'tip-sub', 'No data for this measure in ' + state.year)];
      return [el('div', 'tip-name', name), el('div', 'tip-val', money(v)), el('div', 'tip-sub', rankText(rk.byName.get(name).rank, rk.have.length))];
    };
    svg.addEventListener('pointermove', (e) => {
      const p = e.target.closest && e.target.closest('.region');
      if (!p) { setHover(null); hideTip(); return; }
      setHover(p.dataset.c);
      if (e.pointerType !== 'touch') showTip(e.clientX, e.clientY, tipLines(p.dataset.c));
    });
    svg.addEventListener('pointerleave', () => { setHover(null); hideTip(); });
    svg.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') { setHover(null); hideTip(); } });
    svg.addEventListener('click', (e) => {
      const p = e.target.closest && e.target.closest('.region');
      if (p) toggleSelect(p.dataset.c);
    });
    svg.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('region')) {
        e.preventDefault();
        toggleSelect(e.target.dataset.c);
      }
    });
    svg.addEventListener('focusin', (e) => {
      if (!e.target.classList || !e.target.classList.contains('region')) return;
      const r = e.target.getBoundingClientRect();
      setHover(e.target.dataset.c);
      showTip(r.left + r.width / 2, r.top + r.height / 2, tipLines(e.target.dataset.c));
    });
    svg.addEventListener('focusout', () => { setHover(null); hideTip(); });
  }

  function setHover(name) {
    hoverPath.setAttribute('d', name ? BY_NAME[name].d : '');
    rowEls.forEach((o, n) => o.li.classList.toggle('hov', n === name));
  }

  function renderMap(ctx) {
    for (const c of COUNCILS) {
      const v = val(state.ind, c.lgbf, state.year);
      const k = klass(v, ctx.b);
      const p = regionEls.get(c.lgbf);
      p.setAttribute('class', 'region ' + (k < 0 ? 'na' : 'k' + k));
      p.setAttribute('aria-pressed', String(state.council === c.lgbf));
      p.setAttribute('aria-label', v == null ? `${c.lgbf}: no data` : `${c.lgbf}: ${money(v)}, ${rankText(ctx.rk.byName.get(c.lgbf).rank, ctx.rk.have.length)}`);
    }
    selPath.setAttribute('d', state.council ? BY_NAME[state.council].d : '');
    $('#mapTitle').textContent = ctx.ind.title;
    $('#mapSub').textContent = `${state.year}, ${basisNote()}`;
  }

  function renderLegend(ctx) {
    const L = $('#legend');
    L.replaceChildren();
    const bar = el('div', 'lg-bar');
    for (let i = 0; i < 5; i++) bar.appendChild(el('span'));
    const labels = el('div', 'lg-labels');
    [ctx.b.min, ...ctx.b.cuts, ctx.b.max].forEach((v, i) => {
      const s = el('span', i === 0 ? 'first' : i === 5 ? 'last' : '', moneyShort(v));
      s.style.left = i * 20 + '%';
      labels.appendChild(s);
    });
    const na = el('div', 'lg-na');
    na.append(el('i'), document.createTextNode('No data'));
    L.append(bar, labels, na);
    $('#fineNote').textContent = state.scale === 'year'
      ? 'Councils fall into five equal-sized groups for the selected year, so colours show how councils compare with each other in that year. Choose All years to keep colours comparable as the year changes.'
      : 'Councils fall into five equal-sized groups of values pooled across every year, so a colour means the same thing in each year.';
  }

  /* ------------------------------------------------------------------ focus: hero, facts, trend */
  function renderFocus(ctx) {
    const c = state.council, y = state.year;
    $('#focusName').textContent = c || 'Scotland';
    $('#clearSel').hidden = !c;
    const v = c ? val(state.ind, c, y) : ctx.scotV;
    $('#heroFig').textContent = v == null ? 'No data' : money(v);
    $('#heroSub').replaceChildren(el('span', 'b', ctx.ind.title), el('span', 'b', `${y}, ${basisNote()}`));

    const facts = [];
    const prevY = YEARS[YEARS.indexOf(y) - 1];
    const change = (cur, prev) => {
      if (cur == null || prev == null || !prev) return null;
      const d = ((cur - prev) / prev) * 100;
      return Math.abs(d) < 0.05 ? `Unchanged from ${prevY}` : `${Math.abs(d).toFixed(1)}% ${d > 0 ? 'higher' : 'lower'} than in ${prevY}`;
    };
    if (c) {
      if (v == null) {
        facts.push(`${c} has no figure for this measure in ${y}.`);
      } else {
        if (ctx.scotV != null) {
          const d = v - ctx.scotV;
          facts.push(Math.abs(d) < 0.005 ? `Level with Scotland (${money(ctx.scotV)})` : `${money(Math.abs(d))} ${d > 0 ? 'above' : 'below'} Scotland (${money(ctx.scotV)})`);
        }
        facts.push(rankText(ctx.rk.byName.get(c).rank, ctx.rk.have.length));
        if (prevY) { const f = change(v, val(state.ind, c, prevY)); if (f) facts.push(f); }
      }
    } else {
      if (v != null && prevY) { const f = change(v, scot(state.ind, prevY)); if (f) facts.push(f); }
      const hv = ctx.rk.have;
      if (hv.length >= 2) {
        facts.push(`Highest: ${hv[0].name} (${money(hv[0].v)})`);
        facts.push(`Lowest: ${hv[hv.length - 1].name} (${money(hv[hv.length - 1].v)})`);
      }
      facts.push('Select a council on the map or in the list to compare it with Scotland.');
    }
    $('#facts').replaceChildren(...facts.map((t) => el('li', '', t)));
    renderTrend(ctx);
  }

  function renderTrend(ctx) {
    const box = $('#trend');
    const keys = $('#trendKeys');
    box.replaceChildren();
    keys.replaceChildren();

    const series = [];
    if (state.council) series.push({ name: state.council, color: 'var(--s1)', vals: YEARS.map((y) => val(state.ind, state.council, y)) });
    series.push({ name: 'Scotland', color: 'var(--s2)', vals: YEARS.map((y) => scot(state.ind, y)) });
    const all = series.flatMap((s) => s.vals).filter((v) => v != null);
    if (!all.length) { box.appendChild(el('p', 't-empty', 'No data for this measure.')); return; }

    if (series.length >= 2) {
      for (const s of series) {
        const k = el('span', 'key');
        const line = el('i', 'kline');
        line.style.background = s.color;
        k.append(line, document.createTextNode(s.name));
        keys.appendChild(k);
      }
    }

    const w = Math.max(280, Math.round(box.getBoundingClientRect().width) || 520);
    const h = 236;
    const m = { t: 22, r: 14, b: 28, l: 54 };
    const { min, max, step, ticks } = niceTicks(Math.min(...all), Math.max(...all), 4);
    const n = YEARS.length;
    const X = (i) => m.l + (i * (w - m.l - m.r)) / (n - 1);
    const Y = (v) => m.t + (1 - (v - min) / (max - min)) * (h - m.t - m.b);
    const cur = YEARS.indexOf(state.year);

    const s = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`, role: 'img',
      'aria-label': `Line chart of ${ctx.ind.title}, ${YEARS[0]} to ${YEARS[n - 1]}, for ${series.map((q) => q.name).join(' and ')}. The same values are in the tables on this page.`,
    });
    for (const t of ticks) {
      s.appendChild(svgEl('line', { class: 't-grid', x1: m.l, x2: w - m.r, y1: Y(t), y2: Y(t) }));
      const lab = svgEl('text', { class: 't-tick', x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' });
      lab.textContent = tickFmt(t, step);
      s.appendChild(lab);
    }
    s.appendChild(svgEl('line', { class: 't-axis', x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b }));
    [0, 4, 8, 12].forEach((i) => {
      if (i >= n) return;
      const lab = svgEl('text', { class: 't-tick', x: X(i), y: h - 8, 'text-anchor': i === 0 ? 'start' : 'middle' });
      lab.textContent = YEARS[i];
      s.appendChild(lab);
    });
    s.appendChild(svgEl('line', { class: 't-axis', x1: X(cur), x2: X(cur), y1: m.t, y2: h - m.b }));

    for (const q of series) {
      let d = '';
      q.vals.forEach((v, i) => { if (v != null) d += (d && q.vals[i - 1] != null ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
      const path = svgEl('path', { class: 't-line', d });
      path.style.stroke = q.color;
      s.appendChild(path);
    }
    const atYear = series.filter((q) => q.vals[cur] != null).sort((a, b) => b.vals[cur] - a.vals[cur]);
    atYear.forEach((q, idx) => {
      const cx = X(cur), cy = Y(q.vals[cur]);
      const dot = svgEl('circle', { class: 't-dot', cx, cy, r: 4.5 });
      dot.style.fill = q.color;
      s.appendChild(dot);
      const anchor = cx < m.l + 36 ? 'start' : cx > w - m.r - 36 ? 'end' : 'middle';
      const lab = svgEl('text', { class: 't-val', x: cx, y: idx === 0 ? cy - 11 : cy + 19, 'text-anchor': anchor });
      lab.textContent = money(q.vals[cur]);
      s.appendChild(lab);
    });

    const cross = svgEl('line', { class: 't-cross', y1: m.t, y2: h - m.b, visibility: 'hidden' });
    s.appendChild(cross);
    const hoverDots = series.map((q) => {
      const c = svgEl('circle', { class: 't-dot', r: 4.5, visibility: 'hidden' });
      c.style.fill = q.color;
      s.appendChild(c);
      return c;
    });
    const hit = svgEl('rect', { x: m.l - 6, y: m.t, width: w - m.l - m.r + 12, height: h - m.t - m.b, fill: 'transparent' });
    hit.style.cursor = 'pointer';
    const nearest = (e) => {
      const r = s.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * w;
      return Math.max(0, Math.min(n - 1, Math.round(((x - m.l) / (w - m.l - m.r)) * (n - 1))));
    };
    hit.addEventListener('pointermove', (e) => {
      const i = nearest(e);
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      series.forEach((q, k) => {
        const v = q.vals[i];
        hoverDots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
        if (v != null) { hoverDots[k].setAttribute('cx', X(i)); hoverDots[k].setAttribute('cy', Y(v)); }
      });
      const rows = [el('div', 'tip-name', YEARS[i])];
      for (const q of series) {
        const row = el('div', 'tip-row');
        const line = el('i', 'kline');
        line.style.background = q.color;
        row.append(line, el('span', '', q.name), el('span', 'tv', money(q.vals[i])));
        rows.push(row);
      }
      showTip(e.clientX, e.clientY, rows);
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      hoverDots.forEach((c) => c.setAttribute('visibility', 'hidden'));
      hideTip();
    });
    hit.addEventListener('click', (e) => { stopPlay(); state.year = YEARS[nearest(e)]; update(); });
    s.appendChild(hit);
    box.appendChild(s);
  }

  /* ------------------------------------------------------------------ ranking */
  const rowEls = new Map();
  function buildRows() {
    const ul = $('#rows');
    for (const c of COUNCILS) {
      const li = el('li');
      const btn = el('button', 'row');
      btn.type = 'button';
      const name = el('span', 'r-name', c.lgbf);
      const track = el('span', 'r-track');
      const bar = el('span', 'r-bar');
      const mark = el('span', 'r-mark');
      track.append(bar, mark);
      const v = el('span', 'r-val');
      btn.append(name, track, v);
      li.appendChild(btn);
      ul.appendChild(li);
      btn.addEventListener('click', () => toggleSelect(c.lgbf));
      btn.addEventListener('pointerenter', () => setHover(c.lgbf));
      btn.addEventListener('pointerleave', () => setHover(null));
      btn.addEventListener('focus', () => setHover(c.lgbf));
      btn.addEventListener('blur', () => setHover(null));
      rowEls.set(c.lgbf, { li, btn, bar, mark, v });
    }
  }

  function renderRanking(ctx) {
    const ul = $('#rows');
    ul.classList.toggle('has-sel', !!state.council);
    const peak = Math.max(...ctx.rk.have.map((r) => r.v), ctx.scotV == null ? 0 : ctx.scotV) || 1;
    [...ctx.rk.have, ...ctx.rk.none].forEach((r) => {
      const o = rowEls.get(r.name);
      ul.appendChild(o.li);
      const has = r.v != null;
      o.bar.style.width = has ? (r.v / peak) * 100 + '%' : '0%';
      o.mark.hidden = ctx.scotV == null;
      o.mark.style.left = ctx.scotV == null ? '0' : (ctx.scotV / peak) * 100 + '%';
      o.v.textContent = has ? money(r.v) : 'No data';
      o.v.className = 'r-val' + (has ? '' : ' none');
      o.btn.setAttribute('aria-pressed', String(state.council === r.name));
      o.btn.setAttribute('aria-label', has ? `${r.name}, ${money(r.v)}, ${rankText(r.rank, ctx.rk.have.length)}` : `${r.name}, no data`);
    });
    $('#rankSub').textContent = ctx.scotV == null ? `${ctx.ind.title}, ${state.year}.` : `${ctx.ind.title}, ${state.year}. The vertical line marks Scotland (${money(ctx.scotV)}).`;
  }

  /* ------------------------------------------------------------------ profile + data tables */
  function renderProfile() {
    const c = state.council, y = state.year;
    $('#profTitle').textContent = c ? `How ${c} compares across services` : 'All measures for Scotland';
    $('#profSub').textContent = `${y}, ${basisNote()}. Select a measure to show it on the map.`;
    const thead = $('#profTable thead');
    const tbody = $('#profTable tbody');
    thead.replaceChildren();
    tbody.replaceChildren();
    const hr = el('tr');
    const heads = c ? [['Measure', ''], [c, 'num'], ['Rank', 'num'], ['Scotland', 'num']] : [['Measure', ''], ['Scotland', 'num']];
    heads.forEach(([t, cls]) => { const th = el('th', cls, t); th.scope = 'col'; hr.appendChild(th); });
    thead.appendChild(hr);

    let svc = null;
    for (const i of D.indicators) {
      if (i.service !== svc) {
        svc = i.service;
        const g = el('tr', 'grp');
        const th = el('th', '', SERVICE_LABEL[svc] || svc);
        th.colSpan = heads.length;
        g.appendChild(th);
        tbody.appendChild(g);
      }
      const tr = el('tr', i.code === state.ind ? 'cur' : '');
      const th = el('th');
      th.scope = 'row';
      const b = el('button', 'link', i.title);
      b.type = 'button';
      b.addEventListener('click', () => { state.ind = i.code; update(); });
      th.appendChild(b);
      tr.appendChild(th);
      if (c) {
        const v = val(i.code, c, y);
        const rk = ranking(i.code, y);
        tr.append(
          el('td', 'num', money(v)),
          el('td', 'num', v == null ? 'No data' : `${ordinal(rk.byName.get(c).rank)} of ${rk.have.length}`),
          el('td', 'num', money(scot(i.code, y)))
        );
      } else {
        tr.appendChild(el('td', 'num', money(scot(i.code, y))));
      }
      tr.querySelectorAll('td').forEach((td, k) => { td.dataset.label = heads[k + 1][0]; });
      tbody.appendChild(tr);
    }
  }

  function renderTable(ctx) {
    const t = $('#dataTable');
    t.replaceChildren();
    t.appendChild(el('caption', '', `${ctx.ind.title}, ${state.year}, ${basisNote()}`));
    const thead = el('thead');
    const hr = el('tr');
    [['Council', ''], ['Value', 'num'], ['Rank', 'num'], ['Colour group on the map', '']].forEach(([x, cls]) => { const th = el('th', cls, x); th.scope = 'col'; hr.appendChild(th); });
    thead.appendChild(hr);
    const tb = el('tbody');
    [...COUNCILS].sort((a, b) => a.lgbf.localeCompare(b.lgbf)).forEach((c) => {
      const v = val(state.ind, c.lgbf, state.year);
      const k = klass(v, ctx.b);
      const tr = el('tr');
      const th = el('th', '', c.lgbf);
      th.scope = 'row';
      tr.append(
        th,
        el('td', 'num', money(v)),
        el('td', 'num', v == null ? '' : `${ctx.rk.byName.get(c.lgbf).rank} of ${ctx.rk.have.length}`),
        el('td', '', k < 0 ? 'No data' : `Group ${k + 1} of 5 (${rangeText(k, ctx.b)})`)
      );
      tb.appendChild(tr);
    });
    t.append(thead, tb);
  }

  /* ------------------------------------------------------------------ controls and state */
  function buildSelect() {
    const sel = $('#measure');
    const groups = new Map();
    for (const i of D.indicators) { if (!groups.has(i.service)) groups.set(i.service, []); groups.get(i.service).push(i); }
    groups.forEach((list, svc) => {
      const og = document.createElement('optgroup');
      og.label = SERVICE_LABEL[svc] || svc;
      list.forEach((i) => { const o = el('option', '', i.title); o.value = i.code; og.appendChild(o); });
      sel.appendChild(og);
    });
  }

  function renderControls() {
    $('#measure').value = state.ind;
    document.querySelectorAll('[data-basis]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.basis === state.basis)));
    document.querySelectorAll('[data-scale]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scale === state.scale)));
    $('#year').value = String(YEARS.indexOf(state.year));
    $('#yearOut').textContent = state.year;
    $('#play').textContent = state.playing ? 'Pause' : 'Play';
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (IND[p.get('m')]) state.ind = p.get('m');
    if (YEARS.includes(p.get('y'))) state.year = p.get('y');
    if (p.get('p') === 'real' || p.get('p') === 'cash') state.basis = p.get('p');
    if (p.get('s') === 'year' || p.get('s') === 'all') state.scale = p.get('s');
    state.council = BY_NAME[p.get('c')] ? p.get('c') : null;
  }
  function writeHash() {
    const p = new URLSearchParams({ m: state.ind, y: state.year, p: state.basis, s: state.scale });
    if (state.council) p.set('c', state.council);
    try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* not available from file:// in some browsers */ }
  }

  let firstRun = true;
  function update() {
    writeHash();
    const ctx = compute();
    renderControls();
    renderMap(ctx);
    renderLegend(ctx);
    renderFocus(ctx);
    renderRanking(ctx);
    renderProfile();
    renderTable(ctx);
    if (!firstRun && !state.playing) {
      const c = state.council;
      const v = c ? val(state.ind, c, state.year) : ctx.scotV;
      $('#live').textContent = `${ctx.ind.title}, ${state.year}. ${c || 'Scotland'}: ${money(v)}.`;
    }
    firstRun = false;
  }

  function toggleSelect(name) {
    state.council = state.council === name ? null : name;
    update();
  }

  let timer = null;
  function stopPlay() {
    if (timer) clearInterval(timer);
    timer = null;
    if (state.playing) { state.playing = false; renderControls(); }
  }
  function startPlay() {
    if (timer) return;
    if (state.year === YEARS[YEARS.length - 1]) state.year = YEARS[0];
    state.playing = true;
    update();
    timer = setInterval(() => {
      const i = YEARS.indexOf(state.year);
      if (i >= YEARS.length - 1) { stopPlay(); return; }
      state.year = YEARS[i + 1];
      update();
      if (i + 1 >= YEARS.length - 1) stopPlay();
    }, 1000);
  }

  function effectiveTheme() {
    return document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function renderTheme() {
    const dark = effectiveTheme() === 'dark';
    $('#themeBtn').textContent = dark ? 'Light mode' : 'Dark mode';
    $('#themeBtn').setAttribute('aria-pressed', String(dark));
  }

  /* ------------------------------------------------------------------ start */
  buildSelect();
  buildMap();
  buildRows();
  readHash();

  window.addEventListener('hashchange', () => { stopPlay(); readHash(); update(); });
  $('#controls').addEventListener('submit', (e) => e.preventDefault());
  $('#measure').addEventListener('change', (e) => { state.ind = e.target.value; update(); });
  document.querySelectorAll('[data-basis]').forEach((b) => b.addEventListener('click', () => { state.basis = b.dataset.basis; update(); }));
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => { state.scale = b.dataset.scale; update(); }));
  $('#year').addEventListener('input', (e) => { stopPlay(); state.year = YEARS[+e.target.value]; update(); });
  $('#play').addEventListener('click', () => (state.playing ? stopPlay() : startPlay()));
  $('#clearSel').addEventListener('click', () => { state.council = null; update(); });
  $('#themeBtn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
    renderTheme();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setHover(null); hideTip(); if (state.council) { state.council = null; update(); } }
  });
  if (window.ResizeObserver) {
    let raf = 0, lastW = 0;
    new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => renderTrend(compute()));
    }).observe($('#trend'));
  }
  renderTheme();
  update();
})();
