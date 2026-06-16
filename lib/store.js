// Profile store keyed by a short login token.
// Default: JSON file at ./data/profiles.json (fine for local + single dev box).
// If SUPABASE_URL + SUPABASE_SERVICE_KEY are set, uses Supabase REST so data
// survives Render restarts. Table: turf_profiles ( token text primary key, data jsonb ).
// SQL to create it is in README.md.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeStartingSquad } from './players.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const useSupabase = !!(SB_URL && SB_KEY);

// ---- file backend -----------------------------------------------------------
function readFileAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}
function writeFileAll(obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
}

// ---- supabase backend -------------------------------------------------------
async function sbGet(token) {
  const url = `${SB_URL}/rest/v1/turf_profiles?token=eq.${encodeURIComponent(token)}&select=data`;
  const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data || null;
}
async function sbUpsert(token, data) {
  const url = `${SB_URL}/rest/v1/turf_profiles`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([{ token, data }]),
  });
  return r.ok;
}

// ---- public API -------------------------------------------------------------
export async function getProfile(token) {
  if (useSupabase) return await sbGet(token);
  const all = readFileAll();
  return all[token] || null;
}

export async function saveProfile(profile) {
  if (useSupabase) return await sbUpsert(profile.token, profile);
  const all = readFileAll();
  all[profile.token] = profile;
  writeFileAll(all);
  return true;
}

async function tokenExists(token) {
  return !!(await getProfile(token));
}

export async function createProfile() {
  // 3-digit token, retried until free; widens to 4 digits only if exhausted.
  let token = null;
  for (let i = 0; i < 60; i++) {
    const t = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    if (!(await tokenExists(t))) { token = t; break; }
  }
  if (!token) {
    for (let i = 0; i < 200; i++) {
      const t = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!(await tokenExists(t))) { token = t; break; }
    }
  }
  const profile = {
    token,
    squad: makeStartingSquad(),
    collection: [], // unlocked extras beyond the active 5
    wins: 0,
    losses: 0,
    matches: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    packs: 0,
    created: Date.now(),
  };
  await saveProfile(profile);
  return profile;
}

export const backend = useSupabase ? 'supabase' : 'file';
