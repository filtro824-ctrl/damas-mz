// Torneios gratuitos de eliminação directa (sem pontos nem prémios).
import { q, tx } from './db.js';
import * as rt from './realtime.js';
import * as games from './games.js';
import { notify } from './notify.js';
import { AppError } from './auth.js';

const SIZES = [4, 8, 16];

export function create(name, size, adminId) {
  const clean = String(name || '').trim().slice(0, 60);
  if (clean.length < 3) throw new AppError('bad_name', 'Indique um nome com pelo menos 3 caracteres.');
  if (!SIZES.includes(size)) throw new AppError('bad_size', 'O torneio deve ter 4, 8 ou 16 jogadores.');
  const r = q.run("INSERT INTO tournaments(name,size,status,created_by,created_at) VALUES(?,?,'open',?,?)", clean, size, adminId, Date.now());
  rt.broadcast({ t: 'tournaments' });
  return Number(r.lastInsertRowid);
}

export function list() {
  return q.all('SELECT * FROM tournaments ORDER BY id DESC LIMIT 50').map((t) => ({
    id: t.id, name: t.name, size: t.size, status: t.status, round: t.current_round, createdAt: t.created_at,
    players: q.get('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id=?', t.id).n,
    winner: t.winner_id ? q.get('SELECT username FROM users WHERE id=?', t.winner_id)?.username : null,
  }));
}

export function detail(id, userId) {
  const t = q.get('SELECT * FROM tournaments WHERE id=?', id);
  if (!t) throw new AppError('not_found', 'Torneio não encontrado.', 404);
  const players = q.all('SELECT u.id, u.public_id, u.username FROM tournament_players tp JOIN users u ON u.id=tp.user_id WHERE tp.tournament_id=? ORDER BY tp.joined_at', id);
  const name = (uid) => q.get('SELECT username FROM users WHERE id=?', uid)?.username;
  const matches = q.all('SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round, slot', id).map((m) => {
    const g = q.get("SELECT id,status FROM games WHERE match_id=? ORDER BY created_at DESC LIMIT 1", m.id);
    return { id: m.id, round: m.round, slot: m.slot, p1: name(m.p1), p2: name(m.p2), winner: m.winner_id ? name(m.winner_id) : null, gameId: g?.id ?? null, gameStatus: g?.status ?? null, mine: m.p1 === userId || m.p2 === userId };
  });
  return {
    id: t.id, name: t.name, size: t.size, status: t.status, round: t.current_round,
    winner: t.winner_id ? name(t.winner_id) : null,
    players: players.map((p) => ({ id: p.public_id, username: p.username })),
    joined: players.some((p) => p.id === userId),
    matches,
  };
}

export function join(user, id) {
  const started = tx(() => {
    const t = q.get('SELECT * FROM tournaments WHERE id=?', id);
    if (!t) throw new AppError('not_found', 'Torneio não encontrado.', 404);
    if (t.status !== 'open') throw new AppError('closed', 'As inscrições deste torneio já fecharam.', 409);
    const n = q.get('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id=?', id).n;
    if (n >= t.size) throw new AppError('full', 'Torneio cheio.', 409);
    q.run('INSERT OR IGNORE INTO tournament_players(tournament_id,user_id,joined_at) VALUES(?,?,?)', id, user.id, Date.now());
    const now = q.get('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id=?', id).n;
    if (now >= t.size) { startRound(id, 1, shuffle(q.all('SELECT user_id FROM tournament_players WHERE tournament_id=?', id).map((r) => r.user_id))); return true; }
    return false;
  });
  rt.broadcast({ t: 'tournaments' });
  return { started };
}

export function leave(user, id) {
  const t = q.get('SELECT status FROM tournaments WHERE id=?', id);
  if (!t) throw new AppError('not_found', 'Torneio não encontrado.', 404);
  if (t.status !== 'open') throw new AppError('closed', 'O torneio já começou.', 409);
  q.run('DELETE FROM tournament_players WHERE tournament_id=? AND user_id=?', id, user.id);
  rt.broadcast({ t: 'tournaments' });
}

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

function startRound(tid, round, ids) {
  q.run("UPDATE tournaments SET status='running', current_round=? WHERE id=?", round, tid);
  const name = q.get('SELECT name FROM tournaments WHERE id=?', tid).name;
  for (let i = 0; i < ids.length; i += 2) {
    const r = q.run('INSERT INTO tournament_matches(tournament_id,round,slot,p1,p2) VALUES(?,?,?,?,?)', tid, round, i / 2, ids[i], ids[i + 1]);
    newGame(tid, Number(r.lastInsertRowid), ids[i], ids[i + 1], name, round);
  }
}

function newGame(tid, matchId, whiteId, blackId, name, round) {
  q.run('UPDATE tournament_matches SET games=games+1 WHERE id=?', matchId);
  const g = games.createGame({ whiteId, blackId, category: 'torneio', entry: 0, source: 'tournament', tournamentId: tid, matchId });
  for (const uid of [whiteId, blackId]) notify(uid, 'tournament_game', `Torneio "${name}" — ronda ${round}: a sua partida está pronta.`, { gameId: g.id, tournamentId: tid });
}

/** Chamado quando uma partida de torneio termina (ou é decidida pela administração). */
export function onGameEnd(g) {
  if (!g.tournament_id || !g.match_id) return;
  tx(() => {
    const m = q.get('SELECT * FROM tournament_matches WHERE id=?', g.match_id);
    if (!m || m.winner_id) return;
    const t = q.get('SELECT * FROM tournaments WHERE id=?', m.tournament_id);
    if (g.result === 'd' || (g.result !== 'w' && g.result !== 'b')) {
      // empate: repete-se a partida com as cores trocadas (regra 2.2)
      newGame(t.id, m.id, g.black_id, g.white_id, t.name, m.round);
      return;
    }
    const winner = g.result === 'w' ? g.white_id : g.black_id;
    q.run('UPDATE tournament_matches SET winner_id=? WHERE id=?', winner, m.id);
    const pending = q.get('SELECT COUNT(*) n FROM tournament_matches WHERE tournament_id=? AND round=? AND winner_id IS NULL', t.id, m.round).n;
    if (pending > 0) return;
    const winners = q.all('SELECT winner_id FROM tournament_matches WHERE tournament_id=? AND round=? ORDER BY slot', t.id, m.round).map((r) => r.winner_id);
    if (winners.length === 1) {
      q.run("UPDATE tournaments SET status='finished', winner_id=? WHERE id=?", winners[0], t.id);
      notify(winners[0], 'tournament_won', `Venceu o torneio "${t.name}"!`, { tournamentId: t.id });
    } else {
      startRound(t.id, m.round + 1, winners);
    }
  });
  rt.broadcast({ t: 'tournaments' });
}

games.onGameEnd(onGameEnd);
