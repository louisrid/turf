// Players. Two stats only: SHO (finishing) and PAS (long-ball control).
// Each stat is a tier: BAD / GOOD / SUPERB. Looks derive from the name.

const SKINS = ['pale', 'light', 'mid', 'olive', 'tan', 'brown', 'dark', 'deep'];
const HAIRCOLORS = ['black', 'brown', 'auburn', 'blonde', 'ginger', 'grey', 'platinum'];
const HAIRSTYLES = ['short', 'buzz', 'fade', 'spiky', 'curly', 'afro', 'cornrows', 'manbun', 'ponytail', 'long'];
const FIRST = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'Y', 'Z'];
const SUR = ['Voss', 'Marek', 'Calden', 'Okafor', 'Brandt', 'Petrov', 'Renn', 'Mboto', 'Hale', 'Sorensen', 'Vidal', 'Ferro', 'Aoki', 'Mensah', 'Kovac', 'Duarte', 'Castor', 'Demir', 'Lindqvist', 'Salgado', 'Nakamura', 'Bauer', 'Toure', 'Romano', 'Pires', 'Haddad', 'Novak', 'Ellis', 'Marsh', 'Adeyemi', 'Falk', 'Bianchi', 'Osei', 'Volkov', 'Santos', 'Beckford', 'Moreau', 'Park', 'Stahl', 'Iversen', 'Da Costa', 'Kingsley', 'Steiner', 'Almeida', 'Vukovic', 'Laurent', 'Yilmaz', 'Carver', 'Rossi', 'Nwosu', 'Halvorsen', 'Eriksson', 'Kaba', 'Sato', 'Petrenko', 'Beaumont', 'Varga', 'Okonkwo', 'Solano', 'Adebayo', 'Ricci', 'Falkner', 'Mendoza'];

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };
function lookFor(name) {
  const h = hash(name);
  return { skin: SKINS[h % SKINS.length], hair: HAIRSTYLES[(Math.floor(h / 8)) % HAIRSTYLES.length], hairColor: HAIRCOLORS[(Math.floor(h / 64)) % HAIRCOLORS.length], beard: (Math.floor(h / 512) % 3 === 0) };
}
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const randName = () => `${rand(FIRST)}. ${rand(SUR)}`;

// tier values
export const TIER = { BAD: 72, GOOD: 82, SUPERB: 92 };
export function tierLabel(v) { return v >= 88 ? 'SUPERB' : v >= 78 ? 'GOOD' : 'BAD'; }

// per-stat tier draw distributions: [tier, probability]
const DIST = {
  easyPack: [['BAD', 0.45], ['GOOD', 0.40], ['SUPERB', 0.15]],
  hardPack: [['BAD', 0.10], ['GOOD', 0.45], ['SUPERB', 0.45]],
  easyBot: [['BAD', 0.55], ['GOOD', 0.40], ['SUPERB', 0.05]],
  hardBot: [['BAD', 0.05], ['GOOD', 0.45], ['SUPERB', 0.50]],
};
function drawTier(dist) { const r = Math.random(); let acc = 0; for (const [t, p] of dist) { acc += p; if (r < acc) return TIER[t]; } return TIER.BAD; }

let SEQ = 0;
function makePlayer(pos, sho, pas) {
  const name = randName();
  return { id: 'p' + (++SEQ), name, pos, sho, pas, ovr: Math.round((sho + pas) / 2), look: lookFor(name + pos) };
}
function makeFromDist(pos, dist) { return makePlayer(pos, drawTier(dist), drawTier(dist)); }

export function rarity(ovr) { return ovr >= 92 ? 'legendary' : ovr >= 87 ? 'elite' : ovr >= 82 ? 'rare' : ovr >= 77 ? 'uncommon' : 'common'; }
export const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', elite: 'Elite', legendary: 'Legendary' };
export function squadAverage(players) { return players.length ? players.reduce((s, p) => s + p.ovr, 0) / players.length : 72; }

// New team: GK + two outfield, all BAD in both stats.
export function makeStartingSquad() {
  return [makePlayer('GK', TIER.BAD, TIER.BAD), makePlayer('DEF', TIER.BAD, TIER.BAD), makePlayer('FWD', TIER.BAD, TIER.BAD)];
}

// Bot squad scaled by difficulty.
export function makeSquadFor(diff) {
  const d = diff === 'hard' ? DIST.hardBot : DIST.easyBot;
  return [makeFromDist('GK', d), makeFromDist('DEF', d), makeFromDist('FWD', d)];
}
export const makeSquadNear = () => makeStartingSquad();   // legacy fallback

// Win reward: ONE player, tiers weighted by difficulty.
export function makePack(diff) {
  const d = diff === 'hard' ? DIST.hardPack : DIST.easyPack;
  const pos = Math.random() < 0.12 ? 'GK' : rand(['DEF', 'MID', 'FWD']);
  return [makeFromDist(pos, d)];
}
export function rollReward(diff) { return makePack(diff)[0]; }
