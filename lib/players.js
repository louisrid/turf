// Player roster. All names are fictional. Looks are derived deterministically
// from each name, so a given player always renders the same way.

const SKINS = ['pale', 'light', 'mid', 'olive', 'tan', 'brown', 'dark', 'deep'];
const HAIRCOLORS = ['black', 'brown', 'auburn', 'blonde', 'ginger', 'grey', 'platinum'];
const HAIRSTYLES = ['short', 'buzz', 'fade', 'spiky', 'curly', 'afro', 'cornrows', 'manbun', 'ponytail', 'long'];

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };

function lookFor(name, pos) {
  const h = hash(name);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRSTYLES[(Math.floor(h / 8)) % HAIRSTYLES.length],
    hairColor: HAIRCOLORS[(Math.floor(h / 64)) % HAIRCOLORS.length],
    beard: pos !== 'GK' && (Math.floor(h / 512) % 100) < 36,
  };
}

// SHO is the only stat that matters. Everything else is flat. A player's
// overall is essentially their shooting (keepers rate low, they don't shoot).
const SHO_BIAS = { GK: -24, DEF: -6, MID: 0, FWD: 6 };
const clamp = (v) => Math.max(40, Math.min(99, Math.round(v)));
function statsFor(name, pos, ovr) {
  const h = hash(name + pos);
  const jit = ((Math.floor(h / 8) % 7) - 3); // -3..+3 deterministic
  const sho = clamp(ovr + (SHO_BIAS[pos] || 0) + jit);
  return { sho, pac: 72, pas: 72, dri: 72, def: 72, phy: 72 };
}

const P = (name, pos, ovr) => ({ name, pos, ovr, ...statsFor(name, pos, ovr), look: lookFor(name, pos) });

const STARTERS = [
  // GK
  P('A. Voss', 'GK', 78), P('T. Marek', 'GK', 76), P('R. Calden', 'GK', 80),
  P('M. Okafor', 'GK', 79), P('L. Brandt', 'GK', 75), P('S. Petrov', 'GK', 82),
  // DEF
  P('D. Renn', 'DEF', 80), P('K. Mboto', 'DEF', 82), P('J. Hale', 'DEF', 78),
  P('P. Sorensen', 'DEF', 79), P('N. Vidal', 'DEF', 81), P('C. Ferro', 'DEF', 77),
  P('B. Aoki', 'DEF', 76), P('G. Mensah', 'DEF', 83), P('E. Kovac', 'DEF', 75),
  P('F. Duarte', 'DEF', 80),
  // MID
  P('M. Castor', 'MID', 81), P('Y. Demir', 'MID', 80), P('O. Lindqvist', 'MID', 79),
  P('R. Salgado', 'MID', 82), P('T. Nakamura', 'MID', 78), P('H. Bauer', 'MID', 77),
  P('Z. Toure', 'MID', 83), P('V. Romano', 'MID', 80), P('A. Pires', 'MID', 76),
  P('L. Haddad', 'MID', 79), P('S. Novak', 'MID', 75), P('D. Ellis', 'MID', 81),
  // FWD
  P('J. Marsh', 'FWD', 82), P('C. Adeyemi', 'FWD', 83), P('R. Falk', 'FWD', 80),
  P('M. Bianchi', 'FWD', 81), P('K. Osei', 'FWD', 79), P('T. Volkov', 'FWD', 78),
  P('E. Santos', 'FWD', 84), P('N. Beckford', 'FWD', 77), P('L. Moreau', 'FWD', 80),
  P('D. Park', 'FWD', 76),
];

const REWARDS = [
  // GK
  P('V. Stahl', 'GK', 88), P('R. Iversen', 'GK', 90), P('M. Da Costa', 'GK', 86), P('A. Kingsley', 'GK', 92),
  // DEF
  P('K. Steiner', 'DEF', 89), P('J. Almeida', 'DEF', 91), P('D. Vukovic', 'DEF', 87),
  P('P. Laurent', 'DEF', 93), P('N. Yilmaz', 'DEF', 88), P('B. Carver', 'DEF', 90),
  P('G. Rossi', 'DEF', 86), P('F. Nwosu', 'DEF', 94),
  // MID
  P('M. Halvorsen', 'MID', 90), P('Z. Eriksson', 'MID', 92), P('R. Castellano', 'MID', 89),
  P('Y. Kaba', 'MID', 94), P('T. Sato', 'MID', 88), P('V. Petrenko', 'MID', 91),
  P('L. Beaumont', 'MID', 96), P('D. Marchetti', 'MID', 90),
  // FWD
  P('C. Varga', 'FWD', 91), P('J. Okonkwo', 'FWD', 93), P('R. Lindholm', 'FWD', 89),
  P('M. Solano', 'FWD', 95), P('K. Adebayo', 'FWD', 97), P('E. Ricci', 'FWD', 90),
  P('N. Falkner', 'FWD', 92), P('L. Mendoza', 'FWD', 99),
];

let SEQ = 0;
const clone = (p) => ({ id: 'p' + (++SEQ), ...p, look: { ...p.look } });

export function rarity(ovr) {
  if (ovr >= 92) return 'icon';
  if (ovr >= 89) return 'gold';
  if (ovr >= 86) return 'silver';
  return 'bronze';
}

const pickN = (arr, n, filterFn) => {
  const pool = (filterFn ? arr.filter(filterFn) : arr).slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
};

// New team: 1 GK + 2 outfield (a defender and a forward), from the 74-84 pool.
export function makeStartingSquad() {
  const gk = pickN(STARTERS, 1, p => p.pos === 'GK')[0];
  const def = pickN(STARTERS, 1, p => p.pos === 'DEF')[0];
  const fwd = pickN(STARTERS, 1, p => p.pos === 'FWD')[0];
  return [gk, def, fwd].map(clone);
}

// Reward roll. Always above the squad average, climbing toward 99.
export function rollReward(squadAvg) {
  const floor = Math.min(94, Math.max(85, Math.round(squadAvg) + 2));
  const pool = REWARDS.filter(p => p.ovr >= floor);
  const src = (pool.length ? pool : REWARDS).slice().sort((a, b) => a.ovr - b.ovr);
  const idx = Math.floor(Math.pow(Math.random(), 1.4) * src.length);
  return clone(src[idx]);
}

// A win pack: 3 players, the last one a guaranteed higher tier.
export function makePack(squadAvg) {
  const a = rollReward(squadAvg);
  const b = rollReward(squadAvg);
  const topFloor = Math.min(99, Math.max(88, Math.round(squadAvg) + 5));
  const topPool = REWARDS.filter(p => p.ovr >= topFloor);
  const src = (topPool.length ? topPool : REWARDS).slice().sort((x, y) => x.ovr - y.ovr);
  const c = clone(src[Math.floor(Math.pow(Math.random(), 1.2) * src.length)]);
  return [a, b, c];
}

export function squadAverage(players) {
  if (!players.length) return 78;
  return players.reduce((s, p) => s + p.ovr, 0) / players.length;
}

// Opponent squad near a target average (1 GK + a defender + a forward).
export function makeSquadNear(targetAvg) {
  const all = [...STARTERS, ...REWARDS];
  const near = (pos) => {
    const c = all.filter(p => p.pos === pos)
      .sort((a, b) => Math.abs(a.ovr - targetAvg) - Math.abs(b.ovr - targetAvg));
    return c[Math.floor(Math.random() * Math.min(3, c.length))];
  };
  return [near('GK'), near('DEF'), near('FWD')].map(clone);
}
