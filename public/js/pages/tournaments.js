// Torneios gratuitos (sem pontos em jogo).
import { h, icon, toast, avatarEl, STATUS } from '/js/ui.js';
import { store, GET, POST, on } from '/js/api.js';
import { pageHead, loadingEl, errorEl, emptyEl } from '/js/pages/common.js';

const T_STATUS = { open: 'Inscrições abertas', running: 'Em curso', finished: 'Terminado' };
const FINAL = new Set(['finished', 'draw', 'cancelled']);

export default function list(root) {
  const box = h('div', { class: 'card list' }, loadingEl());
  root.append(pageHead('Torneios', 'Torneios gratuitos de eliminatórias. Não envolvem pontos nem prémios.'), box);
  const load = () => GET('/api/tournaments').then((r) => {
    box.replaceChildren();
    if (!r.items.length) box.append(emptyEl('trophy', 'Ainda não há torneios. Volte em breve.'));
    for (const t of r.items) {
      box.append(h('a', { class: 'item', href: '#/torneios/' + t.id }, h('div', { class: 'grow' }, h('b', { text: t.name }), h('span', { class: 'small muted', text: `${t.players}/${t.size} jogadores${t.winner ? ' · Vencedor: ' + t.winner : ''}` })), h('span', { class: 'chip', text: T_STATUS[t.status] || t.status }), icon('next', 18)));
    }
  }).catch((e) => box.replaceChildren(errorEl(e)));
  load();
  const off = on('ws:tournaments', load);
  return off;
}

export function detail(root, [tid]) {
  const box = h('div', { class: 'stack' }, loadingEl());
  root.append(box);
  const offs = [];
  async function load() {
    try {
      const t = await GET('/api/tournaments/' + tid);
      const rounds = new Map();
      for (const m of t.matches) { if (!rounds.has(m.round)) rounds.set(m.round, []); rounds.get(m.round).push(m); }
      const act = t.status === 'open'
        ? h('button', { class: 'btn ' + (t.joined ? '' : 'primary'), onclick: async () => { try { await POST(`/api/tournaments/${tid}/${t.joined ? 'leave' : 'join'}`); toast(t.joined ? 'Inscrição cancelada.' : 'Inscrição feita.'); } catch (e) { toast(e.message, 'err'); } load(); } }, t.joined ? 'Cancelar inscrição' : 'Inscrever-me')
        : null;
      box.replaceChildren(
        pageHead(t.name, `${T_STATUS[t.status]} · ${t.players.length}/${t.size} jogadores${t.winner ? ' · Vencedor: ' + t.winner : ''}`, act),
        h('div', { class: 'card stack' }, h('h2', { text: 'Jogadores' }),
          t.players.length ? h('div', { class: 'row wrap' }, ...t.players.map((p) => h('span', { class: 'chip' }, avatarEl(p, 'sm'), p.username))) : h('p', { class: 'muted', text: 'Ninguém inscrito ainda.' })),
        ...[...rounds].map(([r, ms]) => h('div', { class: 'card stack' }, h('h2', { text: `Ronda ${r}` }),
          h('div', { class: 'list' }, ...ms.map((m) => h('div', { class: 'item' },
            h('div', { class: 'grow' }, h('b', { text: `${m.p1 || '—'} vs ${m.p2 || '—'}` }), h('span', { class: 'small muted', text: m.winner ? `Vencedor: ${m.winner}` : m.gameStatus ? STATUS[m.gameStatus] : 'A aguardar' })),
            m.gameId && m.mine && !FINAL.has(m.gameStatus) ? h('a', { class: 'btn primary sm', href: '#/partida/' + m.gameId }, 'Jogar') : null))))));
    } catch (e) { box.replaceChildren(errorEl(e)); }
  }
  load();
  offs.push(on('ws:tournaments', load), on('ws:match', load));
  return () => offs.forEach((f) => f());
}
