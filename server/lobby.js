// Salas disponíveis e matchmaking automático.
import crypto from 'node:crypto';
import { q, tx } from './db.js';
import { CONFIG, CATEGORIES, WAIT_OPTIONS } from './config.js';
import * as rt from './realtime.js';
import * as points from './points.js';
import * as games from './games.js';
import { notify } from './notify.js';
import { AppError } from './auth.js';

const queue = new Map(); // userId -> { category, since }

function category(id) {
  const c = CATEGORIES[id];
  if (!c) throw new AppError('bad_category', 'Categoria inválida.');
  return c;
}

const roomView = (r, now) => ({
  id: r.id,
  creator: { id: r.creator_public_id, username: r.creator_name, online: rt.isOnline(r.creator_id) },
  category: r.category,
  entry: r.entry,
  waitSeconds: r.wait_s,
  status: r.status,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  remainingMs: r.status === 'open' ? Math.max(0, r.expires_at - now) : 0,
  gameId: r.game_id,
  serverNow: now,
});

const ROOM_SQL = `SELECT r.*, u.public_id AS creator_public_id, u.username AS creator_name FROM rooms r JOIN users u ON u.id=r.creator_id`;

export function listOpen() {
  const now = Date.now();
  return q.all(`${ROOM_SQL} WHERE r.status='open' AND r.expires_at>? ORDER BY r.created_at DESC LIMIT 100`, now).map((r) => roomView(r, now));
}

export function listMine(userId) {
  const now = Date.now();
  return q.all(`${ROOM_SQL} WHERE r.creator_id=? OR r.joined_by=? ORDER BY r.created_at DESC LIMIT 30`, userId, userId).map((r) => roomView(r, now));
}

export function listAll(limit = 100) {
  const now = Date.now();
  return q.all(`${ROOM_SQL} ORDER BY r.created_at DESC LIMIT ?`, limit).map((r) => roomView(r, now));
}

function dropFromQueue(userId) { queue.delete(userId); }

export function createRoom(user, { category: cat, waitSeconds }) {
  const c = category(cat);
  if (!WAIT_OPTIONS.includes(waitSeconds)) throw new AppError('bad_wait', 'O tempo de espera deve ser 20 ou 30 segundos.');
  if (points.balance(user.id) < c.entry) throw new AppError('insufficient_points', 'Pontos demonstrativos insuficientes para esta categoria.');
  if (q.get("SELECT COUNT(*) n FROM rooms WHERE creator_id=? AND status='open'", user.id).n >= 2) throw new AppError('too_many_rooms', 'Já tem 2 salas abertas.');
  const id = crypto.randomBytes(6).toString('base64url');
  const now = Date.now();
  q.run('INSERT INTO rooms(id,creator_id,category,entry,wait_s,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)', id, user.id, c.id, c.entry, waitSeconds, 'open', now, now + waitSeconds * 1000);
  dropFromQueue(user.id);
  rt.broadcast({ t: 'rooms' });
  return roomView(q.get(`${ROOM_SQL} WHERE r.id=?`, id), now);
}

export function joinRoom(user, roomId) {
  const out = tx(() => {
    const now = Date.now();
    const r = q.get('SELECT * FROM rooms WHERE id=?', roomId);
    if (!r) throw new AppError('not_found', 'Sala não encontrada.', 404);
    if (r.creator_id === user.id) throw new AppError('own_room', 'Não pode entrar na sua própria sala.');
    if (r.status !== 'open' || r.expires_at <= now) throw new AppError('room_closed', 'Esta sala já não está disponível.', 409);
    if (points.balance(user.id) < r.entry) throw new AppError('insufficient_points', 'Pontos demonstrativos insuficientes para esta categoria.');
    if (points.balance(r.creator_id) < r.entry) {
      q.run("UPDATE rooms SET status='cancelled' WHERE id=? AND status='open'", roomId);
      throw new AppError('room_closed', 'Esta sala já não está disponível.', 409);
    }
    // reserva atómica da vaga: só uma pessoa consegue passar de 'open' para 'matched'
    const res = q.run("UPDATE rooms SET status='matched', joined_by=? WHERE id=? AND status='open' AND expires_at>?", user.id, roomId, now);
    if (res.changes !== 1) throw new AppError('room_taken', 'Outra pessoa entrou primeiro.', 409);
    const creatorWhite = crypto.randomInt(2) === 0;
    const g = games.createGame({
      whiteId: creatorWhite ? r.creator_id : user.id,
      blackId: creatorWhite ? user.id : r.creator_id,
      category: r.category,
      entry: r.entry,
      source: 'room',
    });
    q.run('UPDATE rooms SET game_id=? WHERE id=?', g.id, roomId);
    return g;
  });
  rt.broadcast({ t: 'rooms' });
  return out;
}

export function cancelRoom(user, roomId) {
  const res = q.run("UPDATE rooms SET status='cancelled' WHERE id=? AND creator_id=? AND status='open'", roomId, user.id);
  if (res.changes !== 1) throw new AppError('not_found', 'Sala não encontrada ou já fechada.', 404);
  rt.broadcast({ t: 'rooms' });
}

/** Fecha as salas cujo tempo de espera terminou e avisa os criadores. */
export function expireRooms() {
  const now = Date.now();
  const due = q.all("SELECT id, creator_id, category FROM rooms WHERE status='open' AND expires_at<=?", now);
  for (const r of due) {
    const res = q.run("UPDATE rooms SET status='expired' WHERE id=? AND status='open'", r.id);
    if (res.changes === 1) notify(r.creator_id, 'room_expired', `A sua sala ${CATEGORIES[r.category]?.name || ''} fechou: ninguém entrou a tempo.`, { roomId: r.id });
  }
  if (due.length) rt.broadcast({ t: 'rooms' });
}

export function userOffline(userId) {
  dropFromQueue(userId);
  const open = q.all("SELECT id FROM rooms WHERE creator_id=? AND status='open'", userId);
  for (const r of open) q.run("UPDATE rooms SET status='cancelled' WHERE id=? AND status='open'", r.id);
  if (open.length) rt.broadcast({ t: 'rooms' });
}

// ------------------------------------------------------------------ matchmaking automático
export function queueState(userId) {
  const e = queue.get(userId);
  return e ? { searching: true, category: e.category, since: e.since, timeoutMs: CONFIG.queueMs, serverNow: Date.now() } : { searching: false };
}

export function queueJoin(user, cat) {
  const c = category(cat);
  if (points.balance(user.id) < c.entry) throw new AppError('insufficient_points', 'Pontos demonstrativos insuficientes para esta categoria.');
  queue.delete(user.id);
  // procura outro jogador elegível (mesma categoria, online, com pontos suficientes), por ordem de chegada
  for (const [uid, e] of queue) {
    if (uid === user.id || e.category !== c.id || !rt.isOnline(uid) || points.balance(uid) < c.entry) continue;
    queue.delete(uid);
    const meWhite = crypto.randomInt(2) === 0;
    const g = games.createGame({
      whiteId: meWhite ? user.id : uid,
      blackId: meWhite ? uid : user.id,
      category: c.id,
      entry: c.entry,
      source: 'matchmaking',
    });
    return { matched: true, gameId: g.id };
  }
  queue.set(user.id, { category: c.id, since: Date.now() });
  return { matched: false, ...queueState(user.id) };
}

export function queueLeave(userId) {
  const had = queue.delete(userId);
  return { searching: false, left: had };
}

export function queueTick() {
  const now = Date.now();
  for (const [uid, e] of queue) {
    if (now - e.since > CONFIG.queueMs) {
      queue.delete(uid);
      rt.sendUser(uid, { t: 'queue', status: 'timeout' });
    }
  }
}

export const _queueSize = () => queue.size;
