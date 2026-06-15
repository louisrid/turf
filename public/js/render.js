/* Pitch rendering + animation. Global: Pitch. White pitch, grey grid. */
(function () {
  const COLS = 5, ROWS = 8, GOAL = [1, 2, 3];
  let cv, ctx, you = 0, cell = 60, padTop = 0;
  let snap = null;
  const disp = new Map();          // id -> {col,row} float (rendered space)
  let ball = { x: 2, y: 4 };       // rendered float
  let ballTarget = { x: 2, y: 4 };
  let anims = [];                  // {id, from, to, t0, dur}
  let ballAnim = null;
  let floats = [];                 // {text, col, row, t0, dur, color}
  let overlay = null;              // selection/order overlay state (set by app)
  let raf = null;

  const aToR = (col, row) => you === 1
    ? { col: COLS - 1 - col, row: ROWS - 1 - row } : { col, row };

  function init(canvas, yourTeam) {
    cv = canvas; ctx = cv.getContext('2d'); you = yourTeam;
    resize();
    window.addEventListener('resize', resize);
    if (!raf) loop();
  }

  function resize() {
    if (!cv) return;
    const wrap = cv.parentElement;
    const cssW = Math.min(wrap.clientWidth, 460);
    cell = Math.floor(cssW / COLS);
    const cssH = cell * ROWS;
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = (cell * COLS) + 'px';
    cv.style.height = cssH + 'px';
    cv.width = cell * COLS * dpr;
    cv.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function setSnapshot(s, animate) {
    const prev = snap;
    snap = s;
    for (const p of s.players) {
      const r = aToR(p.col, p.row);
      if (!disp.has(p.id) || !animate) {
        disp.set(p.id, { col: r.col, row: r.row });
      } else {
        const cur = disp.get(p.id);
        if (cur.col !== r.col || cur.row !== r.row) {
          anims.push({ id: p.id, from: { ...cur }, to: { col: r.col, row: r.row }, t0: performance.now(), dur: 360 });
        }
      }
    }
    // ball
    let bx, by;
    if (s.ball.carrier) {
      const c = s.players.find(p => p.id === s.ball.carrier);
      const r = aToR(c.col, c.row); bx = r.col; by = r.row + 0.32;
    } else if (s.ball.loose) {
      const r = aToR(s.ball.loose.col, s.ball.loose.row); bx = r.col; by = r.row;
    } else { bx = ball.x; by = ball.y; }
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
    const rc = Math.floor(x / cell), rr = Math.floor(y / cell);
    if (rc < 0 || rc >= COLS || rr < 0 || rr >= ROWS) return null;
    return aToR(rc, rr); // back to absolute
  }

  function centerOf(acol, arow) {
    const r = aToR(acol, arow);
    return { x: r.col * cell + cell / 2, y: r.row * cell + cell / 2 };
  }

  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    // advance anims
    anims = anims.filter(a => {
      const k = Math.min(1, (now - a.t0) / a.dur);
      const e = ease(k);
      disp.set(a.id, { col: a.from.col + (a.to.col - a.from.col) * e, row: a.from.row + (a.to.row - a.from.row) * e });
      return k < 1;
    });
    if (ballAnim) {
      const k = Math.min(1, (now - ballAnim.t0) / ballAnim.dur), e = ease(k);
      ball = { x: ballAnim.from.x + (ballAnim.to.x - ballAnim.from.x) * e, y: ballAnim.from.y + (ballAnim.to.y - ballAnim.from.y) * e };
      if (k >= 1) ballAnim = null;
    } else { ball = { ...ballTarget }; }
    draw(now);
  }

  function draw(now) {
    if (!ctx) return;
    const W = cell * COLS, H = cell * ROWS;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    // halfway line + center circle
    ctx.strokeStyle = '#d7d7da'; ctx.lineWidth = 1;
    // grid
    for (let c = 0; c <= COLS; c++) { line(c * cell, 0, c * cell, H); }
    for (let r = 0; r <= ROWS; r++) { line(0, r * cell, W, r * cell); }
    // center line
    ctx.strokeStyle = '#c7c7cc'; ctx.lineWidth = 2; line(0, H / 2, W, H / 2);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, cell * 0.7, 0, Math.PI * 2); ctx.stroke();

    // goals (rendered: bottom = your goal)
    drawGoal(GOAL, 0);          // top edge
    drawGoal(GOAL, ROWS);       // bottom edge

    // order overlay (reachable squares + targets) under sprites
    if (overlay) drawOverlay();

    // players sorted by render row for depth
    const ps = snap ? snap.players.slice() : [];
    ps.sort((a, b) => (disp.get(a.id)?.row || 0) - (disp.get(b.id)?.row || 0));
    for (const p of ps) drawPlayer(p);

    // ball
    drawBall(ball.x, ball.y);

    // floats
    floats = floats.filter(f => {
      const k = (now - f.t0) / f.dur; if (k >= 1) return false;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.font = `bold ${Math.round(cell * 0.34)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.col * cell + cell / 2, f.row * cell + cell / 2 - k * cell * 0.8);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      return true;
    });
  }

  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function drawGoal(cols, edgeRow) {
    const x0 = cols[0] * cell, w = cols.length * cell;
    const y = edgeRow === 0 ? 0 : ROWS * cell - cell * 0.16;
    ctx.fillStyle = '#ececef';
    ctx.fillRect(x0, edgeRow === 0 ? 0 : y, w, cell * 0.16);
    ctx.strokeStyle = '#9a9aa0'; ctx.lineWidth = 3;
    const yy = edgeRow === 0 ? 2 : ROWS * cell - 2;
    line(x0, yy, x0 + w, yy);
  }

  function drawOverlay() {
    const o = overlay;
    if (o.reach) for (const sq of o.reach) {
      const r = aToR(sq.col, sq.row);
      const x = r.col * cell, y = r.row * cell;
      ctx.fillStyle = o.kind === 'tackle' ? 'rgba(209,31,45,0.16)' : 'rgba(31,79,209,0.16)';
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      ctx.strokeStyle = o.kind === 'tackle' ? 'rgba(209,31,45,0.55)' : 'rgba(31,79,209,0.55)';
      ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6); ctx.setLineDash([]);
    }
    if (o.orders) for (const ord of o.orders) {
      const f = centerOf(ord.from.col, ord.from.row);
      const tg = centerOf(ord.to.col, ord.to.row);
      ctx.strokeStyle = ord.color; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tg.x, tg.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ord.color;
      ctx.beginPath(); ctx.arc(tg.x, tg.y, cell * 0.12, 0, Math.PI * 2); ctx.fill();
    }
    if (o.sel) {
      const c = centerOf(o.sel.col, o.sel.row);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      ctx.strokeRect(c.x - cell / 2 + 2, c.y - cell / 2 + 2, cell - 4, cell - 4);
    }
  }

  function drawPlayer(p) {
    const d = disp.get(p.id) || aToR(p.col, p.row);
    const x = d.col * cell, y = d.row * cell;
    const S = window.Sprites;
    const U = cell / 16;
    const figW = S.GRID_W * U, figH = S.GRID_H * U;
    const ox = x + (cell - figW) / 2;
    const oy = y + (cell - figH) / 2 - cell * 0.04;
    // possession ring
    if (p.hasBall) {
      ctx.fillStyle = 'rgba(255,206,0,0.30)';
      ctx.beginPath(); ctx.ellipse(x + cell / 2, y + cell * 0.82, cell * 0.34, cell * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (p.adv) {
      ctx.strokeStyle = '#19a64a'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
    }
    const team = p.team === 0 ? 'blue' : 'red';
    S.drawGrid(ctx, ox, oy, U, { team, skin: p.look.skin, hair: p.look.hair, hairColor: p.look.hairColor, role: p.pos === 'GK' ? 'gk' : 'out' });
    // name tag (tiny)
    ctx.fillStyle = '#555'; ctx.font = `${Math.round(cell * 0.16)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(p.name.split(' ').slice(-1)[0], x + cell / 2, y + cell - 3);
    ctx.textAlign = 'left';
  }

  function drawBall(bx, by) {
    const x = bx * cell + cell / 2, y = by * cell + cell / 2;
    const rr = cell * 0.12;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, rr * 0.42, 0, Math.PI * 2); ctx.fill();
  }

  window.Pitch = { init, setSnapshot, cellAt, centerOf, setOverlay, addFloat,
                   get you() { return you; }, COLS, ROWS, GOAL };
})();
