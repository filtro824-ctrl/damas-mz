// Livro-razão de pontos DEMONSTRATIVOS (VirtualPointsLedger).
// Separado das partidas e resultados. Não está ligado a pagamentos e não existe levantamento.
import { q } from './db.js';

export function balance(userId) {
  return q.get('SELECT COALESCE(SUM(amount),0) b FROM ledger WHERE user_id=?', userId).b;
}

export function add(userId, kind, amount, gameId, note) {
  q.run('INSERT INTO ledger(user_id,kind,amount,game_id,note,created_at) VALUES(?,?,?,?,?,?)', userId, kind, amount, gameId ?? null, note ?? null, Date.now());
}

export function recent(userId, limit = 20) {
  return q.all('SELECT kind,amount,game_id,note,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT ?', userId, limit)
    .map((r) => ({ kind: r.kind, amount: r.amount, gameId: r.game_id, note: r.note, createdAt: r.created_at }));
}
