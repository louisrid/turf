# TURF

A turn-based **3-a-side** football game for mobile web. Both teams plan every player's
move at once, submit blind, and watch them resolve together. You play on a 6x8 grid
with the goals just outside it; you move 3 squares (2 on the ball), short-pass (range 3,
cut only in the lane) or hit a long ball (range 6), and win the ball positionally by
moving onto the carrier's square. Shoot from the last two rows in a 1v1 keeper bluff.
Two stats only: **SHO** (finishing) and **PAS** (long-ball control), each BAD / GOOD /
SUPERB. Play the bots solo or share a code to play a friend. No build step, no image
files: every sprite is drawn in code.

## Play
- **Vs Easy / Hard bot** for a single-player match.
- **Play a friend**: create a room, share your 4-letter code, they join.
- **Squad**: pick a keeper and two outfielders.
- **Collection**: every player you own, with SHO/PAS tiers and rarity.
- **Win a match** to earn a **pack** (one player). Hard bots drop better players.
- **How to play** opens the tutorial any time (it also shows once on first run).

Your team saves automatically on this device (no login needed). To move it to
another device, use the 4-character **code** shown on the home screen via *Use a code*.

## Run locally
```
npm install
npm start
```
Open http://localhost:3000 in two browser tabs/phones to test a friend match.

## Deploy on Render (free)
1. Push these files to a GitHub repo with `server.js` at the **root**.
2. Render → New → **Web Service** → connect the repo.
   - Build command: `npm install`
   - Start command: `node server.js`
   - Instance type: Free
3. Create. Open the onrender.com URL on two phones.

Note: it must be a **Web Service**, not a Static Site (a static site never runs
`server.js`, which gives a "Not Found" / blank page).

## Configuration
All optional, set as environment variables (see `.env.example`):

| Var | Default | What it does |
|-----|---------|--------------|
| `PORT` | 3000 | Render sets this for you |
| `PLANNING_MS` | 45000 | Time to plan each turn. Solo gives 4x. |
| `DECISION_MS` | 20000 | Time for a 1v1 / shot pick. Solo gives 2x. |
| `RESOLVE_GAP_MS` | 1500 | Pause between turns |
| `GOAL_TARGET` | 3 | Goals to win |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | empty | Optional persistence |

### Persistence
By default profiles save to `./data/profiles.json`. Render's free disk wipes on
restart, so for permanent saves create a Supabase table and set the two env vars:
```
turf_profiles ( token text primary key, data jsonb )
```

## Make it yours
- **Name / logo**: the title text in `public/index.html` (the `.brand` elements).
- **Balance**: duel, interception, and shot odds live in `lib/engine.js`.
- **Bot skill**: `lib/bot.js` (easy vs hard behaviour).
- **Players & looks**: `lib/players.js` (roster, stats, sprite looks).
- **Sprites**: `public/js/sprites.js` (all drawn in code, no assets).

## Layout
```
server.js            Express + WebSocket server, rooms, solo bot, packs, records
lib/engine.js        Pure game logic (movement, duels, shots, scoring)
lib/bot.js           Single-player bot (easy / hard)
lib/players.js       Roster, squad building, reward packs, rarity
lib/store.js         Profile storage (file or Supabase)
public/index.html    Screens + overlays
public/css/style.css
public/js/sprites.js  Pixel sprite drawing
public/js/render.js   Pitch canvas renderer
public/js/app.js      Client controller
```
