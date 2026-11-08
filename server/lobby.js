// Salas públicas/privadas e emparelhamento automático, sem débitos nem pontos em jogo.
import crypto from 'node:crypto';
import { q, tx } from './db.js';
import { CONFIG, CATEGORIES, WAIT_OPTIONS } from './config.js';
import * as rt from './realtime.js';
import * as games from './games.js';
import { notify } from './notify.js';
import { AppError } from './auth.js';
import * as plans from './plans.js';

const queue = new Map();
function category(id) {
  const c = CATEGORIES[id];
  if (!c) throw new AppError('bad_category', 'Categoria inválida.');
  return c;
}
function ratingOf(userId) { return q.get("SELECT rating FROM rankings WHERE user_id=? AND category='geral'", userId)?.rating ?? 1000; }
function safeRatingRange(min, max) {
  if (min == null && max == null) return { min: null, max: null };
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 4000 || min > max) throw new AppError('bad_rating_range', 'Intervalo de pontuação inválido (0–4000).');
  return { min, max };
}
const roomView = (r, now, viewerId = null) => ({
  id: r.id, creator: { id: r.creator_public_id, username: r.creator_name, online: rt.isOnline(r.creator_id) },
  category: r.category, title: r.title || 'Desafio aberto', visibility: r.visibility || 'public',
  inviteCode: viewerId === r.creator_id ? r.invite_code : null,
  minRating: r.min_rating ?? null, maxRating: r.max_rating ?? null,
  waitSeconds: r.wait_s, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
  remainingMs: r.status === 'open' ? Math.max(0, r.expires_at - now) : 0, gameId: r.game_id, serverNow: now,
});
const ROOM_SQL = `SELECT r.*, u.public_id AS creator_public_id, u.username AS creator_name FROM rooms r JOIN users u ON u.id=r.creator_id`;
export function listOpen(viewerId = null) {
  const now = Date.now();
  return q.all(`${ROOM_SQL} WHERE r.status='open' AND r.visibility='public' AND r.expires_at>? ORDER BY r.created_at DESC LIMIT 100`, now).map((r) => roomView(r, now, viewerId));
}
export function listMine(userId) {
  const now = Date.now();
  return q.all(`${ROOM_SQL} WHERE r.creator_id=? OR r.joined_by=? ORDER BY r.created_at DESC LIMIT 100`, userId, userId).map((r) => roomView(r, now, userId));
}
export function listAll(limit = 100) {
  const now = Date.now();
  return q.all(`${ROOM_SQL} ORDER BY r.created_at DESC LIMIT ?`, limit).map((r) => roomView(r, now));
}
function dropFromQueue(userId) { queue.delete(userId); }
function inviteCode() { return crypto.randomBytes(8).toString('base64url').toUpperCase(); }

export function createRoom(user, { category: cat, waitSeconds, visibility = 'public', title = '', minRating = null, maxRating = null }) {
  const c = category(cat);
  if (!WAIT_OPTIONS.includes(waitSeconds)) throw new AppError('bad_wait', 'O tempo de espera deve ser 20 ou 30 segundos.');
  if (!['public', 'private'].includes(visibility)) throw new AppError('bad_visibility', 'Visibilidade inválida.');
  const custom = Boolean(String(title || '').trim() || minRating != null || maxRating != null);
  if (custom) plans.requirePlan(user.id, 'premium', 'Salas personalizadas');
  if (visibility === 'private') plans.requirePlan(user.id, 'vip', 'Salas privadas avançadas');
  const range = safeRatingRange(minRating, maxRating);
  const hasAnyRatingLimit = minRating != null || maxRating != null;
  if (hasAnyRatingLimit && (range.min == null || range.max == null)) throw new AppError('bad_rating_range', 'Defina um limite mínimo e máximo de pontuação.');
  if (q.get("SELECT COUNT(*) n FROM rooms WHERE creator_id=? AND status='open'", user.id).n >= 2) throw new AppError('too_many_rooms', 'Já tem 2 salas abertas.');
  const id = crypto.randomBytes(6).toString('base64url');
  const code = visibility === 'private' ? inviteCode() : null;
  const now = Date.now();
  const cleanTitle = String(title || 'Desafio aberto').trim().slice(0, 50) || 'Desafio aberto';
  q.run(`INSERT INTO rooms(id,creator_id,category,wait_s,status,created_at,expires_at,visibility,invite_code,title,min_rating,max_rating)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, user.id, c.id, waitSeconds, 'open', now, now + waitSeconds * 1000, visibility, code, cleanTitle, range.min, range.max);
  dropFromQueue(user.id);
  rt.broadcast({ t: 'rooms' });
  return roomView(q.get(`${ROOM_SQL} WHERE r.id=?`, id), now, user.id);
}

function joinRoomWithCode(user, roomId, code = null) {
  const out = tx(() => {
    const now = Date.now();
    const r = q.get('SELECT * FROM rooms WHERE id=?', roomId);
    if (!r) throw new AppError('not_found', 'Sala não encontrada.', 404);
    if (r.creator_id === user.id) throw new AppError('own_room', 'Não pode entrar na sua própria sala.');
    if (r.status !== 'open' || r.expires_at <= now) throw new AppError('room_closed', 'Esta sala já não está disponível.', 409);
    if (r.visibility === 'private') {
      plans.requirePlan(user.id, 'vip', 'Acesso a salas privadas');
      if (!code || code !== r.invite_code) throw new AppError('invite_required', 'É necessário o código de convite.', 403);
    }
    const userRating = ratingOf(user.id);
    if ((r.min_rating != null && userRating < r.min_rating) || (r.max_rating != null && userRating > r.max_rating)) throw new AppError('rating_mismatch', 'A sua pontuação não está no intervalo desta sala.', 403);
    const ownerRating = ratingOf(r.creator_id);
    if ((r.min_rating != null && ownerRating < r.min_rating) || (r.max_rating != null && ownerRating > r.max_rating)) throw new AppError('room_invalid_range', 'O anfitrião já não corresponde ao intervalo da sala.', 409);
    const res = q.run("UPDATE rooms SET status='matched',joined_by=? WHERE id=? AND status='open' AND expires_at>?", user.id, roomId, now);
    if (res.changes !== 1) throw new AppError('room_taken', 'Outra pessoa entrou primeiro.', 409);
    const creatorWhite = crypto.randomInt(2) === 0;
    const g = games.createGame({ whiteId: creatorWhite ? r.creator_id : user.id, blackId: creatorWhite ? user.id : r.creator_id, category: r.category, source: r.visibility === 'private' ? 'private_room' : 'room' });
    q.run('UPDATE rooms SET game_id=? WHERE id=?', g.id, roomId);
    return g;
  });
  rt.broadcast({ t: 'rooms' });
  return out;
}
export function joinRoom(user, roomId, code = null) { return joinRoomWithCode(user, roomId, code); }
export function joinByInvite(user, code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{8,16}$/.test(normalized)) throw new AppError('bad_invite', 'Código de convite inválido.');
  const r = q.get('SELECT id FROM rooms WHERE invite_code=? AND status=\'open\'', normalized);
  if (!r) throw new AppError('invite_expired', 'Convite não encontrado ou expirado.', 404);
  return joinRoomWithCode(user, r.id, normalized);
}
export function cancelRoom(user, roomId) {
  const res = q.run("UPDATE rooms SET status='cancelled' WHERE id=? AND creator_id=? AND status='open'", roomId, user.id);
  if (res.changes !== 1) throw new AppError('not_found', 'Sala não encontrada ou já fechada.', 404);
  rt.broadcast({ t: 'rooms' });
}
export function cancelRoomAdmin(roomId) {
  const res = q.run("UPDATE rooms SET status='cancelled' WHERE id=? AND status='open'", roomId);
  if (res.changes !== 1) throw new AppError('not_found', 'Sala aberta não encontrada.', 404);
  rt.broadcast({ t: 'rooms' });
  return { ok: true };
}
export function expireRooms() {
  const now = Date.now();
  const due = q.all("SELECT id,creator_id,category FROM rooms WHERE status='open' AND expires_at<=?", now);
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

export function queueState(userId) {
  const e = queue.get(userId);
  return e ? { searching: true, category: e.category, since: e.since, timeoutMs: CONFIG.queueMs, serverNow: Date.now(), filters: { minRating: e.minRating, maxRating: e.maxRating, username: e.username } } : { searching: false };
}
function fits(criteria, rating, username) {
  if (criteria.minRating != null && rating < criteria.minRating) return false;
  if (criteria.maxRating != null && rating > criteria.maxRating) return false;
  if (criteria.username && criteria.username.toLowerCase() !== username.toLowerCase()) return false;
  return true;
}
export function queueJoin(user, cat, filters = {}) {
  const c = category(cat);
  const hasAdvanced = filters.minRating != null || filters.maxRating != null || String(filters.username || '').trim();
  if (hasAdvanced) plans.requirePlan(user.id, 'premium', 'Pesquisa avançada de adversários');
  const range = safeRatingRange(filters.minRating == null ? null : Number(filters.minRating), filters.maxRating == null ? null : Number(filters.maxRating));
  const username = String(filters.username || '').trim().slice(0, 20);
  if (username && !q.get('SELECT id FROM users WHERE username=? COLLATE NOCASE AND status=\'active\'', username)) throw new AppError('opponent_not_found', 'Adversário não encontrado.');
  queue.delete(user.id);
  const mineRating = ratingOf(user.id);
  for (const [uid, e] of queue) {
    if (uid === user.id || e.category !== c.id || !rt.isOnline(uid)) continue;
    const opponent = q.get('SELECT username FROM users WHERE id=? AND status=\'active\'', uid);
    if (!opponent) continue;
    if (!fits(e, mineRating, user.username) || !fits({ minRating: range.min, maxRating: range.max, username }, ratingOf(uid), opponent.username)) continue;
    queue.delete(uid);
    const meWhite = crypto.randomInt(2) === 0;
    const g = games.createGame({ whiteId: meWhite ? user.id : uid, blackId: meWhite ? uid : user.id, category: c.id, source: 'matchmaking' });
    return { matched: true, gameId: g.id };
  }
  queue.set(user.id, { category: c.id, since: Date.now(), minRating: range.min, maxRating: range.max, username: username || null });
  return { matched: false, ...queueState(user.id) };
}
export function queueLeave(userId) { const had = queue.delete(userId); return { searching: false, left: had }; }
export function queueTick() {
  const now = Date.now();
  for (const [uid, e] of queue) if (now - e.since > CONFIG.queueMs) { queue.delete(uid); rt.sendUser(uid, { t: 'queue', status: 'timeout' }); }
}
export function searchPlayers(query, limit = 20) {
  const s = String(query || '').trim().slice(0, 20);
  if (s.length < 2) return [];
  return q.all(`SELECT u.public_id,u.username,r.rating FROM users u LEFT JOIN rankings r ON r.user_id=u.id AND r.category='geral'
    WHERE u.status='active' AND u.username LIKE ? ESCAPE '\\' ORDER BY r.rating DESC LIMIT ?`, `%${s.replace(/[\\%_]/g, '\\$&')}%`, limit)
    .map((r) => ({ id: r.public_id, username: r.username, rating: r.rating ?? 1000 }));
}
export const _queueSize = () => queue.size;
