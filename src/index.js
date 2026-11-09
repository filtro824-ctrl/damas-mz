import { one, many, run } from './db.js';
import * as auth from './auth.js';
import { GameRoom } from './game-room.js';
export { GameRoom };

const CATEGORIES = { bronze: { id: 'bronze', name: 'Bronze', entry: 100 }, prata: { id: 'prata', name: 'Prata', entry: 250 }, ouro: { id: 'ouro', name: 'Ouro', entry: 500 }, diamante: { id: 'diamante', name: 'Diamante', entry: 1000 } };
const headers = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...headers, ...extra, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const body = async (r) => { try { return await r.json(); } catch { return {}; } };
function error(e) { return json({ error: e.code || 'internal_error', message: e.message || 'Erro interno.' }, e.status || 500); }
function me(u) { return { user: auth.publicUser(u), staff: ['support', 'moderator', 'admin'].includes(u.role) }; }
async function requireUser(env, request) { const u = await auth.sessionUser(env, request); if (!u) throw new auth.AppError('unauthorized', 'Sessão expirada. Entre novamente.', 401); return u; }
function sameOrigin(request) { const origin = request.headers.get('Origin'); return !origin || new URL(origin).host === new URL(request.url).host; }

export default { async fetch(request, env) {
  const url = new URL(request.url);
  try {
    if (request.method !== 'GET' && !sameOrigin(request)) throw new auth.AppError('forbidden', 'Origem não permitida.', 403);
    if (url.pathname === '/api/health') return json({ ok: true, time: Date.now(), runtime: 'cloudflare-workers' });
    if (url.pathname === '/api/config') return json({ categories: Object.values(CATEGORIES), waits: [20, 30], clockMinutes: Number(env.CLOCK_MINUTES || 10), variant: 'Damas Portuguesas FPDJ 2025', serverNow: Date.now() });
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade_required' }, 426);
      const gameId = url.searchParams.get('gameId') || url.pathname.split('/')[2] || 'lobby';
      const u = await requireUser(env, request);
      const id = env.GAME_ROOMS.idFromName(gameId); const stub = env.GAME_ROOMS.get(id);
      const target = new URL(request.url); target.pathname = '/'; target.searchParams.set('userId', String(u.id));
      return stub.fetch(new Request(target, request));
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') { const r = await auth.register(env, await body(request), request); return json({ ...me(r.user), recoveryCode: r.recoveryCode }, 200, { 'Set-Cookie': auth.cookie(r.token, true) }); }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') { const r = await auth.login(env, await body(request), request); return json(me(r.user), 200, { 'Set-Cookie': auth.cookie(r.token, true) }); }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') { await auth.logout(env, request); return json({ ok: true }, 200, { 'Set-Cookie': auth.clearCookie() }); }
    const u = await requireUser(env, request);
    if (url.pathname === '/api/me' && request.method === 'GET') return json(me(u));
    if (url.pathname === '/api/rooms' && request.method === 'GET') { const items = await many(env.DB, "SELECT r.*,u.public_id creator_public_id,u.username creator_name FROM rooms r JOIN users u ON u.id=r.creator_id WHERE r.status='open' AND r.expires_at>? ORDER BY r.created_at DESC LIMIT 100", Date.now()); return json({ items, serverNow: Date.now() }); }
    if (url.pathname === '/api/rooms' && request.method === 'POST') { const b = await body(request); const c = CATEGORIES[b.category]; if (!c || ![20,30].includes(Number(b.waitSeconds))) throw new auth.AppError('bad_room', 'Categoria ou espera inválida.'); const id = crypto.randomUUID(); const now = Date.now(); await run(env.DB, 'INSERT INTO rooms(id,creator_id,category,entry,wait_s,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)', id, u.id, c.id, c.entry, Number(b.waitSeconds), 'open', now, now + Number(b.waitSeconds) * 1000); return json({ room: { id, category: c.id, entry: c.entry, status: 'open', createdAt: now, expiresAt: now + Number(b.waitSeconds) * 1000 } }); }
    return env.ASSETS.fetch(request);
  } catch (e) { return error(e); }
} };
