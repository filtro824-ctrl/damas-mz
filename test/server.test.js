// Testes de integração do servidor: HTTP + WebSocket reais, base de dados SQLite em memória.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import * as games from '../server/games.js';
import * as lobby from '../server/lobby.js';
import { q } from '../server/db.js';
import { CONFIG } from '../server/config.js';

let srv;
let base;
let n = 0;

// ---------------------------------------------------------------- utilitários
async function http(method, url, body, cookie) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binário */ }
  return { status: res.status, json, res };
}

async function newUser(name) {
  const username = `${name}${++n}`;
  const r = await http('POST', '/api/auth/register', { username, password: 'senhaSegura1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cookie = r.res.headers.get('set-cookie').split(';')[0];
  return { username, cookie, id: r.json.user.id, recoveryCode: r.json.recoveryCode };
}

function connect(user) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie: user.cookie } });
  const c = { ws, msgs: [], waiters: [] };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    c.msgs.push(m);
    for (const w of [...c.waiters]) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); }
  });
  c.open = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('ws erro'))); });
  c.waitFor = (pred, ms = 3000) => {
    const hit = c.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      c.waiters.push(w);
      setTimeout(() => { c.waiters.splice(c.waiters.indexOf(w), 1); reject(new Error('timeout à espera de mensagem')); }, ms);
    });
  };
  c.send = (o) => ws.send(JSON.stringify(o));
  c.last = (t) => [...c.msgs].reverse().find((m) => m.t === t);
  c.clear = () => { c.msgs.length = 0; };
  c.close = () => ws.close();
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let moveSeq = 0;
const mv = (gameId, ply, path) => ({ t: 'move', gameId, moveId: `mv-${++moveSeq}-${Date.now()}`, ply, path });

/** Cria uma partida entre dois utilizadores, ambos ligados e dentro da tela, e devolve tudo. */
async function startGame(category = 'bronze') {
  const a = await newUser('ana');
  const b = await newUser('bruno');
  const room = await http('POST', '/api/rooms', { category, waitSeconds: 30 }, a.cookie);
  assert.equal(room.status, 200, JSON.stringify(room.json));
  const ca = connect(a);
  const cb = connect(b);
  await Promise.all([ca.open, cb.open]);
  const join = await http('POST', `/api/rooms/${room.json.room.id}/join`, null, b.cookie);
  assert.equal(join.status, 200, JSON.stringify(join.json));
  const gameId = join.json.gameId;
  ca.send({ t: 'join', gameId });
  cb.send({ t: 'join', gameId });
  const ga = await ca.waitFor((m) => m.t === 'game' && m.game.status === 'active');
  const gb = await cb.waitFor((m) => m.t === 'game' && m.game.status === 'active');
  const white = ga.game.you === 'w' ? { u: a, c: ca } : { u: b, c: cb };
  const black = ga.game.you === 'w' ? { u: b, c: cb } : { u: a, c: ca };
  return { a, b, ca, cb, gameId, white, black, ga: ga.game, gb: gb.game };
}

before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', adminPassword: 'admin-teste-123', offlineGraceMs: 60, registerPerHour: 10000 });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => { await srv.close(); });

// ---------------------------------------------------------------- contas e segurança básica
test('registo devolve identificador único, código de recuperação e pontos demonstrativos', async () => {
  const u = await newUser('conta');
  assert.match(u.id, /^DM\d{6}$/);
  assert.match(u.recoveryCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const me = await http('GET', '/api/me', null, u.cookie);
  assert.equal(me.json.balance, CONFIG.startingPoints);
  const dup = await http('POST', '/api/auth/register', { username: u.username.toUpperCase(), password: 'senhaSegura1' });
  assert.equal(dup.status, 409);
});

test('rotas protegidas exigem sessão; palavra-passe fraca é recusada', async () => {
  assert.equal((await http('GET', '/api/me')).status, 401);
  assert.equal((await http('GET', '/api/rooms')).status, 401);
  assert.equal((await http('POST', '/api/auth/register', { username: 'fraca1', password: '123' })).status, 400);
});

test('login errado é limitado após 5 tentativas (sem revelar se o utilizador existe)', async () => {
  const u = await newUser('lim');
  for (let i = 0; i < 5; i++) assert.equal((await http('POST', '/api/auth/login', { username: u.username, password: 'errada-errada' })).status, 401);
  assert.equal((await http('POST', '/api/auth/login', { username: u.username, password: 'senhaSegura1' })).status, 429);
});

test('recuperação de acesso com o código de recuperação', async () => {
  const u = await newUser('rec');
  const bad = await http('POST', '/api/auth/recover', { username: u.username, recoveryCode: 'AAAA-AAAA-AAAA-AAAA', newPassword: 'novaSenha123' });
  assert.equal(bad.status, 401);
  const ok = await http('POST', '/api/auth/recover', { username: u.username, recoveryCode: u.recoveryCode, newPassword: 'novaSenha123' });
  assert.equal(ok.status, 200);
  assert.notEqual(ok.json.recoveryCode, u.recoveryCode); // o código é renovado
  assert.equal((await http('GET', '/api/me', null, u.cookie)).status, 401); // sessões antigas terminadas
  assert.equal((await http('POST', '/api/auth/login', { username: u.username, password: 'novaSenha123' })).status, 200);
});

test('cabeçalhos de segurança e recusa de origem estranha em pedidos que alteram dados', async () => {
  const r = await http('GET', '/api/config');
  assert.equal(r.res.headers.get('x-frame-options'), 'DENY');
  assert.match(r.res.headers.get('content-security-policy'), /script-src 'self'/);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('utilizador comum não acede ao painel administrativo', async () => {
  const u = await newUser('comum');
  assert.equal((await http('GET', '/api/admin/dashboard', null, u.cookie)).status, 403);
  const ev = q.get("SELECT COUNT(*) n FROM security_events WHERE kind='forbidden_admin_access'").n;
  assert.ok(ev >= 1);
});

// ---------------------------------------------------------------- salas
test('sala: só 20 ou 30 s; categorias com valores demonstrativos; lista mostra criador, categoria, valor, estado e espera', async () => {
  const a = await newUser('sala');
  assert.equal((await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 45 }, a.cookie)).status, 400);
  assert.equal((await http('POST', '/api/rooms', { category: 'platina', waitSeconds: 20 }, a.cookie)).status, 400);
  const cfg = (await http('GET', '/api/config')).json;
  assert.deepEqual(cfg.categories.map((c) => [c.name, c.entry]), [['Bronze', 100], ['Prata', 250], ['Ouro', 500], ['Diamante', 1000]]);
  assert.deepEqual(cfg.waits, [20, 30]);
  const r = await http('POST', '/api/rooms', { category: 'prata', waitSeconds: 20 }, a.cookie);
  assert.equal(r.status, 200);
  const list = (await http('GET', '/api/rooms', null, a.cookie)).json.items.find((x) => x.id === r.json.room.id);
  assert.equal(list.creator.username, a.username);
  assert.equal(list.category, 'prata');
  assert.equal(list.entry, 250);
  assert.equal(list.status, 'open');
  assert.ok(list.remainingMs > 0 && list.remainingMs <= 20000);
});

test('sala: o tempo é do servidor — ao expirar fecha sozinha e o criador é notificado', async () => {
  const a = await newUser('exp');
  const ca = connect(a);
  await ca.open;
  const r = (await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 20 }, a.cookie)).json.room;
  q.run('UPDATE rooms SET expires_at=? WHERE id=?', Date.now() - 1, r.id); // simula o fim dos 20 s
  const b = await newUser('tarde');
  const late = await http('POST', `/api/rooms/${r.id}/join`, null, b.cookie);
  assert.equal(late.status, 409); // já não aceita, mesmo antes de o relógio de 1 s correr
  lobby.expireRooms();
  assert.equal(q.get('SELECT status FROM rooms WHERE id=?', r.id).status, 'expired');
  const note = await ca.waitFor((m) => m.t === 'notice' && m.kind === 'room_expired');
  assert.match(note.text, /ninguém entrou/);
  ca.close();
});

test('sala: dois jogadores a entrar ao mesmo tempo — só um ocupa a vaga', async () => {
  const owner = await newUser('dono');
  const b = await newUser('ra');
  const c = await newUser('rb');
  const room = (await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 30 }, owner.cookie)).json.room;
  const [r1, r2] = await Promise.all([
    http('POST', `/api/rooms/${room.id}/join`, null, b.cookie),
    http('POST', `/api/rooms/${room.id}/join`, null, c.cookie),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(q.get('SELECT COUNT(*) n FROM games WHERE id IN (SELECT game_id FROM rooms WHERE id=?)', room.id).n, 1);
  assert.equal((await http('POST', `/api/rooms/${room.id}/join`, null, owner.cookie)).status, 400); // o dono não entra na própria sala
});

test('sala: 20 pedidos simultâneos, exactamente uma partida', async () => {
  const owner = await newUser('dono20');
  const room = (await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 30 }, owner.cookie)).json.room;
  const users = [];
  for (let i = 0; i < 8; i++) users.push(await newUser('multi'));
  const rs = await Promise.all(users.flatMap((u) => [0, 1, 2].map(() => http('POST', `/api/rooms/${room.id}/join`, null, u.cookie))));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.ok(rs.every((r) => r.status === 200 || r.status === 409));
});

test('pontos demonstrativos insuficientes impedem criar sala', async () => {
  const a = await newUser('pobre');
  q.run("INSERT INTO ledger(user_id,kind,amount,created_at) VALUES((SELECT id FROM users WHERE public_id=?),'TESTE',-4950,?)", a.id, Date.now());
  const r = await http('POST', '/api/rooms', { category: 'ouro', waitSeconds: 20 }, a.cookie);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'insufficient_points');
});

// ---------------------------------------------------------------- matchmaking
test('matchmaking automático: dois jogadores da mesma categoria são emparelhados e recebem a partida pronta', async () => {
  const a = await newUser('mm');
  const b = await newUser('mm');
  const ca = connect(a);
  const cb = connect(b);
  await Promise.all([ca.open, cb.open]);
  const first = await http('POST', '/api/queue', { category: 'prata' }, a.cookie);
  assert.equal(first.json.matched, false);
  assert.equal((await http('GET', '/api/queue', null, a.cookie)).json.searching, true);
  const second = await http('POST', '/api/queue', { category: 'prata' }, b.cookie);
  assert.equal(second.json.matched, true);
  const m = await ca.waitFor((x) => x.t === 'match');
  assert.equal(m.gameId, second.json.gameId);
  await cb.waitFor((x) => x.t === 'match');
  ca.close(); cb.close();
});

test('matchmaking: categorias diferentes não são emparelhadas; sair da fila funciona', async () => {
  const a = await newUser('mmx');
  const b = await newUser('mmy');
  const ca = connect(a);
  const cb = connect(b);
  await Promise.all([ca.open, cb.open]);
  await http('POST', '/api/queue', { category: 'ouro' }, a.cookie);
  const r = await http('POST', '/api/queue', { category: 'bronze' }, b.cookie);
  assert.equal(r.json.matched, false);
  await http('DELETE', '/api/queue', null, a.cookie);
  assert.equal((await http('GET', '/api/queue', null, a.cookie)).json.searching, false);
  await http('DELETE', '/api/queue', null, b.cookie);
  ca.close(); cb.close();
});

// ---------------------------------------------------------------- partida: cores e controlo exclusivo
test('o servidor atribui cores; a partida só começa quando os dois entram; as brancas jogam primeiro', async () => {
  const g = await startGame();
  assert.deepEqual([g.ga.you, g.gb.you].sort(), ['b', 'w']);
  assert.equal(g.ga.turn, 'w');
  assert.equal(g.ga.board.slice(1, 13).every((v) => v === 1), true);
  assert.equal(g.ga.legal.length > 0 || g.gb.legal.length > 0, true);
  // só quem tem a vez recebe os lances legais
  assert.equal(g.white.c.last('game').game.legal.length, 7);
  assert.equal(g.black.c.last('game').game.legal.length, 0);
});

test('jogador sem a vez e jogador da cor errada são recusados e ficam registados', async () => {
  const g = await startGame();
  const before = q.get("SELECT COUNT(*) n FROM security_events WHERE kind='move_out_of_turn'").n;
  g.black.c.send(mv(g.gameId, 0, [21, 17])); // negras a tentar jogar na vez das brancas
  const ack = await g.black.c.waitFor((m) => m.t === 'ack' && !m.ok);
  assert.equal(ack.error, 'not_your_turn');
  assert.ok(q.get("SELECT COUNT(*) n FROM security_events WHERE kind='move_out_of_turn'").n > before);
  // as brancas tentam mover uma peça negra
  g.white.c.send(mv(g.gameId, 0, [21, 17]));
  const ack2 = await g.white.c.waitFor((m) => m.t === 'ack' && !m.ok);
  assert.equal(ack2.error, 'illegal_move');
  assert.equal(q.get('SELECT ply FROM games WHERE id=?', g.gameId).ply, 0);
});

test('um terceiro (não jogador) não pode jogar nem ver a partida', async () => {
  const g = await startGame();
  const intruder = await newUser('intruso');
  const ci = connect(intruder);
  await ci.open;
  ci.send(mv(g.gameId, 0, [9, 13]));
  const ack = await ci.waitFor((m) => (m.t === 'ack' && !m.ok) || m.t === 'error');
  assert.equal(ack.error ?? ack.code, 'forbidden');
  assert.equal((await http('GET', `/api/games/${g.gameId}`, null, intruder.cookie)).status, 403);
  ci.send({ t: 'join', gameId: g.gameId });
  assert.equal((await ci.waitFor((m) => m.t === 'error')).code, 'forbidden');
  ci.close();
});

test('lance legal é aceite, o tabuleiro actualiza nos dois e o lance fica no histórico', async () => {
  const g = await startGame();
  const path = g.white.c.last('game').game.legal[0];
  g.black.c.clear();
  g.white.c.send(mv(g.gameId, 0, path));
  const ack = await g.white.c.waitFor((m) => m.t === 'ack');
  assert.equal(ack.ok, true);
  const upd = await g.black.c.waitFor((m) => m.t === 'game' && m.game.ply === 1);
  assert.equal(upd.game.turn, 'b');
  assert.equal(upd.game.board[path[0]], 0);
  assert.equal(upd.game.board[path[1]], 1);
  assert.deepEqual(upd.game.lastMove, path);
  assert.equal(upd.game.legal.length, 7); // agora são as negras
  const h = (await http('GET', `/api/games/${g.gameId}`, null, g.white.u.cookie)).json;
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0].color, 'w');
});

test('lance repetido (mesmo moveId) não é jogado duas vezes; ply antigo é recusado', async () => {
  const g = await startGame();
  const path = g.white.c.last('game').game.legal[0];
  const m = mv(g.gameId, 0, path);
  g.white.c.send(m);
  g.white.c.send(m); // reenvio (rede instável)
  await sleep(150);
  assert.equal(q.get('SELECT ply FROM games WHERE id=?', g.gameId).ply, 1);
  const acks = g.white.c.msgs.filter((x) => x.t === 'ack' && x.moveId === m.moveId);
  assert.equal(acks.length, 2);
  assert.ok(acks.every((x) => x.ok));
  assert.equal(acks[1].duplicate, true);
  // negras jogam com ply desactualizado
  g.black.c.send(mv(g.gameId, 0, g.black.c.last('game').game.legal[0]));
  const bad = await g.black.c.waitFor((x) => x.t === 'ack' && !x.ok);
  assert.equal(bad.error, 'stale');
});

test('lances simultâneos das duas cores: só o da vez é aplicado', async () => {
  const g = await startGame();
  g.white.c.send(mv(g.gameId, 0, g.white.c.last('game').game.legal[0]));
  g.black.c.send(mv(g.gameId, 0, [21, 17]));
  await sleep(200);
  assert.equal(q.get('SELECT ply FROM games WHERE id=?', g.gameId).ply, 1);
  assert.equal(q.get('SELECT COUNT(*) n FROM game_moves WHERE game_id=?', g.gameId).n, 1);
});

// ---------------------------------------------------------------- reconexão
test('desconexão: a partida não se perde, o adversário é avisado, sem vitória automática; ao voltar recupera tudo', async () => {
  const g = await startGame();
  const p1 = g.white.c.last('game').game.legal[0];
  g.white.c.send(mv(g.gameId, 0, p1));
  await g.black.c.waitFor((m) => m.t === 'game' && m.game.ply === 1);
  const boardBefore = g.black.c.last('game').game.board.slice();

  g.white.c.clear();
  g.black.c.close(); // as negras perdem a ligação
  const warn = await g.white.c.waitFor((m) => m.t === 'game' && m.game.status === 'awaiting_reconnect');
  assert.equal(warn.game.disconnects[g.black.c === g.ca ? 'b' : 'b'], 1);
  assert.equal(warn.game.result, null); // nenhuma vitória atribuída
  assert.equal(warn.game.clocks.running, null); // relógio parado
  const clockWhileAway = warn.game.clocks.b;
  await sleep(300);
  const row = q.get('SELECT status,result FROM games WHERE id=?', g.gameId);
  assert.equal(row.status, 'awaiting_reconnect');
  assert.equal(row.result, null);

  // o jogador volta (nova ligação, possivelmente outro dispositivo)
  const back = connect(g.black.u);
  await back.open;
  back.send({ t: 'join', gameId: g.gameId });
  const sync = await back.waitFor((m) => m.t === 'game' && m.game.status === 'active');
  assert.deepEqual(sync.game.board, boardBefore); // posição exacta
  assert.equal(sync.game.turn, 'b'); // vez correcta
  assert.equal(sync.game.ply, 1);
  assert.equal(sync.game.you, 'b');
  assert.ok(sync.game.clocks.b <= clockWhileAway + 5 && sync.game.clocks.b >= clockWhileAway - 1500); // o relógio parado não consumiu o tempo da ausência
  assert.equal(sync.game.clocks.running, 'b');
  assert.equal(sync.game.legal.length, 7);
  await g.white.c.waitFor((m) => m.t === 'game' && m.game.status === 'active'); // o adversário vê que voltou
  // e a partida prossegue
  back.send(mv(g.gameId, 1, sync.game.legal[0]));
  assert.equal((await back.waitFor((m) => m.t === 'ack')).ok, true);
  g.white.c.close(); back.close();
});

test('recarregar a página (queda rápida dentro da tolerância) não conta como desconexão', async () => {
  const g = await startGame();
  g.black.c.close();
  await sleep(10);
  const again = connect(g.black.u);
  await again.open;
  await sleep(150);
  const row = q.get('SELECT status,disconnects_w,disconnects_b FROM games WHERE id=?', g.gameId);
  assert.equal(row.status, 'active');
  assert.equal(row.disconnects_w + row.disconnects_b, 0);
  again.close(); g.white.c.close();
});

test('os dois desligam: partida "interrompida"; depois do prazo fica "em análise" sem penalizar ninguém; histórico conserva-a', async () => {
  const g = await startGame();
  g.white.c.send(mv(g.gameId, 0, g.white.c.last('game').game.legal[0]));
  await g.black.c.waitFor((m) => m.t === 'game' && m.game.ply === 1);
  g.ca.close(); g.cb.close();
  await sleep(250);
  assert.equal(q.get('SELECT status FROM games WHERE id=?', g.gameId).status, 'interrupted');
  const saved = CONFIG.reviewAfterMs;
  CONFIG.reviewAfterMs = 100;
  await sleep(150);
  games.tick();
  CONFIG.reviewAfterMs = saved;
  const row = q.get('SELECT status,result,ply FROM games WHERE id=?', g.gameId);
  assert.equal(row.status, 'under_review');
  assert.equal(row.result, null);
  assert.equal(row.ply, 1);
  const hist = (await http('GET', '/api/games/mine', null, g.a.cookie)).json.items.find((x) => x.id === g.gameId);
  assert.equal(hist.status, 'under_review');
  assert.equal(hist.plies, 1);
  assert.equal(hist.disconnects.you + hist.disconnects.opponent, 2);
  // ... e o administrador pode decidir
  const adm = await http('POST', '/api/auth/login', { username: 'admin', password: 'admin-teste-123' });
  const cookie = adm.res.headers.get('set-cookie').split(';')[0];
  const res = await http('POST', `/api/admin/games/${g.gameId}/resolve`, { action: 'd', note: 'ambos sem rede' }, cookie);
  assert.equal(res.status, 200);
  assert.equal(q.get('SELECT status FROM games WHERE id=?', g.gameId).status, 'draw');
  const aud = (await http('GET', '/api/admin/audit', null, cookie)).json.items;
  assert.ok(aud.some((x) => x.action === 'game_resolve' && x.target === g.gameId));
});

test('partida não começada: se um dos jogadores nunca entra, cancela-se e as entradas são devolvidas', async () => {
  const a = await newUser('nb1');
  const b = await newUser('nb2');
  const room = (await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 30 }, a.cookie)).json.room;
  const gameId = (await http('POST', `/api/rooms/${room.id}/join`, null, b.cookie)).json.gameId;
  assert.equal((await http('GET', '/api/me', null, a.cookie)).json.balance, CONFIG.startingPoints - 100);
  q.run('UPDATE games SET created_at=? WHERE id=?', Date.now() - CONFIG.startTimeoutMs - 1000, gameId);
  games.loadGame(gameId).created_at = Date.now() - CONFIG.startTimeoutMs - 1000;
  games.tick();
  assert.equal(q.get('SELECT status FROM games WHERE id=?', gameId).status, 'cancelled');
  assert.equal((await http('GET', '/api/me', null, a.cookie)).json.balance, CONFIG.startingPoints);
  assert.equal((await http('GET', '/api/me', null, b.cookie)).json.balance, CONFIG.startingPoints);
});

// ---------------------------------------------------------------- relógio, fim, pontos, classificação
test('o relógio é do servidor: tempo esgotado perde por tempo e liquida os pontos demonstrativos', async () => {
  const g = await startGame('bronze');
  const row = games.loadGame(g.gameId);
  row.clock_w = 1;
  q.run('UPDATE games SET clock_w=1 WHERE id=?', g.gameId);
  await sleep(30);
  games.tick();
  const done = q.get('SELECT status,result,reason FROM games WHERE id=?', g.gameId);
  assert.equal(done.status, 'finished');
  assert.equal(done.result, 'b');
  assert.equal(done.reason, 'time');
  const winner = g.black.u;
  const loser = g.white.u;
  assert.equal((await http('GET', '/api/me', null, winner.cookie)).json.balance, CONFIG.startingPoints + 100);
  assert.equal((await http('GET', '/api/me', null, loser.cookie)).json.balance, CONFIG.startingPoints - 100);
  const rk = (await http('GET', '/api/rankings?category=geral', null, winner.cookie)).json.items;
  assert.equal(rk.find((r) => r.username === winner.username).wins, 1);
  // o livro-razão é separado e identifica a natureza dos movimentos
  const pts = (await http('GET', '/api/points', null, winner.cookie)).json;
  assert.equal(pts.demo, true);
  assert.ok(pts.ledger.some((l) => l.kind === 'PREMIO'));
  g.ca.close(); g.cb.close();
});

test('partida completa até ao fim por captura é consistente (validação no servidor em todos os lances)', async () => {
  const g = await startGame();
  const players = { w: g.white.c, b: g.black.c };
  let view = g.white.c.last('game').game;
  let guard = 0;
  while (view.status === 'active' && guard++ < 300) {
    const mover = players[view.turn];
    const state = mover.last('game').game;
    if (state.turn !== view.turn || state.ply !== view.ply || !state.legal.length) { await sleep(5); view = mover.last('game').game; continue; }
    // escolhe sempre o último lance legal (determinístico)
    mover.send(mv(g.gameId, state.ply, state.legal[state.legal.length - 1]));
    const next = await mover.waitFor((m) => m.t === 'game' && m.game.ply === state.ply + 1 || (m.t === 'game' && m.game.status !== 'active'));
    view = next.game;
  }
  const row = q.get('SELECT status,ply FROM games WHERE id=?', g.gameId);
  const moves = q.get('SELECT COUNT(*) n FROM game_moves WHERE game_id=?', g.gameId).n;
  assert.equal(moves, row.ply); // nenhum lance perdido nem duplicado
  g.ca.close(); g.cb.close();
});

// ---------------------------------------------------------------- persistência
test('reinício do servidor: partidas em curso são recuperadas da base de dados com a posição exacta', async () => {
  await srv.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'damas-'));
  const dbPath = path.join(dir, 'x.db');
  srv = await startServer({ port: 0, host: '127.0.0.1', dbPath, adminPassword: 'admin-teste-123', offlineGraceMs: 60, registerPerHour: 10000 });
  base = `http://127.0.0.1:${srv.port}`;
  const g = await startGame();
  g.white.c.send(mv(g.gameId, 0, g.white.c.last('game').game.legal[0]));
  const upd = await g.black.c.waitFor((m) => m.t === 'game' && m.game.ply === 1);
  const board = upd.game.board.slice();
  const cookies = { w: g.white.u, b: g.black.u };
  await srv.close();

  srv = await startServer({ port: 0, host: '127.0.0.1', dbPath, adminPassword: 'admin-teste-123', offlineGraceMs: 60, registerPerHour: 10000 });
  base = `http://127.0.0.1:${srv.port}`;
  // as sessões também sobreviveram ao reinício
  const me = await http('GET', '/api/me', null, cookies.b.cookie);
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.activeGames, [g.gameId]);
  const back = connect(cookies.b);
  await back.open;
  back.send({ t: 'join', gameId: g.gameId });
  const sync = await back.waitFor((m) => m.t === 'game');
  assert.deepEqual(sync.game.board, board);
  assert.equal(sync.game.ply, 1);
  assert.equal(sync.game.status, 'awaiting_reconnect'); // à espera do adversário
  const other = connect(cookies.w);
  await other.open;
  other.send({ t: 'join', gameId: g.gameId });
  await back.waitFor((m) => m.t === 'game' && m.game.status === 'active');
  back.close(); other.close();
});

// ---------------------------------------------------------------- torneios e denúncias
test('torneio gratuito: criação pelo administrador, inscrição e arranque quando enche', async () => {
  const adm = await http('POST', '/api/auth/login', { username: 'admin', password: 'admin-teste-123' });
  const cookie = adm.res.headers.get('set-cookie').split(';')[0];
  const t = await http('POST', '/api/admin/tournaments', { name: 'Taça de Teste', size: 4 }, cookie);
  assert.equal(t.status, 200);
  const users = [];
  for (let i = 0; i < 4; i++) users.push(await newUser('torn'));
  const outs = [];
  for (const u of users) outs.push((await http('POST', `/api/tournaments/${t.json.id}/join`, null, u.cookie)).json);
  assert.equal(outs[3].started, true);
  const d = (await http('GET', `/api/tournaments/${t.json.id}`, null, users[0].cookie)).json;
  assert.equal(d.status, 'running');
  assert.equal(d.matches.length, 2);
  assert.ok(d.matches.every((m) => m.gameId));
  const g = q.get('SELECT entry FROM games WHERE match_id=?', d.matches[0].id);
  assert.equal(g.entry, 0); // torneios não envolvem pontos
});

test('denúncias: validam o texto e chegam ao painel', async () => {
  const u = await newUser('den');
  const t = await newUser('alvo');
  assert.equal((await http('POST', '/api/reports', { reason: 'curto' }, u.cookie)).status, 400);
  assert.equal((await http('POST', '/api/reports', { targetUsername: t.username, reason: 'Comportamento suspeito durante a partida.' }, u.cookie)).status, 200);
  const adm = await http('POST', '/api/auth/login', { username: 'admin', password: 'admin-teste-123' });
  const cookie = adm.res.headers.get('set-cookie').split(';')[0];
  const rep = (await http('GET', '/api/admin/reports', null, cookie)).json.items;
  assert.ok(rep.some((r) => r.reporter === u.username && r.target === t.username));
});

test('papéis: suporte lê mas não decide; moderador decide; ninguém altera a própria conta', async () => {
  const adm = await http('POST', '/api/auth/login', { username: 'admin', password: 'admin-teste-123' });
  const ck = adm.res.headers.get('set-cookie').split(';')[0];
  const sup = await newUser('sup');
  const alvo = await newUser('alvo2');
  assert.equal((await http('POST', `/api/admin/users/${sup.id}/role`, { role: 'support' }, ck)).status, 200);
  assert.equal((await http('GET', '/api/admin/users', null, sup.cookie)).status, 200);
  assert.equal((await http('POST', `/api/admin/users/${alvo.id}/status`, { status: 'suspended', reason: 'x' }, sup.cookie)).status, 403);
  assert.equal((await http('POST', `/api/admin/users/${sup.id}/role`, { role: 'moderator' }, ck)).status, 200);
  assert.equal((await http('POST', `/api/admin/users/${alvo.id}/status`, { status: 'suspended', reason: 'teste' }, sup.cookie)).status, 200);
  assert.equal((await http('GET', '/api/me', null, alvo.cookie)).status, 401); // sessões terminadas
  assert.equal((await http('POST', `/api/admin/users/${sup.id}/status`, { status: 'suspended' }, sup.cookie)).status, 403);
});
