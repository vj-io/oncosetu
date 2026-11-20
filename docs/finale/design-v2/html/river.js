// Record river + shared type glyphs. Counts papers only, never clinical values.
(function () {
  const COL = { report: '#0F6E78', scan: '#34495A', lab: '#2459A6', rx: '#6A4C9C', letter: '#5D6B78' };
  const NAME = { report: 'Report', scan: 'Scan', lab: 'Lab', rx: 'Prescription', letter: 'Letter' };
  const MISS = '#B45309';

  // shape per type: report circle, scan square, lab diamond, prescription triangle, letter hexagon
  function shape(type, cx, cy, r, fill, stroke, sw) {
    const a = 'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linejoin="round"';
    if (type === 'report') return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' + a + '/>';
    if (type === 'scan') return '<rect x="' + (cx - r * .92) + '" y="' + (cy - r * .92) + '" width="' + r * 1.84 + '" height="' + r * 1.84 + '" rx="2" ' + a + '/>';
    if (type === 'lab') { const d = r * 1.25; return '<path d="M' + cx + ' ' + (cy - d) + 'L' + (cx + d) + ' ' + cy + 'L' + cx + ' ' + (cy + d) + 'L' + (cx - d) + ' ' + cy + 'Z" ' + a + '/>'; }
    if (type === 'rx') { const d = r * 1.2; return '<path d="M' + cx + ' ' + (cy - d) + 'L' + (cx + d) + ' ' + (cy + d * .8) + 'L' + (cx - d) + ' ' + (cy + d * .8) + 'Z" ' + a + '/>'; }
    const d = r * 1.1, p = []; for (let i = 0; i < 6; i++) { const t = Math.PI / 3 * i; p.push((cx + d * Math.cos(t)).toFixed(1) + ' ' + (cy + d * Math.sin(t)).toFixed(1)); }
    return '<path d="M' + p.join('L') + 'Z" ' + a + '/>';
  }
  function glyph(type, hollow, size) {
    size = size || 16; const c = size / 2, r = size * 0.34;
    const inner = hollow ? shape(type, c, c, r, '#fff', MISS, 2.2) : shape(type, c, c, r, COL[type], '#fff', 1);
    return '<svg class="tg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + inner + '</svg>';
  }
  window.OncoGlyph = glyph; window.OncoTypeName = NAME; window.OncoTypeColor = COL;

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = (d) => String(d.getDate()).padStart(2, '0') + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();

  window.buildRiver = function (host, cfg) {
    const items = cfg.items.map((i) => Object.assign({}, i, { d: new Date(i.date) }));
    const start = new Date(cfg.start), end = new Date(cfg.end);
    const W = host.clientWidth, H = cfg.h || 120, padL = 8, padR = 14, base = cfg.base || 70;
    const x = (d) => padL + (d - start) / (end - start) * (W - padL - padR);
    const y = (px) => base + 5 * Math.sin(px / 78);
    let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    // river body
    let path = ''; for (let px = 0; px <= W; px += 6) path += (px ? 'L' : 'M') + px + ' ' + y(px).toFixed(1);
    s += '<path d="' + path + '" fill="none" stroke="#CFE5E8" stroke-width="20" stroke-linecap="round"/>';
    s += '<path d="' + path.replace(/ (\d+\.?\d*)/g, (m, v) => ' ' + (parseFloat(v) - 4).toFixed(1)) + '" fill="none" stroke="#BCD9DD" stroke-width="1.2" stroke-dasharray="2 7" stroke-linecap="round"/>';
    // month ticks and quarter labels
    const m0 = new Date(start.getFullYear(), start.getMonth(), 1);
    for (let d = new Date(m0), k = 0; d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), k++) {
      const px = x(d); if (px < padL - 1) continue;
      const q = d.getMonth() % 3 === 0;
      s += '<line x1="' + px + '" x2="' + px + '" y1="' + (H - 24) + '" y2="' + (H - (q ? 16 : 19)) + '" stroke="#8FA9B0" stroke-width="1"/>';
      if (q) s += '<text x="' + (px + 3) + '" y="' + (H - 4) + '" font-size="12.5" fill="' + (d.getMonth() === 0 ? '#17212B' : '#4F5E6B') + '" font-weight="' + (d.getMonth() === 0 ? 600 : 400) + '" font-family="Mukta,sans-serif">' + MON[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : '') + '</text>';
    }
    // marks (e.g. last sealed visit)
    (cfg.marks || []).forEach((m) => {
      const px = x(new Date(m.date));
      s += '<line x1="' + px + '" x2="' + px + '" y1="6" y2="' + (H - 24) + '" stroke="#0F6E78" stroke-width="1.5" stroke-dasharray="3 4"/>' +
           '<text x="' + (px + 6) + '" y="16" font-size="12.5" fill="#0B5A63" font-weight="600" font-family="Mukta,sans-serif">' + m.label + '</text>';
    });
    // place dots, avoiding overlap
    const placed = [];
    const sorted = items.slice().sort((a, b) => a.d - b.d);
    sorted.forEach((it) => {
      const px = x(it.d), lift = it.missing ? -38 : 0;
      const offs = [0, -17, 17, -34, 34, -51];
      for (const o of offs) {
        const py = y(px) + lift + o;
        if (py < 22 || py > H - 30) continue;
        if (placed.every((p) => Math.hypot(p.x - px, p.y - py) > 17)) { it.x = px; it.y = py; placed.push({ x: px, y: py }); break; }
      }
      if (it.x === undefined) { it.x = px; it.y = y(px) + lift; placed.push({ x: px, y: it.y }); }
    });
    sorted.forEach((it, idx) => {
      const label = it.missing
        ? 'Missing: ' + it.title + ', mentioned ' + fmt(it.d) + '. Ask at ' + it.where + '.'
        : NAME[it.type] + ': ' + it.title + ', ' + fmt(it.d) + ', ' + it.where + '.';
      if (it.missing) s += '<line x1="' + it.x + '" x2="' + it.x + '" y1="' + (it.y + 9) + '" y2="' + y(it.x) + '" stroke="' + MISS + '" stroke-width="1.5" stroke-dasharray="2 3"/>';
      s += '<g class="dot" tabindex="0" role="link" data-i="' + idx + '" aria-label="' + label.replace(/"/g, '') + '">' +
           '<circle cx="' + it.x + '" cy="' + it.y + '" r="14" fill="transparent"/>' +
           (it.missing ? shape(it.type, it.x, it.y, 6.4, '#fff', MISS, 2.4) : shape(it.type, it.x, it.y, 6.4, COL[it.type], '#fff', 1.6)) +
           '<circle class="ring-f" cx="' + it.x + '" cy="' + it.y + '" r="12"/></g>';
    });
    s += '</svg>';
    host.innerHTML = s + '<div class="tipbox" role="status"></div>';
    const tip = host.querySelector('.tipbox');
    const show = (el) => {
      const it = sorted[+el.dataset.i];
      tip.innerHTML = it.missing
        ? '<b>' + it.title + '</b><span style="color:#B45309;font-weight:600">Missing, not in file</span><br>Mentioned ' + fmt(it.d) + (it.src ? ' (' + it.src + ')' : '') + '<br>Ask at ' + it.where
        : '<b>' + it.title + '</b>' + NAME[it.type] + ', ' + fmt(it.d) + '<br>' + it.where + '<br><span style="color:#0F6E78">Select to open the record</span>';
      tip.classList.add('on');
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let left = it.x > W * 0.6 ? it.x - w + 18 : it.x - 18; left = Math.min(Math.max(left, 0), W - w);
      let top = it.y + 22;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    };
    host.querySelectorAll('.dot').forEach((el) => {
      el.addEventListener('mouseenter', () => show(el)); el.addEventListener('focus', () => show(el));
      el.addEventListener('mouseleave', () => tip.classList.remove('on')); el.addEventListener('blur', () => tip.classList.remove('on'));
      el.addEventListener('click', () => { location.hash = 'record-' + el.dataset.i; });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.click(); });
    });
    host._show = (i) => { const el = host.querySelector('.dot[data-i="' + i + '"]'); if (el) show(el); };
    host._sorted = sorted;
  };
})();
