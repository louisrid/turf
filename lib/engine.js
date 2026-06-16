// Pure game logic. Server owns the authoritative state.
// 6 wide x 8 tall. Keeper + 2 outfield a side. Goals are 2 cells (cols 2-3)
// just outside each end. Every outfield piece is identical except SHO.
// Movement: carrier 1, off-ball 2, keeper 1. Tackling is positional and has no
// stat. SHO is the only stat and only matters at the finish.

export const COLS = 6;
export const ROWS = 8;
export const GOAL_COLS = [2, 3];
export const PASS_SHORT = Number(process.env.PASS_SHORT) || 3;   // reliable, can be cut on the lane
export const PASS_LONG = 6;    // lofted, uncuttable, lands loose
export const LONG_COOLDOWN = process.env.LONG_COOLDOWN !== undefined ? Number(process.env.LONG_COOLDOWN) : 3; // turns between long balls

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

const goalRowFor = (team) => (team === 0 ? 0 : ROWS - 1);   // row a team shoots from
const ownGoalRow = (team) => (team === 0 ? ROWS - 1 : 0);
// keeper "red line": team0 keeper belongs to rows 6-7, team1 to rows 0-1.
export const redRowFor = (team) => (team === 0 ? ROWS - 2 : 1);
export const keeperOut = (m, team) => {
  const gk = m.players.find(p => p.team === team && p.pos === 'GK');
  if (!gk) return false;
  return team === 0 ? gk.row < redRowFor(0) : gk.row > redRowFor(1);
};

export function moveAllowance(m, p) {
  if (p.pos === 'GK') return 1;
  if (p.recover > 0) return 1;
  return m.ball.carrier === p.id ? 2 : 3;   // carry 2, off-ball 3
}
export const canShootFrom = (team, row) => (team === 0 ? row <= 1 : row >= ROWS - 2); // last two rows

// ---- formation --------------------------------------------------------------
const SLOTS0 = [[2, 7], [2, 5], [3, 5]];  // GK, OUT, OUT (bottom team)
const SLOTS1 = [[3, 0], [3, 2], [2, 2]];  // mirror (top team)

function place(squad, team) {
  const slots = team === 0 ? SLOTS0 : SLOTS1;
  const gk = squad.find(p => p.pos === 'GK') || squad[0];
  const others = squad.filter(p => p !== gk);
  const ordered = [gk, ...others].slice(0, 3);
  return ordered.map((p, i) => ({
    id: p.id, team, pos: p.pos, name: p.name, ovr: p.ovr, look: p.look,
    sho: p.sho, pac: p.pac, dri: p.dri, def: p.def, pas: p.pas, phy: p.phy,
    col: slots[i][0], row: slots[i][1],
    hasBall: false, protect: 0, recover: 0,
  }));
}

export function createMatch(squadA, squadB) {
  const players = [...place(squadA, 0), ...place(squadB, 1)];
  const m = {
    players, ball: { carrier: null, loose: null },
    possession: 0, score: [0, 0], turn: 1, phase: 'PLANNING', pending: null, longCd: [0, 0],
  };
  kickoff(m, 0);
  return m;
}

function kickoff(m, toTeam) {
  let i0 = 0, i1 = 0;
  for (const p of m.players) {
    p.hasBall = false; p.protect = 0; p.recover = 0;
    const s = p.team === 0 ? SLOTS0[i0++] : SLOTS1[i1++];
    p.col = s[0]; p.row = s[1];
  }
  const out = m.players.filter(p => p.team === toTeam && p.pos !== 'GK')
    .sort((a, b) => Math.abs(a.col - 2.5) - Math.abs(b.col - 2.5))[0]
    || m.players.find(p => p.team === toTeam);
  out.hasBall = true;
  m.ball = { carrier: out.id, loose: null };
  m.possession = toTeam; m.pending = null; m.phase = 'PLANNING'; m.longCd = [0, 0];
}

export function snapshot(m) {
  return {
    cols: COLS, rows: ROWS, goalCols: GOAL_COLS,
    passShort: PASS_SHORT, passLong: PASS_LONG,
    redRows: [redRowFor(0), redRowFor(1)],
    longCd: m.longCd ? [m.longCd[0], m.longCd[1]] : [0, 0],
    keeperOut: [keeperOut(m, 0), keeperOut(m, 1)],
    players: m.players.map(p => ({
      id: p.id, team: p.team, pos: p.pos, name: p.name, ovr: p.ovr, look: p.look,
      col: p.col, row: p.row, hasBall: p.hasBall, protect: p.protect, recover: p.recover,
      sho: p.sho, pac: p.pac, dri: p.dri, def: p.def, pas: p.pas, phy: p.phy,
    })),
    ball: m.ball, possession: m.possession, score: m.score,
    turn: m.turn, phase: m.phase, pending: m.pending,
  };
}

const byId = (m, id) => m.players.find(p => p.id === id);
const carrier = (m) => m.ball.carrier ? byId(m, m.ball.carrier) : null;
const gkOf = (m, t) => m.players.find(p => p.team === t && p.pos === 'GK');

// ---- order validation -------------------------------------------------------
// order types: move | pass | longpass | backpass | shoot | chip | winball
export function sanitizeOrders(m, team, orders) {
  const out = {};
  if (!orders) return out;
  const cr = carrier(m);
  for (const p of m.players) {
    if (p.team !== team) continue;
    const o = orders[p.id];
    if (!o) continue;
    const isCarrier = m.ball.carrier === p.id;
    const attacking = m.possession === team;

    if (o.type === 'move') {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= moveAllowance(m, p)
          && !(o.to.col === p.col && o.to.row === p.row)) out[p.id] = { type: 'move', to: pt(o.to) };
    } else if (o.type === 'pass' && isCarrier && attacking) {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= PASS_SHORT
          && !(o.to.col === p.col && o.to.row === p.row)) out[p.id] = { type: 'pass', to: pt(o.to) };
    } else if (o.type === 'longpass' && isCarrier && attacking && (!m.longCd || m.longCd[team] === 0)) {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= PASS_LONG
          && !(o.to.col === p.col && o.to.row === p.row)) out[p.id] = { type: 'longpass', to: pt(o.to) };
    } else if (o.type === 'backpass' && isCarrier && attacking && p.pos !== 'GK') {
      const gk = gkOf(m, team);
      if (gk) out[p.id] = { type: 'pass', to: { col: gk.col, row: gk.row } };  // back-pass = pass to keeper
    } else if (o.type === 'shoot' && isCarrier && attacking && p.pos !== 'GK') {
      if (canShootFrom(team, p.row)) out[p.id] = { type: 'shoot' };
    } else if (o.type === 'chip' && isCarrier && attacking && p.pos !== 'GK') {
      if (keeperOut(m, 1 - team)) out[p.id] = { type: 'chip' };
    } else if (o.type === 'winball' && !attacking && cr) {
      if (cheb(p, cr) <= 3) out[p.id] = { type: 'winball' };  // commit: lunge up to 2 + tackle on adjacency
    }
  }
  return out;
}
const pt = (o) => ({ col: o.col, row: o.row });

function lineSquares(from, to) {
  const out = [];
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  for (let i = 1; i <= steps; i++) out.push({
    col: Math.round(from.col + (to.col - from.col) * i / steps),
    row: Math.round(from.row + (to.row - from.row) * i / steps),
  });
  return out;
}

// ---- resolution -------------------------------------------------------------
export function resolveOrders(m, ordersA, ordersB) {
  const events = [];
  m.pending = null;
  const orders = { ...sanitizeOrders(m, 0, ordersA), ...sanitizeOrders(m, 1, ordersB) };
  for (const p of m.players) p._winball = false;

  const cr = carrier(m);
  const co = cr ? orders[cr.id] : null;

  // SHOOT / CHIP -> interactive (shoot) or instant (chip)
  if (cr && co && co.type === 'shoot') {
    const dest = destMap(m, orders, cr, { col: cr.col, row: cr.row });
    moveSimple(m, dest, events, new Set([cr.id]));
    deoverlap(m);
    const gk = gkOf(m, 1 - cr.team);
    m.pending = { kind: 'shoot', shooterId: cr.id, gkId: gk ? gk.id : null };
    events.push({ t: 'shootStart', shooterId: cr.id, gkId: gk ? gk.id : null, at: { col: cr.col, row: cr.row } });
    m.phase = 'SHOOT';
    return { events, pending: m.pending };
  }
  if (cr && co && co.type === 'chip') {
    const dest = destMap(m, orders, cr, { col: cr.col, row: cr.row });
    resolveChip(m, cr, events);
    if (m.pending === null && carrier(m) === null && !m.ball.loose) { /* scored, kickoff done */ }
    else { moveSimple(m, dest, events, new Set([cr.id])); settleLooseBall(m, events); }
    finalizeTurn(m, events);
    return { events, pending: null };
  }

  const carrierDest = cr ? (co && co.type === 'move' ? co.to : { col: cr.col, row: cr.row }) : null;
  const dest = destMap(m, orders, cr, carrierDest);

  // PASS (short to feet / lofted long)
  if (cr && co && (co.type === 'pass' || co.type === 'longpass')) {
    if (co.type === 'longpass' && m.longCd) m.longCd[cr.team] = LONG_COOLDOWN;
    resolvePass(m, cr, co.to, dest, events, co.type === 'longpass');
    moveSimple(m, dest, events, new Set());
    settleLooseBall(m, events);
    finalizeTurn(m, events);
    return { events, pending: null };
  }

  // CHALLENGE: opponent ending on the carrier's square wins it (positional, no stat)
  if (cr) {
    const challengers = m.players.filter(p => p.team !== cr.team &&
      (() => { const d = dest.get(p.id); return d.col === carrierDest.col && d.row === carrierDest.row; })());
    const committers = m.players.filter(p => p._winball);
    // winball commits home onto the carrier; resolved by adjacency after movement
    if (challengers.length) {
      const d = challengers[0];
      resolveChallenge(m, cr, d, carrierDest, events);
      moveSimple(m, dest, events, new Set([cr.id, d.id]));
      // committers that did not land the tackle whiff
      for (const w of committers) if (w.id !== d.id && cheb(w, carrier(m) || cr) > 1) w.recover = 1;
      settleLooseBall(m, events);
      finalizeTurn(m, events);
      return { events, pending: null };
    }
    // no one on the square: move, then committed pressers tackle if they end adjacent
    moveSimple(m, dest, events, new Set());
    const cc = carrier(m);
    if (cc) for (const w of committers) {
      if (cheb(w, cc) <= 1) {
        if (cc.protect > 0) events.push({ t: 'challenge', win: 'carrier', shielded: true, carrierId: cc.id, defenderId: w.id, at: { col: cc.col, row: cc.row } });
        else { giveBall(m, w, events); w.protect = 1; events.push({ t: 'challenge', win: 'defender', carrierId: cc.id, defenderId: w.id, at: { col: w.col, row: w.row } }); }
      } else { w.recover = 1; events.push({ t: 'whiff', id: w.id }); }
    }
    settleLooseBall(m, events);
    finalizeTurn(m, events);
    return { events, pending: null };
  }

  // loose-ball turn
  moveSimple(m, dest, events, new Set());
  settleLooseBall(m, events);
  finalizeTurn(m, events);
  return { events, pending: null };
}

function destMap(m, orders, cr, carrierDest) {
  const dest = new Map();
  for (const p of m.players) {
    const o = orders[p.id];
    if (o && o.type === 'move') dest.set(p.id, o.to);
    else if (o && o.type === 'winball' && cr) {
      p._winball = true;
      const home = carrierDest && cheb(p, carrierDest) <= moveAllowance(m, p) ? carrierDest
        : (cheb(p, cr) <= moveAllowance(m, p) ? { col: cr.col, row: cr.row } : stepToward(p, carrierDest || cr, moveAllowance(m, p)));
      dest.set(p.id, { col: home.col, row: home.row });
    } else dest.set(p.id, { col: p.col, row: p.row });
  }
  return dest;
}

function stepToward(from, to, range) {
  const dc = Math.sign(to.col - from.col), dr = Math.sign(to.row - from.row);
  const steps = Math.min(range, Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row)));
  return { col: clamp(from.col + dc * steps, 0, COLS - 1), row: clamp(from.row + dr * steps, 0, ROWS - 1) };
}

function resolvePass(m, cr, target, dest, events, lofted) {
  cr.hasBall = false;
  if (!lofted) {
    events.push({ t: 'pass', from: { col: cr.col, row: cr.row }, to: pt(target) });
    for (const sq of lineSquares(cr, target)) {
      if (sq.col === cr.col && sq.row === cr.row) continue;
      if (sq.col === target.col && sq.row === target.row) continue;
      const d = m.players.find(p => p.team !== cr.team && (() => { const x = dest.get(p.id); return x.col === sq.col && x.row === sq.row; })());
      if (d) { giveBall(m, d, events); events.push({ t: 'intercept', id: d.id, at: pt(dest.get(d.id)) }); return; }
    }
    const rcv = m.players.find(p => p.team === cr.team && p.id !== cr.id && (() => { const x = dest.get(p.id); return cheb(x, target) === 0; })())
      || m.players.find(p => p.team === cr.team && p.id !== cr.id && (() => { const x = dest.get(p.id); return cheb(x, target) <= 1; })());
    if (rcv) { giveBall(m, rcv, events); return; }
    m.ball = { carrier: null, loose: pt(target) };
    m.possession = -1;
    events.push({ t: 'loose', at: pt(target) });
    return;
  }
  // lofted ball over the top
  events.push({ t: 'longpass', from: { col: cr.col, row: cr.row }, to: pt(target) });
  // a team-mate arriving on the drop zone (within 1) can bring it down IF they have space
  const mate = m.players
    .filter(p => p.team === cr.team && p.id !== cr.id)
    .map(p => ({ p, d: cheb(dest.get(p.id), target) }))
    .filter(x => x.d <= 1)
    .sort((a, b) => a.d - b.d)[0];
  if (mate) {
    const md = dest.get(mate.p.id);
    const oppD = Math.min(99, ...m.players.filter(p => p.team !== cr.team).map(p => cheb(dest.get(p.id), md)));
    if (oppD >= 2) { // runner has beaten the defence to it -> clean control, real progression
      giveBall(m, mate.p, events);
      events.push({ t: 'control', id: mate.p.id, at: pt(md) });
      return;
    }
  }
  // contested or nobody there: drops as a scattered loose ball (a gamble)
  const land = {
    col: clamp(target.col + (Math.floor(Math.random() * 3) - 1), 0, COLS - 1),
    row: clamp(target.row + (Math.floor(Math.random() * 3) - 1), 0, ROWS - 1),
  };
  m.ball = { carrier: null, loose: land };
  m.possession = -1;
  events.push({ t: 'loose', at: land });
}

function resolveChallenge(m, cr, d, at, events) {
  if (cr.protect > 0) {
    cr.col = at.col; cr.row = at.row;
    relocate(m, d, at);
    events.push({ t: 'challenge', win: 'carrier', shielded: true, carrierId: cr.id, defenderId: d.id, at: pt(at) });
    return;
  }
  // positional, no stat: covering the carrier's square wins the ball
  cr.hasBall = false; giveBall(m, d, events); d.col = at.col; d.row = at.row; d.protect = 1;
  relocate(m, cr, at);
  events.push({ t: 'challenge', win: 'defender', carrierId: cr.id, defenderId: d.id, at: pt(at) });
}

function moveSimple(m, dest, events, skip) {
  const groups = new Map();
  for (const p of m.players) {
    if (skip.has(p.id)) continue;
    const d = dest.get(p.id) || { col: p.col, row: p.row };
    const k = d.col + ',' + d.row;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const final = new Map();
  for (const [k, grp] of groups) {
    const [c, r] = k.split(',').map(Number);
    if (grp.length === 1) final.set(grp[0].id, { col: c, row: r });
    else {
      // contested square: random winner (no stat), losers hold
      grp.sort(() => Math.random() - 0.5);
      final.set(grp[0].id, { col: c, row: r });
      for (let i = 1; i < grp.length; i++) final.set(grp[i].id, { col: grp[i].col, row: grp[i].row });
    }
  }
  for (const p of m.players) {
    if (skip.has(p.id)) continue;
    const f = final.get(p.id) || { col: p.col, row: p.row };
    if (f.col !== p.col || f.row !== p.row) { events.push({ t: 'move', id: p.id, from: { col: p.col, row: p.row }, to: f }); p.col = f.col; p.row = f.row; }
  }
}

function settleLooseBall(m, events) {
  if (!m.ball.loose) return;
  const { col, row } = m.ball.loose;
  let bd = 99;
  for (const p of m.players) { const d = cheb(p, { col, row }); if (d < bd) bd = d; }
  if (bd > 1) return;
  const closest = m.players.filter(p => cheb(p, { col, row }) === bd);
  const best = closest[Math.floor(Math.random() * closest.length)];
  for (const q of m.players) q.hasBall = false;
  best.hasBall = true; best.col = col; best.row = row;
  m.ball = { carrier: best.id, loose: null }; m.possession = best.team;
  events.push({ t: 'collect', id: best.id, at: { col, row } });
}

function giveBall(m, p, events) {
  for (const q of m.players) q.hasBall = false;
  p.hasBall = true; m.ball = { carrier: p.id, loose: null }; m.possession = p.team;
}

function relocate(m, p, from) {
  const own = ownGoalRow(p.team);
  const occupied = (c, r) => m.players.some(q => q.id !== p.id && q.col === c && q.row === r);
  let best = null, bd = 1e9;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    if (occupied(c, r)) continue;
    if (c === from.col && r === from.row) continue;       // must leave the contested square
    const d = Math.max(Math.abs(c - from.col), Math.abs(r - from.row));
    const score = d * 100 + Math.abs(r - own) * 2 + Math.abs(c - 2.5); // nearest, then goal-side, then central
    if (score < bd) { bd = score; best = { col: c, row: r }; }
  }
  if (best) { p.col = best.col; p.row = best.row; }
}

function deoverlap(m) {
  for (let pass = 0; pass < 5; pass++) {
    let any = false;
    for (let i = 0; i < m.players.length; i++) for (let j = i + 1; j < m.players.length; j++) {
      const a = m.players[i], b = m.players[j];
      if (a.col === b.col && a.row === b.row) {
        const mv = a.hasBall ? b : (b.hasBall ? a : (Math.random() < 0.5 ? a : b));
        relocate(m, mv, { col: a.col, row: a.row });
        any = true;
      }
    }
    if (!any) break;
  }
}

// ---- finishing --------------------------------------------------------------
// SHO is the only stat. It (1) can beat a correct dive, (2) avoids missing an
// open side, (3) gives a chance from range (chip).
const CELL = { L: GOAL_COLS[0], R: GOAL_COLS[1] };
export function resolveShoot(m, cell, dive) {
  const events = [];
  const s = byId(m, m.pending.shooterId);
  const gk = m.pending.gkId ? byId(m, m.pending.gkId) : null;
  const aimCol = CELL[cell] !== undefined ? CELL[cell] : GOAL_COLS[0];
  const diveCol = CELL[dive] !== undefined ? CELL[dive] : GOAL_COLS[0];
  const covered = gk && diveCol === aimCol; // keeper defending its goal always gets its dive guess
  const rowOff = Math.abs(s.row - goalRowFor(s.team));        // 0 = right in front, 1 = one row back
  const edge = (s.col === 0 || s.col === COLS - 1) ? 1 : 0;    // tight angle from the touchline
  const easyPen = (m.easyBotTeam === s.team) ? 0.26 : 0;       // easy bot finishes worse
  const pen = 0.12 * rowOff + 0.20 * edge + easyPen;

  let goal;
  if (!covered) goal = Math.random() < clamp(0.55 + (s.sho - 78) / 100 - pen, 0.10, 0.90); // open: SHO converts
  else goal = Math.random() < clamp((s.sho - 82) / 45 - pen * 0.5, 0, 0.40);                // power past a correct dive

  events.push({ t: 'shootResult', shooterId: s.id, gkId: gk ? gk.id : null, cell, dive, covered, blocked: false, goal, at: { col: s.col, row: s.row } });
  if (goal) { m.score[s.team]++; events.push({ t: 'goal', team: s.team }); m.pending = null; kickoff(m, s.team === 0 ? 1 : 0); m.turn++; return { events, goal: true }; }

  s.hasBall = false;
  // strong shot, correct dive -> sometimes parried out for a rebound
  if (covered && s.sho >= 86 && Math.random() < 0.4) {
    m.ball = { carrier: null, loose: { col: aimCol, row: goalRowFor(s.team) } }; m.possession = -1;
    settleLooseBall(m, events);
  } else if (gk) { giveBall(m, gk, events); }
  else { m.ball = { carrier: null, loose: { col: s.col, row: goalRowFor(s.team) } }; m.possession = -1; settleLooseBall(m, events); }
  m.pending = null; finalizeTurn(m, events);
  return { events, goal: false };
}

function resolveChip(m, c, events) {
  const dist = Math.abs(c.row - goalRowFor(c.team));
  const p = clamp(c.sho / 100 - 0.09 * dist, 0.03, 0.85);
  const goal = Math.random() < p;
  events.push({ t: 'chipResult', shooterId: c.id, goal, dist, at: { col: c.col, row: c.row } });
  if (goal) { m.score[c.team]++; events.push({ t: 'goal', team: c.team }); kickoff(m, c.team === 0 ? 1 : 0); }
  else { c.hasBall = false; m.ball = { carrier: null, loose: { col: c.col, row: clamp(c.row + (c.team === 0 ? -1 : 1), 0, ROWS - 1) } }; m.possession = -1; }
}

function finalizeTurn(m, events) {
  deoverlap(m);
  for (const p of m.players) { if (p.protect > 0) p.protect--; if (p.recover > 0) p.recover--; }
  const c = carrier(m);
  if (c) m.possession = c.team;
  if (m.longCd) { if (m.longCd[0] > 0) m.longCd[0]--; if (m.longCd[1] > 0) m.longCd[1]--; }
  m.turn++; m.phase = 'PLANNING';
}

export { kickoff };
