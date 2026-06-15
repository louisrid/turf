// Pure game logic. No I/O. Server owns the authoritative match state.
// Grid: 5 columns (0..4) x 8 rows (0..7), vertical.
// Team 0 defends row 7, attacks row 0. Team 1 defends row 0, attacks row 7.
// Goal mouth = columns 1..3 on the defended end row.

export const COLS = 5;
export const ROWS = 8;
export const GOAL_COLS = [1, 2, 3];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (n = 20) => (Math.random() * 2 - 1) * n; // +/- n
const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

// ---- stat -> range mappings -------------------------------------------------
export const moveRange   = (pac) => clamp(1 + Math.floor((pac - 50) / 14), 1, 4);
export const passRange   = (pas) => clamp(2 + Math.floor((pas - 50) / 12), 2, 6);
export const tackleRange = (def) => clamp(1 + Math.floor((def - 55) / 15), 1, 3);
export const shootRange  = (sho) => clamp(2 + Math.floor((sho - 60) / 12), 2, 5);

const goalRowFor = (team) => (team === 0 ? 0 : 7);     // row a team attacks toward
const ownGoalRow = (team) => (team === 0 ? 7 : 0);

// ---- match creation ---------------------------------------------------------
function place(squad, team) {
  // squad order: GK, DEF, MID, MID, FWD
  const gkR = ownGoalRow(team);
  const dir = team === 0 ? -1 : 1; // forward direction in rows
  const slots = team === 0
    ? [[2, 7], [2, 6], [1, 5], [3, 5], [2, 4]]
    : [[2, 0], [2, 1], [1, 2], [3, 2], [2, 3]];
  // ensure GK first regardless of squad ordering
  const gk = squad.find(p => p.pos === 'GK') || squad[0];
  const others = squad.filter(p => p !== gk);
  const ordered = [gk, ...others].slice(0, 5);
  return ordered.map((p, i) => ({
    id: p.id, team, pos: p.pos, name: p.name, ovr: p.ovr, look: p.look,
    pac: p.pac, sho: p.sho, pas: p.pas, dri: p.dri, def: p.def, phy: p.phy,
    col: slots[i][1] !== undefined ? slots[i][0] : 2,
    row: slots[i][1],
    hasBall: false, adv: false,
  }));
}

export function createMatch(squadA, squadB) {
  const players = [...place(squadA, 0), ...place(squadB, 1)];
  const m = {
    players,
    ball: { carrier: null, loose: null }, // carrier=playerId OR loose={col,row}
    possession: 0,
    score: [0, 0],
    turn: 1,
    phase: 'PLANNING',
    pending: null, // {kind:'duel'|'shoot', ...}
  };
  kickoff(m, 0);
  return m;
}

function kickoff(m, toTeam) {
  // reset positions, give ball to toTeam forward
  const slots0 = [[2, 7], [2, 6], [1, 5], [3, 5], [2, 4]];
  const slots1 = [[2, 0], [2, 1], [1, 2], [3, 2], [2, 3]];
  let i0 = 0, i1 = 0;
  for (const p of m.players) {
    p.hasBall = false; p.adv = false;
    const s = p.team === 0 ? slots0[i0++] : slots1[i1++];
    p.col = s[0]; p.row = s[1];
  }
  const fwd = m.players.find(p => p.team === toTeam && p.pos === 'FWD')
            || m.players.find(p => p.team === toTeam && p.pos !== 'GK');
  fwd.hasBall = true;
  m.ball = { carrier: fwd.id, loose: null };
  m.possession = toTeam;
  m.pending = null;
  m.phase = 'PLANNING';
}

// ---- snapshot for clients ---------------------------------------------------
export function snapshot(m) {
  return {
    cols: COLS, rows: ROWS, goalCols: GOAL_COLS,
    players: m.players.map(p => ({
      id: p.id, team: p.team, pos: p.pos, name: p.name, ovr: p.ovr, look: p.look,
      col: p.col, row: p.row, hasBall: p.hasBall, adv: p.adv,
      pac: p.pac, sho: p.sho, pas: p.pas, dri: p.dri, def: p.def, phy: p.phy,
    })),
    ball: m.ball, possession: m.possession, score: m.score,
    turn: m.turn, phase: m.phase, pending: m.pending,
  };
}

const byId = (m, id) => m.players.find(p => p.id === id);
const carrier = (m) => m.ball.carrier ? byId(m, m.ball.carrier) : null;

// ---- order validation -------------------------------------------------------
// orders: { [playerId]: {type, to?} }
export function sanitizeOrders(m, team, orders) {
  const out = {};
  if (!orders) return out;
  for (const p of m.players) {
    if (p.team !== team) continue;
    const o = orders[p.id];
    if (!o) continue;
    const isCarrier = m.ball.carrier === p.id;
    const attacking = m.possession === team;

    if (o.type === 'move') {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= moveRange(p.pac)
          && !(o.to.col === p.col && o.to.row === p.row)) {
        out[p.id] = { type: 'move', to: { col: o.to.col, row: o.to.row } };
      }
    } else if (o.type === 'pass' && isCarrier && attacking) {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= passRange(p.pas)) {
        out[p.id] = { type: 'pass', to: { col: o.to.col, row: o.to.row } };
      }
    } else if (o.type === 'shoot' && isCarrier && attacking && p.pos !== 'GK') {
      const dist = Math.abs(p.row - goalRowFor(team));
      if (dist <= shootRange(p.sho)) out[p.id] = { type: 'shoot' };
    } else if (o.type === 'tackle' && !attacking) {
      if (o.to && inBounds(o.to.col, o.to.row) && cheb(p, o.to) <= tackleRange(p.def)) {
        out[p.id] = { type: 'tackle', to: { col: o.to.col, row: o.to.row } };
      }
    }
  }
  return out;
}

function lineSquares(from, to) {
  const out = [];
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  for (let i = 1; i <= steps; i++) {
    out.push({
      col: Math.round(from.col + (to.col - from.col) * i / steps),
      row: Math.round(from.row + (to.row - from.row) * i / steps),
    });
  }
  return out;
}

function offBallDuel(aggressor, holder) {
  const a = aggressor.dri * 0.5 + aggressor.phy * 0.5 + (aggressor.adv ? 8 : 0) + rnd();
  const d = holder.def * 0.5 + holder.phy * 0.5 + (holder.adv ? 8 : 0) + rnd();
  return a >= d ? aggressor : holder;
}

// ---- movement / non-interactive resolution ----------------------------------
// Returns { events, pending }. If pending, server runs the mini-game next.
export function resolveOrders(m, ordersA, ordersB) {
  const events = [];
  m.pending = null;
  const orders = { ...sanitizeOrders(m, 0, ordersA), ...sanitizeOrders(m, 1, ordersB) };
  m.players.forEach(p => { p.adv = false; });

  const cr = carrier(m);
  const carrierOrder = cr ? orders[cr.id] : null;

  // 1) SHOOT takes priority -> interactive
  if (carrierOrder && carrierOrder.type === 'shoot') {
    // move everyone except shooter, then hand off to shoot mini-game
    moveSimple(m, orders, events, cr ? cr.id : null);
    const gk = m.players.find(p => p.team !== cr.team && p.pos === 'GK');
    m.pending = { kind: 'shoot', shooterId: cr.id, gkId: gk ? gk.id : null };
    events.push({ t: 'shootStart', shooterId: cr.id, gkId: gk ? gk.id : null,
                  at: { col: cr.col, row: cr.row } });
    m.phase = 'SHOOT';
    return { events, pending: m.pending };
  }

  // 2) Determine destinations
  const dest = new Map();
  for (const p of m.players) {
    const o = orders[p.id];
    dest.set(p.id, (o && (o.type === 'move' || o.type === 'tackle')) ? o.to : { col: p.col, row: p.row });
  }

  // carrier dribble destination
  const carrierDest = cr ? dest.get(cr.id) : null;

  // 3) Ball-carrier duel? a defender ending on the carrier's destination square.
  if (cr && carrierOrder && carrierOrder.type === 'move') {
    const challengers = m.players.filter(p =>
      p.team !== cr.team &&
      (() => { const d = dest.get(p.id); return d.col === carrierDest.col && d.row === carrierDest.row; })());
    if (challengers.length) {
      challengers.sort((a, b) => b.def - a.def);
      const defender = challengers[0];
      // move everyone else; hold carrier + defender for the duel
      moveSimple(m, orders, events, cr.id, defender.id);
      m.pending = { kind: 'duel', attackerId: cr.id, defenderId: defender.id,
                    at: { col: carrierDest.col, row: carrierDest.row } };
      events.push({ t: 'duelStart', attackerId: cr.id, defenderId: defender.id,
                    at: { col: carrierDest.col, row: carrierDest.row } });
      m.phase = 'DUEL';
      return { events, pending: m.pending };
    }
  }

  // 4) No interactive event. Resolve passes, movement, off-ball duels, loose balls.
  // 4a) Pass first (ball leaves carrier before movement settles)
  if (cr && carrierOrder && carrierOrder.type === 'pass') {
    const target = carrierOrder.to;
    events.push({ t: 'pass', from: { col: cr.col, row: cr.row }, to: target });
    cr.hasBall = false;
    // interception: a defender whose destination sits on the pass path
    const path = lineSquares(cr, target);
    let intercepted = null;
    for (const sq of path) {
      const def = m.players.find(p => p.team !== cr.team &&
        (() => { const d = dest.get(p.id); return d.col === sq.col && d.row === sq.row; })());
      if (def) {
        // interception duel: defender def vs passer pas
        const dscore = def.def * 0.6 + def.phy * 0.4 + rnd();
        const pscore = cr.pas * 0.6 + cr.dri * 0.4 + rnd();
        if (dscore >= pscore) { intercepted = def; break; }
      }
    }
    if (intercepted) {
      m.ball = { carrier: intercepted.id, loose: null };
      intercepted.hasBall = true;
      m.possession = intercepted.team;
      events.push({ t: 'intercept', id: intercepted.id, at: { col: dest.get(intercepted.id).col, row: dest.get(intercepted.id).row } });
    } else {
      // reception: a teammate whose destination is the target square
      const receiver = m.players.find(p => p.team === cr.team && p.id !== cr.id &&
        (() => { const d = dest.get(p.id); return d.col === target.col && d.row === target.row; })());
      if (receiver) {
        m.ball = { carrier: receiver.id, loose: null };
        receiver.hasBall = true;
        m.possession = receiver.team;
      } else {
        m.ball = { carrier: null, loose: { ...target } };
        m.possession = -1;
        events.push({ t: 'loose', at: { ...target } });
      }
    }
  }

  // 4b) Move everyone (carrier carries ball if still carrier)
  moveSimple(m, orders, events, null);

  // 4c) loose ball pickup: nearest player on/adjacent to loose square
  settleLooseBall(m, events);

  finalizeTurn(m, events);
  return { events, pending: null };
}

// Move players to destinations. Resolve off-ball duels at contested squares.
// skipIds: players whose movement is deferred (pending interactive duel).
function moveSimple(m, orders, events, ...skipIds) {
  const skip = new Set(skipIds.filter(Boolean));
  const dest = new Map();
  for (const p of m.players) {
    if (skip.has(p.id)) { dest.set(p.id, { col: p.col, row: p.row }); continue; }
    const o = orders[p.id];
    dest.set(p.id, (o && (o.type === 'move' || o.type === 'tackle')) ? o.to : { col: p.col, row: p.row });
  }
  // group by destination square
  const groups = new Map();
  for (const p of m.players) {
    if (skip.has(p.id)) continue;
    const d = dest.get(p.id);
    const k = d.col + ',' + d.row;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const finalPos = new Map();
  for (const [k, grp] of groups) {
    const [c, r] = k.split(',').map(Number);
    const teams = new Set(grp.map(p => p.team));
    if (grp.length === 1) {
      finalPos.set(grp[0].id, { col: c, row: r });
    } else if (teams.size === 1) {
      // same team: highest pac takes the square, others stay put
      grp.sort((a, b) => b.pac - a.pac);
      finalPos.set(grp[0].id, { col: c, row: r });
      for (let i = 1; i < grp.length; i++) finalPos.set(grp[i].id, { col: grp[i].col, row: grp[i].row });
    } else {
      // opposing players: off-ball duels (no carrier here, carrier handled separately)
      grp.sort((a, b) => (b.dri + b.phy) - (a.dri + a.phy));
      let winner = grp[0];
      for (let i = 1; i < grp.length; i++) winner = offBallDuel(winner, grp[i]);
      finalPos.set(winner.id, { col: c, row: r });
      winner.adv = true;
      for (const p of grp) if (p !== winner) {
        finalPos.set(p.id, { col: p.col, row: p.row }); // bumped back
        events.push({ t: 'offduel', winnerId: winner.id, loserId: p.id, at: { col: c, row: r } });
      }
    }
  }
  for (const p of m.players) {
    if (skip.has(p.id)) continue;
    const f = finalPos.get(p.id) || { col: p.col, row: p.row };
    if (f.col !== p.col || f.row !== p.row) {
      events.push({ t: 'move', id: p.id, from: { col: p.col, row: p.row }, to: f });
      p.col = f.col; p.row = f.row;
    }
  }
}

function settleLooseBall(m, events) {
  if (!m.ball.loose) return;
  const { col, row } = m.ball.loose;
  let best = null, bestD = 99;
  for (const p of m.players) {
    const d = cheb(p, { col, row });
    if (d < bestD || (d === bestD && Math.random() < 0.5)) { bestD = d; best = p; }
  }
  if (best && bestD <= 1) {
    best.hasBall = true;
    best.col = col; best.row = row;
    m.ball = { carrier: best.id, loose: null };
    m.possession = best.team;
  }
}

// Move a player off `from` to a free adjacent square, preferring toward own goal.
function relocate(m, p, from) {
  const own = ownGoalRow(p.team);
  const step = own >= from.row ? 1 : -1;
  const cands = [
    { col: from.col, row: from.row + step },
    { col: from.col - 1, row: from.row + step },
    { col: from.col + 1, row: from.row + step },
    { col: from.col - 1, row: from.row },
    { col: from.col + 1, row: from.row },
    { col: from.col, row: from.row - step },
  ];
  for (const c of cands) {
    if (!inBounds(c.col, c.row)) continue;
    if (m.players.some(q => q.id !== p.id && q.col === c.col && q.row === c.row)) continue;
    p.col = c.col; p.row = c.row; return;
  }
  p.row = clamp(from.row + step, 0, ROWS - 1);
  if (p.col === from.col && p.row === from.row) p.col = clamp(from.col + 1, 0, COLS - 1);
}

// Safety net: never leave two opposing players on the same square.
function deoverlap(m) {
  for (let i = 0; i < m.players.length; i++) {
    for (let j = i + 1; j < m.players.length; j++) {
      const a = m.players[i], b = m.players[j];
      if (a.col === b.col && a.row === b.row && a.team !== b.team) {
        relocate(m, a.hasBall ? b : a, { col: a.col, row: a.row });
      }
    }
  }
}

// ---- interactive: duel ------------------------------------------------------
// dirs: 'L' | 'C' | 'R'
export function resolveDuel(m, attackerDir, defenderDir) {
  const events = [];
  const a = byId(m, m.pending.attackerId);
  const d = byId(m, m.pending.defenderId);
  const at = m.pending.at;
  let winner, loser, evade = false, skill = false, tackle = false, turnover = false;

  if (attackerDir !== defenderDir) {
    winner = a; loser = d; evade = true;              // attacker reads it, glides past
  } else {
    const aScore = a.dri * 0.6 + a.pac * 0.2 + a.phy * 0.2 + (a.adv ? 8 : 0) + rnd();
    const dScore = d.def * 0.6 + d.phy * 0.4 + (d.adv ? 8 : 0) + rnd();
    if (aScore >= dScore) { winner = a; loser = d; skill = (aScore - dScore) > 15; }
    else { winner = d; loser = a; tackle = true; turnover = true; }
  }

  winner.col = at.col; winner.row = at.row; winner.adv = true;
  if (turnover) {
    a.hasBall = false; d.hasBall = true;
    m.ball = { carrier: d.id, loose: null }; m.possession = d.team;
  }
  relocate(m, loser, at);

  events.push({ t: 'duelResult', winnerId: winner.id, attackerId: a.id, defenderId: d.id,
                attackerDir, defenderDir, evade, skill, tackle });
  m.pending = null;
  finalizeTurn(m, events);
  return { events };
}

// ---- interactive: shoot -----------------------------------------------------
// placement: 'FL'|'L'|'C'|'R'|'FR' ; gkDir: 'L'|'C'|'R'
const ZONE_DIVE = { FL: 'L', L: 'L', C: 'C', R: 'R', FR: 'R' };
export function resolveShoot(m, placement, gkDir) {
  const events = [];
  const s = byId(m, m.pending.shooterId);
  const gk = m.pending.gkId ? byId(m, m.pending.gkId) : null;
  const goalRow = goalRowFor(s.team);
  const dist = Math.abs(s.row - goalRow);

  // blockers: opposing outfielders on the shot lane between shooter and goal
  const blockers = m.players.filter(p => p.team !== s.team && p.pos !== 'GK' &&
    Math.abs(p.col - s.col) <= 1 &&
    (s.team === 0 ? (p.row < s.row) : (p.row > s.row)));
  const blockPenalty = Math.min(0.4, blockers.length * 0.18);

  const accuracy = clamp(s.sho / 100 - dist * 0.05, 0.35, 0.95);
  let base = clamp(0.5 + (s.sho - 70) / 200 - dist * 0.08 - blockPenalty, 0.05, 0.92);

  const covered = gk && ZONE_DIVE[placement] === gkDir;
  if (covered) base *= clamp(0.22 + (s.sho - 80) / 120, 0.12, 0.5); // power can still beat it
  else base = clamp(base * 1.12, 0.05, 0.95);

  const onTarget = Math.random() < accuracy;
  const goal = onTarget && (Math.random() < base);

  events.push({ t: 'shootResult', shooterId: s.id, gkId: gk ? gk.id : null,
                placement, gkDir, covered, blocked: !onTarget, goal,
                at: { col: s.col, row: s.row } });

  if (goal) {
    m.score[s.team]++;
    events.push({ t: 'goal', team: s.team });
    m.pending = null;
    kickoff(m, s.team === 0 ? 1 : 0);
    m.turn++;
    return { events, goal: true };
  } else {
    // save / miss -> ball to GK's team (goal kick)
    s.hasBall = false;
    const keeper = gk || m.players.find(p => p.team !== s.team && p.pos === 'GK');
    if (keeper) {
      keeper.hasBall = true;
      m.ball = { carrier: keeper.id, loose: null };
      m.possession = keeper.team;
    } else {
      m.ball = { carrier: null, loose: { col: s.col, row: goalRow } };
      m.possession = -1;
    }
    m.pending = null;
    finalizeTurn(m, events);
    return { events, goal: false };
  }
}

function finalizeTurn(m, events) {
  deoverlap(m);
  // possession from carrier
  const c = carrier(m);
  if (c) m.possession = c.team;
  m.turn++;
  m.phase = 'PLANNING';
}

export { kickoff };
