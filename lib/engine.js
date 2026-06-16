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
export const PASS_SHORT_V = Math.max(1, PASS_SHORT - 1);   // short pass reaches 1 less up/down
export function shortPassOk(a, b) { return Math.abs(a.col - b.col) <= PASS_SHORT && Math.abs(a.row - b.row) <= PASS_SHORT_V; }
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
    sho: p.sho, pas: p.pas,
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
    passShort: PASS_SHORT, passShortV: PASS_SHORT_V, passLong: PASS_LONG, longCooldown: LONG_COOLDOWN,
    redRows: [redRowFor(0), redRowFor(1)],
    longCd: m.longCd ? [m.longCd[0], m.longCd[1]] : [0, 0],
    keeperOut: [keeperOut(m, 0), keeperOut(m, 1)],
    players: m.players.map(p => ({
      id: p.id, team: p.team, pos: p.pos, name: p.name, ovr: p.ovr, look: p.look,
      col: p.col, row: p.row, hasBall: p.hasBall, protect: p.protect, recover: p.recover,
      sho: p.sho, pas: p.pas,
    })),
    ball: m.ball, possession: m.possession, score: m.score,
    turn: m.turn, phase: m.phase, pending: m.pending,
  };
}

const byId = (m, id) => m.players.find(p => p.id === id);
const carrier = (m) => m.ball.carrier ? byId(m, m.ball.carrier) : null;
const gkOf = (m, t) => m.players.find(p => p.team === t && p.pos === 'GK');

// ---- order validation -------------------------------------------------------
// order types: move | pass | longpass | shoot | chip  (ball is won positionally, no tackle)
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
      const ontoMate = m.players.some(q => q.team === team && q.id !== p.id && q.col === o.to.col && q.row === o.to.row);
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= moveAllowance(m, p)
          && !(o.to.col === p.col && o.to.row === p.row) && !ontoMate) out[p.id] = { type: 'move', to: pt(o.to) };
    } else if (o.type === 'pass' && isCarrier && attacking) {
      if (o.to && inBounds(o.to.col, o.to.row) && shortPassOk(p, o.to)
          && !(o.to.col === p.col && o.to.row === p.row)) out[p.id] = { type: 'pass', to: pt(o.to) };
    } else if (o.type === 'longpass' && isCarrier && attacking && (!m.longCd || m.longCd[team] === 0)) {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= PASS_LONG
          && !(o.to.col === p.col && o.to.row === p.row)) out[p.id] = { type: 'longpass', to: pt(o.to) };
    } else if (o.type === 'shoot' && isCarrier && attacking && p.pos !== 'GK') {
      if (canShootFrom(team, p.row)) out[p.id] = { type: 'shoot' };
    } else if (o.type === 'chip' && isCarrier && attacking && p.pos !== 'GK') {
      if (keeperOut(m, 1 - team)) out[p.id] = { type: 'chip' };
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
    if (co.type === "longpass" && m.longCd) m.longCd[cr.team] = LONG_COOLDOWN + 1;
    resolvePass(m, cr, co.to, dest, events, co.type === 'longpass');
    moveSimple(m, dest, events, new Set());
    settleLooseBall(m, events);
    finalizeTurn(m, events);
    return { events, pending: null };
  }

  // CHALLENGE: an opponent ending on the carrier's resolved square wins the ball (positional, no stat)
  if (cr) {
    const challengers = m.players.filter(p => p.team !== cr.team &&
      (() => { const d = dest.get(p.id); return d.col === carrierDest.col && d.row === carrierDest.row; })());
    if (challengers.length) {
      const d = challengers[Math.floor(Math.random() * challengers.length)];
      resolveChallenge(m, cr, d, carrierDest, events);
      moveSimple(m, dest, events, new Set([cr.id, d.id]));
    } else {
      moveSimple(m, dest, events, new Set());
    }
    settleLooseBall(m, events);
    finalizeTurn(m, events);
    return { events, pending: null };
  }

  // loose-ball turn: players chasing the loose ball
  const loose = m.ball.loose;
  if (loose) {
    const from = (m.ball.looseFrom != null) ? m.ball.looseFrom : -1;
    const grabbers = m.players.filter(p => { const d = dest.get(p.id); return d.col === loose.col && d.row === loose.row; });
    if (grabbers.length) {
      let pool = grabbers;
      if (pool.length > 1 && from !== -1) { const nk = pool.filter(p => p.team !== from); if (nk.length) pool = nk; }  // didn't kick it -> wins the 50/50
      const winner = pool[Math.floor(Math.random() * pool.length)];
      moveSimple(m, dest, events, new Set(grabbers.map(p => p.id)));   // everyone else moves; grabbers handled here
      if (winner.col !== loose.col || winner.row !== loose.row) { events.push({ t: 'move', id: winner.id, from: { col: winner.col, row: winner.row }, to: { col: loose.col, row: loose.row } }); winner.col = loose.col; winner.row = loose.row; }
      giveBall(m, winner, events);
      events.push({ t: 'collect', id: winner.id, at: { col: loose.col, row: loose.row } });
      for (const g of grabbers) { if (g !== winner) scatter(m, g, loose, events); }   // losers nudged to a free square by the ball
      deoverlap(m);
      finalizeTurn(m, events);
      return { events, pending: null };
    }
  }
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
    else dest.set(p.id, { col: p.col, row: p.row });
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
    m.ball = { carrier: null, loose: pt(target), looseFrom: cr.team };
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
    if (Math.random() < longChance(cr.pas)) { // PAS: higher = reliably finds the man, not loose
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
  m.ball = { carrier: null, loose: land, looseFrom: cr.team };
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

function scatter(m, p, center, events) {
  const c = center || { col: p.col, row: p.row };
  const opts = [];
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    if (dc === 0 && dr === 0) continue;
    const nc = c.col + dc, nr = c.row + dr;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
    if (m.players.some(q => q.id !== p.id && q.col === nc && q.row === nr)) continue;
    opts.push({ col: nc, row: nr });
  }
  if (!opts.length) return;
  const t = opts[Math.floor(Math.random() * opts.length)];
  if (t.col !== p.col || t.row !== p.row) { events.push({ t: 'move', id: p.id, from: { col: p.col, row: p.row }, to: t }); p.col = t.col; p.row = t.row; }
}

function settleLooseBall(m, events) {
  if (!m.ball.loose) return;
  const { col, row } = m.ball.loose;
  const from = (m.ball.looseFrom != null) ? m.ball.looseFrom : -1;
  let bd = 99;
  for (const p of m.players) { const d = cheb(p, { col, row }); if (d < bd) bd = d; }
  if (bd > 1) return;
  let closest = m.players.filter(p => cheb(p, { col, row }) === bd);
  if (closest.length > 1 && from !== -1) {                 // equally close -> the team that didn't kick it wins
    const notKicker = closest.filter(p => p.team !== from);
    if (notKicker.length) closest = notKicker;
  }
  const best = closest[Math.floor(Math.random() * closest.length)];
  for (const q of m.players) q.hasBall = false;
  best.hasBall = true;                       // ball comes to them; they keep the square they ran to
  m.ball = { carrier: best.id, loose: null }; m.possession = best.team;
  events.push({ t: 'collect', id: best.id, at: { col: best.col, row: best.row } });
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
  const covered = gk && diveCol === aimCol;                    // keeper guessed the right corner
  const rowOff = Math.abs(s.row - goalRowFor(s.team));
  const edge = (s.col === 0 || s.col === COLS - 1) ? 1 : 0;
  const easyPen = (m.easyBotTeam === s.team) ? 0.18 : 0;
  const pen = 0.08 * rowOff + 0.12 * edge + easyPen;
  // SCR: BAD 72 / GOOD 82 / SUPERB 92. Open goal still needs finishing; SCR can beat a correct dive.
  const pOpen = clamp(0.72 + (s.sho - 72) * 0.013 - pen, 0.50, 0.98);
  const pCovered = clamp(0.10 + (s.sho - 72) * 0.013 - pen * 0.4, 0.05, 0.50);
  const goal = Math.random() < (covered ? pCovered : pOpen);
  const outcome = goal ? 'goal' : covered ? 'saved' : 'missed';   // keeper-wrong & no goal = off target

  events.push({ t: 'shootResult', shooterId: s.id, gkId: gk ? gk.id : null, cell, dive, covered, goal, outcome, at: { col: s.col, row: s.row } });
  if (goal) { m.score[s.team]++; events.push({ t: 'goal', team: s.team }); m.pending = null; kickoff(m, s.team === 0 ? 1 : 0); m.turn++; return { events, goal: true }; }

  s.hasBall = false;
  if (gk) giveBall(m, gk, events);                              // save or miss -> keeper restarts
  else { m.ball = { carrier: null, loose: { col: s.col, row: goalRowFor(s.team) }, looseFrom: s.team }; m.possession = -1; settleLooseBall(m, events); }
  m.pending = null; finalizeTurn(m, events);
  return { events, goal: false };
}

// expected goal chance for the UI (keeper guess unknown -> average of the two)
export function shootChance(m, s) {
  const rowOff = Math.abs(s.row - goalRowFor(s.team));
  const edge = (s.col === 0 || s.col === COLS - 1) ? 1 : 0;
  const easyPen = (m.easyBotTeam === s.team) ? 0.18 : 0;
  const pen = 0.08 * rowOff + 0.12 * edge + easyPen;
  const pOpen = clamp(0.72 + (s.sho - 72) * 0.013 - pen, 0.50, 0.98);
  const pCovered = clamp(0.10 + (s.sho - 72) * 0.013 - pen * 0.4, 0.05, 0.50);
  return 0.5 * pOpen + 0.5 * pCovered;
}
export const longChance = (pas) => clamp(0.66 + (pas - 72) * 0.015, 0.60, 0.96);

function resolveChip(m, c, events) {
  const dist = Math.abs(c.row - goalRowFor(c.team));
  const p = clamp(c.sho / 100 + 0.12 - 0.07 * dist, 0.06, 0.92);
  const goal = Math.random() < p;
  events.push({ t: 'chipResult', shooterId: c.id, goal, dist, at: { col: c.col, row: c.row } });
  if (goal) { m.score[c.team]++; events.push({ t: 'goal', team: c.team }); kickoff(m, c.team === 0 ? 1 : 0); }
  else { c.hasBall = false; m.ball = { carrier: null, loose: { col: c.col, row: clamp(c.row + (c.team === 0 ? -1 : 1), 0, ROWS - 1) }, looseFrom: c.team }; m.possession = -1; }
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
