import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as engine from './lib/engine.js';
import { getProfile, saveProfile, createProfile, backend } from './lib/store.js';
import { rollReward, squadAverage, makeSquadNear } from './lib/players.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PLANNING_MS = Number(process.env.PLANNING_MS || 12000);
const DECISION_MS = Number(process.env.DECISION_MS || 6000);
const GOAL_TARGET = Number(process.env.GOAL_TARGET || 3);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, backend }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // code -> room
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function clearTimers(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }

function broadcast(room, obj) { room.players.forEach(p => send(p.ws, obj)); }

// ---- match lifecycle --------------------------------------------------------
function startMatch(room) {
  const [a, b] = room.players;
  const squadA = (a.profile.squad && a.profile.squad.length === 5) ? a.profile.squad : makeSquadNear(78);
  const squadB = (b.profile.squad && b.profile.squad.length === 5) ? b.profile.squad : makeSquadNear(squadAverage(squadA));
  room.match = engine.createMatch(squadA, squadB);
  room.orders = [null, null];
  room.over = false;
  send(a.ws, { t: 'matchStart', you: 0, snapshot: engine.snapshot(room.match) });
  send(b.ws, { t: 'matchStart', you: 1, snapshot: engine.snapshot(room.match) });
  beginPlanning(room);
}

function beginPlanning(room) {
  clearTimers(room);
  room.orders = [null, null];
  const m = room.match;
  m.phase = 'PLANNING';
  const deadline = Date.now() + PLANNING_MS;
  room.deadline = deadline;
  broadcast(room, { t: 'turn', snapshot: engine.snapshot(m), deadline });
  room.timer = setTimeout(() => doResolve(room), PLANNING_MS + 300);
}

function doResolve(room) {
  clearTimers(room);
  const m = room.match;
  if (m.phase !== 'PLANNING' || room.over) return;
  const { events, pending } = engine.resolveOrders(m, room.orders[0] || {}, room.orders[1] || {});

  if (pending && pending.kind === 'duel') {
    const att = engine.snapshot(m).players.find(p => p.id === pending.attackerId);
    const attTeam = att.team;
    room.duel = [null, null];
    room.players.forEach(p => {
      const role = p.team === attTeam ? 'attacker' : 'defender';
      send(p.ws, { t: 'duel', events, snapshot: engine.snapshot(m), role,
                   attackerId: pending.attackerId, defenderId: pending.defenderId,
                   deadline: Date.now() + DECISION_MS });
    });
    room.timer = setTimeout(() => finishDuel(room), DECISION_MS + 300);
    return;
  }
  if (pending && pending.kind === 'shoot') {
    const sh = engine.snapshot(m).players.find(p => p.id === pending.shooterId);
    const shTeam = sh.team;
    room.shoot = [null, null];
    room.players.forEach(p => {
      const role = p.team === shTeam ? 'shooter' : 'gk';
      send(p.ws, { t: 'shoot', events, snapshot: engine.snapshot(m), role,
                   shooterId: pending.shooterId, gkId: pending.gkId,
                   deadline: Date.now() + DECISION_MS });
    });
    room.timer = setTimeout(() => finishShoot(room), DECISION_MS + 300);
    return;
  }

  broadcast(room, { t: 'resolve', events, snapshot: engine.snapshot(m) });
  afterResolve(room);
}

function finishDuel(room) {
  clearTimers(room);
  const m = room.match;
  if (m.phase !== 'DUEL') return;
  const aDir = room.duel[0] || 'C';
  const dDir = room.duel[1] || 'C';
  const { events } = engine.resolveDuel(m, aDir, dDir);
  broadcast(room, { t: 'resolve', events, snapshot: engine.snapshot(m) });
  afterResolve(room);
}

function finishShoot(room) {
  clearTimers(room);
  const m = room.match;
  if (m.phase !== 'SHOOT') return;
  const placement = room.shoot[0] || 'C';
  const gkDir = room.shoot[1] || 'C';
  const { events } = engine.resolveShoot(m, placement, gkDir);
  broadcast(room, { t: 'resolve', events, snapshot: engine.snapshot(m) });
  afterResolve(room);
}

function afterResolve(room) {
  const m = room.match;
  if (m.score[0] >= GOAL_TARGET || m.score[1] >= GOAL_TARGET) {
    endMatch(room, m.score[0] > m.score[1] ? 0 : 1);
    return;
  }
  // small gap so clients can animate, then next planning
  room.timer = setTimeout(() => beginPlanning(room), 1400);
}

async function endMatch(room, winnerTeam) {
  clearTimers(room);
  room.over = true;
  for (const p of room.players) {
    const won = p.team === winnerTeam;
    let reward = null;
    if (p.profile && p.profile.token) {
      if (won) {
        p.profile.wins = (p.profile.wins || 0) + 1;
        reward = rollReward(squadAverage(p.profile.squad || []));
        p.profile.collection = p.profile.collection || [];
        p.profile.collection.push(reward);
      } else {
        p.profile.losses = (p.profile.losses || 0) + 1;
      }
      try { await saveProfile(p.profile); } catch {}
    }
    send(p.ws, { t: 'matchEnd', winnerTeam, won, reward,
                 score: room.match.score, profile: p.profile });
  }
}

function leaveRoom(ws) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx >= 0) {
      clearTimers(room);
      room.players.forEach(p => { if (p.ws !== ws) send(p.ws, { t: 'oppLeft' }); });
      rooms.delete(code);
      return;
    }
  }
}

// ---- socket handling --------------------------------------------------------
wss.on('connection', (ws) => {
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
          send(ws, { t: 'profile', profile });
          break;
        }
        case 'saveSquad': {
          const profile = await getProfile(String(msg.token || '').trim());
          if (!profile) return send(ws, { t: 'error', msg: 'Unknown code.' });
          if (Array.isArray(msg.squad) && msg.squad.length === 5) {
            profile.squad = msg.squad;
            await saveProfile(profile);
            ws.profile = profile;
          }
          send(ws, { t: 'profile', profile });
          break;
        }
        case 'createRoom': {
          if (!ws.profile) return send(ws, { t: 'error', msg: 'Log in first.' });
          const code = roomCode();
          const room = { code, players: [{ ws, profile: ws.profile, team: 0 }], match: null, timer: null };
          rooms.set(code, room);
          ws.roomCode = code;
          send(ws, { t: 'roomCreated', code });
          break;
        }
        case 'joinRoom': {
          if (!ws.profile) return send(ws, { t: 'error', msg: 'Log in first.' });
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) return send(ws, { t: 'error', msg: 'Room not found.' });
          if (room.players.length >= 2) return send(ws, { t: 'error', msg: 'Room is full.' });
          room.players.push({ ws, profile: ws.profile, team: 1 });
          ws.roomCode = code;
          startMatch(room);
          break;
        }
        case 'orders': {
          const room = rooms.get(ws.roomCode); if (!room || room.over) return;
          const me = room.players.find(p => p.ws === ws); if (!me) return;
          room.orders[me.team] = msg.orders || {};
          if (room.orders[0] && room.orders[1]) doResolve(room);
          break;
        }
        case 'duelDir': {
          const room = rooms.get(ws.roomCode); if (!room) return;
          const me = room.players.find(p => p.ws === ws); if (!me) return;
          const att = room.match.players.find(p => p.id === room.match.pending?.attackerId);
          if (!att) return;
          const slot = me.team === att.team ? 0 : 1;
          room.duel[slot] = msg.dir;
          if (room.duel[0] && room.duel[1]) finishDuel(room);
          break;
        }
        case 'shootSel': {
          const room = rooms.get(ws.roomCode); if (!room) return;
          const me = room.players.find(p => p.ws === ws); if (!me) return;
          const sh = room.match.players.find(p => p.id === room.match.pending?.shooterId);
          if (!sh) return;
          const slot = me.team === sh.team ? 0 : 1;
          room.shoot[slot] = msg.sel;
          if (room.shoot[0] && room.shoot[1]) finishShoot(room);
          break;
        }
        case 'rematch': {
          const room = rooms.get(ws.roomCode);
          if (room && room.players.length === 2) startMatch(room);
          break;
        }
        case 'leave': leaveRoom(ws); break;
      }
    } catch (e) {
      console.error('handler error', e);
      send(ws, { t: 'error', msg: 'Server error.' });
    }
  });
  ws.on('close', () => leaveRoom(ws));
});

server.listen(PORT, () => console.log(`TURF on :${PORT} (store: ${backend})`));
