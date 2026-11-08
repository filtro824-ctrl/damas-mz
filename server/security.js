// Auditoria, eventos de segurança e limitação de pedidos.
import { q } from './db.js';
import { CONFIG } from './config.js';

export function audit(actorId, action, target, detail, ip) {
  q.run(
    'INSERT INTO audit_logs(actor_id,action,target,detail_json,ip,created_at) VALUES(?,?,?,?,?,?)',
    actorId ?? null, action, target == null ? null : String(target), JSON.stringify(detail ?? {}), ip ?? null, Date.now(),
  );
}

/** Evento de segurança / comportamento suspeito. NUNCA aplica sanções automáticas: só regista para análise humana. */
export function secEvent(userId, kind, detail, ip) {
  q.run(
    'INSERT INTO security_events(user_id,kind,detail_json,ip,created_at) VALUES(?,?,?,?,?)',
    userId ?? null, kind, JSON.stringify(detail ?? {}), ip ?? null, Date.now(),
  );
}

export function clientIp(req) {
  if (CONFIG.trustProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket?.remoteAddress || '';
}

// ---- limitação de pedidos (janela fixa em memória; em produção com vários processos usar Redis) ----
const buckets = new Map();
/** Devolve true se o pedido é permitido. */
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= max;
}
export function rateReset(key) { buckets.delete(key); }
export function rateCount(key) { return buckets.get(key)?.count || 0; }

const cleaner = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 3600_000) buckets.delete(k);
}, 60_000);
cleaner.unref();
