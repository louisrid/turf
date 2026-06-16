/* TURF client controller. Plain globals, no build step. */
(function () {
  const VERSION = 'v0.5.4';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  const isCarrier = (p) => St.snap && St.snap.ball.carrier === p.id;
  const moveAllow = (p) => (p.pos === 'GK' ? 1 : (isCarrier(p) ? 2 : 3));
  const shortReach = () => (St.snap && St.snap.passShort) || 3;
  const shortReachV = () => (St.snap && St.snap.passShortV) || 2;
  const longReach = () => (St.snap && St.snap.passLong) || 6;
  const passOk = (a, b) => Math.abs(a.col - b.col) <= shortReach() && Math.abs(a.row - b.row) <= shortReachV();
  const shootRow = (team) => (team === 0 ? 0 : (St.snap.rows - 1));
  const canShoot = (p) => p.pos !== 'GK' && (p.team === 0 ? p.row <= 1 : p.row >= St.snap.rows - 2);
  const oppKeeperOut = () => !!(St.snap && St.snap.keeperOut && St.snap.keeperOut[1 - St.you]);
  const theCarrier = () => St.snap && St.snap.ball.carrier ? St.snap.players.find(p => p.id === St.snap.ball.carrier) : null;
  const tierLabel = (v) => v >= 88 ? 'SUPERB' : v >= 78 ? 'GOOD' : 'BAD';
  // mirrors engine: expected goal % (keeper guess unknown), no easy penalty for the human
  function shootPct(p) {
    const rowOff = Math.abs(p.row - shootRow(p.team));
    const edge = (p.col === 0 || p.col === St.snap.cols - 1) ? 1 : 0;
    const pen = 0.08 * rowOff + 0.12 * edge;
    const pOpen = clamp(0.72 + (p.sho - 72) * 0.013 - pen, 0.50, 0.98);
    const pCov = clamp(0.10 + (p.sho - 72) * 0.013 - pen * 0.4, 0.05, 0.50);
    return Math.round(100 * (0.5 * pOpen + 0.5 * pCov));
  }
  const longPct = (pas) => Math.round(100 * clamp(0.66 + (pas - 72) * 0.015, 0.60, 0.96));

  const St = { ws: null, token: null, profile: null, you: 0, snap: null, orders: {}, sel: null, action: null, submitted: false, decTimer: null, inited: false, roomCode: null, inMatch: false, reco: 0 };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); }
  const ov = (id, on) => $(id).classList.toggle('show', on);
  const hideAllOverlays = () => ['ov-reco', 'ov-end', 'ov-shoot', 'ov-diff', 'ov-code', 'ov-settings'].forEach(i => ov(i, false));
  const matchMsg = (t) => { $('match-msg').textContent = t || ''; };
  function flashErr(msg) { const el = document.querySelector('.screen.active .err'); if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000); } }

  function paintFigure(canvas, p, opt) {
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = false;
    const S = window.Sprites, U = canvas.width / 18;
    const ox = (canvas.width - 16 * U) / 2, oy = (canvas.height - 22 * U) / 2;
    S.drawFigure(ctx, ox, oy, U, { team: opt.team || 'blue', skin: p.look.skin, hair: p.look.hair, hairColor: p.look.hairColor, beard: p.look.beard, view: opt.view || 'front', role: p.pos === 'GK' ? 'gk' : 'out' });
  }
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rarity(ovr) { return ovr >= 92 ? 'legendary' : ovr >= 87 ? 'elite' : ovr >= 82 ? 'rare' : ovr >= 77 ? 'uncommon' : 'common'; }
  const RAR_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', elite: 'Elite', legendary: 'Legendary' };
  const rarityChip = (ovr) => { const r = rarity(ovr); return `<span class="rar rar-${r}">${RAR_LABEL[r]}</span>`; };
  const tierTag = (v) => { const t = tierLabel(v); return `<span class="tg t-${t.toLowerCase()}">${t}</span>`; };
  const statStack = (p) => `<div class="cstats"><div class="cs"><span class="cs-k">SCR</span>${tierTag(p.sho)}</div><div class="cs"><span class="cs-k">PAS</span>${tierTag(p.pas)}</div></div>`;

  // ---- networking + reconnect ----------------------------------------------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    St.ws = new WebSocket(`${proto}://${location.host}`);
    St.ws.onopen = () => { const tok = lsGet('turf_token'); if (tok) { St.token = tok; sendWs({ t: 'login', token: tok }); } else sendWs({ t: 'newAccount' }); };
    St.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
    St.ws.onclose = () => onDrop();
    St.ws.onerror = () => {};
  }
  function onDrop() {
    if (St.inMatch) {
      ov('ov-reco', true); St.reco++;
      if (St.reco > 12) { St.reco = 0; St.inMatch = false; ov('ov-reco', false); goHome(); return; }
      setTimeout(connect, Math.min(700 * St.reco, 3500));
    } else setTimeout(connect, 1200);
  }
  const sendWs = (o) => { if (St.ws && St.ws.readyState === 1) St.ws.send(JSON.stringify(o)); };
  function onMsg(m) { try { dispatch(m); } catch (e) { console.error('onMsg', m && m.t, e); } }
  function showUpdateBanner() {
    if (document.getElementById('update-bar')) return;
    const bar = document.createElement('div'); bar.id = 'update-bar';
    bar.innerHTML = 'New version available <button id="update-go">Reload</button>';
    document.body.appendChild(bar);
    document.getElementById('update-go').onclick = () => location.reload();
  }
  function dispatch(m) {
    switch (m.t) {
      case 'sver': if (m.v && m.v !== VERSION) showUpdateBanner(); break;
      case 'token': St.token = m.token; lsSet('turf_token', m.token); St.profile = m.profile; St.reco = 0; goHome(); break;
      case 'profile': St.profile = m.profile; if (!St.token) St.token = m.profile.token; lsSet('turf_token', St.token); St.reco = 0; goHome(); break;
      case 'roomCreated': St.roomCode = m.code; $('lobby-code').textContent = m.code; $('lobby-box').classList.remove('hidden'); break;
      case 'matchStart': St.reco = 0; ov('ov-reco', false); startMatch(m); break;
      case 'turn': onTurn(m); break;
      case 'resolve': onResolve(m); break;
      case 'shoot': onShoot(m); break;
      case 'matchEnd': onEnd(m); break;
      case 'oppDropped': matchMsg('Opponent reconnecting…'); break;
      case 'oppBack': matchMsg(''); break;
      case 'oppLeft': matchMsg('Opponent left.'); setTimeout(goHome, 1300); break;
      case 'error':
        if ($('ov-code').classList.contains('show')) $('code-err').textContent = m.msg;
        else if (!St.profile) { lsSet('turf_token', ''); sendWs({ t: 'newAccount' }); }  // stored token no longer exists -> start fresh
        else flashErr(m.msg);
        break;
    }
  }

  // ---- home -----------------------------------------------------------------
  function goHome() {
    St.inMatch = false; clearTimeout(St.decTimer); hideAllOverlays();
    const p = St.profile || {};
    const wins = p.wins || 0, losses = p.losses || 0, draws = p.draws || 0;
    const total = p.matches || (wins + losses + draws);
    $('home-wr').textContent = total ? Math.round(wins / total * 100) + '% win rate' : 'No games yet';
    const pill = (v, k) => `<div class="pill"><b>${v}</b><span>${k}</span></div>`;
    $('home-record').innerHTML = pill(wins, 'WON') + pill(draws, 'DREW') + pill(losses, 'LOST') + pill(p.goalsFor || 0, 'GOALS');
    const strip = $('home-squad'); strip.innerHTML = '';
    (p.squad || []).forEach(pl => {
      const d = document.createElement('div'); d.className = 'mini';
      const c = mkCanvas(46, 60); paintFigure(c, pl, { team: 'blue' }); d.appendChild(c);
      d.insertAdjacentHTML('beforeend', `<div class="nm">${pl.name.split(' ').slice(-1)[0]}</div>`);
      strip.appendChild(d);
    });
    $('home-code').textContent = St.token || '----';
    $('home-ver').textContent = VERSION;
    $('tile-col-cap').textContent = `${allOwned().length} cards`;
    show('screen-home'); maybeFirstTutorial();
  }
  $('btn-solo').onclick = () => ov('ov-diff', true);
  $('diff-easy').onclick = () => { ov('ov-diff', false); sendWs({ t: 'soloMatch', difficulty: 'easy' }); };
  $('diff-hard').onclick = () => { ov('ov-diff', false); sendWs({ t: 'soloMatch', difficulty: 'hard' }); };
  $('diff-cancel').onclick = () => ov('ov-diff', false);
  $('btn-online').onclick = () => { $('lobby-box').classList.add('hidden'); $('online-err').textContent = ''; show('screen-online'); };
  $('btn-collection').onclick = () => openSquad();
  $('btn-rules').onclick = () => startTutorial(false);
  $('btn-edit').onclick = openSquad;
  document.querySelectorAll('.nav-home').forEach(b => b.onclick = () => { sendWs({ t: 'leave' }); goHome(); });
  let resetArmed = false;
  $('btn-settings').onclick = () => {
    resetArmed = false; $('set-reset').textContent = 'Reset team'; $('set-reset').classList.remove('armed');
    $('set-code').textContent = St.token || (St.profile && St.profile.token) || '----';
    ov('ov-settings', true);
  };
  $('set-close').onclick = () => ov('ov-settings', false);
  $('set-usecode').onclick = () => { ov('ov-settings', false); $('code-err').textContent = ''; $('code-input').value = ''; ov('ov-code', true); };
  $('set-reset').onclick = () => {
    if (!resetArmed) { resetArmed = true; $('set-reset').textContent = 'Tap again to wipe this team'; $('set-reset').classList.add('armed'); return; }
    resetArmed = false; lsSet('turf_token', ''); St.token = null; St.profile = null; ov('ov-settings', false); sendWs({ t: 'newAccount' });
  };
  $('code-cancel').onclick = () => ov('ov-code', false);
  $('code-go').onclick = () => { const c = $('code-input').value.trim(); if (c) { lsSet('turf_token', c); St.token = c; sendWs({ t: 'login', token: c }); ov('ov-code', false); } };
  $('btn-create').onclick = () => sendWs({ t: 'createRoom' });
  $('btn-join').onclick = () => { const c = $('join-code').value.trim().toUpperCase(); if (c) sendWs({ t: 'joinRoom', code: c }); };
  $('lobby-cancel').onclick = () => { sendWs({ t: 'leave' }); goHome(); };

  // ---- squad editor ---------------------------------------------------------
  let editActive = [];
  function openSquad() { editActive = (St.profile.squad || []).map(p => p.id); renderSquad(); show('screen-squad'); }
  function allOwned() { const map = new Map(); [...((St.profile && St.profile.squad) || []), ...((St.profile && St.profile.collection) || [])].forEach(p => map.set(p.id, p)); return [...map.values()]; }
  function renderSquad() {
    const owned = allOwned();
    const active = $('sq-active'); active.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const id = editActive[i]; const p = id && owned.find(x => x.id === id);
      if (p) { const card = playerCard(p); card.onclick = () => toggleSquad(p); active.appendChild(card); }
      else { const slot = document.createElement('div'); slot.className = 'card slot'; slot.textContent = '+'; active.appendChild(slot); }
    }
    const pool = $('sq-pool'); pool.innerHTML = '';
    owned.forEach(p => {
      const card = playerCard(p);
      if (editActive.includes(p.id)) { card.classList.add('used'); card.insertAdjacentHTML('beforeend', '<div class="tick">✓</div>'); }
      card.onclick = () => toggleSquad(p); pool.appendChild(card);
    });
    const gkCount = editActive.map(id => owned.find(x => x.id === id)).filter(p => p && p.pos === 'GK').length;
    $('sq-err').textContent = editActive.length !== 3 ? `Pick ${3 - editActive.length} more` : gkCount !== 1 ? 'Squad needs exactly one keeper' : '';
  }
  function toggleSquad(p) { if (editActive.includes(p.id)) editActive = editActive.filter(x => x !== p.id); else if (editActive.length < 3) editActive.push(p.id); renderSquad(); }
  function playerCard(p) {
    const card = document.createElement('div'); card.className = 'card r-' + rarity(p.ovr);
    const c = mkCanvas(54, 58); paintFigure(c, p, { team: 'blue' }); card.appendChild(c);
    card.insertAdjacentHTML('beforeend', `<div class="pos">${p.pos}</div><div class="nm">${p.name.split(' ').slice(-1)[0]}</div>` + statStack(p));
    return card;
  }
  $('sq-save').onclick = () => {
    const owned = allOwned();
    const gkCount = editActive.map(id => owned.find(x => x.id === id)).filter(p => p && p.pos === 'GK').length;
    if (editActive.length !== 3 || gkCount !== 1) { renderSquad(); return; }
    St.profile.squad = editActive.map(id => owned.find(x => x.id === id));
    sendWs({ t: 'saveSquad', token: St.token, squad: St.profile.squad });
    goHome();
  };

  // ---- collection -----------------------------------------------------------
  let colSort = 'ovr';
  document.querySelectorAll('.col-sort .chip').forEach(c => c.onclick = () => { document.querySelectorAll('.col-sort .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); colSort = c.dataset.sort; renderCollection(); });
  function renderCollection() {
    const owned = allOwned();
    $('col-count').textContent = `${owned.length} players · ratings are BAD / GOOD / SUPERB`;
    const posOrder = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    const sorted = owned.slice();
    if (colSort === 'ovr') sorted.sort((a, b) => b.ovr - a.ovr);
    else if (colSort === 'pos') sorted.sort((a, b) => (posOrder[a.pos] - posOrder[b.pos]) || (b.ovr - a.ovr));
    else sorted.reverse();
    const grid = $('col-grid'); grid.innerHTML = '';
    for (const p of sorted) {
      const r = rarity(p.ovr);
      const card = document.createElement('div'); card.className = 'pcard r-' + r;
      const c = mkCanvas(54, 58); paintFigure(c, p, { team: 'blue' }); card.appendChild(c);
      card.insertAdjacentHTML('beforeend', `<div class="pos">${p.pos}</div><div class="nm">${p.name.split(' ').slice(-1)[0]}</div>` + statStack(p));
      grid.appendChild(card);
    }
  }

  // ---- rules / tutorial -----------------------------------------------------
  const TUT = [
    ['The pitch', '<b>3-a-side</b> on a 6x8 grid. Goals sit just outside each end; a line marks each keeper\'s zone. <b>First goal wins.</b>'],
    ['Move at once', 'Order your players, then hit <b>Submit Moves</b>. Both teams resolve at the <b>same time</b> — read your opponent.'],
    ['Moving', 'Tap a player, then a square. <b>2 squares</b> with the ball, <b>3</b> without. You can\'t move onto your own players.'],
    ['On the ball', '<b>Run with ball</b>, <b>short pass</b> (cut only if a defender is in the lane), or a <b>long ball</b> over the top — one per <b>team</b>, then a 3-turn cooldown. Pass back to your keeper to reset.'],
    ['Two stats', 'Only <b>SCR</b> (scoring) and <b>PAS</b> (long-ball control) matter, each rated <b>BAD / GOOD / SUPERB</b>. Higher SCR scores more, even past a correct keeper. Higher PAS means long balls land at your man instead of bouncing loose.'],
    ['Loose balls', 'A <b>loose ball</b> belongs to no one and pulses on the pitch. Whoever <b>ends closest</b> the next turn collects it where they stand — so chase it down.'],
    ['Winning it back', 'No tackle button — <b>move a defender onto the ball carrier\'s square</b> to win it. Stay goal-side to block runs.'],
    ['Shooting', 'From the last two rows, tap <b>Shoot</b> for a 1 v 1. You pick a corner, the keeper guesses a dive — your live <b>% to score</b> is shown.'],
    ['Win & build', 'Score first to win the match and a <b>player pack</b>. Hard bots drop better players. Set your three in Squad.'],
  ];
  let tutIdx = 0;
  function maybeFirstTutorial() { if (!lsGet('turf_tut_seen')) startTutorial(true); }
  function startTutorial(first) { tutIdx = 0; renderTut(); if (first) lsSet('turf_tut_seen', '1'); ov('ov-tut', true); }
  function renderTut() { const [t, b] = TUT[tutIdx]; $('tut-step').textContent = `${tutIdx + 1} / ${TUT.length}`; $('tut-title').textContent = t; $('tut-body').innerHTML = b; $('tut-back').style.display = tutIdx === 0 ? 'none' : ''; $('tut-next').textContent = tutIdx === TUT.length - 1 ? 'Got it' : 'Next'; }
  $('tut-next').onclick = () => { if (tutIdx < TUT.length - 1) { tutIdx++; renderTut(); } else ov('ov-tut', false); };
  $('tut-back').onclick = () => { if (tutIdx > 0) { tutIdx--; renderTut(); } };
  $('tut-skip').onclick = () => ov('ov-tut', false);

  // ---- match ----------------------------------------------------------------
  function startMatch(m) {
    St.you = m.you; St.snap = m.snapshot; St.orders = {}; St.sel = null; St.action = null; St.submitted = false;
    St.vsBot = m.vsBot; St.difficulty = m.difficulty; St.goalTarget = m.goalTarget || 1; St.inMatch = true; St._sy = undefined; St._so = undefined;
    hideAllOverlays(); show('screen-match');
    Pitch.init($('pitch'), St.you); St.inited = true;
    Pitch.setSnapshot(m.snapshot, false);
    const youBlue = St.you === 0;
    $('hud-you').className = 'badge' + (youBlue ? '' : ' red');
    $('hud-opp').className = 'badge' + (youBlue ? ' red' : '');
    $('hud-opp').textContent = m.vsBot ? (m.difficulty === 'hard' ? 'HARD BOT' : 'EASY BOT') : 'RIVAL';
    $('btn-submit').textContent = 'Submit Moves!'; $('btn-submit').classList.remove('waiting');
    updateHud(); matchMsg('');
  }
  $('btn-quit').onclick = () => { sendWs({ t: 'leave' }); goHome(); };

  function updateHud() {
    const s = St.snap; if (!s) return;
    $('hud-s0').textContent = s.score[St.you]; $('hud-s1').textContent = s.score[1 - St.you];
    const sy = s.score[St.you], so = s.score[1 - St.you];
    if (St._sy !== undefined && (sy !== St._sy || so !== St._so)) { const el = document.querySelector('.mhud-score'); if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } }
    St._sy = sy; St._so = so;
    const ls = document.getElementById('long-status');
    if (ls) {
      const cd = s.longCd ? (s.longCd[St.you] || 0) : 0;
      ls.textContent = cd > 0 ? `Long ball: cooldown ${cd}` : 'Long ball: ready';
      ls.className = 'long-status' + (cd > 0 ? ' cooling' : ' ready');
    }
  }

  function onTurn(m) {
    St.snap = m.snapshot; St.orders = {}; St.sel = null; St.action = null; St.submitted = false;
    ov('ov-shoot', false);
    Pitch.setSnapshot(m.snapshot, false); Pitch.setOverlay(null);
    updateHud();
    $('btn-submit').textContent = 'Submit Moves!'; $('btn-submit').classList.remove('waiting');
    matchMsg(''); hidePop();
  }

  function myPlayers() { return St.snap.players.filter(p => p.team === St.you); }
  function playerAt(abs) { return myPlayers().find(p => p.col === abs.col && p.row === abs.row); }
  function mateOccupied(p, abs) { return myPlayers().some(q => q.id !== p.id && q.col === abs.col && q.row === abs.row); }

  function actionsFor(p) {
    if (St.snap.possession === (1 - St.you)) return [['Move', 'move']];
    if (isCarrier(p)) {
      const list = [['Run with ball', 'move'], ['Short pass', 'pass'], ['Long pass', 'longpass']];
      if (canShoot(p)) list.unshift(['Shoot', 'shoot']);
      if (p.pos !== 'GK' && oppKeeperOut()) list.push(['Chip', 'chip']);
      return list;
    }
    return [['Run', 'move']];
  }

  function clearSel() { St.sel = null; St.action = null; hidePop(); drawOrders(); matchMsg(''); }
  function hidePop() { const pop = $('ab-pop'); pop.style.display = 'none'; pop.innerHTML = ''; }
  function refreshPop() { if (!St.sel || St.submitted) { hidePop(); return; } const p = St.snap.players.find(x => x.id === St.sel); if (!p) { hidePop(); return; } showPop(p); }

  function showPop(p) {
    const pop = $('ab-pop'); const mine = p.team === St.you; const last = p.name.split(' ').slice(-1)[0];
    let html = `<div class="ab-head"><div class="ab-name">${last} <span class="ab-pos">${p.pos}</span> ${rarityChip(p.ovr)}</div>${statStack(p)}</div>`;
    if (mine && !St.submitted) {
      const acts = actionsFor(p);
      const longCd = St.snap.longCd ? (St.snap.longCd[St.you] || 0) : 0;
      html += '<div class="ab-row">';
      for (const [label, kind] of acts) {
        if (kind === 'longpass' && longCd > 0) { html += `<button class="off" disabled>Long pass · ${longCd}</button>`; continue; }
        html += `<button data-k="${kind}"${St.action === kind ? ' class="act"' : ''}>${label}</button>`;
      }
      const hasOrder = !!St.orders[p.id];
      html += `<button data-k="__cancel"${hasOrder ? ' class="warn"' : ''}>${hasOrder ? 'Clear order' : 'Cancel'}</button></div>`;
      if (acts.some(a => a[1] === 'shoot')) html += `<div class="ab-hint"><b>${shootPct(p)}%</b> to score from here. Shoot opens a 1 v 1.</div>`;
      else if (isCarrier(p)) {
        const cd = St.snap.longCooldown || 3;
        html += longCd > 0
          ? `<div class="ab-hint">Long ball is on cooldown — your <b>team</b> can use it again in <b>${longCd}</b> turn${longCd > 1 ? 's' : ''}.</div>`
          : `<div class="ab-hint">Long ball ≈ <b>${longPct(p.pas)}%</b> to land at your man. One per <b>team</b>, then a ${cd}-turn cooldown.</div>`;
      }
      else if (St.snap.possession === (1 - St.you)) html += '<div class="ab-hint">Move onto the carrier\'s square to win the ball back.</div>';
    }
    pop.innerHTML = html; pop.style.display = 'block';
    const c = Pitch.screenOf(p.col, p.row), cell = Pitch.cell;
    const w = pop.offsetWidth, wrapW = (pop.offsetParent ? pop.offsetParent.clientWidth : w);
    let left = Math.max(w / 2 + 6, Math.min(c.x, wrapW - w / 2 - 6));   // keep popover fully on screen
    pop.style.left = left + 'px';
    const h = pop.offsetHeight; let top = c.y - cell * 0.5 - h - 6; if (top < 2) top = c.y + cell * 0.5 + 6;
    pop.style.top = top + 'px';
    pop.querySelectorAll('button').forEach(b => b.onclick = (e) => {
      e.stopPropagation(); const k = b.dataset.k; if (!k) return;
      if (k === '__cancel') { if (St.orders[p.id]) delete St.orders[p.id]; clearSel(); }
      else armAction(k);
    });
  }

  function armAction(kind) {
    const p = St.snap.players.find(x => x.id === St.sel);
    if (kind === 'shoot') { St.orders[p.id] = { type: 'shoot' }; St.sel = null; St.action = null; hidePop(); submitOrders(); return; }
    if (kind === 'chip') { St.orders[p.id] = { type: 'chip' }; clearSel(); return; }
    St.action = kind;
    if (kind === 'longpass') matchMsg(`Long ball ≈ ${longPct(p.pas)}% to control`);
    const inReach = (cell) => kind === 'pass' ? passOk(p, cell) : kind === 'longpass' ? cheb(p, cell) <= longReach() : cheb(p, cell) <= moveAllow(p);
    const reach = [];
    for (let c = 0; c < St.snap.cols; c++) for (let r = 0; r < St.snap.rows; r++) {
      const cell = { col: c, row: r };
      if (c === p.col && r === p.row) continue;
      if (!inReach(cell)) continue;
      if (kind === 'move' && mateOccupied(p, cell)) continue;  // can't run onto your own players
      reach.push(cell);
    }
    hidePop(); drawOrders(reach, kind, { col: p.col, row: p.row });
  }

  function drawOrders(reach, kind, sel) {
    const orders = Object.entries(St.orders).map(([id, o]) => {
      const p = St.snap.players.find(x => x.id === id); let to = o.to;
      if (o.type === 'shoot' || o.type === 'chip') to = { col: p.col, row: shootRow(p.team) };
      const color = o.type === 'pass' ? 'var(--ink)' : o.type === 'longpass' ? 'var(--gold)' : (o.type === 'shoot' || o.type === 'chip') ? 'var(--red)' : 'var(--blue)';
      return { from: { col: p.col, row: p.row }, to, color };
    });
    Pitch.setOverlay({ reach, kind, orders, sel });
  }
  function selectPlayer(pl, abs) { St.sel = pl.id; St.action = null; matchMsg(''); refreshPop(); drawOrders(null, null, abs); }

  $('pitch').addEventListener('click', (e) => {
    if (St.submitted) return;
    const abs = Pitch.cellAt(e.clientX, e.clientY); if (!abs) return;
    const anyP = St.snap.players.find(x => x.col === abs.col && x.row === abs.row);
    if (St.sel && St.action) {
      const p = St.snap.players.find(x => x.id === St.sel);
      if (St.action === 'pass' || St.action === 'longpass') {
        const ok = St.action === 'pass' ? passOk(p, abs) : (cheb(p, abs) <= longReach());
        if (ok && !(abs.col === p.col && abs.row === p.row)) { St.orders[p.id] = { type: St.action, to: { col: abs.col, row: abs.row } }; clearSel(); return; }
      } else if (cheb(p, abs) <= moveAllow(p) && !(abs.col === p.col && abs.row === p.row) && !mateOccupied(p, abs)) { St.orders[p.id] = { type: 'move', to: abs }; clearSel(); return; }
      if (anyP) { selectPlayer(anyP, abs); return; }
      clearSel(); return;
    }
    if (anyP) { selectPlayer(anyP, abs); return; }
    clearSel();
  });

  $('btn-submit').onclick = submitOrders;
  function submitOrders() {
    if (St.submitted) return;
    St.submitted = true; St.sel = null; St.action = null; Pitch.setOverlay(null);
    sendWs({ t: 'orders', orders: St.orders }); hidePop(); matchMsg('');
    $('btn-submit').textContent = 'Waiting…'; $('btn-submit').classList.add('waiting');
  }

  // ---- resolve --------------------------------------------------------------
  function onResolve(m) {
    St.snap = m.snapshot;
    $('btn-submit').textContent = 'Resolving…'; $('btn-submit').classList.add('waiting');
    const shotEv = m.events.find(ev => ev.t === 'shootResult');
    const lp = m.events.find(ev => ev.t === 'longpass');
    const sp = m.events.find(ev => ev.t === 'pass');
    Pitch.setSnapshot(m.snapshot, true);
    let landDelay = 0;
    if (lp) { Pitch.flyBall([{ col: lp.to.col, row: lp.to.row }], { lofts: [0.95, 0.45], durs: [380, 280] }); landDelay = 380; }
    else if (sp) { Pitch.flyBall([], { lofts: [0.16], durs: [300] }); landDelay = 120; }
    const float = () => {
      for (const ev of m.events) {
        if (ev.t === 'goal') Pitch.addFloat('GOAL!', 2, ev.team === 0 ? 0 : St.snap.rows - 1, '#e0a200');
        else if (ev.t === 'intercept') Pitch.addFloat('INTERCEPTED', ev.at.col, ev.at.row, '#ff3b4e');
        else if (ev.t === 'loose') Pitch.addFloat('LOOSE BALL', ev.at.col, ev.at.row, '#b8860b');
        else if (ev.t === 'control') Pitch.addFloat('IN BEHIND!', ev.at.col, ev.at.row, '#1f50d8');
        else if (ev.t === 'challenge') Pitch.addFloat(ev.win === 'defender' ? 'WON BALL!' : 'SHIELDED', ev.at.col, ev.at.row, ev.win === 'defender' ? '#ff3b4e' : '#2f6bff');
      }
    };
    if (landDelay) setTimeout(float, landDelay); else float();
    updateHud(); matchMsg('');
    if (shotEv) animateShot(shotEv); else setTimeout(() => ov('ov-shoot', false), 250);
  }

  function animateShot(ev) {
    const ball = $('shoot-ball'), result = $('shoot-result');
    const xOf = { L: '30%', R: '70%' };
    result.className = 'shoot-result'; result.textContent = '';
    ball.style.left = '50%'; ball.style.top = '80%';
    moveKeeper(ev.dive);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ball.style.left = xOf[ev.cell] || '50%';
      ball.style.top = ev.outcome === 'goal' ? '12%' : ev.outcome === 'saved' ? '26%' : '-14%';  // miss flies over the bar
    }));
    setTimeout(() => {
      const txt = ev.outcome === 'goal' ? 'GOAL!' : ev.outcome === 'saved' ? 'SAVED!' : 'MISSED!';
      result.textContent = txt; result.className = 'shoot-result show ' + (ev.outcome === 'goal' ? 'goal' : 'save');
    }, 520);
    setTimeout(() => { ov('ov-shoot', false); ball.style.top = '80%'; result.className = 'shoot-result'; result.textContent = ''; }, 2200);
  }

  // ---- shoot 1 v 1 ----------------------------------------------------------
  function onShoot(m) {
    St.snap = m.snapshot;
    Pitch.setSnapshot(m.snapshot, true); updateHud();
    const isShooter = m.role === 'shooter';
    const shooter = m.shooterId ? m.snapshot.players.find(p => p.id === m.shooterId) : null;
    const gk = m.gkId ? m.snapshot.players.find(p => p.id === m.gkId) : null;
    const pct = isShooter && shooter ? shootPct(shooter) : null;
    $('shoot-title').textContent = isShooter ? (pct + '% to score') : 'Save it!';
    $('shoot-prompt').textContent = isShooter ? 'Pick a corner — the keeper is guessing' : 'Pick your dive';
    $('shoot-wait').textContent = '';
    if (gk) paintFigure($('shoot-gk'), gk, { team: gk.team === 0 ? 'blue' : 'red', view: 'front' });
    if (shooter) paintFigure($('shoot-shooter'), shooter, { team: shooter.team === 0 ? 'blue' : 'red', view: 'back' });
    const ball = $('shoot-ball'); ball.style.left = '50%'; ball.style.top = '80%';
    $('shoot-gk').style.left = '50%';
    $('shoot-result').className = 'shoot-result'; $('shoot-result').textContent = '';
    const zonesWrap = $('goal-zones'); zonesWrap.innerHTML = ''; let locked = false;
    [['L', '◀ LEFT'], ['R', 'RIGHT ▶']].forEach(([code, label]) => {
      const z = document.createElement('div'); z.className = 'z'; z.textContent = label;
      z.onclick = () => { if (locked) return; locked = true; z.classList.add(isShooter ? 'on' : 'gk'); if (!isShooter) moveKeeper(code); sendWs({ t: 'shootSel', sel: code }); $('shoot-wait').textContent = 'Locked in…'; };
      zonesWrap.appendChild(z);
    });
    ov('ov-shoot', true);
    autoDecision(() => sendWs({ t: 'shootSel', sel: Math.random() < 0.5 ? 'L' : 'R' }), m.deadline);
  }
  function moveKeeper(dive) { $('shoot-gk').style.left = dive === 'L' ? '30%' : '70%'; }
  function autoDecision(fn, deadline) { clearTimeout(St.decTimer); const ms = deadline ? Math.max(600, deadline - Date.now() - 600) : 8000; St.decTimer = setTimeout(fn, ms); }

  // ---- match end ------------------------------------------------------------
  function onEnd(m) {
    clearTimeout(St.decTimer);
    if (m.profile) { St.profile = m.profile; St.token = m.profile.token; lsSet('turf_token', St.token); }
    $('end-title').textContent = m.draw ? 'DRAW' : m.won ? 'YOU WIN' : 'YOU LOSE';
    $('end-title').style.color = m.draw ? 'var(--sub)' : m.won ? 'var(--blue)' : 'var(--red)';
    $('end-score').textContent = `${m.score[St.you]} – ${m.score[1 - St.you]}`;
    const label = $('end-pack-label'), wrap = $('end-pack'); wrap.innerHTML = '';
    if (m.won && m.pack && m.pack.length) {
      label.textContent = 'Tap to reveal your new player';
      const pl = m.pack[0], r = rarity(pl.ovr);
      const card = document.createElement('div'); card.className = 'rc r-' + r + ' facedown';
      const c = mkCanvas(104, 104); paintFigure(c, pl, { team: 'blue' }); card.appendChild(c);
      card.insertAdjacentHTML('beforeend', `<div class="pos">${pl.pos}</div><div class="nm">${pl.name.split(' ').slice(-1)[0]}</div>` + statStack(pl) +
        `<div class="back-face">TURF</div>`);
      const reveal = () => { card.classList.remove('facedown'); card.classList.add('reveal'); label.textContent = 'New player added to your collection'; };
      card.onclick = reveal; wrap.appendChild(card);
      setTimeout(reveal, 1400);
    } else label.textContent = '';
    ov('ov-shoot', false); ov('ov-end', true);
  }
  $('end-rematch').onclick = () => { ov('ov-end', false); sendWs({ t: 'rematch' }); };
  $('end-home').onclick = () => { ov('ov-end', false); sendWs({ t: 'leave' }); goHome(); };

  // returning to the app on a dead socket mid-match -> reconnect (don't disturb a healthy one)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && St.inMatch && (!St.ws || St.ws.readyState !== 1)) connect();
  });

  connect();
})();
