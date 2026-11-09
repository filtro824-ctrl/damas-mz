// Arranque do servidor DAMAS MZ.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as db from './db.js';
import { CONFIG } from './config.js';
import * as auth from './auth.js';
import * as rt from './realtime.js';
import * as games from './games.js';
import * as lobby from './lobby.js';
import './tournaments.js';
import { acceptUpgrade } from './ws.js';
import { handler } from './http.js';
import { clientIp, rateLimit, secEvent } from './security.js';
import { q } from './db.js';

function wsMessage(conn, raw) {
  const userId = conn.userId;
  if (!rateLimit(`ws:${conn.id}`, 40, 1000)) {
    conn.strikes = (conn.strikes || 0) + 1;
    if (conn.strikes === 1) secEvent(userId, 'ws_rate_limited', {}, conn.ip);
    if (conn.strikes > 5) conn.close(1008);
    return conn.send({ t: 'error', code: 'rate_limited', message: 'Demasiadas mensagens.' });
  }
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.t === 'ping') return conn.send({ t: 'pong', serverNow: Date.now() });
    if (msg.t === 'join') {
      const v = games.joinGame(userId, String(msg.gameId));
      return conn.send({ t: 'game', game: v });
    }
    if (msg.t === 'move') {
      try {
        const r = games.makeMove(userId, String(msg.gameId), { moveId: msg.moveId, ply: msg.ply, path: msg.path }, conn.ip);
        conn.send({ t: 'ack', moveId: msg.moveId, ok: true, duplicate: r.duplicate });
      } catch (e) {
        if (!(e instanceof games.GameError)) throw e;
        conn.send({ t: 'ack', moveId: msg.moveId, ok: false, error: e.code, message: e.message });
        const g = games.loadGame(String(msg.gameId));
        if (g) conn.send({ t: 'game', game: games.view(g, userId) }); // ressincroniza o cliente
      }
    }
  } catch (e) {
    if (e instanceof games.GameError) return conn.send({ t: 'error', code: e.code, message: e.message, gameId: msg.gameId });
    console.error('ws erro:', e);
  }
}

let connSeq = 0;

export async function startServer(opts = {}) {
  Object.assign(CONFIG, opts);
  db.init(CONFIG.dbPath || path.join(CONFIG.dataDir, 'damas.db'));
  const admin = await auth.ensureAdmin();
  if (admin) {
    console.log('────────────────────────────────────────────────────────');
    console.log(' Conta de administrador criada');
    console.log(`   utilizador: ${admin.username}`);
    console.log(`   palavra-passe: ${admin.password}${admin.generated ? '   (gerada — guarde-a e altere-a)' : ''}`);
    console.log('────────────────────────────────────────────────────────');
  }
  const resumed = games.loadLiveGames();
  if (resumed) console.log(`${resumed} partida(s) em curso recuperada(s) da base de dados.`);

  rt.configure({
    graceMs: CONFIG.offlineGraceMs,
    onOnline: (id) => { try { games.userOnline(id); } catch (e) { console.error('onOnline:', e); } },
    onOffline: (id) => { try { lobby.userOffline(id); games.userOffline(id); } catch (e) { console.error('onOffline:', e); } },
  });

  const server = http.createServer(handler);
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    const ip = clientIp(req);
    if (url.pathname !== '/ws') return socket.destroy();
    const reject = (status, text) => { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* inválido */ }
      if (host !== req.headers.host) return reject(403, 'Forbidden');
    }
    if (!rateLimit(`wsup:${ip}`, 120, 60_000)) return reject(429, 'Too Many Requests');
    const user = auth.userFromToken(auth.parseCookies(req.headers.cookie)[auth.COOKIE]);
    if (!user) return reject(401, 'Unauthorized');
    const conn = acceptUpgrade(req, socket);
    if (!conn) return;
    conn.userId = user.id;
    conn.ip = ip;
    conn.id = ++connSeq;
    q.run('UPDATE users SET last_ip=?, last_seen=? WHERE id=?', ip, Date.now(), user.id);
    conn.send({ t: 'hello', serverNow: Date.now(), games: games.activeGameIds(user.id) });
    rt.add(user.id, conn);
    conn.on('message', (raw) => wsMessage(conn, raw));
    conn.on('close', () => rt.remove(user.id, conn));
  });

  const clock = setInterval(() => {
    try { games.tick(); lobby.expireRooms(); lobby.queueTick(); } catch (e) { console.error('tick:', e); }
  }, 1000);
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const c of rt.allConns()) {
      if (now - c.lastPong > 35_000) c.terminate(1001);
      else c.ping();
    }
  }, 10_000);

  await new Promise((resolve) => server.listen(CONFIG.port, CONFIG.host, resolve));
  const port = server.address().port;
  const close = async () => {
    clearInterval(clock);
    clearInterval(heartbeat);
    for (const c of rt.allConns()) c.terminate(1001);
    await new Promise((r) => server.close(r));
    rt.reset();
    games._resetForTests();
    db.close();
  };
  return { server, port, close };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { port } = await startServer();
  console.log(`DAMAS MZ a correr em http://localhost:${port}  (painel administrativo: /admin)`);
  const stop = async () => { console.log('A terminar…'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
