/* TURF client controller. Plain globals, no build step. */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  const moveRange   = (p) => clamp(1 + Math.floor((p - 50) / 14), 1, 4);
  const passRange   = (p) => clamp(2 + Math.floor((p - 50) / 12), 2, 6);
  const tackleRange = (p) => clamp(1 + Math.floor((p - 55) / 15), 1, 3);
  const shootRange  = (p) => clamp(2 + Math.floor((p - 60) / 12), 2, 5);

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
    $('home-record').innerHTML = `<span>Wins <b>${p.wins || 0}</b></span><span>Losses <b>${p.losses || 0}</b></span><span>Players <b>${(p.squad || []).length + (p.collection || []).length}</b></span>`;
    const strip = $('home-squad'); strip.innerHTML = '';
    (p.squad || []).forEach(pl => {
      const d = document.createElement('div'); d.className = 'mini';
      const c = mkCanvas(40, 56); paintFigure(c, pl, { team: 'blue' });
      d.appendChild(c);
      const n = document.createElement('div'); n.className = 'nm'; n.textContent = pl.name.split(' ').slice(-1)[0];
      d.appendChild(n); strip.appendChild(d);
    });
    show('screen-home');
  }

  $('btn-create').onclick = () => sendWs({ t: 'createRoom' });
  $('btn-join').onclick = () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code) sendWs({ t: 'joinRoom', code });
  };
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
    $('sq-err').textContent = editActive.length !== 5 ? `Pick ${5 - editActive.length} more` :
      gkCount !== 1 ? 'Squad needs exactly one keeper' : '';
  }
  function toggleSquad(p) {
    if (editActive.includes(p.id)) editActive = editActive.filter(x => x !== p.id);
    else if (editActive.length < 5) editActive.push(p.id);
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
    if (editActive.length !== 5 || gkCount !== 1) { renderSquad(); return; }
    const squad = editActive.map(id => owned.find(x => x.id === id));
    St.profile.squad = squad;
    sendWs({ t: 'saveSquad', token: St.token, squad });
  };

  // ---- match start ----------------------------------------------------------
  function startMatch(m) {
    St.you = m.you; St.snap = m.snapshot; St.orders = {}; St.sel = null; St.action = null;
    show('screen-match');
    if (!St.inited) { Pitch.init($('pitch'), St.you); St.inited = true; }
    else { /* re-init team if rematch swapped */ Pitch.init($('pitch'), St.you); }
    Pitch.setSnapshot(m.snapshot, false);
    const youBlue = St.you === 0;
    $('hud-you').className = 'badge' + (youBlue ? '' : ' red');
    $('hud-opp').className = 'badge' + (youBlue ? ' red' : '');
    ov('ov-end', false);
    updateHud();
    $('match-msg').textContent = '';
  }

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
    setActionBar();
    startTimer(m.deadline);
  }

  function myPlayers() { return St.snap.players.filter(p => p.team === St.you); }
  function playerAt(abs) { return myPlayers().find(p => p.col === abs.col && p.row === abs.row); }
  function attacking() { return St.snap.possession === St.you || St.snap.possession === -1; }

  function actionsFor(p) {
    const isCarrier = St.snap.ball.carrier === p.id;
    if (St.snap.possession === (1 - St.you)) { // defending
      return p.pos === 'GK' ? [['Move', 'move']] : [['Move', 'move'], ['Tackle', 'tackle']];
    }
    if (isCarrier) {
      const list = [['Dribble', 'move'], ['Pass', 'pass']];
      const goalRow = p.team === 0 ? 0 : 7;
      if (p.pos !== 'GK' && Math.abs(p.row - goalRow) <= shootRange(p.sho)) list.push(['Shoot', 'shoot']);
      return list;
    }
    return [['Run', 'move']];
  }

  function rangeFor(p, kind) {
    if (kind === 'move') return moveRange(p.pac);
    if (kind === 'pass') return passRange(p.pas);
    if (kind === 'tackle') return tackleRange(p.def);
    return 0;
  }

  function setActionBar() {
    const title = $('ab-title'), box = $('ab-buttons'); box.innerHTML = '';
    if (St.submitted) { title.textContent = 'Orders in. Waiting for opponent…'; return; }
    if (!St.sel) { title.textContent = 'Tap one of your players'; drawOrders(); return; }
    const p = St.snap.players.find(x => x.id === St.sel);
    title.textContent = `${p.name}  ·  ${p.pos}`;
    actionsFor(p).forEach(([label, kind]) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (St.action === kind) b.classList.add('act');
      b.onclick = () => armAction(kind);
      box.appendChild(b);
    });
    const clr = document.createElement('button'); clr.textContent = 'Cancel'; clr.onclick = () => { St.sel = null; St.action = null; setActionBar(); drawOrders(); };
    box.appendChild(clr);
  }

  function armAction(kind) {
    const p = St.snap.players.find(x => x.id === St.sel);
    if (kind === 'shoot') { St.orders[p.id] = { type: 'shoot' }; St.sel = null; St.action = null; setActionBar(); drawOrders(); return; }
    St.action = kind;
    const range = rangeFor(p, kind);
    const reach = [];
    for (let c = 0; c < St.snap.cols; c++) for (let r = 0; r < St.snap.rows; r++) {
      if (c === p.col && r === p.row) continue;
      if (cheb(p, { col: c, row: r }) <= range) reach.push({ col: c, row: r });
    }
    St.reach = reach;
    setActionBar();
    drawOrders(reach, kind, { col: p.col, row: p.row });
  }

  function drawOrders(reach, kind, sel) {
    const orders = Object.entries(St.orders).map(([id, o]) => {
      const p = St.snap.players.find(x => x.id === id);
      const to = o.type === 'shoot' ? { col: p.col, row: (p.team === 0 ? 0 : 7) } : o.to;
      const color = o.type === 'tackle' ? '#d11f2d' : o.type === 'pass' ? '#19a64a' : o.type === 'shoot' ? '#111' : '#1f4fd1';
      return { from: { col: p.col, row: p.row }, to, color };
    });
    Pitch.setOverlay({ reach, kind, orders, sel });
  }

  // pitch taps
  $('pitch').addEventListener('click', (e) => {
    if (St.phase !== 'PLANNING' || St.submitted) return;
    const abs = Pitch.cellAt(e.clientX, e.clientY); if (!abs) return;
    const mine = playerAt(abs);
    if (mine) { St.sel = mine.id; St.action = null; St.reach = null; setActionBar(); drawOrders(null, null, abs); return; }
    if (St.sel && St.action) {
      const p = St.snap.players.find(x => x.id === St.sel);
      if (cheb(p, abs) <= rangeFor(p, St.action) && !(abs.col === p.col && abs.row === p.row)) {
        const type = St.action === 'tackle' ? 'tackle' : St.action === 'pass' ? 'pass' : 'move';
        St.orders[p.id] = { type, to: abs };
        St.sel = null; St.action = null; St.reach = null; setActionBar(); drawOrders();
      }
    }
  });

  $('btn-submit').onclick = submitOrders;
  function submitOrders() {
    if (St.submitted) return;
    St.submitted = true; St.sel = null; St.action = null;
    Pitch.setOverlay(null);
    sendWs({ t: 'orders', orders: St.orders });
    stopTimer();
    setActionBar();
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
    // floats from events
    for (const ev of m.events) {
      if (ev.t === 'goal') Pitch.addFloat('GOAL!', 2, ev.team === 0 ? 0 : 7, '#19a64a');
      else if (ev.t === 'intercept') Pitch.addFloat('INTERCEPTED', ev.at.col, ev.at.row, '#d11f2d');
      else if (ev.t === 'duelResult') {
        const a = St.snap.players.find(p => p.id === ev.attackerId) || { col: 2, row: 4 };
        if (ev.tackle) Pitch.addFloat('TACKLED!', a.col, a.row, '#d11f2d');
        else if (ev.skill) Pitch.addFloat('SKILL!', a.col, a.row, '#1f4fd1');
        else if (ev.evade) Pitch.addFloat('GETS PAST', a.col, a.row, '#1f4fd1');
        else Pitch.addFloat('WON BALL', a.col, a.row, '#111');
      } else if (ev.t === 'shootResult' && !ev.goal) {
        Pitch.addFloat(ev.blocked ? 'OFF TARGET' : 'SAVED!', ev.at.col, ev.at.row, '#d11f2d');
      }
    }
    setTimeout(() => { ov('ov-duel', false); ov('ov-shoot', false); }, 250);
    Pitch.setSnapshot(m.snapshot, true);
    updateHud();
    $('match-msg').textContent = '';
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
    autoDecision(() => { sendWs({ t: 'duelDir', dir: 'C' }); });
  }

  // ---- shoot mini-game ------------------------------------------------------
  function onShoot(m) {
    St.snap = m.snapshot; stopTimer();
    Pitch.setSnapshot(m.snapshot, true);
    updateHud();
    const isShooter = m.role === 'shooter';
    const gk = m.gkId ? m.snapshot.players.find(p => p.id === m.gkId) : null;
    $('shoot-title').textContent = isShooter ? 'Your shot' : 'Big save needed';
    $('shoot-prompt').textContent = isShooter ? 'Pick your placement' : 'Pick your dive';
    $('shoot-wait').textContent = '';
    if (gk) paintFigure($('shoot-gk'), gk, { team: gk.team === 0 ? 'blue' : 'red' });

    const zonesWrap = $('goal-zones'); zonesWrap.innerHTML = '';
    const codes = ['FL', 'L', 'C', 'R', 'FR'];
    const labels = isShooter ? ['◤', 'L', 'C', 'R', '◥'] : ['L', 'L', 'C', 'R', 'R'];
    const diveOf = { FL: 'L', L: 'L', C: 'C', R: 'R', FR: 'R' };
    let locked = false;
    codes.forEach((code, i) => {
      const z = document.createElement('div'); z.className = 'z'; z.textContent = labels[i];
      z.onclick = () => {
        if (locked) return; locked = true;
        if (isShooter) {
          z.classList.add('on');
          sendWs({ t: 'shootSel', sel: code });
        } else {
          const dive = diveOf[code];
          [...zonesWrap.children].forEach((c, j) => { if (diveOf[codes[j]] === dive) c.classList.add('gk'); });
          moveKeeper(dive);
          sendWs({ t: 'shootSel', sel: dive });
        }
        $('shoot-wait').textContent = 'Locked in…';
      };
      zonesWrap.appendChild(z);
    });
    setTimeout(() => ov('ov-shoot', true), 420);
    autoDecision(() => { sendWs({ t: 'shootSel', sel: isShooter ? 'C' : 'C' }); });
  }
  function moveKeeper(dive) {
    const gk = $('shoot-gk');
    gk.style.left = dive === 'L' ? '20%' : dive === 'R' ? '80%' : '50%';
  }

  // auto-pick after the decision window if the player did nothing
  function autoDecision(fn) {
    clearTimeout(St.decTimer);
    St.decTimer = setTimeout(fn, 5600);
  }

  // ---- match end ------------------------------------------------------------
  function onEnd(m) {
    stopTimer();
    if (m.profile) { St.profile = m.profile; St.token = m.profile.token; }
    $('end-title').textContent = m.won ? 'YOU WIN' : 'YOU LOSE';
    $('end-title').style.color = m.won ? 'var(--blue)' : 'var(--red)';
    $('end-score').textContent = `${m.score[St.you]} – ${m.score[1 - St.you]}`;
    const rw = $('end-reward'); rw.innerHTML = '';
    if (m.won && m.reward) {
      const wrap = document.createElement('div'); wrap.className = 'rc';
      const c = mkCanvas(80, 110); paintFigure(c, m.reward, { team: 'blue' });
      wrap.appendChild(c);
      wrap.insertAdjacentHTML('beforeend',
        `<div class="rn">${m.reward.name} · ${m.reward.ovr}</div><div class="rs">Unlocked &amp; added to your collection</div>`);
      rw.appendChild(wrap);
    }
    ov('ov-duel', false); ov('ov-shoot', false);
    ov('ov-end', true);
  }
  $('end-rematch').onclick = () => { ov('ov-end', false); sendWs({ t: 'rematch' }); };
  $('end-home').onclick = () => { ov('ov-end', false); sendWs({ t: 'leave' }); goHome(); };

  connect();
})();
