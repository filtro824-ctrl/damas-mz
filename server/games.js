// Núcleo das partidas: estado persistente, validação de lances, relógios, presença e reconexão.
// O servidor é a única autoridade. O cliente só envia a intenção de jogar (sequência de casas).
import crypto from 'node:crypto';
import * as E from '../shared/engine.js';
import { q, tx } from './db.js';
import { CONFIG } from './config.js';
import * as rt from './realtime.js';
import * as points from './points.js';
import { notify } from './notify.js';
import { audit, secEvent } from './security.js';

export class GameError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const FINAL = new Set(['finished', 'draw', 'cancelled']);
const RUNNABLE = ['active', 'awaiting_reconnect', 'interrupted'];
const cache = new Map(); // id -> jogo em memória (escrita imediata na BD)
const live = new Set(); // ids de jogos não terminados (percorridos pelo relógio de 1 s)
const joined = new Map(); // id -> { w:boolean, b:boolean } (quem já abriu a tela da partida)
const endHooks = [];
const counters = new Map(); // `${gameId}:${userId}` -> { illegal, fast }

export const onGameEnd = (fn) => endHooks.push(fn);
export const isFinal = (g) => FINAL.has(g.status);

// ------------------------------------------------------------------ carregar / guardar
function fromRow(r) { return { ...r, state: JSON.parse(r.state_json) }; }

export function loadGame(id) {
  let g = cache.get(id);
  if (g) return g;
  const r = q.get('SELECT * FROM games WHERE id=?', id);
  if (!r) return null;
  g = fromRow(r);
  if (!FINAL.has(g.status)) { cache.set(id, g); live.add(id); }
  return g;
}

function persist(g) {
  q.run(
    `UPDATE games SET status=?, result=?, reason=?, state_json=?, ply=?, clock_w=?, clock_b=?, turn_started_at=?,
       started_at=?, ended_at=?, interrupted_since=?, disconnects_w=?, disconnects_b=?, settled=? WHERE id=?`,
    g.status, g.result, g.reason, JSON.stringify(g.state), g.ply, g.clock_w, g.clock_b, g.turn_started_at,
    g.started_at, g.ended_at, g.interrupted_since, g.disconnects_w, g.disconnects_b, g.settled, g.id,
  );
}

export function logEvent(gameId, userId, kind, detail) {
  q.run('INSERT INTO game_events(game_id,user_id,kind,detail,created_at) VALUES(?,?,?,?,?)', gameId, userId ?? null, kind, detail ? JSON.stringify(detail) : null, Date.now());
}

export function loadLiveGames() {
  const rows = q.all("SELECT * FROM games WHERE status NOT IN ('finished','draw','cancelled')");
  for (const r of rows) {
    const g = fromRow(r);
    // após reinício do servidor ninguém está ligado: relógios parados e estado "interrompida"
    if (g.status === 'active' || g.status === 'awaiting_reconnect') {
      if (g.turn_started_at) {
        const color = g.state.turn;
        g['clock_' + color] = Math.max(0, g['clock_' + color] - (Date.now() - g.turn_started_at));
        g.turn_started_at = null;
      }
      g.status = 'interrupted';
      g.interrupted_since = Date.now();
      persist(g);
    }
    cache.set(g.id, g);
    live.add(g.id);
  }
  return rows.length;
}

// ------------------------------------------------------------------ vista para o cliente
const colorOfUser = (g, userId) => (g.white_id === userId ? 'w' : g.black_id === userId ? 'b' : null);

function remaining(g, color, now) {
  let ms = g['clock_' + color];
  if (g.turn_started_at && g.state.turn === color && g.status === 'active') ms -= now - g.turn_started_at;
  return Math.max(0, ms);
}

function playerInfo(userId) {
  const u = q.get('SELECT id,public_id,username FROM users WHERE id=?', userId);
  const r = q.get("SELECT rating FROM rankings WHERE user_id=? AND category='geral'", userId);
  const p = q.get('SELECT avatar_ext, avatar_ts FROM profiles WHERE user_id=?', userId);
  return {
    id: u.public_id,
    username: u.username,
    rating: r?.rating ?? 1000,
    online: rt.isOnline(userId),
    avatar: p?.avatar_ext ? `/avatars/${u.public_id}?v=${p.avatar_ts}` : null,
  };
}

export function view(g, userId) {
  const now = Date.now();
  const you = colorOfUser(g, userId);
  const active = g.status === 'active';
  const j = joined.get(g.id) || { w: false, b: false };
  return {
    id: g.id,
    status: g.status,
    category: g.category,
    entry: g.entry,
    you,
    turn: g.state.turn,
    board: g.state.board,
    ply: g.ply,
    result: g.result,
    reason: g.reason,
    white: playerInfo(g.white_id),
    black: playerInfo(g.black_id),
    clocks: { w: remaining(g, 'w', now), b: remaining(g, 'b', now), running: active ? g.state.turn : null },
    serverNow: now,
    legal: active && you === g.state.turn ? E.legalMoves(g.state).map((m) => m.path) : [],
    lastMove: g.lastMove || lastMoveOf(g),
    joined: you ? { you: !!j[you], opponent: !!j[you === 'w' ? 'b' : 'w'] } : null,
    disconnects: { w: g.disconnects_w, b: g.disconnects_b },
    interruptedSince: g.interrupted_since,
    reviewDeadline: g.interrupted_since && RUNNABLE.includes(g.status) ? g.interrupted_since + CONFIG.reviewAfterMs : null,
    startDeadline: g.status === 'waiting_start' ? g.created_at + (g.tournament_id ? CONFIG.tournamentStartMs : CONFIG.startTimeoutMs) : null,
    createdAt: g.created_at,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    tournamentId: g.tournament_id,
  };
}

function lastMoveOf(g) {
  const m = q.get('SELECT path_json FROM game_moves WHERE game_id=? ORDER BY ply DESC LIMIT 1', g.id);
  return m ? JSON.parse(m.path_json) : null;
}

export function pushState(g) {
  rt.sendUser(g.white_id, { t: 'game', game: view(g, g.white_id) });
  rt.sendUser(g.black_id, { t: 'game', game: view(g, g.black_id) });
}

// ------------------------------------------------------------------ criar partida
export function createGame({ whiteId, blackId, category, entry = 0, source = 'room', tournamentId = null, matchId = null }) {
  if (whiteId === blackId) throw new GameError('same_user', 'Não pode jogar contra si próprio.');
  const id = crypto.randomBytes(8).toString('base64url');
  tx(() => {
    if (entry > 0) {
      for (const uid of [whiteId, blackId]) {
        if (points.balance(uid) < entry) throw new GameError('insufficient_points', 'Pontos demonstrativos insuficientes.');
      }
    }
    const now = Date.now();
    const state = E.initialState();
    q.run(
      `INSERT INTO games(id,white_id,black_id,category,entry,source,status,state_json,ply,clock_w,clock_b,created_at,tournament_id,match_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, whiteId, blackId, category, entry, source, 'waiting_start', JSON.stringify(state), 0, CONFIG.clockMs, CONFIG.clockMs, now, tournamentId, matchId,
    );
    if (entry > 0) for (const uid of [whiteId, blackId]) points.add(uid, 'ENTRADA', -entry, id, `Entrada na categoria ${category}`);
    logEvent(id, null, 'created', { whiteId, blackId, category, entry, source });
  });
  const g = loadGame(id);
  const ips = q.all('SELECT last_ip FROM users WHERE id IN (?,?)', whiteId, blackId).map((r) => r.last_ip);
  if (ips[0] && ips[0] === ips[1]) secEvent(null, 'same_ip_match', { gameId: id }, ips[0]); // pista de conluio: só regista
  for (const uid of [whiteId, blackId]) {
    rt.sendUser(uid, { t: 'match', gameId: id });
    notify(uid, 'match', 'A sua partida está pronta. Entre para começar.', { gameId: id });
  }
  return g;
}

// ------------------------------------------------------------------ presença e relógios
function pauseClock(g, now) {
  if (g.turn_started_at) {
    const color = g.state.turn;
    g['clock_' + color] = Math.max(0, g['clock_' + color] - (now - g.turn_started_at));
    g.turn_started_at = null;
  }
}

function maybeStart(g) {
  if (g.status !== 'waiting_start') return false;
  const j = joined.get(g.id);
  if (!j?.w || !j?.b || !rt.isOnline(g.white_id) || !rt.isOnline(g.black_id)) return false;
  const now = Date.now();
  g.status = 'active';
  g.started_at = now;
  g.turn_started_at = now;
  persist(g);
  logEvent(g.id, null, 'started');
  return true;
}

/** Recalcula o estado em função de quem está ligado. */
function refreshPresence(g) {
  if (!RUNNABLE.includes(g.status)) return;
  const wOn = rt.isOnline(g.white_id);
  const bOn = rt.isOnline(g.black_id);
  const want = wOn && bOn ? 'active' : wOn || bOn ? 'awaiting_reconnect' : 'interrupted';
  if (want === g.status) return;
  const now = Date.now();
  if (g.status === 'active') { pauseClock(g, now); g.interrupted_since = now; }
  if (want === 'active') { g.turn_started_at = now; g.interrupted_since = null; }
  g.status = want;
  persist(g);
  logEvent(g.id, null, 'status', { status: want });
}

export function userOnline(userId) {
  const rows = q.all("SELECT id FROM games WHERE (white_id=? OR black_id=?) AND status NOT IN ('finished','draw','cancelled')", userId, userId);
  for (const r of rows) {
    const g = loadGame(r.id);
    if (!g) continue;
    const before = g.status;
    maybeStart(g);
    refreshPresence(g);
    if (RUNNABLE.includes(before) || g.status !== before) logEvent(g.id, userId, 'reconnected');
    pushState(g);
  }
}

export function userOffline(userId) {
  const rows = q.all("SELECT id FROM games WHERE (white_id=? OR black_id=?) AND status NOT IN ('finished','draw','cancelled')", userId, userId);
  for (const r of rows) {
    const g = loadGame(r.id);
    if (!g) continue;
    if (g.started_at && RUNNABLE.includes(g.status)) {
      const c = colorOfUser(g, userId);
      g['disconnects_' + c]++;
      logEvent(g.id, userId, 'disconnected');
    }
    refreshPresence(g);
    persist(g);
    pushState(g);
  }
}

/** O jogador abriu a tela da partida (ou pediu sincronização). */
export function joinGame(userId, gameId) {
  const g = loadGame(gameId);
  if (!g) throw new GameError('not_found', 'Partida não encontrada.');
  const color = colorOfUser(g, userId);
  if (!color) throw new GameError('forbidden', 'Não é jogador desta partida.');
  if (g.status === 'waiting_start') {
    const j = joined.get(g.id) || { w: false, b: false };
    j[color] = true;
    joined.set(g.id, j);
    const started = maybeStart(g);
    if (started) pushState(g); else rt.sendUser(g.white_id === userId ? g.black_id : g.white_id, { t: 'game', game: view(g, g.white_id === userId ? g.black_id : g.white_id) });
  }
  refreshPresence(g);
  return view(g, userId);
}

export function getView(gameId, userId) {
  const g = loadGame(gameId) || (q.get('SELECT id FROM games WHERE id=?', gameId) ? fromRow(q.get('SELECT * FROM games WHERE id=?', gameId)) : null);
  return g ? view(g, userId) : null;
}

// ------------------------------------------------------------------ lances
function bump(gameId, userId, field) {
  const k = `${gameId}:${userId}`;
  const c = counters.get(k) || { illegal: 0, fast: 0, flagged: false };
  c[field]++;
  counters.set(k, c);
  return c;
}

export function makeMove(userId, gameId, { moveId, ply, path }, ip) {
  const g = loadGame(gameId);
  if (!g) throw new GameError('not_found', 'Partida não encontrada.');
  const color = colorOfUser(g, userId);
  if (!color) {
    secEvent(userId, 'move_not_player', { gameId }, ip);
    throw new GameError('forbidden', 'Não é jogador desta partida.');
  }
  if (typeof moveId !== 'string' || moveId.length < 6 || moveId.length > 64) throw new GameError('bad_request', 'Pedido inválido.');

  // idempotência: o mesmo lance reenviado devolve sucesso sem voltar a jogar
  const dup = q.get('SELECT ply FROM game_moves WHERE game_id=? AND move_id=?', gameId, moveId);
  if (dup) return { duplicate: true, ply: dup.ply };

  if (g.status !== 'active') throw new GameError('not_active', g.status === 'waiting_start' ? 'A partida ainda não começou.' : 'A partida está parada.');
  if (g.state.turn !== color) {
    secEvent(userId, 'move_out_of_turn', { gameId }, ip);
    throw new GameError('not_your_turn', 'Não é a sua vez.');
  }
  if (ply !== g.ply) throw new GameError('stale', 'O estado da partida mudou. A sincronizar.');

  const now = Date.now();
  const rem = remaining(g, color, now);
  if (rem <= 0) { finish(g, color === 'w' ? 'b' : 'w', 'time'); throw new GameError('time_over', 'O seu tempo terminou.'); }

  const r = E.applyMove(g.state, path);
  if (!r.ok) {
    const c = bump(gameId, userId, 'illegal');
    secEvent(userId, 'illegal_move_attempt', { gameId, path }, ip);
    if (c.illegal === 3) secEvent(userId, 'repeated_illegal_moves', { gameId }, ip);
    throw new GameError(r.error, 'Lance inválido.');
  }

  const think = now - g.turn_started_at;
  tx(() => {
    g['clock_' + color] = Math.max(0, g['clock_' + color] - think);
    q.run(
      'INSERT INTO game_moves(game_id,ply,move_id,color,notation,path_json,captured_json,think_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      g.id, g.ply, moveId, color, r.notation, JSON.stringify(path), JSON.stringify(r.move.captured), think, now,
    );
    g.state = r.state;
    g.ply = r.state.ply;
    g.turn_started_at = now;
    g.lastMove = path;
    persist(g);
    if (r.state.result) finish(g, r.state.result.winner ?? 'd', r.state.result.reason);
  });

  if (think < 120) {
    const c = bump(gameId, userId, 'fast');
    if (c.fast >= 8 && !c.flagged) { c.flagged = true; secEvent(userId, 'very_fast_moves', { gameId, count: c.fast }, ip); }
  }
  if (!isFinal(g)) pushState(g);
  return { duplicate: false, ply: g.ply };
}

// ------------------------------------------------------------------ fim de partida
function elo(ra, rb, score) {
  const exp = 1 / (1 + 10 ** ((rb - ra) / 400));
  return Math.round(32 * (score - exp));
}

function updateRankings(g, result) {
  const cats = ['geral'];
  if (g.category && g.category !== 'geral') cats.push(g.category);
  for (const cat of cats) {
    for (const uid of [g.white_id, g.black_id]) q.run('INSERT OR IGNORE INTO rankings(user_id,category) VALUES(?,?)', uid, cat);
    const w = q.get('SELECT rating FROM rankings WHERE user_id=? AND category=?', g.white_id, cat).rating;
    const b = q.get('SELECT rating FROM rankings WHERE user_id=? AND category=?', g.black_id, cat).rating;
    const sw = result === 'w' ? 1 : result === 'b' ? 0 : 0.5;
    const dw = elo(w, b, sw);
    const db = elo(b, w, 1 - sw);
    const col = (res, me) => (res === 'd' ? 'draws' : res === me ? 'wins' : 'losses');
    q.run(`UPDATE rankings SET rating=rating+?, ${col(result, 'w')}=${col(result, 'w')}+1 WHERE user_id=? AND category=?`, dw, g.white_id, cat);
    q.run(`UPDATE rankings SET rating=rating+?, ${col(result, 'b')}=${col(result, 'b')}+1 WHERE user_id=? AND category=?`, db, g.black_id, cat);
  }
}

/** Termina a partida: 'w' | 'b' | 'd' (empate). Liquida pontos demonstrativos e classificações. Idempotente. */
export function finish(g, result, reason, { actorId = null } = {}) {
  if (isFinal(g)) return;
  tx(() => {
    const now = Date.now();
    pauseClock(g, now);
    g.status = result === 'd' ? 'draw' : 'finished';
    g.result = result;
    g.reason = reason;
    g.ended_at = now;
    g.interrupted_since = null;
    if (!g.settled) {
      g.settled = 1;
      if (g.entry > 0) {
        if (result === 'd') for (const uid of [g.white_id, g.black_id]) points.add(uid, 'REEMBOLSO_EMPATE', g.entry, g.id, 'Empate: entrada devolvida');
        else points.add(result === 'w' ? g.white_id : g.black_id, 'PREMIO', g.entry * 2, g.id, 'Vitória (pontos demonstrativos)');
      }
      updateRankings(g, result);
    }
    persist(g);
    logEvent(g.id, actorId, 'finished', { result, reason });
  });
  for (const uid of [g.white_id, g.black_id]) {
    const won = (result === 'w' && uid === g.white_id) || (result === 'b' && uid === g.black_id);
    notify(uid, 'game_end', result === 'd' ? 'Partida terminada: empate.' : won ? 'Partida terminada: ganhou!' : 'Partida terminada: perdeu.', { gameId: g.id });
  }
  pushState(g);
  live.delete(g.id);
  cache.delete(g.id);
  joined.delete(g.id);
  for (const k of [...counters.keys()]) if (k.startsWith(g.id + ':')) counters.delete(k);
  for (const fn of endHooks) { try { fn(g); } catch (e) { console.error('hook fim de partida:', e); } }
}

export function cancelGame(g, reason) {
  if (isFinal(g)) return;
  tx(() => {
    g.status = 'cancelled';
    g.reason = reason;
    g.ended_at = Date.now();
    pauseClock(g, g.ended_at);
    if (!g.settled) {
      g.settled = 1;
      if (g.entry > 0) for (const uid of [g.white_id, g.black_id]) points.add(uid, 'REEMBOLSO_CANCELADA', g.entry, g.id, 'Partida cancelada: entrada devolvida');
    }
    persist(g);
    logEvent(g.id, null, 'cancelled', { reason });
  });
  for (const uid of [g.white_id, g.black_id]) notify(uid, 'game_cancelled', 'Partida cancelada: o adversário não entrou a tempo. Entrada devolvida.', { gameId: g.id });
  pushState(g);
  live.delete(g.id); cache.delete(g.id); joined.delete(g.id);
}

function toReview(g, why) {
  if (g.status === 'under_review') return;
  const now = Date.now();
  pauseClock(g, now);
  g.status = 'under_review';
  persist(g);
  logEvent(g.id, null, 'under_review', { why });
  for (const uid of [g.white_id, g.black_id]) notify(uid, 'game_review', 'A partida ficou em análise (interrupção não resolvida). Nenhum jogador foi penalizado automaticamente.', { gameId: g.id });
  pushState(g);
}

/** Decisão administrativa para partidas "Em análise". */
export function adminResolve(g, action, actorId, note) {
  const fresh = loadGame(g.id) || g;
  if (isFinal(fresh)) throw new GameError('already_final', 'A partida já terminou.');
  if (action === 'w' || action === 'b' || action === 'd') finish(fresh, action, 'admin', { actorId });
  else if (action === 'cancel') {
    if (fresh.tournament_id) throw new GameError('bad_request', 'Partidas de torneio não podem ser canceladas.');
    cancelGame(fresh, 'admin');
  } else if (action === 'resume') {
    fresh.status = 'awaiting_reconnect';
    fresh.interrupted_since = Date.now();
    refreshPresence(fresh);
    maybeStart(fresh);
    persist(fresh);
    pushState(fresh);
  } else throw new GameError('bad_request', 'Acção inválida.');
  logEvent(g.id, actorId, 'admin_resolve', { action, note });
}

// ------------------------------------------------------------------ relógio do servidor (1 s)
export function tick() {
  const now = Date.now();
  for (const id of [...live]) {
    const g = loadGame(id);
    if (!g) { live.delete(id); continue; }
    if (g.status === 'waiting_start') {
      const limit = g.tournament_id ? CONFIG.tournamentStartMs : CONFIG.startTimeoutMs;
      if (now - g.created_at > limit) {
        if (g.tournament_id) toReview(g, 'no_show');
        else cancelGame(g, 'no_show');
      }
    } else if (g.status === 'active') {
      const color = g.state.turn;
      if (remaining(g, color, now) <= 0) finish(g, color === 'w' ? 'b' : 'w', 'time');
    } else if (g.status === 'awaiting_reconnect' || g.status === 'interrupted') {
      if (g.interrupted_since && now - g.interrupted_since > CONFIG.reviewAfterMs) toReview(g, 'disconnect');
    }
  }
}

// ------------------------------------------------------------------ consultas
export function movesOf(gameId) {
  return q.all('SELECT ply,color,notation,think_ms,path_json FROM game_moves WHERE game_id=? ORDER BY ply', gameId)
    .map((m) => ({ ply: m.ply, color: m.color, notation: m.notation, thinkMs: m.think_ms, path: JSON.parse(m.path_json) }));
}
export const eventsOf = (gameId) => q.all('SELECT user_id,kind,detail,created_at FROM game_events WHERE game_id=? ORDER BY id', gameId)
  .map((e) => ({ userId: e.user_id, kind: e.kind, detail: e.detail ? JSON.parse(e.detail) : null, at: e.created_at }));

export function activeGameIds(userId) {
  return q.all("SELECT id FROM games WHERE (white_id=? OR black_id=?) AND status NOT IN ('finished','draw','cancelled')", userId, userId).map((r) => r.id);
}

export function _resetForTests() { cache.clear(); live.clear(); joined.clear(); counters.clear(); endHooks.length = 0; }
export { audit };
