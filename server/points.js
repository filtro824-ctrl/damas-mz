// Pontos de progressão: XP exclusivamente virtual, sem saldo apostável ou transferências.
import { q } from './db.js';

export function balance(userId) {
  return q.get('SELECT COALESCE(SUM(amount),0) b FROM ledger WHERE user_id=?', userId).b;
}

export function award(userId, kind, amount, gameId, note) {
  if (!Number.isInteger(amount) || amount <= 0) throw new TypeError('XP award must be a positive integer');
  q.run('INSERT INTO ledger(user_id,kind,amount,game_id,note,created_at) VALUES(?,?,?,?,?,?)', userId, kind, amount, gameId ?? null, note ?? null, Date.now());
}

export const add = award;

export function recent(userId, limit = 20) {
  return q.all('SELECT kind,amount,game_id,note,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT ?', userId, limit)
    .map((r) => ({ kind: r.kind, amount: r.amount, gameId: r.game_id, note: r.note, createdAt: r.created_at }));
}
