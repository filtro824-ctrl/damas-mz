// API HTTP (JSON) + ficheiros estáticos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { CONFIG, CATEGORIES, WAIT_OPTIONS, ROLES, isStaff, roleAtLeast } from './config.js';
import * as auth from './auth.js';
import * as points from './points.js';
import * as notifs from './notify.js';
import * as lobby from './lobby.js';
import * as games from './games.js';
import * as tournaments from './tournaments.js';
import * as rt from './realtime.js';
import * as plans from './plans.js';
import * as payments from './payments.js';
import * as progression from './progression.js';
import { audit, secEvent, clientIp, rateLimit } from './security.js';
import { VARIANT } from '../shared/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const routes = [];
function route(method, pattern, opts, fn) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, fn });
}

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new auth.AppError('too_large', 'Pedido demasiado grande.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- utilitários
const ratingRow = (userId, cat = 'geral') => q.get('SELECT rating,wins,losses,draws FROM rankings WHERE user_id=? AND category=?', userId, cat) || { rating: 1000, wins: 0, losses: 0, draws: 0 };
const int = (v, d) => (Number.isInteger(Number(v)) ? Number(v) : d);
const userByPublic = (pid) => {
  const u = q.get('SELECT * FROM users WHERE public_id=?', pid);
  if (!u) throw new auth.AppError('not_found', 'Utilizador não encontrado.', 404);
  return u;
};

function meView(u) {
  const subscription = plans.subscriptionFor(u.id);
  const progress = progression.forUser(u.id);
  return {
    user: auth.publicUser(u),
    staff: isStaff(u.role),
    balance: points.balance(u.id),
    rating: ratingRow(u.id),
    progression: progress,
    subscription,
    activeGames: games.activeGameIds(u.id),
    unread: notifs.unreadCount(u.id),
  };
}

function gameRows(where, params, limit = 100) {
  return q.all(
    `SELECT g.*, uw.username wn, uw.public_id wp, ub.username bn, ub.public_id bp
       FROM games g JOIN users uw ON uw.id=g.white_id JOIN users ub ON ub.id=g.black_id
      ${where} ORDER BY g.created_at DESC LIMIT ?`, ...params, limit);
}

function historyItem(g, userId) {
  const color = g.white_id === userId ? 'w' : 'b';
  const mine = g.status === 'finished' || g.status === 'draw' ? (g.result === 'd' ? 'draw' : g.result === color ? 'win' : 'loss') : null;
  const now = Date.now();
  return {
    id: g.id,
    opponent: color === 'w' ? { id: g.bp, username: g.bn } : { id: g.wp, username: g.wn },
    color, category: g.category, status: g.status, result: mine, reason: g.reason,
    createdAt: g.created_at, startedAt: g.started_at, endedAt: g.ended_at,
    durationMs: g.started_at ? (g.ended_at || now) - g.started_at : 0,
    plies: g.ply,
    disconnects: { you: color === 'w' ? g.disconnects_w : g.disconnects_b, opponent: color === 'w' ? g.disconnects_b : g.disconnects_w },
  };
}

function adminGameRow(g) {
  return {
    id: g.id, white: { id: g.wp, username: g.wn }, black: { id: g.bp, username: g.bn }, category: g.category, status: g.status,
    result: g.result, reason: g.reason, plies: g.ply, createdAt: g.created_at, startedAt: g.started_at, endedAt: g.ended_at, disconnects: g.disconnects_w + g.disconnects_b,
  };
}

function detectImage(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// ---------------------------------------------------------------- rotas públicas
route('GET', '/api/health', {}, () => ({ ok: true, time: Date.now() }));

route('GET', '/api/config', {}, () => ({
  categories: Object.values(CATEGORIES), waits: WAIT_OPTIONS, clockMinutes: CONFIG.clockMs / 60000,
  startTimeoutSeconds: CONFIG.startTimeoutMs / 1000, reviewMinutes: CONFIG.reviewAfterMs / 60000, queueSeconds: CONFIG.queueMs / 1000,
  variant: VARIANT.name, serverNow: Date.now(), xpAwards: { win: 25, draw: 10, participation: 5 }, paymentAvailable: payments.checkoutAvailable(),
}));

route('GET', '/api/plans', {}, () => ({ items: plans.listPlans() }));

route('POST', '/api/auth/register', {}, async (c) => {
  const { user, token, recoveryCode } = await auth.register({ username: c.body.username, password: c.body.password, ip: c.ip, ua: c.req.headers['user-agent'] });
  c.res.setHeader('Set-Cookie', auth.cookieHeader(token, CONFIG.secureCookie || c.req.headers['x-forwarded-proto'] === 'https'));
  return { ...meView(user), recoveryCode };
});

route('POST', '/api/auth/login', {}, async (c) => {
  const { user, token } = await auth.login({ username: c.body.username, password: c.body.password, ip: c.ip, ua: c.req.headers['user-agent'] });
  c.res.setHeader('Set-Cookie', auth.cookieHeader(token, CONFIG.secureCookie || c.req.headers['x-forwarded-proto'] === 'https'));
  return meView(user);
});

route('POST', '/api/auth/logout', {}, (c) => {
  auth.destroySession(c.token);
  c.res.setHeader('Set-Cookie', auth.clearCookieHeader());
  return { ok: true };
});

route('POST', '/api/auth/recover', {}, async (c) => auth.recover({ username: c.body.username, recoveryCode: c.body.recoveryCode, newPassword: c.body.newPassword, ip: c.ip }));

// ---------------------------------------------------------------- conta
route('GET', '/api/me', { auth: true }, (c) => meView(c.user));

route('GET', '/api/subscription', { auth: true }, (c) => ({ subscription: plans.subscriptionFor(c.user.id), payments: payments.listMine(c.user.id), paymentAvailable: payments.checkoutAvailable() }));
route('POST', '/api/subscription/checkout', { auth: true }, (c) => {
  const plan = plans.listPlans().find((p) => p.code === String(c.body.planCode || ''));
  if (!plan || plan.code === 'free') throw new auth.AppError('bad_plan', 'Selecione Premium ou VIP.');
  return payments.startCheckout(c.user, plan);
});
route('GET', '/api/payments/mine', { auth: true }, (c) => ({ items: payments.listMine(c.user.id) }));
route('POST', '/api/payments/webhook/:provider', { raw: 32 * 1024 }, (c) => ({ ok: true, ...payments.verifyAndApplyWebhook(c.params.provider, c.raw, c.req.headers['x-damas-signature']) }));
route('POST', '/api/me/theme', { auth: true }, (c) => ({ theme: plans.setTheme(c.user.id, String(c.body.theme || '')) }));
route('POST', '/api/me/bio', { auth: true }, (c) => ({ bio: plans.setBio(c.user.id, c.body.bio) }));

route('POST', '/api/me/password', { auth: true }, async (c) => {
  await auth.changePassword(c.user, c.body.oldPassword, c.body.newPassword, c.ip);
  return { ok: true };
});

route('POST', '/api/me/avatar', { auth: true, raw: 300 * 1024 }, (c) => {
  const ext = detectImage(c.raw);
  if (!ext) throw new auth.AppError('bad_image', 'Imagem inválida (use PNG, JPEG ou WebP até 300 KB).');
  const dir = path.join(CONFIG.dataDir, 'avatars');
  fs.mkdirSync(dir, { recursive: true });
  for (const e of ['png', 'jpg', 'webp']) fs.rmSync(path.join(dir, `${c.user.public_id}.${e}`), { force: true });
  fs.writeFileSync(path.join(dir, `${c.user.public_id}.${ext}`), c.raw);
  q.run('UPDATE profiles SET avatar_ext=?, avatar_ts=? WHERE user_id=?', ext, Date.now(), c.user.id);
  return { user: auth.publicUser(c.user) };
});

route('GET', '/avatars/:pid', { auth: true, binary: true }, (c) => {
  const p = q.get('SELECT p.avatar_ext FROM profiles p JOIN users u ON u.id=p.user_id WHERE u.public_id=?', c.params.pid);
  if (!p?.avatar_ext) throw new auth.AppError('not_found', 'Sem fotografia.', 404);
  const file = path.join(CONFIG.dataDir, 'avatars', `${c.params.pid}.${p.avatar_ext}`);
  if (!fs.existsSync(file)) throw new auth.AppError('not_found', 'Sem fotografia.', 404);
  return { binary: fs.readFileSync(file), type: MIME['.' + p.avatar_ext] || 'application/octet-stream' };
});

route('GET', '/api/points', { auth: true }, (c) => ({ balance: points.balance(c.user.id), ledger: points.recent(c.user.id, 20), virtualOnly: true }));

route('GET', '/api/notifications', { auth: true }, (c) => ({ items: notifs.list(c.user.id) }));
route('POST', '/api/notifications/read', { auth: true }, (c) => { notifs.markRead(c.user.id); return { ok: true }; });

route('GET', '/api/users/:pid', { auth: true }, (c) => {
  const u = userByPublic(c.params.pid);
  const ranks = q.all('SELECT category,rating,wins,losses,draws,win_streak,best_streak FROM rankings WHERE user_id=?', u.id);
  const advancedStats = plans.hasFeature(c.user.id, 'advanced_stats');
  const detailedStats = u.id === c.user.id && plans.hasFeature(c.user.id, 'detailed_stats') ? progression.detailedForUser(u.id) : null;
  return { user: auth.publicUser(u), online: rt.isOnline(u.id), rankings: advancedStats ? ranks : ranks.filter((r) => r.category === 'geral'), progression: progression.forUser(u.id), advancedStats, detailedStats };
});

route('GET', '/api/rankings', { auth: true }, (c) => {
  const cat = String(c.query.get('category') || 'geral');
  const period = String(c.query.get('period') || 'general');
  if (!['general', 'week', 'month'].includes(period)) throw new auth.AppError('bad_period', 'Período de classificação inválido.');
  if (period !== 'general') {
    const start = Date.now() - (period === 'week' ? 7 : 30) * 86400_000;
    const rows = q.all(`SELECT u.public_id,u.username,COALESCE(SUM(l.amount),0) score,
      COALESCE(r.rating,1000) rating,COALESCE(r.wins,0) wins,COALESCE(r.losses,0) losses,COALESCE(r.draws,0) draws
      FROM users u JOIN ledger l ON l.user_id=u.id LEFT JOIN rankings r ON r.user_id=u.id AND r.category='geral'
      WHERE u.status='active' AND l.created_at>=? AND l.kind IN ('VITORIA_XP','EMPATE_XP','PARTICIPACAO_XP')
      GROUP BY u.id HAVING score>0 ORDER BY score DESC,r.rating DESC LIMIT 50`, start);
    return { category: cat, period, items: rows.map((r, i) => ({ position: i + 1, id: r.public_id, username: r.username, score: r.score, rating: r.rating, wins: r.wins, losses: r.losses, draws: r.draws, progression: progression.forUser(q.get('SELECT id FROM users WHERE public_id=?', r.public_id).id) })) };
  }
  const rows = q.all(
    `SELECT u.public_id, u.username, r.rating, r.wins, r.losses, r.draws,r.win_streak,r.best_streak FROM rankings r JOIN users u ON u.id=r.user_id
      WHERE r.category=? AND (r.wins+r.losses+r.draws)>0 AND u.status='active' ORDER BY r.rating DESC, r.wins DESC LIMIT 50`, cat);
  return { category: cat, period, items: rows.map((r, i) => ({ position: i + 1, id: r.public_id, username: r.username, rating: r.rating, wins: r.wins, losses: r.losses, draws: r.draws, winStreak: r.win_streak, bestStreak: r.best_streak, progression: progression.forUser(q.get('SELECT id FROM users WHERE public_id=?', r.public_id).id) })) };
});

// ---------------------------------------------------------------- salas e matchmaking
route('GET', '/api/rooms', { auth: true }, (c) => ({ items: lobby.listOpen(c.user.id), serverNow: Date.now() }));
route('GET', '/api/rooms/mine', { auth: true }, (c) => ({ items: lobby.listMine(c.user.id), serverNow: Date.now() }));
route('POST', '/api/rooms', { auth: true }, (c) => ({ room: lobby.createRoom(c.user, { category: c.body.category, waitSeconds: Number(c.body.waitSeconds), visibility: c.body.visibility || 'public', title: c.body.title, minRating: c.body.minRating == null ? null : Number(c.body.minRating), maxRating: c.body.maxRating == null ? null : Number(c.body.maxRating) }) }));
route('POST', '/api/rooms/invite', { auth: true }, (c) => ({ gameId: lobby.joinByInvite(c.user, c.body.code).id }));
route('POST', '/api/rooms/:id/join', { auth: true }, (c) => ({ gameId: lobby.joinRoom(c.user, c.params.id, c.body.inviteCode || null).id }));
route('POST', '/api/rooms/:id/cancel', { auth: true }, (c) => { lobby.cancelRoom(c.user, c.params.id); return { ok: true }; });

route('GET', '/api/queue', { auth: true }, (c) => lobby.queueState(c.user.id));
route('POST', '/api/queue', { auth: true }, (c) => lobby.queueJoin(c.user, c.body.category, { minRating: c.body.minRating == null ? null : Number(c.body.minRating), maxRating: c.body.maxRating == null ? null : Number(c.body.maxRating), username: c.body.username || '' }));
route('DELETE', '/api/queue', { auth: true }, (c) => lobby.queueLeave(c.user.id));
route('GET', '/api/players/search', { auth: true }, (c) => {
  plans.requirePlan(c.user.id, 'premium', 'Pesquisa de adversários');
  return { items: lobby.searchPlayers(c.query.get('q')) };
});

function canReadHistory(userId, game) {
  if (plans.hasFeature(userId, 'full_history') || !['finished', 'draw', 'cancelled'].includes(game.status)) return true;
  const later = q.get(`SELECT COUNT(*) n FROM games WHERE (white_id=? OR black_id=?) AND created_at>?`, userId, userId, game.created_at).n;
  return later < 20;
}

// ---------------------------------------------------------------- partidas
route('GET', '/api/games/mine', { auth: true }, (c) => ({ items: gameRows('WHERE g.white_id=? OR g.black_id=?', [c.user.id, c.user.id], plans.hasFeature(c.user.id, 'full_history') ? 1000 : 20).map((g) => historyItem(g, c.user.id)), fullHistory: plans.hasFeature(c.user.id, 'full_history') }));

route('GET', '/api/games/:id', { auth: true }, (c) => {
  const g = games.loadGame(c.params.id);
  if (!g) throw new auth.AppError('not_found', 'Partida não encontrada.', 404);
  const isPlayer = g.white_id === c.user.id || g.black_id === c.user.id;
  if (!isPlayer && !isStaff(c.user.role)) throw new auth.AppError('forbidden', 'Sem permissão.', 403);
  if (isPlayer && !canReadHistory(c.user.id, g)) throw new auth.AppError('plan_required', 'O histórico completo requer VIP.', 403);
  const out = { game: games.view(g, c.user.id), moves: games.movesOf(g.id) };
  if (isStaff(c.user.role)) out.events = games.eventsOf(g.id);
  return out;
});

// ---------------------------------------------------------------- denúncias e torneios
route('POST', '/api/reports', { auth: true }, (c) => {
  if (!rateLimit(`report:${c.user.id}`, 10, 3600_000)) throw new auth.AppError('rate_limited', 'Demasiadas denúncias. Tente mais tarde.', 429);
  const reason = String(c.body.reason || '').trim();
  if (reason.length < 10 || reason.length > 1000) throw new auth.AppError('bad_reason', 'Descreva o problema (10 a 1000 caracteres).');
  const target = c.body.targetUsername ? q.get('SELECT id FROM users WHERE username=?', String(c.body.targetUsername)) : null;
  if (c.body.targetUsername && !target) throw new auth.AppError('not_found', 'Utilizador denunciado não encontrado.', 404);
  const gameId = c.body.gameId ? String(c.body.gameId).slice(0, 40) : null;
  q.run('INSERT INTO reports(reporter_id,target_user_id,game_id,reason,created_at) VALUES(?,?,?,?,?)', c.user.id, target?.id ?? null, gameId, reason, Date.now());
  return { ok: true };
});

route('GET', '/api/tournaments', { auth: true }, () => ({ items: tournaments.list() }));
route('GET', '/api/tournaments/:id', { auth: true }, (c) => tournaments.detail(int(c.params.id, 0), c.user.id));
route('POST', '/api/tournaments/:id/join', { auth: true }, (c) => tournaments.join(c.user, int(c.params.id, 0)));
route('POST', '/api/tournaments/:id/leave', { auth: true }, (c) => { tournaments.leave(c.user, int(c.params.id, 0)); return { ok: true }; });

// ---------------------------------------------------------------- administração
const A = (min) => ({ auth: true, min });

route('GET', '/api/admin/dashboard', A('support'), () => {
  const day = Date.now() - 86400_000;
  const n = (sql, ...p) => q.get(sql, ...p).n;
  return {
    users: n('SELECT COUNT(*) n FROM users'),
    online: rt.onlineCount(),
    gamesLive: n("SELECT COUNT(*) n FROM games WHERE status IN ('active','awaiting_reconnect','interrupted','waiting_start')"),
    gamesReview: n("SELECT COUNT(*) n FROM games WHERE status='under_review'"),
    gamesDay: n("SELECT COUNT(*) n FROM games WHERE status IN ('finished','draw') AND ended_at>?", day),
    roomsOpen: n("SELECT COUNT(*) n FROM rooms WHERE status='open'"),
    reportsOpen: n("SELECT COUNT(*) n FROM reports WHERE status='open'"),
    securityDay: n('SELECT COUNT(*) n FROM security_events WHERE created_at>?', day),
    registeredDay: n('SELECT COUNT(*) n FROM users WHERE created_at>?', day),
    activeSubscriptions: n("SELECT COUNT(*) n FROM subscriptions WHERE status='active' AND expires_at>?", Date.now()),
    pendingPayments: n("SELECT COUNT(*) n FROM payments WHERE status='pending'"),
  };
});

route('GET', '/api/admin/users', A('support'), (c) => {
  const s = `%${String(c.query.get('search') || '').slice(0, 40).replace(/[\\%_]/g, '\\$&')}%`; // escapa os curingas do LIKE (não os apaga)
  const rows = q.all("SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR public_id LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100", s, s);
  return { items: rows.map((u) => ({ id: u.public_id, username: u.username, role: u.role, status: u.status, statusReason: u.status_reason, createdAt: u.created_at, lastSeen: u.last_seen, online: rt.isOnline(u.id), rating: ratingRow(u.id).rating, xp: points.balance(u.id), plan: plans.currentPlanCode(u.id) })) };
});

route('POST', '/api/admin/users/:pid/status', A('moderator'), (c) => {
  const u = userByPublic(c.params.pid);
  const status = c.body.status;
  if (!['active', 'suspended'].includes(status)) throw new auth.AppError('bad_request', 'Estado inválido.');
  if (u.id === c.user.id) throw new auth.AppError('forbidden', 'Não pode alterar a sua própria conta.', 403);
  if (!(c.user.role === 'admin' ? u.role !== 'admin' : !roleAtLeast(u.role, c.user.role))) throw new auth.AppError('forbidden', 'Sem permissão sobre este utilizador.', 403);
  const reason = String(c.body.reason || '').slice(0, 300);
  q.run('UPDATE users SET status=?, status_reason=? WHERE id=?', status, status === 'suspended' ? reason : null, u.id);
  if (status === 'suspended') { auth.destroyUserSessions(u.id); for (const cn of rt.connectionsOf(u.id)) cn.close(4001); }
  audit(c.user.id, `user_${status}`, u.public_id, { reason }, c.ip);
  return { ok: true };
});

route('POST', '/api/admin/users/:pid/role', A('admin'), (c) => {
  const u = userByPublic(c.params.pid);
  if (!ROLES.includes(c.body.role)) throw new auth.AppError('bad_request', 'Papel inválido.');
  if (u.id === c.user.id) throw new auth.AppError('forbidden', 'Não pode alterar o seu próprio papel.', 403);
  q.run('UPDATE users SET role=? WHERE id=?', c.body.role, u.id);
  audit(c.user.id, 'user_role', u.public_id, { from: u.role, to: c.body.role }, c.ip);
  return { ok: true };
});

route('POST', '/api/admin/users/:pid/points', A('admin'), (c) => {
  const u = userByPublic(c.params.pid);
  const amount = int(c.body.amount, NaN);
  const note = String(c.body.note || '').trim().slice(0, 200);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 || note.length < 3) throw new auth.AppError('bad_request', 'Indique um valor positivo até 100000 XP e uma justificação.');
  points.award(u.id, 'AJUSTE_ADMIN_XP', amount, null, note);
  audit(c.user.id, 'points_adjust', u.public_id, { amount, note }, c.ip);
  return { balance: points.balance(u.id) };
});

route('POST', '/api/admin/users/:pid/rating', A('admin'), (c) => {
  const u = userByPublic(c.params.pid);
  const rating = int(c.body.rating, NaN);
  const note = String(c.body.note || '').trim().slice(0, 200);
  if (!Number.isInteger(rating) || rating < 0 || rating > 4000 || note.length < 3) throw new auth.AppError('bad_request', 'Indique um rating de 0 a 4000 e uma justificação.');
  q.run("INSERT OR IGNORE INTO rankings(user_id,category) VALUES(?,'geral')", u.id);
  const before = q.get("SELECT rating FROM rankings WHERE user_id=? AND category='geral'", u.id).rating;
  q.run("UPDATE rankings SET rating=? WHERE user_id=? AND category='geral'", rating, u.id);
  audit(c.user.id, 'ranking_rating_adjust', u.public_id, { before, rating, note }, c.ip);
  return { rating };
});

route('GET', '/api/admin/games', A('support'), (c) => {
  const st = String(c.query.get('status') || '');
  const rows = st ? gameRows('WHERE g.status=?', [st], 200) : gameRows('', [], 200);
  return { items: rows.map(adminGameRow) };
});

route('POST', '/api/admin/games/:id/resolve', A('moderator'), (c) => {
  const g = games.loadGame(c.params.id);
  if (!g) throw new auth.AppError('not_found', 'Partida não encontrada.', 404);
  const note = String(c.body.note || '').slice(0, 300);
  games.adminResolve(g, String(c.body.action), c.user.id, note);
  audit(c.user.id, 'game_resolve', g.id, { action: c.body.action, note }, c.ip);
  return { ok: true };
});

route('GET', '/api/admin/rooms', A('support'), () => ({ items: lobby.listAll(200) }));
route('POST', '/api/admin/rooms/:id/cancel', A('moderator'), (c) => {
  const id = String(c.params.id);
  const result = lobby.cancelRoomAdmin(id);
  audit(c.user.id, 'admin_room_cancelled', id, {}, c.ip);
  return result;
});

route('GET', '/api/admin/plans', A('support'), () => ({ items: plans.listPlans() }));
route('POST', '/api/admin/plans/:code', A('admin'), (c) => ({ plan: plans.updatePlan(c.params.code, { priceMzn: int(c.body.priceMzn, NaN), active: c.body.active === true }, c.user.id) }));
route('GET', '/api/admin/subscriptions', A('support'), () => ({ items: q.all(`SELECT s.id,s.user_id,u.public_id,u.username,s.plan_code,s.status,s.starts_at,s.expires_at,s.provider,s.provider_ref
  FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 300`).map((r) => ({ id: r.id, userId: r.public_id, username: r.username, planCode: r.plan_code, status: r.status, startsAt: r.starts_at, expiresAt: r.expires_at, provider: r.provider, providerRef: r.provider_ref })) }));
route('POST', '/api/admin/subscriptions/:id/cancel', A('admin'), (c) => {
  const result = q.run("UPDATE subscriptions SET status='cancelled',updated_at=? WHERE id=? AND status='active'", Date.now(), int(c.params.id, 0));
  if (!result.changes) throw new auth.AppError('not_found', 'Subscrição ativa não encontrada.', 404);
  audit(c.user.id, 'subscription_cancelled', c.params.id, {}, c.ip);
  return { ok: true };
});
route('GET', '/api/admin/payments', A('support'), () => ({ items: payments.listAdmin(), paymentAvailable: payments.checkoutAvailable() }));

route('POST', '/api/admin/tournaments', A('admin'), (c) => {
  const id = tournaments.create(c.body.name, Number(c.body.size), c.user.id);
  audit(c.user.id, 'tournament_create', id, { name: c.body.name, size: c.body.size }, c.ip);
  return { id };
});

route('GET', '/api/admin/reports', A('support'), () => ({
  items: q.all(`SELECT r.*, ur.username rn, ut.username tn FROM reports r JOIN users ur ON ur.id=r.reporter_id LEFT JOIN users ut ON ut.id=r.target_user_id ORDER BY r.id DESC LIMIT 200`)
    .map((r) => ({ id: r.id, reporter: r.rn, target: r.tn, gameId: r.game_id, reason: r.reason, status: r.status, note: r.note, createdAt: r.created_at })),
}));

route('POST', '/api/admin/reports/:id', A('moderator'), (c) => {
  const status = c.body.status;
  if (!['open', 'closed', 'dismissed'].includes(status)) throw new auth.AppError('bad_request', 'Estado inválido.');
  const r = q.run('UPDATE reports SET status=?, note=?, handled_by=?, handled_at=? WHERE id=?', status, String(c.body.note || '').slice(0, 300), c.user.id, Date.now(), int(c.params.id, 0));
  if (r.changes !== 1) throw new auth.AppError('not_found', 'Denúncia não encontrada.', 404);
  audit(c.user.id, 'report_update', c.params.id, { status }, c.ip);
  return { ok: true };
});

route('GET', '/api/admin/security', A('moderator'), () => ({
  items: q.all('SELECT s.*, u.username FROM security_events s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200')
    .map((s) => ({ id: s.id, kind: s.kind, user: s.username, detail: JSON.parse(s.detail_json || '{}'), ip: s.ip, at: s.created_at })),
}));

route('GET', '/api/admin/audit', A('moderator'), () => ({
  items: q.all('SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200')
    .map((a) => ({ id: a.id, actor: a.username, action: a.action, target: a.target, detail: JSON.parse(a.detail_json || '{}'), ip: a.ip, at: a.created_at })),
}));

route('GET', '/api/admin/stats', A('support'), () => {
  const since = Date.now() - 14 * 86400_000;
  const perDay = (table, col) => q.all(`SELECT strftime('%Y-%m-%d', ${col}/1000, 'unixepoch') d, COUNT(*) n FROM ${table} WHERE ${col}>? GROUP BY d ORDER BY d`, since);
  return {
    gamesPerDay: perDay('games', 'created_at'),
    usersPerDay: perDay('users', 'created_at'),
    byCategory: q.all('SELECT category, COUNT(*) n FROM games GROUP BY category'),
    byStatus: q.all('SELECT status, COUNT(*) n FROM games GROUP BY status'),
    byReason: q.all("SELECT COALESCE(reason,'-') reason, COUNT(*) n FROM games WHERE status IN ('finished','draw') GROUP BY reason"),
    avgPlies: q.get("SELECT COALESCE(ROUND(AVG(ply),1),0) n FROM games WHERE status IN ('finished','draw')").n,
    xpInCirculation: q.get('SELECT COALESCE(SUM(amount),0) n FROM ledger').n,
  };
});

route('GET', '/api/admin/config', A('admin'), () => ({
  variant: VARIANT, clockMinutes: CONFIG.clockMs / 60000, startTimeoutSeconds: CONFIG.startTimeoutMs / 1000,
  reviewAfterMinutes: CONFIG.reviewAfterMs / 60000, queueSeconds: CONFIG.queueMs / 1000, startingPoints: CONFIG.startingPoints,
  offlineGraceMs: CONFIG.offlineGraceMs, categories: Object.values(CATEGORIES), waitOptions: WAIT_OPTIONS,
  plans: plans.listPlans(), paymentAvailable: payments.checkoutAvailable(),
}));

// ---------------------------------------------------------------- despacho
async function api(req, res, url) {
  const ip = clientIp(req);
  if (!rateLimit(`api:${ip}`, 600, 60_000)) throw new auth.AppError('rate_limited', 'Demasiados pedidos. Abrande um pouco.', 429);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  let match = null;
  let params = {};
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (m) { match = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
  }
  if (!match) throw new auth.AppError('not_found', 'Recurso não encontrado.', 404);

  if (method !== 'GET') {
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* inválido */ }
      if (host !== req.headers.host) throw new auth.AppError('forbidden', 'Origem não permitida.', 403);
    }
  }

  const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
  const user = auth.userFromToken(token);
  if (match.opts.auth && !user) throw new auth.AppError('unauthorized', 'Sessão expirada. Entre novamente.', 401);
  if (match.opts.min && !roleAtLeast(user.role, match.opts.min)) {
    secEvent(user.id, 'forbidden_admin_access', { path: url.pathname }, ip);
    throw new auth.AppError('forbidden', 'Sem permissão.', 403);
  }
  if (user) q.run('UPDATE users SET last_seen=? WHERE id=?', Date.now(), user.id);

  const ctx = { req, res, url, query: url.searchParams, params, ip, user, token, body: {}, raw: null };
  if (method !== 'GET' && method !== 'DELETE') {
    if (match.opts.raw) ctx.raw = await readBody(req, match.opts.raw);
    else {
      const buf = await readBody(req, 100 * 1024);
      if (buf.length) {
        try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { throw new auth.AppError('bad_json', 'JSON inválido.'); }
        if (ctx.body === null || typeof ctx.body !== 'object') ctx.body = {};
      }
    }
  }
  const out = await match.fn(ctx);
  if (out && out.binary) {
    send(res, 200, out.binary, { 'Content-Type': out.type, 'Cache-Control': 'private, max-age=86400' });
  } else sendJson(res, 200, out ?? { ok: true });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  let base = PUBLIC;
  let rel = p;
  if (p.startsWith('/shared/')) { base = SHARED; rel = p.slice('/shared'.length); }
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = file.endsWith('sw.js') || type.startsWith('text/html') ? 'no-cache' : 'no-cache';
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

export function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/avatars/')) {
    api(req, res, url).catch((e) => {
      if (e instanceof auth.AppError || e instanceof games.GameError) return sendJson(res, e.status || 400, { error: e.code, message: e.message });
      console.error('Erro interno:', e);
      sendJson(res, 500, { error: 'internal', message: 'Erro interno do servidor.' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
  serveStatic(req, res, url);
}
