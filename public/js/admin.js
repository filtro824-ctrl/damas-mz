// Painel administrativo DAMAS MZ. Só lê/escreve através da API (o servidor valida papéis e regista a auditoria).
import { h, icon, brandMark, toast, modal, clear, fmtDate, fmtPts, avatarEl, STATUS, REASON, ROOM_STATUS } from '/js/ui.js';
import { api, GET, POST } from '/js/api.js';

const app = document.getElementById('app');
const ROLE = { admin: 'Administrador principal', moderator: 'Moderador', support: 'Suporte', user: 'Utilizador' };
const LEVEL = { support: 1, moderator: 2, admin: 3 };
const CAT = { geral: 'Geral', bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', diamante: 'Diamante', torneio: 'Torneios' };
const SEC_KIND = {
  login_failed: 'Início de sessão falhado', login_lockout: 'Bloqueio por tentativas', illegal_move_attempt: 'Lance impossível', repeated_illegal_moves: 'Lances impossíveis repetidos',
  move_out_of_turn: 'Lance fora da vez', move_not_player: 'Lance por não-jogador', very_fast_moves: 'Lances muito rápidos', same_ip_match: 'Mesmo IP na partida',
  ws_rate_limited: 'Excesso de mensagens', forbidden_admin_access: 'Acesso admin negado', recover_failed: 'Recuperação falhada', recover_lockout: 'Recuperação bloqueada',
};
const MENU = [
  ['dashboard', 'Dashboard', 'home', 1], ['utilizadores', 'Utilizadores', 'mine', 1], ['partidas', 'Partidas', 'swords', 1], ['salas', 'Salas', 'rooms', 1],
  ['planos', 'Planos', 'crown', 3], ['subscricoes', 'Subscrições', 'history', 1], ['pagamentos', 'Pagamentos', 'chart', 1],
  ['torneios', 'Torneios', 'trophy', 1], ['classificacoes', 'Classificações', 'chart', 1], ['denuncias', 'Denúncias', 'alert', 1], ['seguranca', 'Segurança', 'shield', 2],
  ['relatorios', 'Relatórios', 'history', 1], ['configuracoes', 'Configurações', 'settings', 3],
];
let me = null;
let shell = null;
let cleanup = null;
let token = 0;
const lvl = () => LEVEL[me?.role] || 0;
const can = (n) => lvl() >= n;
const dateOf = (t) => fmtDate(t);
const loading = () => h('div', { class: 'empty', text: 'A carregar…' });
const fail = (e) => h('div', { class: 'empty' }, icon('alert'), h('p', { text: e.message || 'Erro.' }));
const empty = (t) => h('div', { class: 'empty', text: t });
const head = (t, sub, right) => h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: t }), sub ? h('p', { text: sub }) : null), right);
async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, 'err'); return null; } }

function confirmBox(title, text, label, run, needNote) {
  modal(title, (body, close) => {
    const note = needNote ? h('textarea', { rows: 3, placeholder: 'Justificação / nota (obrigatória)', maxlength: 300 }) : null;
    const btn = h('button', { class: 'btn primary block', onclick: async () => { if (needNote && note.value.trim().length < 3) return toast('Escreva uma justificação.', 'err'); btn.disabled = true; const ok = await run(note?.value.trim()); if (ok !== false) close(); else btn.disabled = false; } }, label);
    body.append(h('p', { class: 'muted', text }), note ? h('div', { class: 'field' }, note) : null, btn);
  });
}

// ---------------------------------------------------------------- casca e menu ☰
function openMenu() { shell.scrim.classList.add('on'); shell.drawer.classList.add('on'); shell.drawer.setAttribute('aria-hidden', 'false'); shell.menuBtn.setAttribute('aria-expanded', 'true'); document.body.classList.add('menu-open'); shell.closeBtn.focus(); }
function closeMenu(focus = true) {
  if (!shell?.drawer.classList.contains('on')) return;
  shell.scrim.classList.remove('on'); shell.drawer.classList.remove('on'); shell.drawer.setAttribute('aria-hidden', 'true'); shell.menuBtn.setAttribute('aria-expanded', 'false'); document.body.classList.remove('menu-open');
  if (focus) shell.menuBtn.focus();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

function build() {
  const menuBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', onclick: openMenu }, icon('menu'));
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar menu', onclick: () => closeMenu() }, icon('close'));
  const links = new Map();
  const ul = h('ul', { class: 'menu' });
  for (const [k, label, ic, min] of MENU) {
    if (!can(min)) continue;
    const a = h('a', { href: '#/' + k, onclick: () => closeMenu(false) }, icon(ic), h('span', { text: label }));
    links.set(k, a);
    ul.append(h('li', {}, a));
  }
  const drawer = h('nav', { class: 'drawer', 'aria-label': 'Menu da administração', 'aria-hidden': 'true' },
    h('div', { class: 'drawer-head' }, h('span', { class: 'brand' }, brandMark(), h('span', { text: 'ADMIN' })), closeBtn),
    h('div', { class: 'drawer-user' }, avatarEl(me), h('div', {}, h('b', { text: me.username }), h('span', { class: 'small faint', text: ROLE[me.role] }))),
    ul,
    h('div', { class: 'drawer-foot stack sm' }, h('a', { href: '/', text: 'Voltar à plataforma' }), h('button', { class: 'btn sm', onclick: async () => { try { await POST('/api/auth/logout'); } catch { /* ok */ } location.reload(); } }, icon('logout'), 'Terminar sessão')));
  const scrim = h('div', { class: 'scrim', onclick: () => closeMenu() });
  const main = h('main');
  clear(app).append(h('header', { class: 'topbar' }, menuBtn, h('span', { class: 'brand' }, brandMark(), h('span', { text: 'DAMAS MZ · ADMIN' })), h('span', { class: 'chip', text: ROLE[me.role] })), main, scrim, drawer);
  shell = { main, drawer, scrim, menuBtn, closeBtn, links };
}

async function route() {
  if (!shell) return;
  const k = (location.hash.replace(/^#\//, '') || 'dashboard').split('/')[0];
  const item = MENU.find((m) => m[0] === k && can(m[3]));
  if (!item) { location.hash = '#/dashboard'; return; }
  const my = ++token;
  try { cleanup?.(); } catch { /* ok */ }
  cleanup = null;
  closeMenu(false);
  for (const [key, a] of shell.links) { if (key === k) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  clear(shell.main).append(loading());
  window.scrollTo(0, 0);
  const root = h('div', { class: 'stack' });
  try {
    const c = await VIEWS[k](root);
    if (my !== token) { c?.(); return; }
    clear(shell.main).append(root);
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) { if (my === token) clear(shell.main).append(fail(e)); }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- vistas
const VIEWS = {
  async dashboard(root) {
    const draw = async () => {
      const d = await GET('/api/admin/dashboard');
      const t = (label, v, href, alert) => h('a', { class: 'tile' + (alert && v > 0 ? ' alert' : ''), href }, h('span', { class: 'small muted', text: label }), h('b', { class: 'num', text: String(v) }));
      root.replaceChildren(head('Dashboard', 'Visão geral (atualiza a cada 15 s).'),
        h('div', { class: 'tiles' },
          t('Utilizadores', d.users, '#/utilizadores'), t('Online agora', d.online, '#/utilizadores'), t('Partidas em curso', d.gamesLive, '#/partidas'),
          t('Em análise', d.gamesReview, '#/partidas', true), t('Concluídas (24 h)', d.gamesDay, '#/partidas'), t('Salas abertas', d.roomsOpen, '#/salas'),
          t('Denúncias abertas', d.reportsOpen, '#/denuncias', true), t('Subscrições ativas', d.activeSubscriptions, '#/subscricoes'), t('Pagamentos pendentes', d.pendingPayments, '#/pagamentos', true), can(2) ? t('Eventos de segurança (24 h)', d.securityDay, '#/seguranca') : null, t('Registos (24 h)', d.registeredDay, '#/utilizadores')));
    };
    await draw();
    const i = setInterval(() => draw().catch(() => {}), 15000);
    return () => clearInterval(i);
  },

  async utilizadores(root) {
    const list = h('div', { class: 'card list' });
    const search = h('input', { type: 'search', placeholder: 'Pesquisar por nome ou ID…', 'aria-label': 'Pesquisar utilizadores' });
    const load = async () => {
      const r = await GET('/api/admin/users?search=' + encodeURIComponent(search.value.trim()));
      list.replaceChildren();
      if (!r.items.length) list.append(empty('Nenhum utilizador encontrado.'));
      for (const u of r.items) {
        list.append(h('button', { class: 'item row-btn', onclick: () => userModal(u, load) }, avatarEl(u),
          h('div', { class: 'grow' }, h('div', { class: 'row wrap' }, h('b', { text: u.username }), h('span', { class: 'dot ' + (u.online ? 'on' : '') }), u.status !== 'active' ? h('span', { class: 'chip solid', text: 'Suspenso' }) : null),
            h('span', { class: 'small muted', text: `${u.id} · ${ROLE[u.role]} · ${u.plan.toUpperCase()} · registo ${dateOf(u.createdAt).slice(0, 10)}` })),
          h('div', { class: 'meta' }, h('b', { class: 'num', text: String(u.rating) }), h('div', { class: 'small faint num', text: fmtPts(u.xp) + ' XP' }))));
      }
    };
    let t;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch((e) => toast(e.message, 'err')), 300); });
    root.append(head('Utilizadores', 'Contas, plano ativo, rating e progressão XP virtual.'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, search)), list);
    await load();
  },

  async partidas(root) {
    const list = h('div', { class: 'card list' });
    const sel = h('select', { 'aria-label': 'Filtrar por estado' }, h('option', { value: '', text: 'Todos os estados' }), ...Object.entries(STATUS).map(([k, v]) => h('option', { value: k, text: v })));
    const load = async () => {
      const r = await GET('/api/admin/games' + (sel.value ? '?status=' + sel.value : ''));
      list.replaceChildren();
      if (!r.items.length) list.append(empty('Sem partidas.'));
      for (const g of r.items) {
        list.append(h('button', { class: 'item row-btn', onclick: () => gameModal(g.id, load) },
          h('div', { class: 'grow' }, h('b', { text: `${g.white.username} vs ${g.black.username}` }), h('span', { class: 'small muted', text: `${dateOf(g.createdAt)} · ${CAT[g.category] || 'Torneio'} · ${g.plies} lances · ${g.disconnects} desconex.` })),
          h('span', { class: 'chip' + (g.status === 'under_review' ? ' solid' : ''), text: STATUS[g.status] || g.status })));
      }
    };
    sel.addEventListener('change', () => load().catch((e) => toast(e.message, 'err')));
    root.append(head('Partidas'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, sel)), list);
    await load();
    const i = setInterval(() => load().catch(() => {}), 20000);
    return () => clearInterval(i);
  },

  async salas(root) {
    const r = await GET('/api/admin/rooms');
    const items = r.items.length ? r.items.map((x) => {
      const row = h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('b', { text: x.creator.username }), h('span', { class: 'small muted', text: `${CAT[x.category] || x.category} · ${x.visibility === 'private' ? 'privada' : 'pública'} · espera ${x.waitSeconds} s · ${dateOf(x.createdAt)}` })),
        h('span', { class: 'chip', text: ROOM_STATUS[x.status] || x.status }));
      if (can(2) && x.status === 'open') row.append(h('button', { class: 'btn sm danger', onclick: () => confirmBox('Cancelar sala', `Cancelar a sala aberta de ${x.creator.username}? A operação fica na auditoria.`, 'Cancelar', async () => !!await act(() => POST(`/api/admin/rooms/${encodeURIComponent(x.id)}/cancel`, {}), 'Sala cancelada.'), false) }, 'Cancelar'));
      return row;
    }) : [empty('Sem salas.')];
    root.append(head('Salas'), h('div', { class: 'card list' }, ...items));
  },

  async planos(root) {
    const load = async () => {
      const r = await GET('/api/admin/plans');
      root.replaceChildren(head('Planos', 'Preço e disponibilidade configuráveis pelo administrador.'),
        h('div', { class: 'grid-2' }, ...r.items.map((p) => h('article', { class: 'card stack' },
          h('div', { class: 'row between' }, h('h2', { text: p.name }), h('span', { class: 'chip', text: p.active ? 'Ativo' : 'Desativado' })),
          h('b', { class: 'num big', text: `${fmtPts(p.priceMzn)} MT / mês` }), h('p', { class: 'small muted', text: `${p.features.length} funcionalidades configuradas.` }),
          h('button', { class: 'btn', onclick: () => modal('Editar plano ' + p.name, (body, close) => {
            const price = h('input', { type: 'number', min: 0, max: 1000000, value: p.priceMzn, required: true });
            const active = h('input', { type: 'checkbox', checked: p.active });
            body.append(h('div', { class: 'field' }, h('label', { text: 'Preço mensal em MT' }), price),
              p.code !== 'free' ? h('label', { class: 'row' }, active, h('span', { text: 'Disponível para novas subscrições' })) : h('p', { class: 'small muted', text: 'O Gratuito permanece ativo e a 0 MT.' }),
              h('button', { class: 'btn primary block', onclick: async () => { const result = await act(() => POST('/api/admin/plans/' + p.code, { priceMzn: Number(price.value), active: p.code === 'free' ? true : active.checked }), 'Plano atualizado.'); if (result) { close(); await load(); } } }, 'Guardar'));
          }) }, 'Editar plano')))));
    };
    await load();
  },

  async subscricoes(root) {
    const r = await GET('/api/admin/subscriptions');
    root.append(head('Subscrições', 'Estado, validade e cancelamentos auditados.'),
      h('div', { class: 'card list' }, ...(r.items.length ? r.items.map((s) => h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('b', { text: `${s.username} · ${s.planCode.toUpperCase()}` }), h('span', { class: 'small muted', text: `${s.status} · válida até ${dateOf(s.expiresAt)} · ${s.provider || 'sem provedor'}` })),
        can(3) && s.status === 'active' ? h('button', { class: 'btn sm danger', onclick: () => confirmBox('Cancelar subscrição', `Cancelar ${s.planCode.toUpperCase()} de ${s.username}? A decisão ficará na auditoria.`, 'Cancelar', async () => !!await act(() => POST(`/api/admin/subscriptions/${s.id}/cancel`, {}), 'Subscrição cancelada.'), false) }, 'Cancelar') : h('span', { class: 'chip', text: s.status }))) : [empty('Sem subscrições registadas.')])),
      h('p', { class: 'small muted', text: 'Um administrador não pode ativar subscrições manualmente. A ativação é exclusiva de confirmação válida do provedor.' }));
  },

  async pagamentos(root) {
    const r = await GET('/api/admin/payments');
    root.append(head('Pagamentos', r.paymentAvailable ? 'Transações e respetivas referências.' : 'Gateway não configurado; nenhuma tentativa será tratada como paga.'),
      h('div', { class: 'card list' }, ...(r.items.length ? r.items.map((p) => h('div', { class: 'item' },
        h('div', { class: 'grow' }, h('b', { text: `${p.username} · ${p.planCode.toUpperCase()} · ${fmtPts(p.amountMzn)} MT` }),
          h('span', { class: 'small muted', text: `${p.provider} · ${dateOf(p.createdAt)}${p.providerRef ? ' · ref. ' + p.providerRef : ''}` })), h('span', { class: 'chip', text: p.status }))) : [empty('Sem pagamentos registados.')])),
      h('p', { class: 'small muted', text: 'Confirmações só são aceites pelo callback assinado do provedor; não existe botão de aprovação manual.' }));
  },

  async torneios(root) {
    const r = await GET('/api/tournaments');
    const T = { open: 'Inscrições abertas', running: 'Em curso', finished: 'Terminado' };
    const create = can(3) ? h('button', { class: 'btn primary', onclick: () => modal('Criar torneio', (body, close) => {
      const name = h('input', { placeholder: 'Nome do torneio', maxlength: 40 });
      const size = h('select', {}, ...[4, 8, 16].map((n) => h('option', { value: n, text: `${n} jogadores` })));
      body.append(h('div', { class: 'field' }, h('label', { text: 'Nome' }), name), h('div', { class: 'field' }, h('label', { text: 'Tamanho' }), size), h('p', { class: 'small muted', text: 'Torneio gratuito, sem pontos em jogo.' }),
        h('button', { class: 'btn primary block', onclick: async () => { if (await act(() => POST('/api/admin/tournaments', { name: name.value.trim(), size: Number(size.value) }), 'Torneio criado.')) { close(); route(); } } }, 'Criar'));
    }) }, icon('plus'), 'Criar torneio') : null;
    root.append(head('Torneios', null, create), h('div', { class: 'card list' }, ...(r.items.length ? r.items.map((t) => h('button', { class: 'item row-btn', onclick: () => tournamentModal(t.id) },
      h('div', { class: 'grow' }, h('b', { text: t.name }), h('span', { class: 'small muted', text: `${t.players}/${t.size} jogadores${t.winner ? ' · vencedor ' + t.winner : ''}` })), h('span', { class: 'chip', text: T[t.status] || t.status }))) : [empty('Sem torneios.')])));
  },

  async classificacoes(root) {
    let cat = 'geral'; let period = 'general';
    const box = h('div', { class: 'card list' });
    const seg = h('div', { class: 'seg' });
    const btns = Object.entries(CAT).map(([k, v]) => h('button', { type: 'button', text: v, 'aria-pressed': String(k === cat), onclick: () => { cat = k; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(CAT)[i] === cat))); load(); } }));
    seg.append(...btns);
    const periods = [['general', 'Geral'], ['week', 'Semanal'], ['month', 'Mensal']];
    const periodSeg = h('div', { class: 'seg' });
    const pbtns = periods.map(([key, label]) => h('button', { type: 'button', text: label, 'aria-pressed': String(key === period), onclick: () => { period = key; pbtns.forEach((b, i) => b.setAttribute('aria-pressed', String(periods[i][0] === period))); seg.classList.toggle('hidden', period !== 'general'); load(); } }));
    periodSeg.append(...pbtns);
    async function load() {
      const r = await act(() => GET(`/api/rankings?category=${cat}&period=${period}`));
      box.replaceChildren();
      if (!r?.items.length) return box.append(empty('Sem jogos nesta categoria.'));
      for (const p of r.items) box.append(h('div', { class: 'item' }, h('b', { class: 'num', text: String(p.position).padStart(2, '0') }), h('div', { class: 'grow' }, h('b', { text: p.username }), h('span', { class: 'small muted num', text: `${p.wins}V · ${p.losses}D · ${p.draws}E · melhor sequência ${p.bestStreak || p.progression?.bestStreak || 0}` })), h('b', { class: 'num', text: period === 'general' ? String(p.rating) : `${p.score} XP` }), can(3) && period === 'general' ? h('button', { class: 'btn sm', onclick: () => ratingModal(p, load) }, 'Ajustar rating') : null));
    }
    root.append(head('Classificações', 'Rankings gerais, semanais e mensais; ajustes manuais de rating são auditados.'), periodSeg, seg, box);
    await load();
  },

  async denuncias(root) {
    let onlyOpen = true;
    const box = h('div', { class: 'card list' });
    const sel = h('select', { 'aria-label': 'Filtro' }, h('option', { value: 'open', text: 'Abertas' }), h('option', { value: 'all', text: 'Todas' }));
    const S = { open: 'Aberta', closed: 'Fechada', dismissed: 'Dispensada' };
    const load = async () => {
      const r = await GET('/api/admin/reports');
      box.replaceChildren();
      const items = r.items.filter((x) => !onlyOpen || x.status === 'open');
      if (!items.length) box.append(empty('Sem denúncias.'));
      for (const x of items) {
        box.append(h('div', { class: 'item' }, h('div', { class: 'grow' },
          h('b', { text: `${x.reporter} → ${x.target || '—'}` }), h('span', { class: 'small', text: x.reason }), h('span', { class: 'small faint', text: `${dateOf(x.createdAt)}${x.note ? ' · nota: ' + x.note : ''}` }),
          x.gameId ? h('a', { class: 'small', href: '#/partidas', onclick: (e) => { e.preventDefault(); gameModal(x.gameId, load); }, text: 'Ver partida' }) : null),
          h('div', { class: 'meta stack sm' }, h('span', { class: 'chip', text: S[x.status] || x.status }),
            can(2) ? h('button', { class: 'btn sm', onclick: () => reportModal(x, load) }, 'Tratar') : null)));
      }
    };
    sel.addEventListener('change', () => { onlyOpen = sel.value === 'open'; load(); });
    root.append(head('Denúncias'), h('div', { class: 'toolbar' }, h('div', { class: 'field' }, sel)), box);
    await load();
  },

  async seguranca(root) {
    let tab = 'events';
    let kind = '';
    const box = h('div', { class: 'card list' });
    const seg = h('div', { class: 'seg' });
    const filter = h('select', { 'aria-label': 'Tipo de evento' });
    const tabs = [['events', 'Eventos'], ['audit', 'Auditoria']].map(([k, l]) => h('button', { type: 'button', text: l, 'aria-pressed': String(k === tab), onclick: () => { tab = k; tabs.forEach((b, i) => b.setAttribute('aria-pressed', String(['events', 'audit'][i] === tab))); filter.classList.toggle('hidden', tab !== 'events'); load(); } }));
    seg.append(...tabs);
    async function load() {
      const r = await act(() => GET(tab === 'events' ? '/api/admin/security' : '/api/admin/audit'));
      box.replaceChildren();
      if (!r) return;
      if (tab === 'events') {
        const kinds = [...new Set(r.items.map((x) => x.kind))];
        const cur = kind;
        filter.replaceChildren(h('option', { value: '', text: 'Todos os tipos' }), ...kinds.map((k) => h('option', { value: k, text: SEC_KIND[k] || k, selected: k === cur })));
        const items = r.items.filter((x) => !kind || x.kind === kind);
        if (!items.length) box.append(empty('Sem eventos.'));
        for (const x of items) box.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: SEC_KIND[x.kind] || x.kind }), h('span', { class: 'small muted', text: `${x.user || 'anónimo'} · ${x.ip || ''}` }), x.detail ? h('span', { class: 'small faint mono', text: typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail) }) : null), h('time', { class: 'small faint', text: dateOf(x.at) })));
      } else {
        if (!r.items.length) box.append(empty('Sem registos.'));
        for (const x of r.items) box.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: `${x.actor || '—'}: ${x.action}` }), h('span', { class: 'small muted', text: x.target || '' }), x.detail ? h('span', { class: 'small faint mono', text: typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail) }) : null), h('time', { class: 'small faint', text: dateOf(x.at) })));
      }
    }
    filter.addEventListener('change', () => { kind = filter.value; load(); });
    root.append(head('Segurança', 'Os eventos são pistas para análise humana. A plataforma não sanciona ninguém automaticamente (uma taxa de vitórias alta, por si só, não é infração).'),
      h('div', { class: 'toolbar' }, seg, filter), box);
    await load();
  },

  async relatorios(root) {
    const s = await GET('/api/admin/stats');
    const cols = (rows, title) => h('div', { class: 'card stack' }, h('h2', { text: title }),
      rows.length ? h('div', { class: 'cols' }, ...(() => { const m = Math.max(1, ...rows.map((r) => r.n)); return rows.map((r) => { const i = h('i', { title: String(r.n) }); i.style.height = Math.max(2, (r.n / m) * 100) + '%'; return h('div', { class: 'col' }, h('span', { class: 'num', text: String(r.n) }), i, h('span', { text: String(r.d).slice(5) })); }); })()) : empty('Sem dados.'));
    const bars = (rows, key, label, title) => h('div', { class: 'card stack' }, h('h2', { text: title }),
      rows.length ? h('div', { class: 'bars' }, ...(() => { const m = Math.max(1, ...rows.map((r) => r.n)); return rows.map((r) => { const i = h('i'); i.style.transform = `scaleX(${r.n / m})`; return h('div', { class: 'bar' }, h('span', { text: label(r[key]) }), h('div', { class: 'track' }, i), h('b', { class: 'num', text: String(r.n) })); }); })()) : empty('Sem dados.'));
    root.append(head('Relatórios', 'Métricas de atividade, desempenho e XP exclusivamente virtual.'),
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('span', { class: 'small muted', text: 'Lances médios por partida' }), h('b', { class: 'num', text: String(Math.round((s.avgPlies || 0) * 10) / 10) })),
        h('div', { class: 'tile' }, h('span', { class: 'small muted', text: 'XP virtual acumulado' }), h('b', { class: 'num', text: fmtPts(s.xpInCirculation || 0) }))),
      h('div', { class: 'grid-2' }, cols(s.gamesPerDay, 'Partidas por dia'), cols(s.usersPerDay, 'Registos por dia')),
      h('div', { class: 'grid-2' }, bars(s.byCategory, 'category', (k) => CAT[k] || k || 'Torneio', 'Partidas por categoria'), bars(s.byStatus, 'status', (k) => STATUS[k] || k, 'Partidas por estado')),
      bars(s.byReason, 'reason', (k) => REASON[k] || k || '—', 'Motivo de fim de partida'));
  },

  async configuracoes(root) {
    const c = await GET('/api/admin/config');
    const row = (k, v) => [h('dt', { text: k }), h('dd', { text: String(v) })];
    root.append(head('Configurações', 'Leitura da configuração do servidor (definida por variáveis de ambiente).'),
      h('div', { class: 'card stack' }, h('h2', { text: 'Regras e tempos' }), h('dl', { class: 'kv' },
        ...row('Variante de regras', c.variant), ...row('Relógio por jogador', c.clockMinutes + ' min'), ...row('Prazo para iniciar', c.startTimeoutSeconds + ' s'),
        ...row('Análise após interrupção', c.reviewAfterMinutes + ' min'), ...row('Procura automática', c.queueSeconds + ' s'), ...row('XP virtual inicial', fmtPts(c.startingPoints)),
        ...row('Tolerância a quedas rápidas', Math.round(c.offlineGraceMs / 1000) + ' s'), ...row('Tempos de espera das salas', (c.waitOptions || []).join(' / ') + ' s'),
        ...row('Categorias', (c.categories || []).map((x) => x.name).join(' · ')),
        ...row('Planos disponíveis', (c.plans || []).filter((p) => p.active).map((p) => `${p.name} ${fmtPts(p.priceMzn)} MT`).join(' · ')),
        ...row('Gateway de pagamentos', c.paymentAvailable ? 'Configuração encontrada; adaptador externo ainda necessário' : 'Não configurado'))),
      h('div', { class: 'card stack' }, h('h2', { text: 'XP virtual e integração externa' }), h('p', { class: 'muted', text: 'XP não tem valor monetário, não pode ser transferido, levantado ou resgatado. A subscrição só é ativada por callback válido do provedor. Consulte docs/PAGAMENTOS_E_MIGRACOES.md para a configuração e as limitações do adaptador.' })));
  },
};

// ---------------------------------------------------------------- janelas de detalhe
function userModal(u, reload) {
  modal(u.username, (body, close) => {
    body.append(h('dl', { class: 'kv' }, h('dt', { text: 'ID' }), h('dd', { text: u.id }), h('dt', { text: 'Papel' }), h('dd', { text: ROLE[u.role] }), h('dt', { text: 'Estado' }), h('dd', { text: u.status === 'active' ? 'Ativo' : 'Suspenso' + (u.statusReason ? ' — ' + u.statusReason : '') }),
      h('dt', { text: 'XP virtual' }), h('dd', { text: fmtPts(u.xp) }), h('dt', { text: 'Plano' }), h('dd', { text: u.plan.toUpperCase() }), h('dt', { text: 'Rating' }), h('dd', { text: String(u.rating) }), h('dt', { text: 'Último acesso' }), h('dd', { text: dateOf(u.lastSeen) })));
    const acts = h('div', { class: 'stack sm' });
    if (can(2) && u.id !== me.id) {
      const susp = u.status === 'active';
      acts.append(h('button', { class: 'btn block' + (susp ? ' danger' : ''), onclick: () => { close(); confirmBox(susp ? 'Suspender utilizador' : 'Reativar utilizador', susp ? 'As sessões ativas terminam e deixa de poder entrar.' : 'O utilizador volta a poder entrar.', susp ? 'Suspender' : 'Reativar', async (note) => { const r = await act(() => POST(`/api/admin/users/${u.id}/status`, { status: susp ? 'suspended' : 'active', reason: note }), 'Estado atualizado.'); if (r) reload(); return !!r; }, true); } }, susp ? 'Suspender' : 'Reativar'));
    }
    if (can(3)) {
      const role = h('select', {}, ...['user', 'support', 'moderator', 'admin'].map((r) => h('option', { value: r, text: ROLE[r], selected: r === u.role })));
      acts.append(h('div', { class: 'row' }, h('div', { class: 'field grow' }, role), h('button', { class: 'btn', onclick: async () => { if (await act(() => POST(`/api/admin/users/${u.id}/role`, { role: role.value }), 'Papel atualizado.')) { close(); reload(); } } }, 'Aplicar papel')));
      acts.append(h('button', { class: 'btn block', onclick: () => { close(); pointsModal(u, reload); } }, 'Ajustar XP virtual'));
    }
    if (!acts.children.length) acts.append(h('p', { class: 'small muted', text: 'O seu papel não permite ações sobre utilizadores.' }));
    body.append(acts);
  });
}
function pointsModal(u, reload) {
  modal('Ajustar XP virtual', (body, close) => {
    const n = h('input', { type: 'number', min: 1, max: 100000, step: '1', placeholder: 'Ex.: 500' });
    const note = h('input', { placeholder: 'Justificação (obrigatória)', maxlength: 200 });
    body.append(h('p', { class: 'muted', text: `${u.username}: ${fmtPts(u.xp)} XP. Ajustes são sempre positivos e ficam na auditoria.` }), h('div', { class: 'field' }, n), h('div', { class: 'field' }, note),
      h('button', { class: 'btn primary block', onclick: async () => { if (note.value.trim().length < 3) return toast('Escreva uma justificação.', 'err'); const r = await act(() => POST(`/api/admin/users/${u.id}/points`, { amount: Number(n.value), note: note.value.trim() }), 'XP ajustado.'); if (r) { close(); reload(); } } }, 'Aplicar'));
  });
}
function ratingModal(player, reload) {
  modal('Ajustar rating de ' + player.username, (body, close) => {
    const rating = h('input', { type: 'number', min: 0, max: 4000, value: player.rating, required: true });
    const note = h('textarea', { rows: 3, maxlength: 200, placeholder: 'Justificação (obrigatória)' });
    body.append(h('p', { class: 'muted', text: 'Ajuste manual do rating geral. A operação será registada na auditoria.' }),
      h('div', { class: 'field' }, h('label', { text: 'Rating' }), rating), h('div', { class: 'field' }, h('label', { text: 'Justificação' }), note),
      h('button', { class: 'btn primary block', onclick: async () => { const r = await act(() => POST(`/api/admin/users/${player.id}/rating`, { rating: Number(rating.value), note: note.value.trim() }), 'Rating atualizado.'); if (r) { close(); reload(); } } }, 'Guardar'));
  });
}
function reportModal(x, reload) {
  modal('Tratar denúncia', (body, close) => {
    const note = h('textarea', { rows: 3, placeholder: 'Nota interna', maxlength: 300 });
    const go = (status) => async () => { if (await act(() => POST(`/api/admin/reports/${x.id}`, { status, note: note.value.trim() }), 'Denúncia atualizada.')) { close(); reload(); } };
    body.append(h('p', { class: 'muted', text: x.reason }), h('div', { class: 'field' }, note),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: go('closed') }, 'Fechar (tratada)'), h('button', { class: 'btn', onclick: go('dismissed') }, 'Dispensar'), x.status !== 'open' ? h('button', { class: 'btn', onclick: go('open') }, 'Reabrir') : null));
  });
}
async function gameModal(id, reload) {
  let r;
  try { r = await GET('/api/games/' + id); } catch (e) { return toast(e.message, 'err'); }
  const g = r.game;
  const m = modal(`${g.white.username} vs ${g.black.username}`, (body, close) => {
    const moves = h('div', { class: 'moves' });
    for (let i = 0; i < r.moves.length; i += 2) { moves.append(h('span', { class: 'n', text: `${i / 2 + 1}.` })); for (const j of [i, i + 1]) moves.append(r.moves[j] ? h('span', { text: r.moves[j].notation }) : h('span')); }
    body.append(h('dl', { class: 'kv' }, h('dt', { text: 'Estado' }), h('dd', { text: STATUS[g.status] + (g.reason ? ' — ' + (REASON[g.reason] || g.reason) : '') }), h('dt', { text: 'Categoria' }), h('dd', { text: CAT[g.category] || 'Torneio' }),
      h('dt', { text: 'Brancas' }), h('dd', { text: `${g.white.username} (${g.white.online ? 'online' : 'offline'}) · desconexões ${g.disconnects.w}` }), h('dt', { text: 'Negras' }), h('dd', { text: `${g.black.username} (${g.black.online ? 'online' : 'offline'}) · desconexões ${g.disconnects.b}` }),
      h('dt', { text: 'Criada' }), h('dd', { text: dateOf(g.createdAt) }), g.reviewDeadline ? [h('dt', { text: 'Análise prevista' }), h('dd', { text: dateOf(g.reviewDeadline) })] : null));
    if (can(2) && !['finished', 'draw', 'cancelled'].includes(g.status)) {
      const note = h('input', { placeholder: 'Nota da decisão (obrigatória)', maxlength: 300 });
      const dec = (action, label) => h('button', { class: 'btn sm', onclick: () => { if (note.value.trim().length < 3) return toast('Escreva a nota da decisão.', 'err'); confirmBox('Confirmar decisão', `${label}. Esta ação fica registada na auditoria.`, 'Confirmar', async () => { const x = await act(() => POST(`/api/admin/games/${id}/resolve`, { action, note: note.value.trim() }), 'Decisão aplicada.'); if (x) { close(); reload?.(); } return !!x; }); } }, label);
      body.append(h('h3', { text: 'Decisão da moderação' }), h('div', { class: 'field' }, note), h('div', { class: 'row wrap' }, dec('w', 'Vitória das brancas'), dec('b', 'Vitória das negras'), dec('d', 'Empate'), dec('cancel', 'Cancelar partida'), dec('resume', 'Retomar')));
    }
    body.append(h('h3', { text: `Lances (${r.moves.length})` }), r.moves.length ? moves : h('p', { class: 'muted', text: 'Sem lances.' }));
    if (r.events?.length) body.append(h('h3', { text: 'Cronologia' }), h('div', { class: 'evt' }, ...r.events.flatMap((e) => [h('time', { text: new Date(e.at).toTimeString().slice(0, 8) }), h('span', { text: `${e.kind}${e.detail ? ' ' + JSON.stringify(e.detail) : ''}` })])));
  });
  m.body.closest('.modal-wrap').classList.add('wide-modal');
}
async function tournamentModal(id) {
  let t;
  try { t = await GET('/api/tournaments/' + id); } catch (e) { return toast(e.message, 'err'); }
  modal(t.name, (body) => {
    body.append(h('p', { class: 'muted', text: `${t.players.length}/${t.size} jogadores · ronda ${t.round || '—'}${t.winner ? ' · vencedor ' + t.winner : ''}` }),
      t.players.length ? h('div', { class: 'row wrap' }, ...t.players.map((p) => h('span', { class: 'chip', text: p.username }))) : h('p', { class: 'muted', text: 'Sem inscritos.' }),
      ...t.matches.map((x) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: `R${x.round}: ${x.p1 || '—'} vs ${x.p2 || '—'}` }), h('span', { class: 'small muted', text: x.winner ? 'Vencedor: ' + x.winner : x.gameStatus ? STATUS[x.gameStatus] : 'A aguardar' })), x.gameId ? h('button', { class: 'btn sm', onclick: () => gameModal(x.gameId) }, 'Ver') : null)));
  });
}

// ---------------------------------------------------------------- arranque / início de sessão
function loginScreen(msg) {
  const err = h('div', { class: 'error', role: 'alert', text: msg || '' });
  const form = h('form', { class: 'card auth-card stack' },
    h('div', { class: 'auth-brand' }, brandMark(), h('h1', { text: 'Administração' }), h('p', { class: 'muted', text: 'Acesso reservado à equipa.' })),
    h('div', { class: 'field' }, h('label', { for: 'u', text: 'Utilizador' }), h('input', { id: 'u', name: 'username', autocomplete: 'username', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'p', text: 'Palavra-passe' }), h('input', { id: 'p', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    err, h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar'), h('a', { class: 'small', href: '/', text: 'Voltar à plataforma' }));
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { await POST('/api/auth/login', Object.fromEntries(new FormData(form))); start(); } catch (ex) { err.textContent = ex.message; } });
  clear(app).append(h('div', { class: 'auth' }, form));
}
async function start() {
  try { const m = await GET('/api/me'); me = m.user; if (!m.staff) return loginScreen('Esta conta não tem permissões de administração.'); } catch { return loginScreen(); }
  build();
  if (!location.hash) location.hash = '#/dashboard';
  route();
}
start();
