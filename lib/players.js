// Player roster.
// Ratings are approximate, inspired by FIFA-style values. Not official.
// stats: pac (move range), sho (shooting), pas (pass range), dri (dribble/duel), def (tackle/defend), phy (duel tiebreak)
// pos: GK | DEF | MID | FWD
// look: { skin, hair, hairColor }  -> drives the pixel sprite
//   skin: light | mid | tan | brown | dark
//   hair: short | buzz | afro | curly | ponytail | bald | mohawk | long
//   hairColor: black | brown | blonde | ginger | grey

const P = (name, pos, ovr, pac, sho, pas, dri, def, phy, skin, hair, hairColor) =>
  ({ name, pos, ovr, pac, sho, pas, dri, def, phy, look: { skin, hair, hairColor } });

// ---- STARTER POOL (75 - 84) -------------------------------------------------
export const STARTERS = [
  // GK
  P('A. Becker',     'GK', 84, 52, 28, 70, 60, 86, 84, 'tan',   'short', 'black'),
  P('M. Maignan',    'GK', 83, 55, 25, 68, 58, 85, 85, 'brown', 'buzz',  'black'),
  P('U. Nubel',      'GK', 80, 58, 22, 64, 55, 81, 82, 'light', 'short', 'blonde'),
  P('G. Vicario',    'GK', 81, 54, 24, 66, 57, 82, 81, 'tan',   'short', 'brown'),
  P('B. Verbruggen', 'GK', 78, 56, 20, 62, 54, 79, 80, 'light', 'curly', 'brown'),
  P('D. Raya',       'GK', 82, 56, 26, 71, 60, 83, 80, 'tan',   'short', 'black'),
  P('J. Sels',       'GK', 79, 53, 21, 63, 55, 80, 81, 'light', 'short', 'brown'),
  P('R. Bentley',    'GK', 77, 52, 22, 65, 56, 78, 79, 'light', 'short', 'brown'),
  // DEF
  P('W. Saliba',     'DEF', 84, 79, 40, 68, 70, 85, 84, 'dark',  'short',    'black'),
  P('A. Bastoni',    'DEF', 83, 74, 42, 75, 72, 84, 82, 'light', 'short',    'brown'),
  P('J. Gvardiol',   'DEF', 83, 82, 45, 72, 74, 83, 83, 'light', 'buzz',     'brown'),
  P('M. Acuna',      'DEF', 82, 80, 48, 76, 78, 82, 83, 'tan',   'long',     'black'),
  P('T. Hernandez',  'DEF', 83, 90, 60, 78, 82, 79, 84, 'light', 'short',    'brown'),
  P('R. Dias',       'DEF', 84, 68, 38, 72, 66, 87, 86, 'tan',   'short',    'black'),
  P('I. Konate',     'DEF', 82, 85, 35, 64, 68, 84, 87, 'dark',  'buzz',     'black'),
  P('P. Porro',      'DEF', 80, 84, 62, 78, 80, 76, 75, 'light', 'short',    'brown'),
  P('G. Scalvini',   'DEF', 78, 76, 38, 70, 68, 80, 79, 'light', 'short',    'brown'),
  P('L. Martinez',   'DEF', 79, 72, 36, 71, 70, 81, 78, 'tan',   'short',    'black'),
  P('N. Williams Jr','DEF', 77, 80, 42, 72, 74, 77, 76, 'brown', 'curly',    'black'),
  P('C. Romero',     'DEF', 83, 80, 40, 70, 72, 84, 85, 'tan',   'short',    'brown'),
  P('B. White',      'DEF', 82, 78, 44, 76, 74, 82, 80, 'light', 'short',    'ginger'),
  P('M. de Ligt',    'DEF', 82, 72, 46, 71, 70, 84, 85, 'light', 'short',    'blonde'),
  // MID
  P('B. Saka',       'MID', 84, 86, 80, 82, 86, 60, 72, 'dark',  'short',    'black'),
  P('P. Foden',      'MID', 84, 82, 80, 84, 88, 58, 66, 'light', 'short',    'brown'),
  P('N. Barella',    'MID', 83, 80, 76, 84, 84, 72, 78, 'light', 'short',    'brown'),
  P('B. Guimaraes',  'MID', 83, 70, 72, 86, 82, 80, 80, 'brown', 'curly',    'black'),
  P('Pedri',         'MID', 84, 72, 70, 88, 86, 64, 66, 'light', 'short',    'brown'),
  P('A. Onana',      'MID', 80, 74, 70, 80, 78, 76, 84, 'dark',  'buzz',     'black'),
  P('D. Szoboszlai', 'MID', 82, 80, 78, 82, 82, 66, 78, 'light', 'short',    'brown'),
  P('J. Gusto',      'MID', 78, 84, 60, 78, 78, 74, 72, 'light', 'short',    'brown'),
  P('M. Olise',      'MID', 83, 80, 76, 84, 87, 50, 68, 'brown', 'short',    'black'),
  P('K. Phillips',   'MID', 76, 66, 64, 78, 74, 78, 80, 'light', 'buzz',     'brown'),
  P('E. Fernandez',  'MID', 82, 72, 74, 84, 82, 72, 76, 'light', 'short',    'brown'),
  P('A. Tchouameni', 'MID', 83, 74, 66, 80, 78, 82, 84, 'dark',  'short',    'black'),
  P('Y. Bissouma',   'MID', 79, 76, 60, 78, 80, 80, 82, 'dark',  'short',    'black'),
  // FWD
  P('R. Leao',       'FWD', 84, 92, 82, 78, 87, 38, 78, 'dark',  'short',    'black'),
  P('A. Isak',       'FWD', 84, 86, 86, 74, 84, 40, 78, 'tan',   'short',    'brown'),
  P('V. Gyokeres',   'FWD', 83, 86, 86, 70, 80, 42, 84, 'light', 'short',    'brown'),
  P('N. Jackson',    'FWD', 80, 90, 78, 72, 80, 36, 78, 'dark',  'short',    'black'),
  P('B. Gil',        'FWD', 77, 84, 74, 80, 82, 34, 60, 'light', 'short',    'brown'),
  P('J. David',      'FWD', 82, 84, 84, 76, 80, 40, 72, 'brown', 'short',    'black'),
  P('L. Openda',     'FWD', 81, 92, 80, 70, 80, 34, 70, 'dark',  'buzz',     'black'),
  P('S. Gnabry',     'FWD', 82, 86, 82, 78, 82, 44, 72, 'dark',  'short',    'black'),
  P('M. Cunha',      'FWD', 80, 82, 80, 80, 84, 42, 74, 'tan',   'curly',    'black'),
  P('C. Nkunku',     'FWD', 83, 82, 83, 82, 86, 40, 70, 'dark',  'short',    'black'),
];

// ---- REWARD POOL (85 - 99) --------------------------------------------------
export const REWARDS = [
  P('E. Haaland',    'FWD', 91, 89, 94, 70, 80, 45, 88, 'light', 'short',    'blonde'),
  P('K. Mbappe',     'FWD', 91, 97, 90, 80, 92, 36, 78, 'tan',   'short',    'black'),
  P('Vinicius Jr',   'FWD', 90, 95, 86, 78, 94, 30, 70, 'brown', 'short',    'black'),
  P('H. Kane',       'FWD', 90, 75, 93, 84, 84, 48, 84, 'light', 'short',    'brown'),
  P('L. Yamal',      'FWD', 89, 90, 84, 82, 95, 32, 60, 'tan',   'short',    'black'),
  P('Raphinha',      'FWD', 88, 88, 86, 82, 88, 44, 70, 'tan',   'curly',    'black'),
  P('O. Dembele',    'FWD', 89, 92, 84, 80, 92, 38, 66, 'brown', 'afro',     'black'),
  P('Mohamed Salah', 'FWD', 89, 90, 90, 78, 89, 45, 75, 'tan',   'curly',    'black'),
  P('K. De Bruyne',  'MID', 88, 72, 88, 94, 86, 64, 78, 'light', 'short',    'ginger'),
  P('J. Bellingham', 'MID', 90, 80, 86, 90, 88, 78, 84, 'light', 'short',    'brown'),
  P('Rodri',         'MID', 90, 75, 78, 90, 84, 86, 84, 'light', 'short',    'brown'),
  P('Vitinha',       'MID', 87, 76, 76, 90, 87, 70, 70, 'light', 'short',    'brown'),
  P('F. Wirtz',      'MID', 88, 80, 82, 91, 90, 56, 66, 'light', 'short',    'brown'),
  P('Bruno F.',      'MID', 88, 76, 90, 90, 84, 66, 76, 'light', 'short',    'brown'),
  P('Toni Kroos',    'MID', 87, 54, 80, 93, 80, 72, 70, 'light', 'short',    'blonde'),
  P('A. Davies',     'DEF', 86, 96, 60, 78, 84, 80, 80, 'brown', 'short',    'black'),
  P('Marquinhos',    'DEF', 87, 80, 40, 76, 74, 88, 84, 'tan',   'short',    'black'),
  P('V. van Dijk',   'DEF', 88, 78, 60, 74, 72, 90, 92, 'light', 'short',    'brown'),
  P('A. Hakimi',     'DEF', 87, 95, 68, 82, 86, 78, 80, 'tan',   'short',    'black'),
  P('Eder Militao',  'DEF', 86, 86, 45, 70, 72, 87, 88, 'brown', 'short',    'black'),
  P('G. Donnarumma', 'GK', 89, 56, 30, 74, 62, 90, 90, 'light', 'short',     'black'),
  P('Ederson',       'GK', 88, 60, 40, 86, 70, 88, 84, 'tan',   'short',     'brown'),
  P('T. Courtois',   'GK', 89, 52, 26, 72, 60, 91, 92, 'light', 'short',     'ginger'),
  P('Y. Bounou',     'GK', 86, 54, 24, 70, 58, 88, 87, 'tan',   'curly',     'black'),
  P('J. Oblak',      'GK', 89, 53, 25, 70, 60, 92, 88, 'light', 'short',     'brown'),
  P('L. Messi',      'FWD', 90, 80, 89, 94, 96, 36, 64, 'tan',   'short',    'brown'),
  P('Neymar Jr',     'FWD', 88, 86, 82, 86, 95, 34, 60, 'tan',   'curly',    'brown'),
  P('Lamine T.',     'FWD', 86, 90, 80, 80, 90, 32, 58, 'dark',  'afro',     'black'),
];

let SEQ = 0;
const clone = (p) => ({ id: 'p' + (++SEQ), ...p, look: { ...p.look } });

const pickN = (arr, n, filterFn) => {
  const pool = (filterFn ? arr.filter(filterFn) : arr).slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
};

// New token gets: 1 GK + 1 DEF + 2 MID + 1 FWD, all from the 75-84 pool.
export function makeStartingSquad() {
  const gk = pickN(STARTERS, 1, p => p.pos === 'GK')[0];
  const def = pickN(STARTERS, 1, p => p.pos === 'DEF')[0];
  const mid = pickN(STARTERS, 2, p => p.pos === 'MID');
  const fwd = pickN(STARTERS, 1, p => p.pos === 'FWD')[0];
  return [gk, def, ...mid, fwd].map(clone);
}

// Reward roll. Always above the squad average, climbing toward 99.
export function rollReward(squadAvg) {
  const floor = Math.min(94, Math.max(85, Math.round(squadAvg) + 2));
  const pool = REWARDS.filter(p => p.ovr >= floor);
  const src = (pool.length ? pool : REWARDS).slice();
  // weight slightly toward the lower-rated of the eligible so it climbs, not jumps
  src.sort((a, b) => a.ovr - b.ovr);
  const idx = Math.floor(Math.pow(Math.random(), 1.4) * src.length);
  return clone(src[idx]);
}

export function squadAverage(players) {
  if (!players.length) return 78;
  return players.reduce((s, p) => s + p.ovr, 0) / players.length;
}

// Build an opponent squad near a target average (used if a friend has no team yet).
export function makeSquadNear(targetAvg) {
  const all = [...STARTERS, ...REWARDS];
  const near = (pos) => {
    const c = all.filter(p => p.pos === pos)
      .sort((a, b) => Math.abs(a.ovr - targetAvg) - Math.abs(b.ovr - targetAvg));
    return c[Math.floor(Math.random() * Math.min(4, c.length))];
  };
  return [near('GK'), near('DEF'), near('MID'), near('MID'), near('FWD')].map(clone);
}
