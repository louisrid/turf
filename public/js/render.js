/* Pitch rendering + animation. Global: Pitch. White pitch, grey grid.
   Goals sit OUTSIDE the grid: one render row above the grid and one below,
   each spanning the middle two columns. */
(function () {
  let COLS = 4, ROWS = 6, GOAL = [1, 2];
  const PAD = 1;                       // render rows reserved for goals (top + bottom)
  let cv, ctx, you = 0, cell = 70;
  let snap = null;
  const disp = new Map();
  let ball = { x: 1.5, y: 3 }, ballTarget = { x: 1.5, y: 3 };
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
    const cssW = Math.min(wrap.clientWidth, 420);
    cell = Math.floor(cssW / COLS);
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
    if (animate) ballAnim = { from: { ...ball }, to: { ...ballTarget }, t0: performance.now(), dur: 380 };
    else ball = { ...ballTarget };
  }

  function addFloat(text, acol, arow, color) {
    const r = aToR(acol, arow);
    floats.push({ text, col: r.col, row: r.row, t0: performance.now(), dur: 1100, color: color || '#111' });
  }
  function setOverlay(o) { overlay = o; }

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
      const k = Math.min(1, (now - ballAnim.t0) / ballAnim.dur), e = ease(k);
      ball = { x: ballAnim.from.x + (ballAnim.to.x - ballAnim.from.x) * e, y: ballAnim.from.y + (ballAnim.to.y - ballAnim.from.y) * e };
      if (k >= 1) ballAnim = null;
    } else ball = { ...ballTarget };
    draw(now);
  }

  function draw(now) {
    if (!ctx) return;
    const W = cell * COLS, gridY = PAD * cell, gridH = cell * ROWS, H = cell * (ROWS + PAD * 2);
    ctx.clearRect(0, 0, W, H);
    // surrounds
    ctx.fillStyle = '#eef0f2'; ctx.fillRect(0, 0, W, H);
    // pitch
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, gridY, W, gridH);
    // grid
    ctx.strokeStyle = '#d7d7da'; ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) line(c * cell, gridY, c * cell, gridY + gridH);
    for (let r = 0; r <= ROWS; r++) line(0, gridY + r * cell, W, gridY + r * cell);
    // halfway
    ctx.strokeStyle = '#c7c7cc'; ctx.lineWidth = 2; line(0, gridY + gridH / 2, W, gridY + gridH / 2);
    ctx.beginPath(); ctx.arc(W / 2, gridY + gridH / 2, cell * 0.55, 0, Math.PI * 2); ctx.stroke();

    drawGoals(gridY, gridH);
    drawRedLines();
    if (overlay) drawOverlay();

    const ps = snap ? snap.players.slice() : [];
    ps.sort((a, b) => (disp.get(a.id)?.row || 0) - (disp.get(b.id)?.row || 0));
    for (const p of ps) drawPlayer(p);
    drawBall(ball.x, ball.y);

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
      { y: px(0, snap.redRows[0]).y, color: 'rgba(31,79,209,0.85)' },     // team0 keeper zone (blue)
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
      ctx.fillStyle = '#dfe2e6'; ctx.fillRect(x0, y, w, cell);
      ctx.strokeStyle = '#9a9aa0'; ctx.lineWidth = 3; ctx.strokeRect(x0 + 1.5, top ? 1.5 : y + 1.5, w - 3, cell - 3);
      // net hatch
      ctx.strokeStyle = '#c2c5ca'; ctx.lineWidth = 1;
      for (let gx = x0 + 8; gx < x0 + w; gx += 8) line(gx, y + 3, gx, y + cell - 3);
      for (let gy = y + 8; gy < y + cell; gy += 8) line(x0 + 3, gy, x0 + w - 3, gy);
    }
  }

  function drawOverlay() {
    const o = overlay;
    if (o.reach) for (const sq of o.reach) {
      const p = px(sq.col, sq.row);
      const fill = o.kind === 'pass' ? 'rgba(25,166,74,0.18)' : 'rgba(31,79,209,0.16)';
      const stroke = o.kind === 'pass' ? 'rgba(25,166,74,0.6)' : 'rgba(31,79,209,0.55)';
      ctx.fillStyle = fill; ctx.fillRect(p.x + 2, p.y + 2, cell - 4, cell - 4);
      ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.strokeRect(p.x + 3, p.y + 3, cell - 6, cell - 6); ctx.setLineDash([]);
    }
    if (o.orders) for (const ord of o.orders) {
      if (!ord.to || !ord.from) continue;
      const f = center(ord.from.col, ord.from.row), tg = center(ord.to.col, ord.to.row);
      ctx.strokeStyle = ord.color; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tg.x, tg.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ord.color; ctx.beginPath(); ctx.arc(tg.x, tg.y, cell * 0.12, 0, Math.PI * 2); ctx.fill();
    }
    if (o.sel) {
      const c = center(o.sel.col, o.sel.row);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      ctx.strokeRect(c.x - cell / 2 + 2, c.y - cell / 2 + 2, cell - 4, cell - 4);
    }
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
    ctx.fillStyle = '#555'; ctx.font = `${Math.round(cell * 0.15)}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(p.name.split(' ').slice(-1)[0], x + cell / 2, y + cell - 3); ctx.textAlign = 'left';
  }

  function drawBall(bx, by) {
    const x = bx * cell + cell / 2, y = (by + PAD) * cell + cell / 2, rr = cell * 0.12;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, rr * 0.42, 0, Math.PI * 2); ctx.fill();
  }

  function screenOf(col, row) { const c = center(col, row); return { x: (cv.offsetLeft || 0) + c.x, y: (cv.offsetTop || 0) + c.y }; }

  window.Pitch = { init, setSnapshot, cellAt, centerOf: center, screenOf, get cell() { return cell; }, setOverlay, addFloat, get you() { return you; } };
})();
