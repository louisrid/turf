/* Pitch rendering + animation. Global: Pitch. White pitch, grey grid.
   Goals sit OUTSIDE the grid: one render row above the grid and one below,
   each spanning the middle two columns. */
(function () {
  let COLS = 4, ROWS = 6, GOAL = [1, 2];
  const PAD = 1;                       // render rows reserved for goals (top + bottom)
  let cv, ctx, you = 0, cell = 70;
  let snap = null;
  const disp = new Map();
  let ball = { x: 1.5, y: 3, lift: 0 }, ballTarget = { x: 1.5, y: 3 };
  let anims = [], ballAnim = null, floats = [], overlay = null, raf = null;

  const aToR = (col, row) => you === 1 ? { col: COLS - 1 - col, row: ROWS - 1 - row } : { col, row };

  function init(canvas, yourTeam) {
    cv = canvas; ctx = cv.getContext('2d'); you = yourTeam;
    resize();
    if (!init._bound) { window.addEventListener('resize', resize); init._bound = true; }
    if (!raf) loop();
  }

  function resize() {
    if (!cv) return;
    const wrap = cv.parentElement;
    const availW = Math.min(wrap.clientWidth, 460);
    const availH = wrap.clientHeight || (availW / COLS) * (ROWS + PAD * 2);
    cell = Math.max(26, Math.floor(Math.min(availW / COLS, availH / (ROWS + PAD * 2))));
    const cssH = cell * (ROWS + PAD * 2);
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = (cell * COLS) + 'px';
    cv.style.height = cssH + 'px';
    cv.width = cell * COLS * dpr;
    cv.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  // logical cell -> render pixel top-left (with goal padding offset)
  function px(col, row) { const r = aToR(col, row); return { x: r.col * cell, y: (r.row + PAD) * cell }; }
  function center(col, row) { const p = px(col, row); return { x: p.x + cell / 2, y: p.y + cell / 2 }; }

  function setSnapshot(s, animate) {
    if (s.cols && (s.cols !== COLS || s.rows !== ROWS)) {
      COLS = s.cols; ROWS = s.rows; GOAL = s.goalCols || GOAL; resize();
    }
    snap = s;
    for (const p of s.players) {
      const r = aToR(p.col, p.row);
      if (!disp.has(p.id) || !animate) disp.set(p.id, { col: r.col, row: r.row });
      else {
        const cur = disp.get(p.id);
        if (cur.col !== r.col || cur.row !== r.row)
          anims.push({ id: p.id, from: { ...cur }, to: { col: r.col, row: r.row }, t0: performance.now(), dur: 360 });
      }
    }
    let bx, by;
    if (s.ball.carrier) { const c = s.players.find(p => p.id === s.ball.carrier); const r = aToR(c.col, c.row); bx = r.col; by = r.row + 0.32; }
    else if (s.ball.loose) { const r = aToR(s.ball.loose.col, s.ball.loose.row); bx = r.col; by = r.row; }
    else { bx = ball.x; by = ball.y; }
    ballTarget = { x: bx, y: by };
    if (animate) ballAnim = { segs: [{ x0: ball.x, y0: ball.y, x1: bx, y1: by, loft: 0, dur: 380 }], i: 0, t0: performance.now() };
    else { ball = { x: bx, y: by, lift: 0 }; ballAnim = null; }
  }

  function addFloat(text, acol, arow, color) {
    const r = aToR(acol, arow);
    floats.push({ text, col: r.col, row: r.row, t0: performance.now(), dur: 1100, color: color || '#111' });
    if (/GOAL/.test(text)) goalFlash = { top: r.row === 0, t0: performance.now(), color: color || '#27d07a' };
  }
  function setOverlay(o) { overlay = o; }
  let goalFlash = null;
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function cellAt(clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const rc = Math.floor(x / cell), rr = Math.floor(y / cell) - PAD;   // subtract top goal row
    if (rc < 0 || rc >= COLS || rr < 0 || rr >= ROWS) return null;       // ignore goal/outside taps
    return aToR(rc, rr);
  }

  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    anims = anims.filter(a => {
      const k = Math.min(1, (now - a.t0) / a.dur), e = ease(k);
      disp.set(a.id, { col: a.from.col + (a.to.col - a.from.col) * e, row: a.from.row + (a.to.row - a.from.row) * e });
      return k < 1;
    });
    if (ballAnim) {
      const seg = ballAnim.segs[ballAnim.i];
      const k = Math.min(1, (now - ballAnim.t0) / seg.dur), e = ease(k);
      ball.x = seg.x0 + (seg.x1 - seg.x0) * e;
      ball.y = seg.y0 + (seg.y1 - seg.y0) * e;
      ball.lift = (seg.loft || 0) * Math.sin(Math.PI * k) * cell;
      if (k >= 1) { ballAnim.i++; ballAnim.t0 = now; if (ballAnim.i >= ballAnim.segs.length) { ballAnim = null; ball = { x: ballTarget.x, y: ballTarget.y, lift: 0 }; } }
    } else { ball = { x: ballTarget.x, y: ballTarget.y, lift: 0 }; }
    try { draw(now); } catch (e) { /* never let one frame kill the loop */ }
  }

  function draw(now) {
    if (!ctx) return;
    const W = cell * COLS, gridY = PAD * cell, gridH = cell * ROWS, H = cell * (ROWS + PAD * 2);
    ctx.clearRect(0, 0, W, H);
    // surrounds behind the goals (light)
    ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, W, H);
    // pitch (barely-there green)
    ctx.fillStyle = '#f3faf5'; ctx.fillRect(0, gridY, W, gridH);
    // grid (bold, clearly visible)
    ctx.strokeStyle = '#a9afb8'; ctx.lineWidth = 1.5;
    for (let c = 0; c <= COLS; c++) line(c * cell, gridY, c * cell, gridY + gridH);
    for (let r = 0; r <= ROWS; r++) line(0, gridY + r * cell, W, gridY + r * cell);
    // halfway + centre
    ctx.strokeStyle = '#a9afb8'; ctx.lineWidth = 1.5; line(0, gridY + gridH / 2, W, gridY + gridH / 2);
    ctx.beginPath(); ctx.arc(W / 2, gridY + gridH / 2, cell * 0.55, 0, Math.PI * 2); ctx.stroke();

    drawGoals(gridY, gridH);
    if (goalFlash) {
      const k = (now - goalFlash.t0) / 900;
      if (k >= 1) goalFlash = null;
      else { const x0 = GOAL[0] * cell, w = GOAL.length * cell, y = goalFlash.top ? 0 : gridY + gridH; ctx.save(); ctx.globalAlpha = (1 - k) * 0.40; ctx.fillStyle = goalFlash.color; ctx.fillRect(x0, y, w, cell); ctx.restore(); }
    }
    drawRedLines();
    if (overlay) drawOverlay();

    const ps = snap ? snap.players.slice() : [];
    ps.sort((a, b) => (disp.get(a.id)?.row || 0) - (disp.get(b.id)?.row || 0));
    for (const p of ps) drawPlayer(p);
    drawBall(snap && snap.ball && !snap.ball.carrier && !!snap.ball.loose);

    floats = floats.filter(f => {
      const k = (now - f.t0) / f.dur; if (k >= 1) return false;
      ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color;
      ctx.font = `bold ${Math.round(cell * 0.3)}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(f.text, f.col * cell + cell / 2, (f.row + PAD) * cell + cell / 2 - k * cell * 0.8);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      return true;
    });
  }

  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function drawRedLines() {
    if (!snap || !snap.redRows) return;
    const W = cell * COLS;
    const lines = [
      { y: px(0, snap.redRows[0]).y, color: 'rgba(47,107,255,0.9)' },     // home keeper zone (blue)
      { y: px(0, snap.redRows[1] + 1).y, color: 'rgba(209,31,45,0.85)' }, // team1 keeper zone (red)
    ];
    ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]);
    for (const ln of lines) { ctx.strokeStyle = ln.color; line(0, ln.y, W, ln.y); }
    ctx.setLineDash([]);
  }

  function drawGoals(gridY, gridH) {
    const x0 = GOAL[0] * cell, w = GOAL.length * cell;
    // top goal box (render rows above the grid), bottom goal box (below)
    for (const top of [true, false]) {
      const y = top ? 0 : gridY + gridH;
      ctx.fillStyle = '#dfe3e9'; ctx.fillRect(x0, y, w, cell);
      ctx.strokeStyle = '#7f8690'; ctx.lineWidth = 3; ctx.strokeRect(x0 + 1.5, top ? 1.5 : y + 1.5, w - 3, cell - 3);
      // net hatch
      ctx.strokeStyle = 'rgba(120,128,140,0.5)'; ctx.lineWidth = 1;
      for (let gx = x0 + 8; gx < x0 + w; gx += 8) line(gx, y + 3, gx, y + cell - 3);
      for (let gy = y + 8; gy < y + cell; gy += 8) line(x0 + 3, gy, x0 + w - 3, gy);
    }
  }

  function drawOverlay() {
    const o = overlay;
    if (o.reach) for (const sq of o.reach) {
      const p = px(sq.col, sq.row);
      const rgb = o.kind === 'pass' ? '24,28,34' : o.kind === 'longpass' ? '184,134,11' : '47,107,255';
      ctx.fillStyle = `rgba(${rgb},0.20)`; ctx.fillRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
    }
    if (o.orders) for (const ord of o.orders) {
      if (!ord.to || !ord.from) continue;
      const f = center(ord.from.col, ord.from.row), tg = center(ord.to.col, ord.to.row);
      ctx.strokeStyle = ord.color; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tg.x, tg.y); ctx.stroke(); ctx.setLineDash([]);
      const ang = Math.atan2(tg.y - f.y, tg.x - f.x), ah = cell * 0.17;
      ctx.fillStyle = ord.color; ctx.beginPath();
      ctx.moveTo(tg.x, tg.y);
      ctx.lineTo(tg.x - ah * Math.cos(ang - 0.4), tg.y - ah * Math.sin(ang - 0.4));
      ctx.lineTo(tg.x - ah * Math.cos(ang + 0.4), tg.y - ah * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }
    // (selected player is shown by its highlighted reach squares; no ring)
  }
  function drawPlayer(p) {
    const d = disp.get(p.id) || aToR(p.col, p.row);
    const x = d.col * cell, y = (d.row + PAD) * cell;
    const S = window.Sprites, U = cell / 16;
    const figW = S.GRID_W * U, figH = S.GRID_H * U;
    const ox = x + (cell - figW) / 2, oy = y + (cell - figH) / 2 - cell * 0.04;
    if (p.hasBall) { ctx.fillStyle = 'rgba(255,206,0,0.30)'; ctx.beginPath(); ctx.ellipse(x + cell / 2, y + cell * 0.82, cell * 0.34, cell * 0.16, 0, 0, Math.PI * 2); ctx.fill(); }
    if (p.adv) { ctx.strokeStyle = '#19a64a'; ctx.lineWidth = 2; ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6); }
    const team = p.team === 0 ? 'blue' : 'red';
    S.drawGrid(ctx, ox, oy, U, { team, skin: p.look.skin, hair: p.look.hair, hairColor: p.look.hairColor, role: p.pos === 'GK' ? 'gk' : 'out' });
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 2; ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(cell * 0.15)}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(p.name.split(' ').slice(-1)[0], x + cell / 2, y + cell - 3); ctx.restore(); ctx.textAlign = 'left';
  }

  function drawBall(loose) {
    const bx = ball.x, by = ball.y, lift = ball.lift || 0;
    const cx = bx * cell + cell / 2, gy = (by + PAD) * cell + cell / 2, cy = gy - lift, rr = cell * 0.12;
    if (loose && !ballAnim) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 240);
      ctx.strokeStyle = `rgba(184,134,11,${0.30 + 0.45 * pulse})`;
      ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(cx, gy, cell * (0.30 + 0.06 * pulse), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (lift > 0.5) { ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(cx, gy, rr, rr * 0.4, 0, 0, Math.PI * 2); ctx.fill(); }
    const r2 = rr * (1 + Math.min(0.5, lift / (cell * 1.2)) * 0.4);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx, cy, r2 * 0.42, 0, Math.PI * 2); ctx.fill();
  }

  // ball flight through optional mid waypoints, settling at ballTarget; lofts/durs are per segment
  function flyBall(waypointsAbs, opts) {
    opts = opts || {};
    const lofts = opts.lofts || [], durs = opts.durs || [];
    const mapped = (waypointsAbs || []).map(c => { const r = aToR(c.col, c.row); return { x: r.col, y: r.row }; });
    const pts = [{ x: ball.x, y: ball.y }, ...mapped, { x: ballTarget.x, y: ballTarget.y }];
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push({ x0: pts[i].x, y0: pts[i].y, x1: pts[i + 1].x, y1: pts[i + 1].y, loft: lofts[i] || 0, dur: durs[i] || 320 });
    if (segs.length) ballAnim = { segs, i: 0, t0: performance.now() };
  }

  function screenOf(col, row) { const c = center(col, row); return { x: (cv.offsetLeft || 0) + c.x, y: (cv.offsetTop || 0) + c.y }; }

  window.Pitch = { init, setSnapshot, cellAt, centerOf: center, screenOf, get cell() { return cell; }, setOverlay, addFloat, flyBall, get you() { return you; } };
})();
