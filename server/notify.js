// Notificações persistentes + envio em tempo real.
import { q } from './db.js';
import * as rt from './realtime.js';

export function notify(userId, kind, text, data) {
  q.run(
    'INSERT INTO notifications(user_id,kind,text,data_json,created_at) VALUES(?,?,?,?,?)',
    userId, kind, text, data ? JSON.stringify(data) : null, Date.now(),
  );
  rt.sendUser(userId, { t: 'notice', kind, text, data: data ?? null });
}

export function list(userId, limit = 30) {
  return q.all('SELECT id,kind,text,data_json,created_at,read FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?', userId, limit)
    .map((n) => ({ id: n.id, kind: n.kind, text: n.text, data: n.data_json ? JSON.parse(n.data_json) : null, createdAt: n.created_at, read: !!n.read }));
}
export function markRead(userId) { q.run('UPDATE notifications SET read=1 WHERE user_id=? AND read=0', userId); }
export const unreadCount = (userId) => q.get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', userId).n;
