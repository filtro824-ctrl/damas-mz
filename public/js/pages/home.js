import { h, icon, fmtPts, fmtDate, STATUS, RESULT, avatarEl } from '/js/ui.js';
import { store, GET, on } from '/js/api.js';
import { pageHead, demoNote } from '/js/pages/common.js';

export default function home(root) {
  const u = store.me;
  const offs = [];
  root.append(pageHead(`Olá, ${u.username}`, 'Damas Portuguesas online. Cada partida conta para a sua classificação.'));
  const active = h('div');
  const pts = h('div', { class: 'card dark stack sm' });
  const stats = h('div', { class: 'card stack' });
  const recent = h('div', { class: 'card stack' });
  root.append(active, h('div', { class: 'grid-2' }, pts, stats),
    h('div', { class: 'row wrap' }, h('a', { class: 'btn primary', href: '#/jogar' }, icon('play'), 'Jogar Damas'),
      h('a', { class: 'btn', href: '#/salas' }, icon('rooms'), 'Salas disponíveis'),
      h('a', { class: 'btn', href: '#/planos' }, icon('crown'), 'Planos'),
      h('a', { class: 'btn', href: '#/torneios' }, icon('trophy'), 'Torneios')), recent);

  function drawPoints() {
    const p = store.progression || { level: 1, xp: store.balance, winStreak: 0 };
    const sub = store.subscription?.plan?.name || 'Gratuito';
    pts.replaceChildren(h('span', { class: 'small muted', text: `Progressão · nível ${p.level}` }),
      h('b', { class: 'num big', text: fmtPts(p.xp) + ' XP' }),
      h('p', { class: 'muted small', text: `Plano ${sub} · sequência atual: ${p.winStreak} vitória(s).` }), demoNote());
  }
  function drawActive() {
    active.replaceChildren();
    if (store.activeGames[0]) {
      active.append(h('div', { class: 'card stack sm' }, h('h2', { text: 'Partida em curso' }),
        h('p', { class: 'muted', text: 'Volte ao tabuleiro exatamente onde parou.' }),
        h('a', { class: 'btn primary', href: '#/partida/' + store.activeGames[0] }, icon('swords'), 'Voltar à partida')));
      active.className = 'stack'; active.style.marginBottom = '16px';
    } else { active.className = ''; active.style.marginBottom = ''; }
  }
  drawPoints(); drawActive();
  offs.push(on('me', () => { drawPoints(); drawActive(); }));

  stats.append(h('h2', { text: 'A sua classificação' }), h('p', { class: 'muted', text: 'A carregar…' }));
  GET('/api/users/' + u.id).then((r) => {
    const g = r.rankings.find((x) => x.category === 'geral') || { rating: 1000, wins: 0, losses: 0, draws: 0 };
    const p = r.progression;
    stats.replaceChildren(h('h2', { text: 'A sua classificação' }),
      h('div', { class: 'stats n4' },
        ...[['Rating', g.rating], ['Vitórias', g.wins], ['Derrotas', g.losses], ['Empates', g.draws]].map(([label, value]) => h('div', { class: 'stat' }, h('span', { class: 'small muted', text: label }), h('b', { class: 'num', text: String(value) }))),
      ), h('p', { class: 'small muted', text: `${p.level}º nível · melhor sequência ${p.bestStreak} vitória(s) · ${p.achievements.length} conquista(s)` }),
      p.achievements.length ? h('div', { class: 'row wrap' }, ...p.achievements.map((a) => h('span', { class: 'chip', title: a.description, text: a.name }))) : h('p', { class: 'small muted', text: 'Conclua partidas para desbloquear conquistas.' }));
  }).catch(() => {});

  recent.append(h('h2', { text: 'Últimas partidas' }), h('p', { class: 'muted', text: 'A carregar…' }));
  GET('/api/games/mine').then((r) => {
    const items = r.items.slice(0, 4);
    const list = h('div', { class: 'list' });
    if (!items.length) list.append(h('div', { class: 'empty', text: 'Ainda não jogou nenhuma partida.' }));
    for (const g of items) list.append(h('a', { class: 'item', href: '#/historico/' + g.id }, avatarEl({ username: g.opponent.username }, 'sm'),
      h('div', { class: 'grow' }, h('b', { text: 'vs ' + g.opponent.username }), h('span', { class: 'small faint', text: fmtDate(g.createdAt) })),
      g.result ? h('span', { class: 'pill-res ' + g.result, text: RESULT[g.result] }) : h('span', { class: 'chip', text: STATUS[g.status] })));
    recent.replaceChildren(h('div', { class: 'row between' }, h('h2', { text: 'Últimas partidas' }),
      h('a', { class: 'small', href: '#/historico', text: r.fullHistory ? 'Ver histórico completo' : 'Ver últimas partidas' })), list, demoNote());
  }).catch(() => {});
  return () => offs.forEach((f) => f());
}
