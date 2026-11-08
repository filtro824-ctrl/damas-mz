import crypto from 'node:crypto';
import { q } from './db.js';
import { AppError } from './auth.js';
import { activateFromConfirmedPayment } from './plans.js';

export function configuredProvider() {
  const provider = String(process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (!['mpesa', 'emola'].includes(provider)) return null;
  // O adaptador só é considerado configurado quando o segredo de callback está presente.
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || '';
  const checkoutUrl = process.env.PAYMENT_CHECKOUT_URL || '';
  if (!webhookSecret || !checkoutUrl) return null;
  return { provider, webhookSecret, checkoutUrl };
}

// Nenhum adaptador de checkout oficial foi implementado/configurado neste pacote.
export function checkoutAvailable() { return false; }

export function startCheckout(user, plan) {
  if (!['premium', 'vip'].includes(plan?.code) || !plan.active) throw new AppError('bad_plan', 'Selecione um plano pago ativo válido.');
  const id = crypto.randomUUID();
  const config = configuredProvider();
  const now = Date.now();
  if (!config) {
    q.run(`INSERT INTO payments(id,user_id,plan_code,amount_mzn,provider,status,metadata_json,created_at)
      VALUES(?,?,?,?,?,'not_configured',?,?)`, id, user.id, plan.code, plan.priceMzn, process.env.PAYMENT_PROVIDER || 'unconfigured', JSON.stringify({ reason: 'credentials_missing' }), now);
    return { paymentId: id, status: 'not_configured', message: 'Pagamentos ainda não configurados. Nenhum valor foi cobrado nem subscrição ativada.' };
  }
  // Checkout real requer chamada ao endpoint do provedor. Não se inventa um checkout URL nem confirmação.
  const endpoint = process.env.PAYMENT_API_URL;
  const token = process.env.PAYMENT_API_TOKEN;
  if (!endpoint || !token) {
    q.run(`INSERT INTO payments(id,user_id,plan_code,amount_mzn,provider,status,metadata_json,created_at)
      VALUES(?,?,?,?,?,'not_configured',?,?)`, id, user.id, plan.code, plan.priceMzn, config.provider, JSON.stringify({ reason: 'api_credentials_missing' }), now);
    return { paymentId: id, status: 'not_configured', message: 'Credenciais de checkout incompletas. Nenhum valor foi cobrado nem subscrição ativada.' };
  }
  // Ponto de extensão específico do provedor: não iniciar cobrança via API genérica desconhecida.
  q.run(`INSERT INTO payments(id,user_id,plan_code,amount_mzn,provider,status,metadata_json,created_at)
    VALUES(?,?,?,?,?,'not_configured',?,?)`, id, user.id, plan.code, plan.priceMzn, config.provider, JSON.stringify({ reason: 'provider_adapter_not_implemented' }), now);
  return { paymentId: id, status: 'not_configured', message: `Adaptador de checkout ${config.provider} requer integração específica do provedor. Nenhum pagamento foi iniciado.` };
}

export function verifyAndApplyWebhook(provider, rawBody, signature) {
  const config = configuredProvider();
  if (!config || config.provider !== provider) throw new AppError('provider_unavailable', 'Provedor de pagamentos não está configurado.', 503);
  if (!signature || !Buffer.isBuffer(rawBody)) throw new AppError('bad_signature', 'Assinatura do provedor em falta.', 401);
  const supplied = String(signature).replace(/^sha256=/i, '').toLowerCase();
  const expected = crypto.createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(supplied, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError('bad_signature', 'Assinatura do provedor inválida.', 401);
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('bad_json', 'Payload do provedor inválido.'); }
  if (event.status !== 'paid' || typeof event.paymentId !== 'string' || typeof event.providerRef !== 'string' || !event.providerRef) {
    throw new AppError('payment_unconfirmed', 'O evento não é uma confirmação de pagamento válida.', 400);
  }
  return activateFromConfirmedPayment(event.paymentId, provider, event.providerRef);
}

export function listMine(userId) {
  return q.all('SELECT id,plan_code,amount_mzn,provider,status,provider_ref,created_at,confirmed_at FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 100', userId)
    .map((r) => ({ id: r.id, planCode: r.plan_code, amountMzn: r.amount_mzn, provider: r.provider, status: r.status, providerRef: r.provider_ref, createdAt: r.created_at, confirmedAt: r.confirmed_at }));
}

export function listAdmin() {
  return q.all(`SELECT p.id,p.user_id,u.username,p.plan_code,p.amount_mzn,p.provider,p.status,p.provider_ref,p.created_at,p.confirmed_at
    FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 300`)
    .map((r) => ({ id: r.id, userId: r.user_id, username: r.username, planCode: r.plan_code, amountMzn: r.amount_mzn, provider: r.provider, status: r.status, providerRef: r.provider_ref, createdAt: r.created_at, confirmedAt: r.confirmed_at }));
}
