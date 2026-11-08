import { q, tx } from './db.js';
import { AppError } from './auth.js';

export const DEFAULT_PLANS = [
  { code: 'free', name: 'Gratuito', priceMzn: 0, durationDays: 0, features: ['matches', 'random_matchmaking', 'virtual_points', 'basic_rankings', 'profile'] },
  { code: 'premium', name: 'Premium', priceMzn: 99, durationDays: 30, features: ['advanced_search', 'rating_ranges', 'custom_public_rooms', 'profile_customization', 'advanced_stats', 'special_themes'] },
  { code: 'vip', name: 'VIP', priceMzn: 199, durationDays: 30, features: ['premium', 'advanced_private_rooms', 'exclusive_customization', 'full_history', 'detailed_stats', 'special_badges', 'exclusive_themes'] },
];

export function ensurePlans() {
  const now = Date.now();
  for (const p of DEFAULT_PLANS) {
    q.run(`INSERT OR IGNORE INTO plans(code,name,price_mzn,duration_days,features_json,active,updated_at)
      VALUES(?,?,?,?,?,1,?)`, p.code, p.name, p.priceMzn, p.durationDays, JSON.stringify(p.features), now);
  }
}

function planRow(code) {
  const row = q.get('SELECT * FROM plans WHERE code=? AND active=1', code);
  return row ? { code: row.code, name: row.name, priceMzn: row.price_mzn, durationDays: row.duration_days, features: JSON.parse(row.features_json || '[]'), active: !!row.active } : null;
}

export function subscriptionFor(userId, now = Date.now()) {
  const row = q.get("SELECT s.*,p.name,p.price_mzn,p.features_json FROM subscriptions s JOIN plans p ON p.code=s.plan_code WHERE s.user_id=? AND s.status='active' AND s.expires_at>? ORDER BY s.expires_at DESC LIMIT 1", userId, now);
  if (!row) return { plan: planRow('free'), status: 'free', startsAt: null, expiresAt: null, daysRemaining: null };
  return {
    plan: { code: row.plan_code, name: row.name, priceMzn: row.price_mzn, features: JSON.parse(row.features_json || '[]') },
    status: 'active', startsAt: row.starts_at, expiresAt: row.expires_at,
    daysRemaining: Math.max(0, Math.ceil((row.expires_at - now) / 86400000)), subscriptionId: row.id,
  };
}

export function currentPlanCode(userId) { return subscriptionFor(userId).plan?.code || 'free'; }
export function hasFeature(userId, feature) {
  const active = subscriptionFor(userId).plan;
  if (!active) return false;
  if (active.code === 'vip' && feature.startsWith('premium_')) return true;
  if (active.features.includes('premium')) return true;
  return active.features.includes(feature);
}
export function requirePlan(userId, minimum, featureLabel = 'Esta funcionalidade') {
  const order = { free: 0, premium: 1, vip: 2 };
  const current = currentPlanCode(userId);
  if ((order[current] ?? 0) < (order[minimum] ?? 99)) {
    throw new AppError('plan_required', `${featureLabel} requer o plano ${minimum.toUpperCase()}.`, 403);
  }
}

export function listPlans() {
  return q.all('SELECT code,name,price_mzn,duration_days,features_json,active FROM plans ORDER BY CASE code WHEN \'free\' THEN 0 WHEN \'premium\' THEN 1 ELSE 2 END')
    .map((r) => ({ code: r.code, name: r.name, priceMzn: r.price_mzn, durationDays: r.duration_days, features: JSON.parse(r.features_json || '[]'), active: !!r.active }));
}

export function setPrice(code, priceMzn, actorId) {
  if (!['free', 'premium', 'vip'].includes(code) || !Number.isInteger(priceMzn) || priceMzn < 0 || priceMzn > 1000000 || (code === 'free' && priceMzn !== 0)) {
    throw new AppError('bad_plan', 'Plano ou preço inválido. O plano Gratuito permanece a 0 MT.');
  }
  const plan = q.get('SELECT code FROM plans WHERE code=?', code);
  if (!plan) throw new AppError('not_found', 'Plano não encontrado.', 404);
  q.run('UPDATE plans SET price_mzn=?,updated_at=? WHERE code=?', priceMzn, Date.now(), code);
  q.run('INSERT INTO audit_logs(actor_id,action,target,detail_json,created_at) VALUES(?,?,?,?,?)', actorId, 'plan_price_update', code, JSON.stringify({ priceMzn }), Date.now());
  return listPlans().find((p) => p.code === code);
}

export function updatePlan(code, { priceMzn, active }, actorId) {
  if (!['free', 'premium', 'vip'].includes(code)) throw new AppError('bad_plan', 'Plano inválido.');
  if (!Number.isInteger(priceMzn) || priceMzn < 0 || priceMzn > 1000000 || (code === 'free' && priceMzn !== 0)) throw new AppError('bad_plan', 'Preço inválido. O plano Gratuito permanece a 0 MT.');
  if (typeof active !== 'boolean' || (code === 'free' && !active)) throw new AppError('bad_plan', 'Estado de plano inválido.');
  const result = q.run('UPDATE plans SET price_mzn=?,active=?,updated_at=? WHERE code=?', priceMzn, active, Date.now(), code);
  if (result.changes !== 1) throw new AppError('not_found', 'Plano não encontrado.', 404);
  q.run('INSERT INTO audit_logs(actor_id,action,target,detail_json,created_at) VALUES(?,?,?,?,?)', actorId, 'plan_update', code, JSON.stringify({ priceMzn, active }), Date.now());
  return listPlans().find((p) => p.code === code);
}

export function setTheme(userId, themeId) {
  const allowedFree = ['classic', 'night'];
  const themes = { classic: 'free', night: 'free', amber: 'premium', jade: 'premium', obsidian: 'vip' };
  const minimum = themes[themeId];
  if (!minimum) throw new AppError('bad_theme', 'Tema inválido.');
  requirePlan(userId, minimum, 'Este tema');
  if (minimum === 'free' && !allowedFree.includes(themeId)) throw new AppError('bad_theme', 'Tema inválido.');
  q.run('UPDATE profiles SET theme_id=? WHERE user_id=?', themeId, userId);
  return themeId;
}

export function setBio(userId, bio) {
  requirePlan(userId, 'premium', 'Personalização do perfil');
  if (typeof bio !== 'string' || bio.length > 160) throw new AppError('bad_profile', 'A biografia deve ter até 160 caracteres.');
  const value = bio.trim();
  q.run('UPDATE profiles SET bio=? WHERE user_id=?', value, userId);
  return value;
}

export function expireDue(now = Date.now()) {
  const result = q.run("UPDATE subscriptions SET status='expired',updated_at=? WHERE status='active' AND expires_at<=?", now, now);
  return result.changes;
}

export function activateFromConfirmedPayment(paymentId, provider, providerRef) {
  return tx(() => {
    const payment = q.get('SELECT * FROM payments WHERE id=?', paymentId);
    if (payment?.status === 'confirmed' && payment.provider === provider && payment.provider_ref === providerRef) return { userId: payment.user_id, plan: payment.plan_code, alreadyApplied: true };
    if (!payment || payment.status !== 'pending') throw new AppError('payment_not_pending', 'Pagamento não está pendente.', 409);
    if (!providerRef || payment.provider !== provider) throw new AppError('provider_mismatch', 'Confirmação do provedor inválida.', 400);
    const now = Date.now();
    const plan = q.get('SELECT duration_days FROM plans WHERE code=? AND active=1', payment.plan_code);
    if (!plan || plan.duration_days <= 0) throw new AppError('bad_plan', 'Plano pago indisponível.', 409);
    const durationMs = plan.duration_days * 86400000;
    q.run("UPDATE payments SET status='confirmed',provider_ref=?,confirmed_at=?,confirmation_source=? WHERE id=? AND status='pending'", providerRef, now, 'signed-provider-webhook', payment.id);
    q.run("UPDATE subscriptions SET status='expired',updated_at=? WHERE user_id=? AND status='active' AND expires_at<=?", now, payment.user_id, now);
    const current = q.get("SELECT id,expires_at FROM subscriptions WHERE user_id=? AND status='active' AND expires_at>?", payment.user_id, now);
    if (current) {
      q.run('UPDATE subscriptions SET plan_code=?,expires_at=?,updated_at=?,provider=?,provider_ref=? WHERE id=?', payment.plan_code, Math.max(now, current.expires_at) + durationMs, now, provider, providerRef, current.id);
    } else {
      q.run("INSERT INTO subscriptions(user_id,plan_code,status,starts_at,expires_at,provider,provider_ref,created_at,updated_at) VALUES(?,?,'active',?,?,?,?,?,?)", payment.user_id, payment.plan_code, now, now + durationMs, provider, providerRef, now, now);
    }
    q.run('INSERT INTO audit_logs(actor_id,action,target,detail_json,created_at) VALUES(NULL,?,?,?,?)', 'payment_confirmed', payment.id, JSON.stringify({ provider, providerRef, plan: payment.plan_code }), now);
    return { userId: payment.user_id, plan: payment.plan_code };
  });
}
