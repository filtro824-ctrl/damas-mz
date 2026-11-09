import { one, run, batch, stmt } from './db.js';

const SESSION_MS = 30 * 24 * 3600_000;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const random = (n = 32) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(value))); }
export async function hashSecret(secret, salt = hex(random(16))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$120000$${salt}$${hex(bits)}`;
}
export async function verifySecret(secret, encoded) {
  const [, iterations, salt, expected] = String(encoded || '').split('$');
  if (!iterations || !salt || !expected) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: Number(iterations), hash: 'SHA-256' }, key, 256);
  return hex(bits) === expected;
}
export function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2)); }
export function cookie(token, secure = true) { return `dmz_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`; }
export const clearCookie = () => 'dmz_session=; Path=/; HttpOnly; SameSite=None; Max-Age=0; Secure';
export async function sessionUser(env, request) {
  const token = parseCookies(request.headers.get('Cookie') || '').dmz_session;
  if (!token) return null;
  const s = await one(env.DB, 'SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', await digest(token), Date.now());
  if (!s) return null;
  return one(env.DB, 'SELECT * FROM users WHERE id=? AND status=\'active\'', s.user_id);
}
function validUsername(v) { return typeof v === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(v); }
function validPassword(v) { return typeof v === 'string' && v.length >= 8 && v.length <= 128; }
export async function register(env, body, request) {
  if (!validUsername(body.username) || !validPassword(body.password)) throw new AppError('bad_credentials', 'Nome ou palavra-passe inválidos.', 400);
  const username = body.username.trim();
  if (await one(env.DB, 'SELECT id FROM users WHERE username=? COLLATE NOCASE', username)) throw new AppError('username_taken', 'Esse nome de utilizador já existe.', 409);
  const id = await nextPublicId(env.DB);
  const recoveryCode = [...random(10)].map(x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('').match(/.{1,4}/g).join('-');
  const now = Date.now();
  const userId = (await run(env.DB, 'INSERT INTO users(public_id,username,pass_hash,recovery_hash,role,status,created_at,last_seen,last_ip) VALUES(?,?,?,?,\'user\',\'active\',?,?,?)', id, username, await hashSecret(body.password), await digest(recoveryCode), now, now, request.headers.get('CF-Connecting-IP') || '')).meta.last_row_id;
  await batch(env.DB, [stmt(env.DB, 'INSERT INTO profiles(user_id) VALUES(?)', userId), stmt(env.DB, 'INSERT INTO rankings(user_id,category) VALUES(?,\'geral\')', userId), stmt(env.DB, 'INSERT INTO ledger(user_id,kind,amount,note,created_at) VALUES(?,\'BONUS_INICIAL\',?,?,?)', userId, Number(env.STARTING_POINTS || 5000), 'Pontos demonstrativos iniciais', now)]);
  const token = await createSession(env, userId, request);
  return { user: await one(env.DB, 'SELECT * FROM users WHERE id=?', userId), token, recoveryCode };
}
async function nextPublicId(db) { for (;;) { const id = `DM${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`; if (!await one(db, 'SELECT id FROM users WHERE public_id=?', id)) return id; } }
export async function login(env, body, request) { const u = await one(env.DB, 'SELECT * FROM users WHERE username=? COLLATE NOCASE', String(body.username || '')); if (!u || !(await verifySecret(body.password, u.pass_hash))) throw new AppError('invalid_login', 'Credenciais inválidas.', 401); const token = await createSession(env, u.id, request); return { user: u, token }; }
export async function createSession(env, userId, request) { const token = hex(random(32)); const now = Date.now(); await run(env.DB, 'INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)', await digest(token), userId, now, now + SESSION_MS, request.headers.get('CF-Connecting-IP') || '', (request.headers.get('User-Agent') || '').slice(0, 200)); return token; }
export async function logout(env, request) { const token = parseCookies(request.headers.get('Cookie') || '').dmz_session; if (token) await run(env.DB, 'DELETE FROM sessions WHERE token_hash=?', await digest(token)); }
export const publicUser = (u) => ({ id: u.public_id, username: u.username, role: u.role, status: u.status, createdAt: u.created_at });
export class AppError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }
