// Testes de integração do servidor: HTTP + WebSocket reais, base de dados SQLite em memória.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import * as games from '../server/games.js';
import * as lobby from '../server/lobby.js';
import { q } from '../server/db.js';
import { CONFIG } from '../server/config.js';
import * as plans from '../server/plans.js';

let srv;
let base;
let n = 0;

// ---------------------------------------------------------------- utilitários
async function http(method, url, body, cookie, extraHeaders = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders, ...(cookie ? { Cookie: cookie } : {}) },
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

function setPlan(user, code, expiresAt = Date.now() + 30 * 86400000) {
  const row = q.get('SELECT id FROM users WHERE public_id=?', user.id);
  const now = Date.now();
  return Number(q.run(`INSERT INTO subscriptions(user_id,plan_code,status,starts_at,expires_at,provider,created_at,updated_at)
    VALUES(?,?,'active',?,?,?, ?,?)`, row.id, code, now, expiresAt, 'test-fixture', now, now).lastInsertRowid);
}
async function adminCookie() {
  const r = await http('POST', '/api/auth/login', { username: 'admin', password: 'admin-teste-123' });
  assert.equal(r.status, 200);
  return r.res.headers.get('set-cookie').split(';')[0];
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
test('registo devolve identificador único, código de recuperação e plano gratuito com zero XP inicial', async () => {
  const u = await newUser('conta');
  assert.match(u.id, /^DM\d{6}$/);
  assert.match(u.recoveryCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const me = await http('GET', '/api/me', null, u.cookie);
  assert.equal(me.json.balance, 0);
  assert.equal(me.json.subscription.plan.code, 'free');
  const dup = await http('POST', '/api/auth/register', { username: u.username.toUpperCase(), password: 'senhaSegura1' });
  assert.equal(dup.status, 409);
  assert.equal((await http('POST', '/api/auth/register', { username: 'utilizador-teste', password: 'senhaSegura1' })).status, 200);
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

test('planos têm os preços aprovados e Gratuito não pode contornar pesquisa avançada', async () => {
  const user = await newUser('planos');
  const list = await http('GET', '/api/plans');
  assert.deepEqual(list.json.items.map((p) => [p.code, p.priceMzn]), [['free', 0], ['premium', 99], ['vip', 199]]);
  const denied = await http('POST', '/api/queue', { category: 'bronze', minRating: 900, maxRating: 1100 }, user.cookie);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'plan_required');
  assert.equal((await http('GET', `/api/users/${user.id}`, null, user.cookie)).json.advancedStats, false);
  const target = await newUser('outroplan'); setPlan(target, 'premium');
  const targetDbId = q.get('SELECT id FROM users WHERE public_id=?', target.id).id;
  q.run("INSERT OR IGNORE INTO rankings(user_id,category) VALUES(?,'ouro')", targetDbId);
  const hiddenStats = await http('GET', `/api/users/${target.id}`, null, user.cookie);
  assert.equal(hiddenStats.json.advancedStats, false);
  assert.equal(hiddenStats.json.detailedStats, null);
  assert.equal(hiddenStats.json.rankings.some((r) => r.category === 'ouro'), false);
  const allowedStats = await http('GET', `/api/users/${target.id}`, null, target.cookie);
  assert.equal(allowedStats.json.advancedStats, true);
  assert.equal(allowedStats.json.detailedStats, null);
  assert.equal(allowedStats.json.rankings.some((r) => r.category === 'ouro'), true);
  assert.equal((await http('POST', '/api/me/theme', { theme: 'amber' }, user.cookie)).status, 403);
  assert.equal((await http('POST', '/api/me/bio', { bio: 'Biografia premium' }, user.cookie)).status, 403);
  assert.equal((await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 20, title: 'Sem filtro' }, user.cookie)).status, 403);
});

test('Premium usa pesquisa avançada e cria sala pública personalizada; VIP herda esses recursos', async () => {
  const premium = await newUser('prem'); setPlan(premium, 'premium');
  const search = await http('POST', '/api/queue', { category: 'prata', minRating: 900, maxRating: 1100 }, premium.cookie);
  assert.equal(search.status, 200, JSON.stringify(search.json));
  assert.equal(search.json.searching, true);
  await http('DELETE', '/api/queue', null, premium.cookie);
  const room = await http('POST', '/api/rooms', { category: 'prata', waitSeconds: 30, title: 'Desafio Premium', minRating: 900, maxRating: 1100 }, premium.cookie);
  assert.equal(room.status, 200, JSON.stringify(room.json));
  assert.equal(room.json.room.title, 'Desafio Premium');
  const titleOnly = await http('POST', '/api/rooms', { category: 'prata', waitSeconds: 30, title: 'Só título' }, premium.cookie);
  assert.equal(titleOnly.status, 200, JSON.stringify(titleOnly.json));
  assert.equal(titleOnly.json.room.minRating, null);
  assert.equal((await http('GET', `/api/users/${premium.id}`, null, premium.cookie)).json.advancedStats, true);
  assert.equal((await http('POST', '/api/me/theme', { theme: 'amber' }, premium.cookie)).status, 200);
  assert.equal((await http('POST', '/api/me/bio', { bio: 'Competidor Premium' }, premium.cookie)).json.bio, 'Competidor Premium');
  const vip = await newUser('vip'); setPlan(vip, 'vip');
  assert.equal((await http('GET', '/api/games/mine', null, vip.cookie)).json.fullHistory, true);
  assert.equal((await http('POST', '/api/me/theme', { theme: 'obsidian' }, vip.cookie)).status, 200);
  const vipAchievements = (await http('GET', `/api/users/${vip.id}`, null, vip.cookie)).json.progression.achievements;
  assert.equal(vipAchievements.some((a) => a.id === 'vip_badge'), true);
  assert.deepEqual((await http('GET', `/api/users/${vip.id}`, null, vip.cookie)).json.detailedStats, { games: 0, wins: 0, losses: 0, draws: 0, categories: [] });
  assert.equal((await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 20, visibility: 'private' }, premium.cookie)).status, 403);
});

test('sala VIP privada não aparece em salas públicas, exige convite e só aceita VIP', async () => {
  const owner = await newUser('privdono'); setPlan(owner, 'vip');
  const created = await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 30, visibility: 'private' }, owner.cookie);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const code = created.json.room.inviteCode;
  assert.match(code, /^[A-Z0-9_-]{8,16}$/);
  assert.equal((await http('GET', '/api/rooms', null, owner.cookie)).json.items.some((r) => r.id === created.json.room.id), false);
  assert.equal((await http('GET', '/api/rooms/mine', null, owner.cookie)).json.items.find((r) => r.id === created.json.room.id).inviteCode, code);
  const free = await newUser('privfree');
  assert.equal((await http('POST', '/api/rooms/invite', { code }, free.cookie)).status, 403);
  const guest = await newUser('privvip'); setPlan(guest, 'vip');
  assert.equal((await http('POST', `/api/rooms/${created.json.room.id}/join`, {}, guest.cookie)).status, 403);
  const joined = await http('POST', '/api/rooms/invite', { code }, guest.cookie);
  assert.equal(joined.status, 200, JSON.stringify(joined.json));
  assert.ok(joined.json.gameId);
});

test('subscrição expirada perde acesso e checkout não simula pagamento', async () => {
  const user = await newUser('expplan');
  const subId = setPlan(user, 'premium', Date.now() - 1);
  assert.equal((await http('GET', '/api/me', null, user.cookie)).json.subscription.plan.code, 'free');
  assert.equal(plans.expireDue() >= 1, true);
  assert.equal(q.get('SELECT status FROM subscriptions WHERE id=?', subId).status, 'expired');
  const original = process.env.PAYMENT_PROVIDER; process.env.PAYMENT_PROVIDER = 'unconfigured-test';
  try {
    const checkout = await http('POST', '/api/subscription/checkout', { planCode: 'premium' }, user.cookie);
    assert.equal(checkout.status, 200); assert.equal(checkout.json.status, 'not_configured');
    assert.match(checkout.json.message, /Nenhum valor foi cobrado/);
    assert.equal((await http('GET', '/api/me', null, user.cookie)).json.subscription.plan.code, 'free');
    assert.equal((await http('GET', '/api/payments/mine', null, user.cookie)).json.items[0].status, 'not_configured');
  } finally { if (original === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = original; }
});

test('callback com assinatura inválida não confirma pagamento nem ativa subscrição', async () => {
  const user = await newUser('webhook');
  const uid = q.get('SELECT id FROM users WHERE public_id=?', user.id).id;
  const id = crypto.randomUUID();
  q.run("INSERT INTO payments(id,user_id,plan_code,amount_mzn,provider,status,metadata_json,created_at) VALUES(?,?,?,?,?,'pending','{}',?)", id, uid, 'premium', 99, 'mpesa', Date.now());
  const keys = ['PAYMENT_PROVIDER', 'PAYMENT_WEBHOOK_SECRET', 'PAYMENT_CHECKOUT_URL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.PAYMENT_PROVIDER = 'mpesa'; process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret'; process.env.PAYMENT_CHECKOUT_URL = 'https://gateway.invalid/';
  try {
    const body = { status: 'paid', paymentId: id, providerRef: 'TEST-REF' };
    const raw = Buffer.from(JSON.stringify(body));
    const wrong = crypto.createHmac('sha256', 'different-secret').update(raw).digest('hex');
    const result = await http('POST', '/api/payments/webhook/mpesa', body, null, { 'X-Damas-Signature': `sha256=${wrong}` });
    assert.equal(result.status, 401);
    assert.equal(q.get('SELECT status FROM payments WHERE id=?', id).status, 'pending');
    assert.equal((await http('GET', '/api/me', null, user.cookie)).json.subscription.plan.code, 'free');
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('admin gere preço e subscrições, mas ativa pagamento apenas por confirmação do provedor', async () => {
  const user = await newUser('subadm'); const subId = setPlan(user, 'premium');
  const admin = await adminCookie();
  const price = await http('POST', '/api/admin/plans/premium', { priceMzn: 123, active: true }, admin);
  assert.equal(price.status, 200, JSON.stringify(price.json)); assert.equal(price.json.plan.priceMzn, 123);
  assert.equal((await http('GET', '/api/admin/subscriptions', null, admin)).json.items.some((x) => x.id === subId), true);
  assert.equal((await http('GET', '/api/admin/payments', null, admin)).status, 200);
  const rating = await http('POST', `/api/admin/users/${user.id}/rating`, { rating: 1325, note: 'Correção após análise' }, admin);
  assert.equal(rating.status, 200); assert.equal(rating.json.rating, 1325);
  const room = await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 20 }, user.cookie);
  assert.equal(room.status, 200);
  assert.equal((await http('POST', `/api/admin/rooms/${room.json.room.id}/cancel`, {}, user.cookie)).status, 403);
  assert.equal((await http('POST', `/api/admin/rooms/${room.json.room.id}/cancel`, {}, admin)).status, 200);
  assert.equal((await http('GET', '/api/rooms/mine', null, user.cookie)).json.items.find((r) => r.id === room.json.room.id).status, 'cancelled');
  assert.equal((await http('POST', `/api/admin/subscriptions/${subId}/cancel`, {}, admin)).status, 200);
  assert.equal((await http('GET', '/api/me', null, user.cookie)).json.subscription.plan.code, 'free');
  await http('POST', '/api/admin/plans/premium', { priceMzn: 99, active: true }, admin);
});

// ---------------------------------------------------------------- salas
test('sala: só 20 ou 30 s; categorias não têm entradas; lista mostra criador, categoria, estado e espera', async () => {
  const a = await newUser('sala');
  assert.equal((await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 45 }, a.cookie)).status, 400);
  assert.equal((await http('POST', '/api/rooms', { category: 'platina', waitSeconds: 20 }, a.cookie)).status, 400);
  const cfg = (await http('GET', '/api/config')).json;
  assert.deepEqual(cfg.categories.map((c) => c.name), ['Bronze', 'Prata', 'Ouro', 'Diamante']);
  assert.ok(cfg.categories.every((c) => !Object.hasOwn(c, 'entry')));
  assert.deepEqual(cfg.waits, [20, 30]);
  const r = await http('POST', '/api/rooms', { category: 'prata', waitSeconds: 20 }, a.cookie);
  assert.equal(r.status, 200);
  const list = (await http('GET', '/api/rooms', null, a.cookie)).json.items.find((x) => x.id === r.json.room.id);
  assert.equal(list.creator.username, a.username);
  assert.equal(list.category, 'prata');
  assert.equal(Object.hasOwn(list, 'entry'), false);
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

test('sala pública e partida não exigem saldo nem alteram XP antes do resultado', async () => {
  const a = await newUser('pobre');
  const r = await http('POST', '/api/rooms', { category: 'ouro', waitSeconds: 20 }, a.cookie);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await http('GET', '/api/me', null, a.cookie)).json.balance, 0);
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
  assert.equal((await http('GET', '/api/me', null, g.a.cookie)).json.balance, 10);
  assert.equal((await http('GET', '/api/me', null, g.b.cookie)).json.balance, 10);
  const aud = (await http('GET', '/api/admin/audit', null, cookie)).json.items;
  assert.ok(aud.some((x) => x.action === 'game_resolve' && x.target === g.gameId));
});

test('partida não começada: se um dos jogadores nunca entra, cancela-se sem alterar XP', async () => {
  const a = await newUser('nb1');
  const b = await newUser('nb2');
  const room = (await http('POST', '/api/rooms', { category: 'bronze', waitSeconds: 30 }, a.cookie)).json.room;
  const gameId = (await http('POST', `/api/rooms/${room.id}/join`, null, b.cookie)).json.gameId;
  assert.equal((await http('GET', '/api/me', null, a.cookie)).json.balance, 0);
  q.run('UPDATE games SET created_at=? WHERE id=?', Date.now() - CONFIG.startTimeoutMs - 1000, gameId);
  games.loadGame(gameId).created_at = Date.now() - CONFIG.startTimeoutMs - 1000;
  games.tick();
  assert.equal(q.get('SELECT status FROM games WHERE id=?', gameId).status, 'cancelled');
  assert.equal((await http('GET', '/api/me', null, a.cookie)).json.balance, 0);
  assert.equal((await http('GET', '/api/me', null, b.cookie)).json.balance, 0);
});

// ---------------------------------------------------------------- relógio, fim, pontos, classificação
test('o relógio é do servidor: tempo esgotado perde por tempo e atribui XP virtual fixo', async () => {
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
  assert.equal((await http('GET', '/api/me', null, winner.cookie)).json.balance, 25);
  assert.equal((await http('GET', '/api/me', null, loser.cookie)).json.balance, 5);
  const rk = (await http('GET', '/api/rankings?category=geral', null, winner.cookie)).json.items;
  assert.equal(rk.find((r) => r.username === winner.username).wins, 1);
  // o livro-razão é separado e identifica a natureza dos movimentos
  const pts = (await http('GET', '/api/points', null, winner.cookie)).json;
  assert.equal(pts.virtualOnly, true);
  assert.ok(pts.ledger.some((l) => l.kind === 'VITORIA_XP'));
  const weekly = (await http('GET', '/api/rankings?period=week', null, winner.cookie)).json.items;
  assert.equal(weekly.find((r) => r.username === winner.username).score, 25);
  const monthly = (await http('GET', '/api/rankings?period=month', null, loser.cookie)).json.items;
  assert.equal(monthly.find((r) => r.username === loser.username).score, 5);
  setPlan(winner, 'vip');
  const detailed = (await http('GET', `/api/users/${winner.id}`, null, winner.cookie)).json.detailedStats;
  assert.deepEqual(detailed, { games: 1, wins: 1, losses: 0, draws: 0, categories: [{ category: 'bronze', games: 1, wins: 1, losses: 0, draws: 0, averagePlies: 0 }] });
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
  const gameColumns = q.all('PRAGMA table_info(games)').map((x) => x.name);
  assert.equal(gameColumns.includes('entry'), false); // torneios não envolvem entradas
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
