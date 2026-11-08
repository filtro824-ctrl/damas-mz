// Autenticação: registo, login, sessões, recuperação por código, alteração de palavra-passe.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q, tx } from './db.js';
import { CONFIG } from './config.js';
import * as points from './points.js';
import { audit, secEvent, rateLimit, rateReset, rateCount } from './security.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 24 * 3600 * 1000;
export const COOKIE = 'dmz_session';

export class AppError extends Error {
  constructor(code, message, status = 400) { super(message || code); this.code = code; this.status = status; }
}

export async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(secret, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifySecret(secret, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const hash = await scrypt(secret, Buffer.from(s, 'base64'), 64);
  const expected = Buffer.from(h, 'base64');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

function newPublicId() {
  for (;;) {
    const id = 'DM' + crypto.randomInt(100000, 999999);
    if (!q.get('SELECT 1 x FROM users WHERE public_id=?', id)) return id;
  }
}
function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${part()}-${part()}-${part()}-${part()}`;
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new AppError('weak_password', 'A palavra-passe deve ter pelo menos 8 caracteres.');
  if (pw.length > 100) throw new AppError('weak_password', 'Palavra-passe demasiado longa.');
}

export function publicUser(u) {
  const prof = q.get('SELECT avatar_ext, avatar_ts, theme_id, bio FROM profiles WHERE user_id=?', u.id);
  return {
    id: u.public_id,
    username: u.username,
    role: u.role,
    createdAt: u.created_at,
    avatar: prof?.avatar_ext ? `/avatars/${u.public_id}?v=${prof.avatar_ts}` : null,
    theme: prof?.theme_id || 'classic',
    bio: prof?.bio || '',
  };
}

export function createUserRow({ username, passHash, recoveryHash, role = 'user' }) {
  return tx(() => {
    const now = Date.now();
    const r = q.run(
      'INSERT INTO users(public_id,username,pass_hash,recovery_hash,role,created_at) VALUES(?,?,?,?,?,?)',
      newPublicId(), username, passHash, recoveryHash, role, now,
    );
    const id = Number(r.lastInsertRowid);
    q.run('INSERT INTO profiles(user_id) VALUES(?)', id);
    q.run("INSERT INTO rankings(user_id,category) VALUES(?, 'geral')", id);
    if (CONFIG.startingPoints > 0) points.award(id, 'XP_INICIAL', CONFIG.startingPoints, null, 'XP inicial de progressão');
    return q.get('SELECT * FROM users WHERE id=?', id);
  });
}

export async function createSession(userId, ip, ua) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  q.run('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)', sha(token), userId, now, now + SESSION_MS, ip, String(ua || '').slice(0, 200));
  return token;
}

export function userFromToken(token) {
  if (!token) return null;
  const s = q.get('SELECT * FROM sessions WHERE token_hash=?', sha(token));
  if (!s || s.expires_at < Date.now()) return null;
  const u = q.get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || u.status !== 'active') return null;
  return u;
}

export function destroySession(token) { if (token) q.run('DELETE FROM sessions WHERE token_hash=?', sha(token)); }
export function destroyUserSessions(userId) { q.run('DELETE FROM sessions WHERE user_id=?', userId); }

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(token, secure) {
  const base = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
  return secure ? base + '; Secure' : base;
}
export const clearCookieHeader = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export async function register({ username, password, ip, ua }) {
  if (!rateLimit(`reg:${ip}`, CONFIG.registerPerHour, 3600_000)) throw new AppError('rate_limited', 'Demasiados registos a partir desta rede. Tente mais tarde.', 429);
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw new AppError('bad_username', 'Nome de utilizador: 3 a 20 caracteres (letras, números, _ . e -).');
  validatePassword(password);
  if (q.get('SELECT 1 x FROM users WHERE username=?', username)) throw new AppError('username_taken', 'Esse nome de utilizador já existe.', 409);
  const recoveryCode = newRecoveryCode();
  const [passHash, recoveryHash] = await Promise.all([hashSecret(password), hashSecret(recoveryCode)]);
  let user;
  try { user = createUserRow({ username, passHash, recoveryHash }); }
  catch (e) { if (/UNIQUE/i.test(String(e.message))) throw new AppError('username_taken', 'Esse nome de utilizador já existe.', 409); throw e; }
  q.run('UPDATE users SET last_ip=?, last_seen=? WHERE id=?', ip, Date.now(), user.id);
  const token = await createSession(user.id, ip, ua);
  return { user, token, recoveryCode };
}

export async function login({ username, password, ip, ua }) {
  const keyU = `login:${ip}:${String(username).toLowerCase()}`;
  const keyI = `loginip:${ip}`;
  if (rateCount(keyU) >= 5 || rateCount(keyI) >= 40) {
    secEvent(null, 'login_lockout', { username: String(username).slice(0, 30) }, ip);
    throw new AppError('rate_limited', 'Demasiadas tentativas. Aguarde 15 minutos.', 429);
  }
  const u = typeof username === 'string' ? q.get('SELECT * FROM users WHERE username=?', username) : null;
  const ok = u && typeof password === 'string' && (await verifySecret(password, u.pass_hash));
  if (!ok) {
    rateLimit(keyU, 5, 15 * 60_000);
    rateLimit(keyI, 40, 15 * 60_000);
    secEvent(u?.id ?? null, 'login_failed', { username: String(username).slice(0, 30) }, ip);
    throw new AppError('bad_credentials', 'Nome de utilizador ou palavra-passe incorrectos.', 401);
  }
  if (u.status !== 'active') throw new AppError('suspended', 'Esta conta está suspensa. Contacte o suporte.', 403);
  rateReset(keyU);
  q.run('UPDATE users SET last_ip=?, last_seen=? WHERE id=?', ip, Date.now(), u.id);
  const token = await createSession(u.id, ip, ua);
  return { user: u, token };
}

/** Recuperação de acesso através do código de recuperação mostrado uma única vez no registo. */
export async function recover({ username, recoveryCode, newPassword, ip }) {
  const key = `recover:${ip}`;
  if (rateCount(key) >= 5) { secEvent(null, 'recover_lockout', {}, ip); throw new AppError('rate_limited', 'Demasiadas tentativas. Aguarde 15 minutos.', 429); }
  validatePassword(newPassword);
  const u = typeof username === 'string' ? q.get('SELECT * FROM users WHERE username=?', username) : null;
  const code = String(recoveryCode || '').trim().toUpperCase();
  const ok = u && (await verifySecret(code, u.recovery_hash));
  if (!ok) {
    rateLimit(key, 5, 15 * 60_000);
    secEvent(u?.id ?? null, 'recover_failed', {}, ip);
    throw new AppError('bad_recovery', 'Nome de utilizador ou código de recuperação inválidos.', 401);
  }
  if (u.status !== 'active') throw new AppError('suspended', 'Esta conta está suspensa. Contacte o suporte.', 403);
  const newCode = newRecoveryCode();
  const [passHash, recoveryHash] = await Promise.all([hashSecret(newPassword), hashSecret(newCode)]);
  q.run('UPDATE users SET pass_hash=?, recovery_hash=? WHERE id=?', passHash, recoveryHash, u.id);
  destroyUserSessions(u.id);
  audit(u.id, 'password_recovered', u.public_id, {}, ip);
  return { recoveryCode: newCode };
}

export async function changePassword(user, oldPassword, newPassword, ip) {
  validatePassword(newPassword);
  if (!(await verifySecret(String(oldPassword || ''), user.pass_hash))) throw new AppError('bad_credentials', 'Palavra-passe actual incorrecta.', 401);
  q.run('UPDATE users SET pass_hash=? WHERE id=?', await hashSecret(newPassword), user.id);
  audit(user.id, 'password_changed', user.public_id, {}, ip);
}

/** Cria a conta de administrador principal no primeiro arranque. */
export async function ensureAdmin() {
  if (q.get("SELECT 1 x FROM users WHERE role='admin'")) return null;
  const password = CONFIG.adminPassword || crypto.randomBytes(9).toString('base64url');
  const [passHash, recoveryHash] = await Promise.all([hashSecret(password), hashSecret(newRecoveryCode())]);
  const user = createUserRow({ username: CONFIG.adminUsername, passHash, recoveryHash, role: 'admin' });
  return { username: user.username, password, generated: !CONFIG.adminPassword };
}
