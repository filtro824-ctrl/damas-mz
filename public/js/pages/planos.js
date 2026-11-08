import { h, icon, fmtDate, fmtPts, toast } from '/js/ui.js';
import { GET, POST, store } from '/js/api.js';
import { pageHead, loadingEl, errorEl } from '/js/pages/common.js';

const FEATURES = {
  matches: 'Partidas normais', random_matchmaking: 'Adversários aleatórios', virtual_points: 'XP virtual por resultado', basic_rankings: 'Ranking básico', profile: 'Perfil de jogador',
  advanced_search: 'Pesquisa avançada de adversários', rating_ranges: 'Intervalos de pontuação', custom_public_rooms: 'Salas públicas personalizadas', profile_customization: 'Personalização do perfil', advanced_stats: 'Estatísticas avançadas', special_themes: 'Temas especiais',
  premium: 'Todas as funcionalidades Premium', advanced_private_rooms: 'Salas privadas avançadas', exclusive_customization: 'Personalização exclusiva', full_history: 'Histórico completo', detailed_stats: 'Estatísticas detalhadas', special_badges: 'Emblemas especiais', exclusive_themes: 'Temas exclusivos',
};
const PAYMENT = { not_configured: 'Não configurado', pending: 'A aguardar confirmação do provedor', confirmed: 'Confirmado pelo provedor', failed: 'Falhou', cancelled: 'Cancelado' };

export default async function plansPage(root) {
  root.append(pageHead('Planos e subscrição', 'Escolha o nível de ferramentas que acompanha a sua competição.'), loadingEl());
  try {
    const [pr, sub] = await Promise.all([GET('/api/plans'), GET('/api/subscription')]);
    const current = sub.subscription;
    const cards = pr.items.map((plan) => {
      const isCurrent = current.plan?.code === plan.code;
      const features = plan.features.flatMap((f) => f === 'premium' ? ['advanced_search', 'rating_ranges', 'custom_public_rooms', 'profile_customization', 'advanced_stats', 'special_themes'] : [f]);
      const button = h('button', { class: 'btn block' + (plan.code === 'vip' ? ' primary' : ''), disabled: plan.code === 'free' ? isCurrent : !plan.active || !sub.paymentAvailable, text: plan.code === 'free' ? (isCurrent ? 'Plano atual' : 'Gratuito') : isCurrent ? 'Renovar ' + plan.name : sub.paymentAvailable ? 'Assinar ' + plan.name : 'Pagamento indisponível' });
      if (plan.code !== 'free') button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await POST('/api/subscription/checkout', { planCode: plan.code });
          toast(result.message || PAYMENT[result.status] || result.status, result.status === 'not_configured' ? 'err' : '');
          const updated = await GET('/api/subscription');
          sub.payments = updated.payments;
          drawPayments();
        } catch (e) { toast(e.message, 'err'); }
        finally { button.disabled = false; }
      });
      return h('article', { class: 'card stack plan-card' },
        h('div', { class: 'row between' }, h('h2', { text: plan.name }), isCurrent ? h('span', { class: 'chip solid', text: 'Atual' }) : null),
        h('div', { class: 'num big', text: `${fmtPts(plan.priceMzn)} MT` }),
        plan.durationDays ? h('p', { class: 'small muted', text: 'por mês · renovação mediante confirmação do pagamento' }) : h('p', { class: 'small muted', text: 'sem custo' }),
        h('div', { class: 'stack sm' }, ...features.map((f) => h('div', { class: 'small row' }, icon('check', 16), h('span', { text: FEATURES[f] || f })))),
        !plan.active ? h('p', { class: 'small muted', text: 'Plano temporariamente indisponível.' }) : null, button);
    });
    const currentBox = h('div', { class: 'card stack' }, h('h2', { text: 'A sua subscrição' }),
      h('p', { class: 'muted', text: current.status === 'active' ? `${current.plan.name} · válida até ${fmtDate(current.expiresAt)} (${current.daysRemaining} dias restantes)` : 'Plano Gratuito · as funcionalidades pagas só ficam disponíveis após confirmação válida do provedor.' }),
      h('p', { class: 'small muted', text: sub.paymentAvailable ? 'Checkout disponível pelo provedor configurado; a renovação depende de confirmação válida.' : 'Pagamentos ainda não configurados. Assinatura e renovação estão indisponíveis; nenhuma transação será simulada nem ativará um plano.' }));
    const payList = h('div', { class: 'card list' });
    const drawPayments = () => {
      payList.replaceChildren(h('h2', { text: 'Histórico de pagamentos' }));
      if (!sub.payments.length) payList.append(h('p', { class: 'muted', text: 'Ainda não há tentativas de pagamento.' }));
      for (const p of sub.payments) payList.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: p.planCode.toUpperCase() + ' · ' + fmtPts(p.amountMzn) + ' MT' }), h('span', { class: 'small muted', text: `${p.provider} · ${fmtDate(p.createdAt)}` })), h('span', { class: 'chip', text: PAYMENT[p.status] || p.status })));
    };
    drawPayments();
    root.replaceChildren(pageHead('Planos e subscrição', 'Escolha o nível de ferramentas que acompanha a sua competição.'), currentBox,
      h('div', { class: 'grid-2' }, ...cards), payList,
      h('p', { class: 'small faint', text: 'Os preços são configuráveis pelo administrador. O XP é apenas virtual, sem valor monetário ou resgate. Renovação e acesso pago dependem de confirmação válida do provedor.' }));
  } catch (e) { root.replaceChildren(errorEl(e)); }
}
