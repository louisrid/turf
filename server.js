import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as engine from './lib/engine.js';
import * as bot from './lib/bot.js';
import { getProfile, saveProfile, createProfile, backend } from './lib/store.js';
import { makePack, squadAverage, makeSquadFor } from './lib/players.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PLANNING_MS = Number(process.env.PLANNING_MS || 45000);
const DECISION_MS = Number(process.env.DECISION_MS || 20000);
const GOAL_TARGET = Number(process.env.GOAL_TARGET || 3);
const MAX_TURNS = Number(process.env.MAX_TURNS || 90);
const RESOLVE_GAP_MS = Number(process.env.RESOLVE_GAP_MS || 1500);
const SHOT_GAP_MS = Number(process.env.SHOT_GAP_MS || 2800);
const GRACE_MS = Number(process.env.GRACE_MS || 90000);   // hold a match this long for reconnect

const app = express();
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, lastModified: true, maxAge: 0,
  setHeaders: (res, p) => {
    // never let phones/CDNs serve a stale build of the app shell or assets
    if (/\.(html|js|css)$/.test(p)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));
app.get('/health', (_, res) => res.json({ ok: true, backend }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// heartbeat: terminate sockets that stop responding (e.g. a backgrounded phone tab),
// which fires 'close' -> pauseRoom so the match can be resumed on reconnect.
const HEARTBEAT_MS = 30000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

const rooms = new Map();
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const humans = (room) => room.players;
const broadcast = (room, obj) => room.players.forEach(p => send(p.ws, obj));
function clearTimers(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (rooms.has(c));
  return c;
}
const validSquad = (p) => p && Array.isArray(p.squad) && p.squad.length === 3;

// ---- match lifecycle --------------------------------------------------------
function startMatch(room) {
  const human = room.players[0];
  const squadA = validSquad(human.profile) ? human.profile.squad : makeSquadFor('easy');
  let squadB;
  if (room.bot) squadB = room.bot.squad;
  else { const b = room.players[1]; squadB = validSquad(b.profile) ? b.profile.squad : makeSquadFor('easy'); }
  room.match = engine.createMatch(squadA, squadB);
  room.match.easyBotTeam = (room.bot && room.bot.diff === 'easy') ? room.bot.team : -1;
  // who starts with the ball: easy -> human always; hard -> bot 60% of the time; PvP -> coin flip
  let startTeam = 0;
  if (room.bot) startTeam = room.bot.diff === 'hard' ? (Math.random() < 0.6 ? room.bot.team : 0) : 0;
  else startTeam = Math.random() < 0.5 ? 0 : 1;
  engine.kickoff(room.match, startTeam);
  room.orders = [null, null];
  room.over = false;
  room.planMs = room.bot ? 600000 : PLANNING_MS;   // solo: no clock pressure (no random auto-play on tab-out)
  room.decMs = room.bot ? 120000 : DECISION_MS;   // solo: long shoot window, no surprise auto-pick
  for (const p of room.players)
    send(p.ws, { t: 'matchStart', you: p.team, snapshot: engine.snapshot(room.match),
                 vsBot: !!room.bot, difficulty: room.bot ? room.bot.diff : null, goalTarget: GOAL_TARGET });
  beginPlanning(room);
}

function beginPlanning(room) {
  clearTimers(room);
  room.orders = [null, null];
  const m = room.match;
  m.phase = 'PLANNING';
  const deadline = Date.now() + room.planMs;
  room.deadline = deadline;
  broadcast(room, { t: 'turn', snapshot: engine.snapshot(m), deadline });
  room.timer = setTimeout(() => doResolve(room), room.planMs + 300);   // fallback first, so a bot error can't hang the turn
  if (room.bot) {
    try { room.orders[room.bot.team] = bot.botOrders(m, room.bot.team, room.bot.diff); }
    catch (e) { console.error('botOrders', e); room.orders[room.bot.team] = {}; }
    maybeResolve(room);
  }
}

function maybeResolve(room) { if (room.orders[0] && room.orders[1]) doResolve(room); }

function doResolve(room) {
  clearTimers(room);
  const m = room.match;
  if (m.phase !== 'PLANNING' || room.over || room.paused) return;
  const { events, pending } = engine.resolveOrders(m, room.orders[0] || {}, room.orders[1] || {});

  if (pending && pending.kind === 'shoot') {
    const snap = engine.snapshot(m);
    const sh = snap.players.find(p => p.id === pending.shooterId);
    room.shoot = [null, null];
    room.players.forEach(p => {
      const role = p.team === sh.team ? 'shooter' : 'gk';
      send(p.ws, { t: 'shoot', events, snapshot: snap, role,
                   shooterId: pending.shooterId, gkId: pending.gkId,
                   deadline: Date.now() + room.decMs });
    });
    if (room.bot) {
      const role = room.bot.team === sh.team ? 'shooter' : 'gk';
      try { room.shoot[room.bot.team === sh.team ? 0 : 1] = bot.botShoot(m, role, room.bot.diff); }
      catch (e) { console.error('botShoot', e); room.shoot[room.bot.team === sh.team ? 0 : 1] = Math.random() < 0.5 ? 'L' : 'R'; }
      if (room.shoot[0] && room.shoot[1]) return finishShoot(room);
    }
    room.timer = setTimeout(() => finishShoot(room), room.decMs + 300);
    return;
  }

  broadcast(room, { t: 'resolve', events, snapshot: engine.snapshot(m) });
  afterResolve(room, events);
}

function finishShoot(room) {
  clearTimers(room);
  const m = room.match;
  if (m.phase !== 'SHOOT') return;
  const { events } = engine.resolveShoot(m, room.shoot[0] || 'C', room.shoot[1] || 'C');
  broadcast(room, { t: 'resolve', events, snapshot: engine.snapshot(m) });
  afterResolve(room, events);
}

function afterResolve(room, events) {
  const m = room.match;
  if (m.score[0] >= GOAL_TARGET || m.score[1] >= GOAL_TARGET) {
    endMatch(room, m.score[0] > m.score[1] ? 0 : 1);
    return;
  }
  if (m.turn > MAX_TURNS) {
    endMatch(room, m.score[0] === m.score[1] ? -1 : (m.score[0] > m.score[1] ? 0 : 1));
    return;
  }
  // hold longer after a shot so the result animation can play out
  const shotish = events && events.some(e => e.t === 'shootResult' || e.t === 'goal');
  const gap = shotish ? Math.max(RESOLVE_GAP_MS, SHOT_GAP_MS) : RESOLVE_GAP_MS;
  room.timer = setTimeout(() => beginPlanning(room), gap);
}

async function endMatch(room, winnerTeam) {
  clearTimers(room);
  room.over = true;
  for (const p of room.players) {
    const draw = winnerTeam === -1;
    const won = !draw && p.team === winnerTeam;
    const my = p.team, opp = 1 - p.team;
    let pack = null;
    if (p.profile && p.profile.token) {
      p.profile.matches = (p.profile.matches || 0) + 1;
      p.profile.goalsFor = (p.profile.goalsFor || 0) + room.match.score[my];
      p.profile.goalsAgainst = (p.profile.goalsAgainst || 0) + room.match.score[opp];
      if (won) {
        p.profile.wins = (p.profile.wins || 0) + 1;
        pack = makePack(room.bot ? room.bot.diff : 'hard');
        p.profile.packs = (p.profile.packs || 0) + 1;
        p.profile.collection = (p.profile.collection || []).concat(pack);
      } else if (!draw) {
        p.profile.losses = (p.profile.losses || 0) + 1;
      } else {
        p.profile.draws = (p.profile.draws || 0) + 1;
      }
      try { await saveProfile(p.profile); } catch {}
    }
    send(p.ws, { t: 'matchEnd', winnerTeam, won, draw, pack, score: room.match.score, profile: p.profile, vsBot: !!room.bot });
  }
}

// explicit quit (pressed Leave): forfeit a live match, then drop the room
async function forfeitLeave(ws) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx < 0) continue;
    clearTimers(room); if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
    const leaver = room.players[idx];
    const opp = room.players.find(p => p.ws !== ws);
    if (room.match && !room.over) {
      room.over = true;
      const m = room.match;
      const earlyAbort = (m.turn <= 1 && m.score[0] === 0 && m.score[1] === 0);
      if (earlyAbort) {
        // bailed on the opening move: no loss for the leaver, no forfeit win for anyone
        if (opp && opp.ws) send(opp.ws, { t: 'oppLeft' });
        if (ws.roomCode === code) ws.roomCode = null;
        rooms.delete(code);
        return;
      }
      if (leaver.profile && leaver.profile.token) {
        leaver.profile.matches = (leaver.profile.matches || 0) + 1;
        leaver.profile.losses = (leaver.profile.losses || 0) + 1;
        leaver.profile.goalsFor = (leaver.profile.goalsFor || 0) + m.score[leaver.team];
        leaver.profile.goalsAgainst = (leaver.profile.goalsAgainst || 0) + m.score[1 - leaver.team];
        try { await saveProfile(leaver.profile); } catch {}
        send(leaver.ws, { t: 'profile', profile: leaver.profile });
      }
      if (opp && opp.ws) {
        if (opp.profile && opp.profile.token) {
          opp.profile.matches = (opp.profile.matches || 0) + 1;
          opp.profile.wins = (opp.profile.wins || 0) + 1;
          opp.profile.goalsFor = (opp.profile.goalsFor || 0) + m.score[opp.team];
          opp.profile.goalsAgainst = (opp.profile.goalsAgainst || 0) + m.score[1 - opp.team];
          const pack = makePack('hard');
          opp.profile.packs = (opp.profile.packs || 0) + 1;
          opp.profile.collection = (opp.profile.collection || []).concat(pack);
          try { await saveProfile(opp.profile); } catch {}
          send(opp.ws, { t: 'matchEnd', winnerTeam: opp.team, won: true, draw: false, pack, score: m.score, profile: opp.profile, vsBot: false, byForfeit: true });
        } else send(opp.ws, { t: 'oppLeft' });
      }
    } else if (opp && opp.ws) send(opp.ws, { t: 'oppLeft' });
    if (ws.roomCode === code) ws.roomCode = null;
    rooms.delete(code);
    return;
  }
  ws.roomCode = null;
}

// socket dropped (tab closed / network): pause a live match so it can be resumed
function pauseRoom(ws) {
  for (const [code, room] of rooms) {
    const slot = room.players.find(p => p.ws === ws);
    if (!slot) continue;
    clearTimers(room);
    if (!room.match || room.over) {
      const opp = room.players.find(p => p.ws && p.ws !== ws);
      if (opp) send(opp.ws, { t: 'oppLeft' });
      if (!room.bot && room.players.every(p => !p.ws || p.ws === ws)) rooms.delete(code);
      else if (room.bot) rooms.delete(code);
      return;
    }
    room.paused = true;
    slot.ws = null;                       // keep slot + token for reconnect
    const opp = room.players.find(p => p !== slot && p.ws);
    if (opp) send(opp.ws, { t: 'oppDropped' });
    room.graceTimer = setTimeout(() => expirePause(room, slot), GRACE_MS);
    return;
  }
}

async function expirePause(room, slot) {
  if (!room.paused || room.over) return;
  room.over = true;
  const opp = room.players.find(p => p !== slot && p.ws);
  if (!room.bot && opp && opp.profile && opp.profile.token) {
    const m = room.match;
    opp.profile.matches = (opp.profile.matches || 0) + 1;
    opp.profile.wins = (opp.profile.wins || 0) + 1;
    opp.profile.goalsFor = (opp.profile.goalsFor || 0) + m.score[opp.team];
    opp.profile.goalsAgainst = (opp.profile.goalsAgainst || 0) + m.score[1 - opp.team];
    const pack = makePack('hard');
    opp.profile.packs = (opp.profile.packs || 0) + 1;
    opp.profile.collection = (opp.profile.collection || []).concat(pack);
    try { await saveProfile(opp.profile); } catch {}
    send(opp.ws, { t: 'matchEnd', winnerTeam: opp.team, won: true, draw: false, pack, score: m.score, profile: opp.profile, vsBot: false, byForfeit: true });
  }
  rooms.delete(room.code);
}

// reconnect: if this token owns a paused match, rebind and resume
function resumeRoom(ws) {
  if (!ws.profile || !ws.profile.token) return false;
  for (const [code, room] of rooms) {
    if (!room.paused) continue;
    const slot = room.players.find(p => !p.ws && p.profile && p.profile.token === ws.profile.token);
    if (!slot) continue;
    slot.ws = ws; slot.profile = ws.profile; ws.roomCode = code;
    const allHere = room.bot || room.players.every(p => p.ws);
    if (allHere) {
      room.paused = false;
      if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
      const m = room.match; m.pending = null; m.phase = 'PLANNING';
      send(ws, { t: 'matchStart', you: slot.team, snapshot: engine.snapshot(m), vsBot: !!room.bot, difficulty: room.bot ? room.bot.diff : null, goalTarget: GOAL_TARGET, resumed: true });
      const opp = room.players.find(p => p !== slot && p.ws);
      if (opp) send(opp.ws, { t: 'oppBack' });
      beginPlanning(room);
    } else {
      send(ws, { t: 'matchStart', you: slot.team, snapshot: engine.snapshot(room.match), vsBot: false, goalTarget: GOAL_TARGET, resumed: true });
      send(ws, { t: 'oppDropped' });
    }
    return true;
  }
  return false;
}

// ---- socket handling --------------------------------------------------------
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    try {
      switch (msg.t) {
        case 'newAccount': {
          const profile = await createProfile();
          ws.profile = profile;
          send(ws, { t: 'token', token: profile.token, profile });
          break;
        }
        case 'login': {
          const profile = await getProfile(String(msg.token || '').trim());
          if (!profile) return send(ws, { t: 'error', msg: 'No team found for that code.' });
          ws.profile = profile;
          if (resumeRoom(ws)) return;
          send(ws, { t: 'profile', profile });
          break;
        }
        case 'saveSquad': {
          const profile = await getProfile(String(msg.token || '').trim());
          if (!profile) return send(ws, { t: 'error', msg: 'Unknown code.' });
          if (Array.isArray(msg.squad) && msg.squad.length === 3) {
            profile.squad = msg.squad;
            await saveProfile(profile);
            ws.profile = profile;
          }
          send(ws, { t: 'profile', profile });
          break;
        }
        case 'soloMatch': {
          if (!ws.profile) return send(ws, { t: 'error', msg: 'Log in first.' });
          const diff = msg.difficulty === 'hard' ? 'hard' : 'easy';
          const code = roomCode();
          const room = { code, players: [{ ws, profile: ws.profile, team: 0 }],
                         bot: { team: 1, diff, squad: makeSquadFor(diff) }, match: null, timer: null };
          rooms.set(code, room); ws.roomCode = code;
          startMatch(room);
          break;
        }
        case 'createRoom': {
          if (!ws.profile) return send(ws, { t: 'error', msg: 'Log in first.' });
          const code = roomCode();
          rooms.set(code, { code, players: [{ ws, profile: ws.profile, team: 0 }], match: null, timer: null });
          ws.roomCode = code;
          send(ws, { t: 'roomCreated', code });
          break;
        }
        case 'joinRoom': {
          if (!ws.profile) return send(ws, { t: 'error', msg: 'Log in first.' });
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) return send(ws, { t: 'error', msg: 'Room not found.' });
          if (room.bot || room.players.length >= 2) return send(ws, { t: 'error', msg: 'Room is full.' });
          room.players.push({ ws, profile: ws.profile, team: 1 });
          ws.roomCode = code;
          startMatch(room);
          break;
        }
        case 'orders': {
          const room = rooms.get(ws.roomCode); if (!room || room.over || room.paused) return;
          const me = room.players.find(p => p.ws === ws); if (!me) return;
          room.orders[me.team] = msg.orders || {};
          maybeResolve(room);
          break;
        }
        case 'shootSel': {
          const room = rooms.get(ws.roomCode); if (!room || room.paused) return;
          const me = room.players.find(p => p.ws === ws); if (!me) return;
          const sh = room.match.players.find(p => p.id === room.match.pending?.shooterId);
          if (!sh) return;
          room.shoot[me.team === sh.team ? 0 : 1] = msg.sel;
          if (room.shoot[0] && room.shoot[1]) finishShoot(room);
          break;
        }
        case 'rematch': {
          const room = rooms.get(ws.roomCode);
          if (room && (room.players.length === 2 || room.bot)) startMatch(room);
          break;
        }
        case 'leave': forfeitLeave(ws); break;
      }
    } catch (e) {
      console.error('handler error', e);
      send(ws, { t: 'error', msg: 'Server error.' });
    }
  });
  ws.on('close', () => pauseRoom(ws));
});

server.listen(PORT, () => console.log(`TURF on :${PORT} (store: ${backend})`));
