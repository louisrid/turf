/* TURF client controller. Plain globals, no build step. */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  const isCarrier = (p) => St.snap && St.snap.ball.carrier === p.id;
  const moveAllow = (p) => (p.pos === 'GK' ? 1 : (p.recover > 0 ? 1 : (isCarrier(p) ? 2 : 3))); // carry 2, off-ball 3
  const shortReach = () => (St.snap && St.snap.passShort) || 3;
  const longReach = () => (St.snap && St.snap.passLong) || 6;
  const shootRow = (team) => (team === 0 ? 0 : (St.snap.rows - 1));
  const canShoot = (p) => p.pos !== 'GK' && (p.team === 0 ? p.row <= 1 : p.row >= St.snap.rows - 2); // last two rows
  const oppKeeperOut = () => !!(St.snap && St.snap.keeperOut && St.snap.keeperOut[1 - St.you]);
  const theCarrier = () => St.snap && St.snap.ball.carrier ? St.snap.players.find(p => p.id === St.snap.ball.carrier) : null;

  const St = {
    ws: null, token: null, profile: null, you: 0, snap: null,
    orders: {}, sel: null, action: null, submitted: false,
    deadline: 0, timer: null, phase: null, inited: false, roomCode: null,
  };

  // ---- screens / overlays ---------------------------------------------------
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }
  const ov = (id, on) => $(id).classList.toggle('show', on);

  // ---- sprite helpers -------------------------------------------------------
  function paintFigure(canvas, p, opt) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    const S = window.Sprites, U = canvas.width / 18;
    const ox = (canvas.width - 16 * U) / 2, oy = (canvas.height - 22 * U) / 2;
    S.drawFigure(ctx, ox, oy, U, {
      team: opt.team || 'blue', skin: p.look.skin, hair: p.look.hair, hairColor: p.look.hairColor,
      view: opt.view || 'front', role: p.pos === 'GK' ? 'gk' : 'out', number: opt.number,
    });
  }
  function mkCanvas(w, h, cls) { const c = document.createElement('canvas'); c.width = w; c.height = h; if (cls) c.className = cls; return c; }

  // ---- networking -----------------------------------------------------------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    St.ws = new WebSocket(`${proto}://${location.host}`);
    St.ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    St.ws.onclose = () => { setTimeout(connect, 1200); };
  }
  const sendWs = (o) => { if (St.ws && St.ws.readyState === 1) St.ws.send(JSON.stringify(o)); };

  function onMsg(m) {
    switch (m.t) {
      case 'token': St.token = m.token; St.profile = m.profile; goHome(); break;
      case 'profile': St.profile = m.profile; if (St.token == null) St.token = m.profile.token; goHome(); break;
      case 'roomCreated': St.roomCode = m.code; $('lobby-code').textContent = m.code; show('screen-lobby'); break;
      case 'matchStart': startMatch(m); break;
      case 'turn': onTurn(m); break;
      case 'resolve': onResolve(m); break;
      case 'duel': onDuel(m); break;
      case 'shoot': onShoot(m); break;
      case 'matchEnd': onEnd(m); break;
      case 'oppLeft': $('match-msg').textContent = 'Opponent left.'; setTimeout(goHome, 1200); break;
      case 'error': flashErr(m.msg); break;
    }
  }
  function flashErr(msg) {
    const el = document.querySelector('.screen.active .err');
    if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000); }
  }

  // ---- login / home ---------------------------------------------------------
  $('btn-new').onclick = () => sendWs({ t: 'newAccount' });
  $('btn-login').onclick = () => {
    const code = $('login-code').value.trim();
    if (code) { St.token = code; sendWs({ t: 'login', token: code }); }
  };
  $('login-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-login').click(); });

  function goHome() {
    $('home-token').textContent = St.token;
    const p = St.profile;
    const wins = p.wins || 0, losses = p.losses || 0, draws = p.draws || 0;
    const m = p.matches || (wins + losses + draws);
    const wr = m ? Math.round(wins / m * 100) : 0;
    const stat = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    $('home-record').innerHTML =
      stat(wins, 'Wins') + stat(draws, 'Draws') + stat(losses, 'Losses') +
      stat(wr + '%', 'Win rate') + stat(p.goalsFor || 0, 'Goals') + stat(p.goalsAgainst || 0, 'Conceded');
    const strip = $('home-squad'); strip.innerHTML = '';
    (p.squad || []).forEach(pl => {
      const d = document.createElement('div'); d.className = 'mini';
      const c = mkCanvas(40, 56); paintFigure(c, pl, { team: 'blue' });
      d.appendChild(c);
      d.insertAdjacentHTML('beforeend',
        `<div class="ov">${pl.ovr}</div><div class="nm">${pl.name.split(' ').slice(-1)[0]}</div>`);
      strip.appendChild(d);
    });
    show('screen-home');
    maybeFirstTutorial();
  }

  $('btn-create').onclick = () => sendWs({ t: 'createRoom' });
  $('btn-join').onclick = () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code) sendWs({ t: 'joinRoom', code });
  };
  $('btn-easy').onclick = () => sendWs({ t: 'soloMatch', difficulty: 'easy' });
  $('btn-hard').onclick = () => sendWs({ t: 'soloMatch', difficulty: 'hard' });
  $('btn-collection').onclick = openCollection;
  $('btn-tut').onclick = () => startTutorial(false);
  $('btn-tut-login').onclick = () => startTutorial(false);
  $('lobby-cancel').onclick = () => { sendWs({ t: 'leave' }); goHome(); };

  // ---- squad editor ---------------------------------------------------------
  let editActive = [];
  $('btn-edit').onclick = openSquad;
  $('sq-back').onclick = goHome;
  function openSquad() {
    editActive = (St.profile.squad || []).map(p => p.id);
    renderSquad();
    show('screen-squad');
  }
  function allOwned() {
    const map = new Map();
    [...(St.profile.squad || []), ...(St.profile.collection || [])].forEach(p => map.set(p.id, p));
    return [...map.values()];
  }
  function renderSquad() {
    const owned = allOwned();
    const active = $('sq-active'); active.innerHTML = '';
    editActive.forEach(id => {
      const p = owned.find(x => x.id === id); if (!p) return;
      active.appendChild(playerCard(p, true));
    });
    const pool = $('sq-pool'); pool.innerHTML = '';
    owned.forEach(p => {
      const inSquad = editActive.includes(p.id);
      const card = playerCard(p, false);
      if (inSquad) card.classList.add('on');
      card.onclick = () => toggleSquad(p);
      pool.appendChild(card);
    });
    const gkCount = editActive.map(id => owned.find(x => x.id === id)).filter(p => p && p.pos === 'GK').length;
    $('sq-err').textContent = editActive.length !== 3 ? `Pick ${3 - editActive.length} more` :
      gkCount !== 1 ? 'Squad needs exactly one keeper' : '';
  }
  function toggleSquad(p) {
    if (editActive.includes(p.id)) editActive = editActive.filter(x => x !== p.id);
    else if (editActive.length < 3) editActive.push(p.id);
    renderSquad();
  }
  function playerCard(p, mini) {
    const owned = allOwned();
    const card = document.createElement('div'); card.className = 'card';
    const c = mkCanvas(54, 74); paintFigure(c, p, { team: 'blue', number: undefined });
    card.appendChild(c);
    card.insertAdjacentHTML('beforeend',
      `<div class="ovr">${p.ovr}</div><div class="pos">${p.pos}</div>` +
      `<div class="nm">${p.name}</div>` +
      `<div class="meta"><span>PAC ${p.pac}</span><span>SHO ${p.sho}</span></div>`);
    return card;
  }
  $('sq-save').onclick = () => {
    const owned = allOwned();
    const gkCount = editActive.map(id => owned.find(x => x.id === id)).filter(p => p && p.pos === 'GK').length;
    if (editActive.length !== 3 || gkCount !== 1) { renderSquad(); return; }
    const squad = editActive.map(id => owned.find(x => x.id === id));
    St.profile.squad = squad;
    sendWs({ t: 'saveSquad', token: St.token, squad });
  };

  // ---- collection -----------------------------------------------------------
  function rarity(ovr) { return ovr >= 92 ? 'icon' : ovr >= 89 ? 'gold' : ovr >= 86 ? 'silver' : 'bronze'; }
  let colSort = 'ovr';
  document.querySelectorAll('.col-sort .chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.col-sort .chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on'); colSort = c.dataset.sort; renderCollection();
    };
  });
  $('col-back').onclick = goHome;
  function openCollection() { renderCollection(); show('screen-collection'); }
  function renderCollection() {
    const owned = allOwned();
    $('col-count').textContent = `${owned.length} players owned`;
    const posOrder = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    const sorted = owned.slice();
    if (colSort === 'ovr') sorted.sort((a, b) => b.ovr - a.ovr);
    else if (colSort === 'pos') sorted.sort((a, b) => (posOrder[a.pos] - posOrder[b.pos]) || (b.ovr - a.ovr));
    else sorted.reverse();
    const grid = $('col-grid'); grid.innerHTML = '';
    for (const p of sorted) {
      const r = rarity(p.ovr);
      const card = document.createElement('div'); card.className = 'pcard r-' + r;
      const c = mkCanvas(52, 70); paintFigure(c, p, { team: 'blue' });
      card.appendChild(c);
      card.insertAdjacentHTML('beforeend',
        `<div class="ovr">${p.ovr}</div><div class="pos">${p.pos}</div>` +
        `<div class="nm">${p.name}</div>` +
        `<div class="stats6"><span>PAC ${p.pac}</span><span>SHO ${p.sho}</span><span>PAS ${p.pas}</span>` +
        `<span>DRI ${p.dri}</span><span>DEF ${p.def}</span><span>PHY ${p.phy}</span></div>` +
        `<div class="rib">${r}</div>`);
      grid.appendChild(card);
    }
  }

  // ---- tutorial -------------------------------------------------------------
  const TUT = [
    ['The pitch', '<b>3-a-side</b> on a 6x8 grid. Goals sit just outside each end; a line marks each keeper\'s zone.'],
    ['Move at once', 'Order all your players, then Submit. Both teams resolve at the <b>same time</b>, so it\'s about reading the opponent.'],
    ['Moving', 'Tap a player, then a square. <b>2 squares</b> off the ball, <b>1</b> while carrying. Diagonals count.'],
    ['On the ball', 'Dribble, <b>short pass</b> (cut if a defender sits in the lane), <b>long pass</b> (sails over but lands loose), or pass <b>back to keeper</b> to reset.'],
    ['Off the ball', 'Your other player can come short, drop deep, or run in behind. Two defenders can\'t cover all three.'],
    ['Defending', '<b>Press</b> to win the ball (miss and you\'re a beat behind), or drop and stay compact. Win it and you can\'t be tackled straight back.'],
    ['Shooting', 'Shoot from the row in front of goal: you pick a corner, the keeper picks a dive. <b>SHO</b> is the only stat. Chip a keeper who has rushed out.'],
    ['Win & collect', 'First to the target wins. Win for a player pack, then set your keeper and two outfielders in Squad.'],
  ];
  let tutIdx = 0, tutFirst = false;
  function maybeFirstTutorial() {
    try { if (!localStorage.getItem('turf_tut_seen')) startTutorial(true); } catch {}
  }
  function startTutorial(first) { tutFirst = first; tutIdx = 0; renderTut(); ov('ov-tut', true); }
  function renderTut() {
    const [title, body] = TUT[tutIdx];
    $('tut-step').textContent = `Step ${tutIdx + 1} of ${TUT.length}`;
    $('tut-title').textContent = title;
    $('tut-body').innerHTML = body;
    $('tut-back').style.visibility = tutIdx === 0 ? 'hidden' : 'visible';
    $('tut-next').textContent = tutIdx === TUT.length - 1 ? 'Got it' : 'Next';
  }
  $('tut-next').onclick = () => { if (tutIdx < TUT.length - 1) { tutIdx++; renderTut(); } else closeTut(); };
  $('tut-back').onclick = () => { if (tutIdx > 0) { tutIdx--; renderTut(); } };
  $('tut-skip').onclick = closeTut;
  function closeTut() { ov('ov-tut', false); try { localStorage.setItem('turf_tut_seen', '1'); } catch {} }

  // ---- match start ----------------------------------------------------------
  function startMatch(m) {
    St.you = m.you; St.snap = m.snapshot; St.orders = {}; St.sel = null; St.action = null;
    St.vsBot = m.vsBot; St.difficulty = m.difficulty; St.goalTarget = m.goalTarget || 3;
    show('screen-match');
    Pitch.init($('pitch'), St.you); St.inited = true;
    Pitch.setSnapshot(m.snapshot, false);
    const youBlue = St.you === 0;
    $('hud-you').className = 'badge' + (youBlue ? '' : ' red');
    $('hud-opp').className = 'badge' + (youBlue ? ' red' : '');
    $('hud-opp').textContent = m.vsBot ? (m.difficulty === 'hard' ? 'HARD BOT' : 'EASY BOT') : 'OPP';
    $('hud-target').textContent = `First to ${St.goalTarget} wins a pack`;
    ov('ov-end', false);
    updateHud();
    $('match-msg').textContent = '';
  }
  $('btn-quit').onclick = () => { sendWs({ t: 'leave' }); ov('ov-end', false); hidePop(); goHome(); };

  function updateHud() {
    const s = St.snap; if (!s) return;
    $('hud-s0').textContent = s.score[St.you];
    $('hud-s1').textContent = s.score[1 - St.you];
    const att = s.possession === St.you;
    const loose = s.possession === -1;
    $('hud-poss').textContent = loose ? 'Loose ball' : att ? 'You attack' : 'Defend';
    $('hud-phase').textContent = s.phase === 'PLANNING' ? 'PLAN' : s.phase;
    $('timerfill').style.background = att ? 'var(--blue)' : 'var(--red)';
  }

  // ---- planning -------------------------------------------------------------
  function onTurn(m) {
    St.snap = m.snapshot; St.phase = 'PLANNING'; St.orders = {}; St.sel = null; St.action = null; St.submitted = false;
    Pitch.setSnapshot(m.snapshot, false);
    Pitch.setOverlay(null);
    updateHud();
    $('btn-submit').style.display = '';
    $('btn-submit').textContent = 'Submit orders';
    $('match-msg').textContent = '';
    hidePop();
    startTimer(m.deadline);
  }

  function myPlayers() { return St.snap.players.filter(p => p.team === St.you); }
  function playerAt(abs) { return myPlayers().find(p => p.col === abs.col && p.row === abs.row); }
  function attacking() { return St.snap.possession === St.you || St.snap.possession === -1; }

  function actionsFor(p) {
    if (St.snap.possession === (1 - St.you)) { // defending
      const list = [['Move', 'move']];
      const cr = theCarrier();
      if (cr && p.pos !== 'GK' && cheb(p, cr) <= 3) list.push(['Press', 'winball']);
      return list;
    }
    if (isCarrier(p)) {
      if (p.pos === 'GK') return [['Dribble', 'move'], ['Short pass', 'pass'], ['Long pass', 'longpass']];
      const list = [['Dribble', 'move'], ['Short pass', 'pass'], ['Long pass', 'longpass'], ['To keeper', 'backpass']];
      if (canShoot(p)) list.unshift(['Shoot', 'shoot']);
      if (oppKeeperOut()) list.push(['Chip', 'chip']);
      return list;
    }
    return [['Run', 'move']];
  }

  function clearSel() { St.sel = null; St.action = null; St.reach = null; hidePop(); drawOrders(); }

  function hidePop() { const pop = $('ab-pop'); pop.style.display = 'none'; pop.innerHTML = ''; }

  function refreshPop() {
    if (!St.sel || St.submitted) { hidePop(); return; }
    const p = St.snap.players.find(x => x.id === St.sel);
    if (!p) { hidePop(); return; }
    showPop(p);
  }

  function showPop(p) {
    const pop = $('ab-pop');
    const mine = p.team === St.you;
    const last = p.name.split(' ').slice(-1)[0];
    let html = `<div class="ab-head">${last} · ${p.pos} · <b>SHO ${p.sho}</b></div>`;
    if (mine && St.snap.phase === 'PLANNING' && !St.submitted) {
      html += '<div class="ab-row">';
      for (const [label, kind] of actionsFor(p)) html += `<button data-k="${kind}"${St.action === kind ? ' class="act"' : ''}>${label}</button>`;
      html += '<button data-k="__cancel">Cancel</button></div>';
    }
    pop.innerHTML = html;
    pop.style.display = 'block';
    const c = Pitch.screenOf(p.col, p.row), cell = Pitch.cell;
    pop.style.left = c.x + 'px';
    const h = pop.offsetHeight;
    let top = c.y - cell * 0.5 - h - 6;
    if (top < 2) top = c.y + cell * 0.5 + 6;     // flip below if no room above
    pop.style.top = top + 'px';
    pop.querySelectorAll('button').forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); const k = b.dataset.k; if (k === '__cancel') clearSel(); else armAction(k); };
    });
  }

  function armAction(kind) {
    const p = St.snap.players.find(x => x.id === St.sel);
    if (kind === 'shoot') { St.orders[p.id] = { type: 'shoot' }; clearSel(); return; }
    if (kind === 'chip') { St.orders[p.id] = { type: 'chip' }; clearSel(); return; }
    if (kind === 'backpass') { St.orders[p.id] = { type: 'backpass' }; clearSel(); return; }
    if (kind === 'winball') { St.orders[p.id] = { type: 'winball' }; clearSel(); return; }
    St.action = kind;
    const range = kind === 'pass' ? shortReach() : kind === 'longpass' ? longReach() : moveAllow(p);
    const reach = [];
    // move = squares within allowance; pass/longpass = any square within range (can play into space)
    for (let c = 0; c < St.snap.cols; c++) for (let r = 0; r < St.snap.rows; r++) {
      if (c === p.col && r === p.row) continue;
      if (cheb(p, { col: c, row: r }) <= range) reach.push({ col: c, row: r });
    }
    St.reach = reach;
    hidePop();                                   // get out of the way; tap a highlighted square
    drawOrders(reach, kind, { col: p.col, row: p.row });
  }

  function drawOrders(reach, kind, sel) {
    const orders = Object.entries(St.orders).map(([id, o]) => {
      const p = St.snap.players.find(x => x.id === id);
      let to = o.to;
      if (o.type === 'shoot' || o.type === 'chip') to = { col: p.col, row: shootRow(p.team) };
      if (o.type === 'winball') { const c = theCarrier(); to = c ? { col: c.col, row: c.row } : { col: p.col, row: p.row }; }
      if (o.type === 'backpass') { const gk = myPlayers().find(x => x.pos === 'GK'); to = gk ? { col: gk.col, row: gk.row } : { col: p.col, row: p.row }; }
      const color = o.type === 'winball' ? '#d11f2d' : o.type === 'pass' ? '#19a64a'
        : o.type === 'longpass' ? '#e08a00' : o.type === 'backpass' ? '#0aa3a3'
        : (o.type === 'shoot' || o.type === 'chip') ? '#111' : '#1f4fd1';
      return { from: { col: p.col, row: p.row }, to, color };
    });
    Pitch.setOverlay({ reach, kind, orders, sel });
  }

  function selectPlayer(pl, abs) { St.sel = pl.id; St.action = null; St.reach = null; refreshPop(); drawOrders(null, null, abs); }

  // pitch taps
  $('pitch').addEventListener('click', (e) => {
    if (St.phase !== 'PLANNING' || St.submitted) return;
    const abs = Pitch.cellAt(e.clientX, e.clientY); if (!abs) return;
    const mine = playerAt(abs);
    const anyP = St.snap.players.find(x => x.col === abs.col && x.row === abs.row);
    if (St.sel && St.action) {
      const p = St.snap.players.find(x => x.id === St.sel);
      if (St.action === 'pass' || St.action === 'longpass') {
        const range = St.action === 'pass' ? shortReach() : longReach();
        if (cheb(p, abs) <= range && !(abs.col === p.col && abs.row === p.row)) {
          St.orders[p.id] = { type: St.action === 'longpass' ? 'longpass' : 'pass', to: { col: abs.col, row: abs.row } };
          clearSel(); return;
        }
      } else { // move / dribble / run
        if (cheb(p, abs) <= moveAllow(p) && !(abs.col === p.col && abs.row === p.row)) {
          St.orders[p.id] = { type: 'move', to: abs };
          clearSel(); return;
        }
      }
      if (anyP) { selectPlayer(anyP, abs); return; }
      clearSel(); return;
    }
    if (anyP) { selectPlayer(anyP, abs); return; }   // tap any player to see their SHO; yours also shows actions
    clearSel();                                       // empty tap closes the popover
  });

  // long-press (mobile) / right-click (desktop) the ball carrier -> pass mode
  function armPassOnCarrier(clientX, clientY) {
    if (St.phase !== 'PLANNING' || St.submitted) return false;
    const abs = Pitch.cellAt(clientX, clientY); if (!abs) return false;
    const p = playerAt(abs);
    if (p && isCarrier(p) && St.snap.possession === St.you) {
      St.sel = p.id; armAction('pass'); return true;
    }
    return false;
  }
  $('pitch').addEventListener('contextmenu', (e) => { if (armPassOnCarrier(e.clientX, e.clientY)) e.preventDefault(); });
  let pressTimer = null, pressMoved = false, suppressClick = false;
  $('pitch').addEventListener('touchstart', (e) => {
    pressMoved = false;
    const t = e.touches[0]; if (!t) return;
    pressTimer = setTimeout(() => {
      if (!pressMoved && armPassOnCarrier(t.clientX, t.clientY)) suppressClick = true;
    }, 420);
  }, { passive: true });
  $('pitch').addEventListener('touchmove', () => { pressMoved = true; if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
  $('pitch').addEventListener('touchend', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true });
  // swallow the click that follows a long-press
  $('pitch').addEventListener('click', (e) => { if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); } }, true);

  $('btn-submit').onclick = submitOrders;
  function submitOrders() {
    if (St.submitted) return;
    St.submitted = true; St.sel = null; St.action = null;
    Pitch.setOverlay(null);
    sendWs({ t: 'orders', orders: St.orders });
    stopTimer();
    hidePop();
    $('btn-submit').textContent = 'Waiting…';
  }

  // ---- timer ----------------------------------------------------------------
  function startTimer(deadline) {
    stopTimer();
    St.deadline = deadline;
    const total = Math.max(1, deadline - Date.now());
    St.timer = setInterval(() => {
      const left = deadline - Date.now();
      const pct = clamp(left / total * 100, 0, 100);
      $('timerfill').style.width = pct + '%';
      if (left <= 0) { stopTimer(); if (!St.submitted) submitOrders(); }
    }, 120);
  }
  function stopTimer() { if (St.timer) { clearInterval(St.timer); St.timer = null; } }

  // ---- resolve / floats -----------------------------------------------------
  function onResolve(m) {
    St.snap = m.snapshot; stopTimer();
    $('btn-submit').style.display = 'none';
    const shotEv = m.events.find(ev => ev.t === 'shootResult');
    // floats from events
    for (const ev of m.events) {
      if (ev.t === 'goal') Pitch.addFloat('GOAL!', 2, ev.team === 0 ? 0 : St.snap.rows - 1, '#19a64a');
      else if (ev.t === 'intercept') Pitch.addFloat('INTERCEPTED', ev.at.col, ev.at.row, '#d11f2d');
      else if (ev.t === 'loose') Pitch.addFloat('LOOSE!', ev.at.col, ev.at.row, '#b8860b');
      else if (ev.t === 'challenge') {
        const txt = ev.win === 'defender' ? 'WON BALL!' : ev.shielded ? 'HELD OFF' : 'KEPT IT';
        const col = ev.win === 'defender' ? '#d11f2d' : '#1f4fd1';
        Pitch.addFloat(txt, ev.at.col, ev.at.row, col);
      }
    }
    Pitch.setSnapshot(m.snapshot, true);
    updateHud();
    $('match-msg').textContent = '';
    if (shotEv) { animateShot(shotEv); ov('ov-duel', false); }   // keep shoot overlay for the animation
    else setTimeout(() => { ov('ov-duel', false); ov('ov-shoot', false); }, 250);
  }

  function animateShot(ev) {
    const ball = $('shoot-ball'), result = $('shoot-result');
    const xOf = { L: '30%', R: '70%' };
    result.className = 'shoot-result'; result.textContent = '';
    ball.className = 'shoot-ball'; ball.style.left = '50%'; ball.style.top = '78%';
    if (ev.dive) moveKeeper(ev.dive);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ball.classList.add('fly');
      ball.style.left = xOf[ev.cell] || '50%';
      ball.style.top = ev.goal ? '14%' : '50%';
    }));
    setTimeout(() => {
      if (ev.goal) { result.textContent = 'GOAL!'; result.className = 'shoot-result show goal'; }
      else { result.textContent = 'SAVED!'; result.className = 'shoot-result show save'; }
    }, 520);
    setTimeout(() => {
      ov('ov-shoot', false);
      ball.className = 'shoot-ball'; result.className = 'shoot-result'; result.textContent = '';
    }, 2300);
  }

  // ---- duel mini-game -------------------------------------------------------
  function onDuel(m) {
    St.snap = m.snapshot; stopTimer();
    Pitch.setSnapshot(m.snapshot, true);
    updateHud();
    const att = m.snapshot.players.find(p => p.id === m.attackerId);
    const def = m.snapshot.players.find(p => p.id === m.defenderId);
    paintFigure($('duel-att'), att, { team: att.team === 0 ? 'blue' : 'red', view: 'back' });
    paintFigure($('duel-def'), def, { team: def.team === 0 ? 'blue' : 'red', view: 'front' });
    const isAtt = m.role === 'attacker';
    $('duel-title').textContent = isAtt ? `${att.name} on the ball` : `${def.name} closes in`;
    $('duel-prompt').textContent = isAtt ? 'Pick the way you go' : 'Guess the way they go';
    $('duel-wait').textContent = '';
    const btns = document.querySelectorAll('#ov-duel .dir');
    btns.forEach(b => {
      b.disabled = false; b.classList.remove('act');
      b.onclick = () => {
        btns.forEach(x => { x.disabled = true; });
        b.classList.add('act');
        $('duel-wait').textContent = 'Locked in…';
        sendWs({ t: 'duelDir', dir: b.dataset.d });
      };
    });
    setTimeout(() => ov('ov-duel', true), 420);
    autoDecision(() => { sendWs({ t: 'duelDir', dir: 'C' }); }, m.deadline);
  }

  // ---- shoot mini-game ------------------------------------------------------
  function onShoot(m) {
    St.snap = m.snapshot; stopTimer();
    Pitch.setSnapshot(m.snapshot, true);
    updateHud();
    const isShooter = m.role === 'shooter';
    const gk = m.gkId ? m.snapshot.players.find(p => p.id === m.gkId) : null;
    $('shoot-title').textContent = isShooter ? 'Your shot' : 'Big save needed';
    $('shoot-prompt').textContent = isShooter ? 'Pick a corner' : 'Pick your dive';
    $('shoot-wait').textContent = '';
    if (gk) paintFigure($('shoot-gk'), gk, { team: gk.team === 0 ? 'blue' : 'red' });

    const zonesWrap = $('goal-zones'); zonesWrap.innerHTML = '';
    let locked = false;
    [['L', '◀ Left'], ['R', 'Right ▶']].forEach(([code, label]) => {
      const z = document.createElement('div'); z.className = 'z'; z.textContent = label;
      z.onclick = () => {
        if (locked) return; locked = true;
        z.classList.add(isShooter ? 'on' : 'gk');
        if (!isShooter) moveKeeper(code);
        sendWs({ t: 'shootSel', sel: code });
        $('shoot-wait').textContent = 'Locked in…';
      };
      zonesWrap.appendChild(z);
    });
    setTimeout(() => ov('ov-shoot', true), 420);
    autoDecision(() => { sendWs({ t: 'shootSel', sel: Math.random() < 0.5 ? 'L' : 'R' }); }, m.deadline);
  }
  function moveKeeper(dive) {
    const gk = $('shoot-gk');
    gk.style.left = dive === 'L' ? '28%' : '72%';
  }

  // auto-pick just before the server deadline if the player did nothing
  function autoDecision(fn, deadline) {
    clearTimeout(St.decTimer);
    const ms = deadline ? Math.max(400, deadline - Date.now() - 400) : 5600;
    St.decTimer = setTimeout(fn, ms);
  }

  // ---- match end ------------------------------------------------------------
  function onEnd(m) {
    stopTimer();
    if (m.profile) { St.profile = m.profile; St.token = m.profile.token; }
    $('end-title').textContent = m.draw ? 'DRAW' : m.won ? 'YOU WIN' : 'YOU LOSE';
    $('end-title').style.color = m.draw ? 'var(--sub)' : m.won ? 'var(--blue)' : 'var(--red)';
    $('end-score').textContent = `${m.score[St.you]} – ${m.score[1 - St.you]}`;
    const label = $('end-pack-label'), wrap = $('end-pack'); wrap.innerHTML = '';
    if (m.won && m.pack && m.pack.length) {
      label.textContent = 'You won a pack';
      m.pack.forEach((pl, i) => {
        const r = rarity(pl.ovr);
        const flip = document.createElement('div'); flip.className = 'flip';
        const inner = document.createElement('div'); inner.className = 'flip-in';
        const back = document.createElement('div'); back.className = 'flip-face flip-back'; back.textContent = 'TURF';
        const front = document.createElement('div'); front.className = 'flip-face flip-front r-' + r;
        const c = mkCanvas(60, 80); paintFigure(c, pl, { team: 'blue' }); front.appendChild(c);
        front.insertAdjacentHTML('beforeend', `<div class="ov">${pl.ovr}</div><div class="nm">${pl.name.split(' ').slice(-1)[0]}</div>`);
        inner.appendChild(back); inner.appendChild(front); flip.appendChild(inner);
        flip.onclick = () => flip.classList.add('on');
        wrap.appendChild(flip);
        setTimeout(() => flip.classList.add('on'), 500 + i * 450);
      });
    } else { label.textContent = ''; }
    ov('ov-duel', false); ov('ov-shoot', false);
    ov('ov-end', true);
  }
  $('end-rematch').onclick = () => { ov('ov-end', false); sendWs({ t: 'rematch' }); };
  $('end-home').onclick = () => { ov('ov-end', false); sendWs({ t: 'leave' }); goHome(); };

  connect();
})();
