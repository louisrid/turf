# TURF

Turn-based 5-a-side football for two friends. Both managers set orders for all
their players at the same time, submit, and the server resolves the turn at once.
The game is built around reading the other player: where they will move, which way
they will jink in a 1v1, where they will place a shot. Mobile-web, vertical.

"TURF" is a working title. Rename it freely (the in-game logo is the word `TURF`
in `public/index.html`, and the page title is in the same file).

## What is here

```
server.js            Express static host + WebSocket game server
lib/engine.js        Pure game logic (movement, passing, duels, shots, goals)
lib/players.js       Player roster + squad generation + reward rolls
lib/store.js         Profile persistence (file by default, Supabase optional)
public/index.html    All screens + overlays
public/css/style.css Styling
public/js/sprites.js Procedural 8-bit sprite drawing
public/js/render.js  Pitch rendering + animation
public/js/app.js     Client controller (networking, input, mini-games)
```

No build step. The client is plain `<script>` files, so you can edit any file
directly on GitHub mobile and Render will redeploy.

## Run locally

```
npm install
node server.js
```

Open http://localhost:3000 on two devices (or two browser tabs). On each:
create a team, then one player taps Create room and shares the 4-letter code, the
other taps Join and enters it. The match starts when both are in.

## Deploy on Render

1. Push this repo to GitHub.
2. New > Web Service, point it at the repo.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Deploy.

Render free tier notes: the service sleeps after ~15 minutes idle (first request
after that is slow while it wakes), and the disk is wiped on every restart/deploy.
The default file store therefore loses profiles on Render restarts. For real
persistence, add Supabase below.

## Persistence with Supabase (optional but recommended on Render)

1. Create a Supabase project.
2. In the SQL editor, run:

   ```sql
   create table turf_profiles (
     token text primary key,
     data jsonb
   );
   ```

3. In Render, set two environment variables:
   - `SUPABASE_URL`   = your project URL (e.g. https://xxxx.supabase.co)
   - `SUPABASE_SERVICE_KEY` = the service role key

When both are set the server uses Supabase automatically (no extra npm packages;
it calls the REST API directly). With them blank it uses `./data/profiles.json`.

## Login codes

A new team is given a 3-digit code (e.g. `042`). That code is the login on any
device. It is short on purpose so it is easy to type on a phone. If all 1000
three-digit codes are ever taken, new codes widen to 4 digits automatically.

## Tunable settings

Environment variables (see `.env.example`): `PORT`, `PLANNING_MS`, `DECISION_MS`,
`GOAL_TARGET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

## Rules in brief

- Pitch is 5 columns by 8 rows. Your goal is the bottom edge, theirs is the top.
- Each turn you give every player one order, then submit. Both teams resolve together.
- Ball carrier: Dribble (move with the ball), Pass, or Shoot if close enough.
- Off the ball: Run into space.
- Defending: Move, or Tackle to lunge at a nearby square.
- Player stats set the ranges: PAC = move distance, PAS = pass distance, DEF =
  tackle reach, SHO = shoot distance. DRI and PHY decide close duels.
- When a carrier and a defender meet, it is a 1v1: both secretly pick a direction.
  Different directions and the attacker glides past. Same direction and stats plus
  a bit of luck decide it. Win it cleanly for a skill move; lose it and the ball
  is gone.
- Shooting is the same bluff: the shooter picks a placement, the keeper picks a dive.
- First to `GOAL_TARGET` goals wins. The winner unlocks one new player into their
  collection, which they can then pick into their squad of five.
