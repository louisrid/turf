// Bot opponent. difficulty 'easy' | 'hard'.
// hard = optimised: moves into passing/shooting positions, presses, marks tight.
// easy = forgiving: presses less, sometimes gives the ball away, finishes worse.
import { COLS, ROWS, PASS_SHORT, PASS_LONG, moveAllowance, canShootFrom, keeperOut } from './engine.js';

const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const goalRow = t => t === 0 ? 0 : ROWS - 1;
const fwdDir = t => t === 0 ? -1 : 1;
const inb = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

function step(p, to, range) {
  const dc = Math.sign(to.col - p.col), dr = Math.sign(to.row - p.row);
  const n = Math.min(range, Math.max(Math.abs(to.col - p.col), Math.abs(to.row - p.row)));
  return { col: cl(p.col + dc * n, 0, COLS - 1), row: cl(p.row + dr * n, 0, ROWS - 1) };
}
function line(a, b) { const o = []; const s = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row)); for (let i = 1; i < s; i++) o.push({ col: Math.round(a.col + (b.col - a.col) * i / s), row: Math.round(a.row + (b.row - a.row) * i / s) }); return o; }

function carrierOrderOk(m, cr, o) {
  if (!o) return false;
  const same = (t) => t && t.col === cr.col && t.row === cr.row;
  if (o.type === 'shoot') return canShootFrom(cr.team, cr.row);
  if (o.type === 'chip') return keeperOut(m, 1 - cr.team);
  if (o.type === 'pass') return !!o.to && cheb(cr, o.to) <= PASS_SHORT && !same(o.to);
  if (o.type === 'longpass') return !!o.to && cheb(cr, o.to) <= PASS_LONG && !same(o.to);
  if (o.type === 'move') return !!o.to && cheb(cr, o.to) <= moveAllowance(m, cr) && !same(o.to);
  return false;
}

// keep the bot from wasting a move by stepping onto its own team-mate's square
function finalizeOrders(m, team, orders) {
  const mine = m.players.filter(p => p.team === team);
  const occMate = (c, r, ex) => mine.some(q => q.id !== ex && q.col === c && q.row === r);
  for (const p of mine) {
    const o = orders[p.id];
    if (!o || o.type !== 'move' || !o.to) continue;
    if (!occMate(o.to.col, o.to.row, p.id)) continue;
    const a = moveAllowance(m, p); let best = null, bd = 1e9;
    for (let dc = -a; dc <= a; dc++) for (let dr = -a; dr <= a; dr++) {
      const c = cl(p.col + dc, 0, COLS - 1), r = cl(p.row + dr, 0, ROWS - 1);
      if (Math.max(Math.abs(c - p.col), Math.abs(r - p.row)) > a) continue;
      if ((c === p.col && r === p.row) || occMate(c, r, p.id)) continue;
      const d = Math.max(Math.abs(c - o.to.col), Math.abs(r - o.to.row));
      if (d < bd) { bd = d; best = { col: c, row: r }; }
    }
    if (best) orders[p.id] = { type: 'move', to: best }; else delete orders[p.id];
  }
  return orders;
}

export function botOrders(m, team, diff) {
  const hard = diff === 'hard';
  const f = fwdDir(team), gr = goalRow(team), home = team === 0 ? ROWS - 1 : 0;
  const mine = m.players.filter(p => p.team === team);
  const foe = m.players.filter(p => p.team !== team);
  const defs = foe.filter(p => p.pos !== 'GK');
  const gk = mine.find(p => p.pos === 'GK');
  const orders = {};
  const occ = (c, r, ex) => m.players.some(p => p.id !== ex && p.col === c && p.row === r);
  const foeOn = (c, r) => foe.some(p => p.col === c && p.row === r);
  const mateOn = (c, r, ex) => mine.some(p => p.id !== ex && p.col === c && p.row === r);
  const laneClear = (a, b) => line(a, b).every(s => !foeOn(s.col, s.row));
  const defDist = (c, r) => defs.length ? Math.min(...defs.map(d => cheb(d, { col: c, row: r }))) : 9;
  const cr = m.ball.carrier ? m.players.find(p => p.id === m.ball.carrier) : null;
  const attacking = m.possession === team;
  const longOk = !m.longCd || m.longCd[team] === 0;
  const positionKeeper = () => { if (gk && !orders[gk.id]) { const want = { col: cl(cr ? cr.col : 2, 2, 3), row: home }; if (!occ(want.col, want.row, gk.id) && cheb(gk, want) > 0) orders[gk.id] = { type: 'move', to: step(gk, want, 1) }; } };

  // ---- loose ball ----
  if (m.ball.loose) {
    const lb = m.ball.loose;
    const near = mine.filter(p => p.pos !== 'GK').sort((a, b) => cheb(a, lb) - cheb(b, lb));
    if (near[0]) orders[near[0].id] = { type: 'move', to: step(near[0], lb, moveAllowance(m, near[0])) };
    if (near[1]) { const supp = { col: cl(lb.col, 0, COLS - 1), row: cl(lb.row + f, 0, ROWS - 1) }; if (!occ(supp.col, supp.row, near[1].id)) orders[near[1].id] = { type: 'move', to: step(near[1], supp, moveAllowance(m, near[1])) }; }
    if (gk) { if (cheb(gk, lb) <= 1 && Math.abs(lb.row - home) <= 1 && lb.col >= 1 && lb.col <= COLS - 2) orders[gk.id] = { type: 'move', to: step(gk, lb, 1) }; else positionKeeper(); }
    return finalizeOrders(m, team, orders);
  }

  // ---- attacking ----
  if (attacking && cr) {
    const mates = mine.filter(p => p.id !== cr.id && p.pos !== 'GK');
    const runner = mates[0];
    let runnerTo = null;

    const shotQuality = (p) => 1 - 0.30 * Math.abs(p.row - gr) - (p.col === 0 || p.col === COLS - 1 ? 0.45 : (p.col === 1 || p.col === COLS - 2 ? 0.12 : 0));
    const canSh = cr.pos !== 'GK' && canShootFrom(team, cr.row);
    const pressers = defs.filter(d => cheb(d, cr) <= 2);
    const pressed = pressers.length >= 1, doubled = pressers.length >= 2;

    // best forward dribble square (toward goal, central, away from defenders)
    const forwardSquare = () => {
      const a = moveAllowance(m, cr); let best = null, bs = -1e9;
      for (let dc = -a; dc <= a; dc++) for (let dr = -a; dr <= a; dr++) {
        const c = cl(cr.col + dc, 0, COLS - 1), r = cl(cr.row + dr, 0, ROWS - 1);
        if (cheb(cr, { col: c, row: r }) > a || (c === cr.col && r === cr.row)) continue;
        if (foeOn(c, r) || occ(c, r, cr.id)) continue;
        const adv = (gr === 0 ? cr.row - r : r - cr.row);     // >0 = toward goal
        if (adv < 0) continue;
        const sc = adv * 2 + (2 - Math.abs(c - 2.5)) * 0.8 + defDist(c, r) * 0.7;
        if (sc > bs) { bs = sc; best = { col: c, row: r }; }
      }
      return best;
    };
    // reachable square that gives a better shot (central, in the zone)
    const betterShot = () => {
      const a = moveAllowance(m, cr); let best = null, bs = shotQuality(cr) + 0.05;
      for (let dc = -a; dc <= a; dc++) for (let dr = -a; dr <= a; dr++) {
        const c = cl(cr.col + dc, 0, COLS - 1), r = cl(cr.row + dr, 0, ROWS - 1);
        if (cheb(cr, { col: c, row: r }) > a || (c === cr.col && r === cr.row)) continue;
        if (foeOn(c, r) || occ(c, r, cr.id) || !canShootFrom(team, r)) continue;
        const q = 1 - 0.30 * Math.abs(r - gr) - 0.45 * ((c === 0 || c === COLS - 1) ? 1 : 0);
        if (q > bs) { bs = q; best = { col: c, row: r }; }
      }
      return best;
    };
    // a clear short-pass square the runner can reach (coordinated)
    const shortOutlet = () => {
      if (!runner) return null;
      const ra = moveAllowance(m, runner); let best = null, bs = -1e9;
      for (let dc = -ra; dc <= ra; dc++) for (let dr = -ra; dr <= ra; dr++) {
        const c = cl(runner.col + dc, 0, COLS - 1), r = cl(runner.row + dr, 0, ROWS - 1);
        if (cheb(runner, { col: c, row: r }) > ra) continue;
        if (occ(c, r, runner.id) || (c === cr.col && r === cr.row)) continue;
        if (cheb(cr, { col: c, row: r }) > PASS_SHORT || !laneClear(cr, { col: c, row: r })) continue;
        const adv = (gr === 0 ? cr.row - r : r - cr.row);
        const sc = defDist(c, r) * 1.2 + adv * 0.8 + (2 - Math.abs(c - 2.5)) * 0.4;
        if (sc > bs) { bs = sc; best = { col: c, row: r }; }
      }
      return best;
    };
    // a forward run in behind, within long-ball range
    const longRun = () => {
      if (!runner) return null;
      const ra = moveAllowance(m, runner); let best = null, bs = -1e9;
      for (let dc = -ra; dc <= ra; dc++) for (let dr = -ra; dr <= ra; dr++) {
        const c = cl(runner.col + dc, 0, COLS - 1), r = cl(runner.row + dr, 0, ROWS - 1);
        if (cheb(runner, { col: c, row: r }) > ra) continue;
        if (occ(c, r, runner.id)) continue;
        if (cheb(cr, { col: c, row: r }) > PASS_LONG) continue;
        const adv = (gr === 0 ? ROWS - 1 - r : r);
        const sc = adv * 1.5 + defDist(c, r) * 1.0 + (2 - Math.abs(c - 2.5)) * 0.3;
        if (sc > bs) { bs = sc; best = { col: c, row: r }; }
      }
      return best;
    };

    if (!hard && cr.pos !== 'GK' && Math.random() < 0.12 && !(canSh && shotQuality(cr) > 0.75)) {
      // EASY blunder: give the ball away into a defended area
      const d = defs.slice().sort((a, b) => cheb(a, cr) - cheb(b, cr))[0];
      if (d && longOk) orders[cr.id] = { type: 'longpass', to: step(cr, { col: d.col, row: d.row }, PASS_LONG) };
      else if (d && cheb(cr, d) <= PASS_SHORT) orders[cr.id] = { type: 'pass', to: { col: d.col, row: d.row } };
      else { const fs = forwardSquare(); if (fs) orders[cr.id] = { type: 'move', to: fs }; }
    } else if (cr.pos === 'GK') {
      const o = shortOutlet(); if (o) { orders[cr.id] = { type: 'pass', to: o }; runnerTo = o; }
      else if (runner && longOk) { const lr = longRun(); const tgt = lr || { col: runner.col, row: cl(runner.row + f, 0, ROWS - 1) }; orders[cr.id] = { type: 'longpass', to: step(cr, tgt, PASS_LONG) }; runnerTo = lr; }
    } else if (canSh && shotQuality(cr) >= (hard ? 0.5 : 0.45)) {
      orders[cr.id] = { type: 'shoot' };
      runnerTo = { col: cl(2 + Math.round(Math.random()), 2, 3), row: gr }; // crash for a rebound
    } else if (keeperOut(m, 1 - team) && (cr.sho / 100 - 0.09 * Math.abs(cr.row - gr)) > 0.4) {
      orders[cr.id] = { type: 'chip' };
    } else if (doubled) {
      const o = shortOutlet();
      if (o) { orders[cr.id] = { type: 'pass', to: o }; runnerTo = o; }
      else if (gk && cheb(cr, gk) <= PASS_SHORT && laneClear(cr, gk)) orders[cr.id] = { type: 'pass', to: { col: gk.col, row: gk.row } };
      else { const lr = longOk ? longRun() : null; if (lr) { orders[cr.id] = { type: 'longpass', to: step(cr, lr, PASS_LONG) }; runnerTo = lr; } }
    } else if (pressed) {
      const o = shortOutlet();
      if (o) { orders[cr.id] = { type: 'pass', to: o }; runnerTo = o; }
      else { const fs = forwardSquare(); if (fs && defDist(fs.col, fs.row) >= 1) orders[cr.id] = { type: 'move', to: fs }; else if (gk && cheb(cr, gk) <= PASS_SHORT && laneClear(cr, gk)) orders[cr.id] = { type: 'pass', to: { col: gk.col, row: gk.row } }; }
    } else {
      const bs = canSh ? betterShot() : null;
      const myAdv = gr === 0 ? ROWS - 1 - cr.row : cr.row;
      const lr = (hard && longOk) ? longRun() : null;
      const lrAdv = lr ? (gr === 0 ? ROWS - 1 - lr.row : lr.row) : -1;
      if (canSh && shotQuality(cr) < 0.55 && bs) orders[cr.id] = { type: 'move', to: bs };
      else if (lr && lrAdv > myAdv + 1 && defDist(lr.col, lr.row) >= 2 && Math.random() < 0.55) { orders[cr.id] = { type: 'longpass', to: step(cr, lr, PASS_LONG) }; runnerTo = lr; } // ball over the top to a runner in space
      else { const fs = forwardSquare(); if (fs) orders[cr.id] = { type: 'move', to: fs }; else { const o = shortOutlet(); if (o) { orders[cr.id] = { type: 'pass', to: o }; runnerTo = o; } } }
    }

    if (!carrierOrderOk(m, cr, orders[cr.id])) {
      const fwd = { col: cr.col, row: cl(cr.row + f, 0, ROWS - 1) };
      const side = { col: cl(cr.col + (cr.col < 3 ? 1 : -1), 0, COLS - 1), row: cr.row };
      if (!foeOn(fwd.col, fwd.row) && !occ(fwd.col, fwd.row, cr.id) && !(fwd.col === cr.col && fwd.row === cr.row)) orders[cr.id] = { type: 'move', to: fwd };
      else if (cr.pos !== 'GK' && gk && cheb(cr, gk) <= PASS_SHORT) orders[cr.id] = { type: 'pass', to: { col: gk.col, row: gk.row } };
      else if (!occ(side.col, side.row, cr.id) && !(side.col === cr.col && side.row === cr.row)) orders[cr.id] = { type: 'move', to: side };
      else { let mv = null; for (let dc = -1; dc <= 1 && !mv; dc++) for (let dr = -1; dr <= 1 && !mv; dr++) { if (!dc && !dr) continue; const c = cr.col + dc, r = cr.row + dr; if (inb(c, r) && !occ(c, r, cr.id)) mv = { col: c, row: r }; } if (mv) orders[cr.id] = { type: 'move', to: mv }; }
    }

    // runner movement
    if (runner && !orders[runner.id]) {
      let to = runnerTo;
      if (!to && cr.pos === 'GK') to = shortOutlet();          // give the keeper a short option
      if (!to) {
        if (pressed) to = shortOutlet();
        if (!to) to = longRun();
        if (!to) { const ra = moveAllowance(m, runner); to = step(runner, { col: cl(runner.col + (runner.col < 3 ? 1 : -1), 0, COLS - 1), row: cl(runner.row + f, 0, ROWS - 1) }, ra); }
      }
      if (to && !occ(to.col, to.row, runner.id) && !(to.col === cr.col && to.row === cr.row)) orders[runner.id] = { type: 'move', to };
    }
    positionKeeper();
    return finalizeOrders(m, team, orders);
  }

  // ---- defending ----  positional only: chase onto the ball, mark the runner
  if (!attacking && cr) {
    const df = fwdDir(1 - team);
    const atkFwd = fwdDir(cr.team);
    const myDefs = mine.filter(p => p.pos !== 'GK').sort((a, b) => cheb(a, cr) - cheb(b, cr));
    const oppRunner = foe.filter(p => p.pos !== 'GK' && p.id !== cr.id)[0];
    const presser = myDefs[0], marker = myDefs[1];
    if (presser) {
      // hunt the ball: aim at the carrier (hard anticipates one step goal-side); landing on his square wins it
      const tgt = hard ? { col: cr.col, row: cl(cr.row + atkFwd, 0, ROWS - 1) } : { col: cr.col, row: cr.row };
      orders[presser.id] = { type: 'move', to: step(presser, tgt, moveAllowance(m, presser)) };
    }
    if (marker) {
      if (oppRunner) {
        const gsRow = cl(oppRunner.row + df * (hard ? 1 : 2), 0, ROWS - 1);
        orders[marker.id] = { type: 'move', to: step(marker, { col: oppRunner.col, row: gsRow }, moveAllowance(m, marker)) };
      } else {
        const gs = { col: cl(2 + Math.round(Math.random()), 2, 3), row: cl(cr.row + df, 0, ROWS - 1) };
        orders[marker.id] = { type: 'move', to: step(marker, gs, moveAllowance(m, marker)) };
      }
    }
    if (gk) { const want = { col: cl(cr.col, 2, 3), row: home }; if (!occ(want.col, want.row, gk.id) && cheb(gk, want) > 0) orders[gk.id] = { type: 'move', to: step(gk, want, 1) }; }
    return finalizeOrders(m, team, orders);
  }
    return finalizeOrders(m, team, orders);
}

export function botShoot(m, role, diff) {
  const gk = m.pending.gkId ? m.players.find(p => p.id === m.pending.gkId) : null;
  const onLine = gk && !keeperOut(m, gk.team);
  if (role === 'shooter') { if (!onLine) return 'L'; return Math.random() < 0.5 ? 'L' : 'R'; }
  return Math.random() < 0.5 ? 'L' : 'R';
}
