// Bot opponent on the live match. difficulty 'easy' | 'hard'.
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

export function botOrders(m, team, diff) {
  const hard = diff === 'hard';
  const f = fwdDir(team), gr = goalRow(team);
  const mine = m.players.filter(p => p.team === team);
  const foe = m.players.filter(p => p.team !== team);
  const defs = foe.filter(p => p.pos !== 'GK');
  const orders = {};
  const occ = (c, r, ex) => m.players.some(p => p.id !== ex && p.col === c && p.row === r);
  const foeOn = (c, r) => foe.some(p => p.col === c && p.row === r);
  const cr = m.ball.carrier ? m.players.find(p => p.id === m.ball.carrier) : null;
  const attacking = m.possession === team;

  // loose ball: chase with nearest outfielder; keeper only claims it in its own goal mouth
  if (m.ball.loose) {
    const lb = m.ball.loose;
    const near = mine.filter(p => p.pos !== 'GK').sort((a, b) => cheb(a, lb) - cheb(b, lb))[0];
    if (near) orders[near.id] = { type: 'move', to: step(near, lb, moveAllowance(m, near)) };
    const gk = mine.find(p => p.pos === 'GK');
    const gline = team === 0 ? ROWS - 1 : 0;
    if (gk) {
      if (cheb(gk, lb) <= 1 && Math.abs(lb.row - gline) <= 1 && lb.col >= 1 && lb.col <= COLS - 2) orders[gk.id] = { type: 'move', to: step(gk, lb, 1) };
      else { const want = { col: cl(lb.col, 2, 3), row: gline }; if (!occ(want.col, want.row, gk.id)) orders[gk.id] = { type: 'move', to: step(gk, want, 1) }; }
    }
    return orders;
  }

  if (attacking && cr) {
    const mates = mine.filter(p => p.id !== cr.id && p.pos !== 'GK');
    const runner = mates[0];
    const gk = mine.find(p => p.pos === 'GK');
    const pressers = defs.filter(d => cheb(d, cr) <= 2 && d.recover === 0);
    const pressed = pressers.length >= 1;
    const doubled = pressers.length >= 2;

    const fwdSquares = [{ col: cr.col, row: cl(cr.row + f, 0, ROWS - 1) },
      { col: cl(cr.col - 1, 0, COLS - 1), row: cl(cr.row + f, 0, ROWS - 1) },
      { col: cl(cr.col + 1, 0, COLS - 1), row: cl(cr.row + f, 0, ROWS - 1) }]
      .filter(s => inb(s.col, s.row) && !foeOn(s.col, s.row) && !occ(s.col, s.row, cr.id));

    const shortTo = mates.map(mt => {
      const cands = [{ col: mt.col, row: cl(mt.row + f, 0, ROWS - 1) }, { col: mt.col, row: mt.row }];
      for (const c of cands) if (cheb(cr, c) <= PASS_SHORT && !foeOn(c.col, c.row) && line(cr, c).every(s => !foeOn(s.col, s.row))) return { mt, to: c };
      return null;
    }).find(Boolean);

    const behind = mates.find(mt => Math.abs(mt.row - gr) < Math.abs(cr.row - gr) - 1 && cheb(cr, { col: mt.col, row: cl(mt.row + f, 0, ROWS - 1) }) <= PASS_LONG);
    const longTo = behind ? { col: behind.col, row: cl(behind.row + f * 2, 0, ROWS - 1) } : null;

    if (cr.pos !== 'GK' && canShootFrom(team, cr.row)) { orders[cr.id] = { type: 'shoot' }; return assignRunner(); }
    if (cr.pos !== 'GK' && keeperOut(m, 1 - team)) {
      const dist = Math.abs(cr.row - gr); const pr = cr.sho / 100 - 0.09 * dist;
      if (pr > 0.4) { orders[cr.id] = { type: 'chip' }; return assignRunner(); }
    }

    if (cr.pos === 'GK') {
      if (shortTo) orders[cr.id] = { type: 'pass', to: shortTo.to };
      else if (runner) orders[cr.id] = { type: 'longpass', to: { col: runner.col, row: cl(runner.row + f, 0, ROWS - 1) } };
    } else if (doubled) {
      if (longTo) orders[cr.id] = { type: 'longpass', to: longTo };
      else if (gk) orders[cr.id] = { type: 'backpass' };
      else if (shortTo) orders[cr.id] = { type: 'pass', to: shortTo.to };
      else if (fwdSquares.length) orders[cr.id] = { type: 'move', to: fwdSquares[0] };
    } else if (pressed) {
      if (shortTo) orders[cr.id] = { type: 'pass', to: shortTo.to };
      else if (fwdSquares.length) orders[cr.id] = { type: 'move', to: pickAway(fwdSquares, pressers) };
      else if (gk) orders[cr.id] = { type: 'backpass' };
    } else {
      if (longTo && Math.random() < 0.3) orders[cr.id] = { type: 'longpass', to: longTo };
      else if (fwdSquares.length) orders[cr.id] = { type: 'move', to: fwdSquares.sort((a, b) => Math.abs(a.col - 2.5) - Math.abs(b.col - 2.5))[0] };
      else if (shortTo) orders[cr.id] = { type: 'pass', to: shortTo.to };
    }
    return assignRunner();

    function assignRunner() {
      if (runner && !orders[runner.id]) {
        const needOutlet = pressed && !shortTo;
        let to;
        if (needOutlet) to = step(runner, cr, moveAllowance(m, runner));
        else {
          const tr = cl(runner.row + f * moveAllowance(m, runner), 0, ROWS - 1);
          const leftLoad = defs.filter(d => d.col <= 2).length, rightLoad = defs.filter(d => d.col >= 3).length;
          const goLeft = leftLoad === rightLoad ? Math.random() < 0.5 : leftLoad < rightLoad;
          const tc = goLeft ? Math.max(0, runner.col - 1) : Math.min(COLS - 1, runner.col + 1);
          to = { col: tc, row: tr };
        }
        if (!occ(to.col, to.row, runner.id) && !(to.col === cr.col && to.row === cr.row)) orders[runner.id] = { type: 'move', to };
      }
      if (gk && !orders[gk.id]) {
        const home = team === 0 ? ROWS - 1 : 0;
        const want = { col: cl(cr ? cr.col : 2, 2, 3), row: home };
        if (!occ(want.col, want.row, gk.id)) orders[gk.id] = { type: 'move', to: want };
      }
      return orders;
    }
  }

  if (!attacking && cr) {
    const df = fwdDir(1 - team); // toward our own goal = goal-side of the carrier
    const myDefs = mine.filter(p => p.pos !== 'GK').sort((a, b) => cheb(a, cr) - cheb(b, cr));
    const oppMates = foe.filter(p => p.pos !== 'GK' && p.id !== cr.id);
    const oppRunner = oppMates[0];
    const presser = myDefs[0], marker = myDefs[1];
    const escapes = neigh(cr).filter(s => !occ(s.col, s.row, cr.id) && !myDefs.some(d => d !== presser && cheb(d, s) <= 1)).length;
    const cornered = escapes <= 2 || cr.col <= 0 || cr.col >= COLS - 1;

    if (presser && presser.recover === 0) {
      if (cheb(presser, cr) <= 3 && (cornered || cheb(presser, cr) === 1)) orders[presser.id] = { type: 'winball' };
      else { const goalSide = { col: cr.col, row: cl(cr.row + df, 0, ROWS - 1) }; orders[presser.id] = { type: 'move', to: step(presser, goalSide, moveAllowance(m, presser)) }; }
    }
    if (marker && marker.recover === 0) {
      // double up if the carrier is cornered and the runner is not a threat in behind; else mark the runner
      const runnerThreat = oppRunner && Math.abs(oppRunner.row - goalRow(1 - team)) < Math.abs(cr.row - goalRow(1 - team));
      if (cornered && !runnerThreat && cheb(marker, cr) <= 3) orders[marker.id] = { type: 'winball' };
      else if (oppRunner) { const between = { col: oppRunner.col, row: cl(oppRunner.row + df, 0, ROWS - 1) }; orders[marker.id] = { type: 'move', to: step(marker, between, moveAllowance(m, marker)) }; }
    }
    const gk = mine.find(p => p.pos === 'GK');
    if (gk) { const home = team === 0 ? ROWS - 1 : 0; const want = { col: cl(cr.col, 2, 3), row: home }; if (!occ(want.col, want.row, gk.id)) orders[gk.id] = { type: 'move', to: want }; }
    return orders;
  }
  return orders;

  function neigh(p) { const o = []; for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) { if (!dc && !dr) continue; const c = p.col + dc, r = p.row + dr; if (inb(c, r)) o.push({ col: c, row: r }); } return o; }
  function pickAway(sqs, pr) { return sqs.sort((a, b) => dmin(b, pr) - dmin(a, pr))[0]; }
  function dmin(s, pr) { return Math.min(...pr.map(d => cheb(d, s))); }
}

export function botShoot(m, role, diff) {
  const s = m.players.find(p => p.id === m.pending.shooterId);
  const gk = m.pending.gkId ? m.players.find(p => p.id === m.pending.gkId) : null;
  const onLine = gk && !keeperOut(m, gk.team);
  if (role === 'shooter') {
    if (!onLine) return 'L';                 // keeper off its line: open goal, aim anywhere
    return Math.random() < 0.5 ? 'L' : 'R';  // bluff
  }
  return Math.random() < 0.5 ? 'L' : 'R';    // keeper guesses a side
}
