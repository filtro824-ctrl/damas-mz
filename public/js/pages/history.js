// Histórico de partidas e repetição (fora da tela de jogo, por isso pode ter controlos próprios).
import * as E from '/shared/engine.js';
import { h, icon, avatarEl, fmtDate, fmtDuration, fmtPts, toast, modal, STATUS, REASON, RESULT } from '/js/ui.js';
import { store, GET, POST } from '/js/api.js';
import { Board } from '/js/board.js';
import * as prefs from '/js/prefs.js';
import { pageHead, loadingEl, errorEl, emptyEl, CAT_NAME } from '/js/pages/common.js';

export default function history(root) {
  const box = h('div', { class: 'card list' }, loadingEl());
  root.append(pageHead('Histórico de partidas', 'Todas as suas partidas, incluindo as interrompidas, com o número de desconexões.'), box);
  GET('/api/games/mine').then((r) => {
    box.replaceChildren();
    if (!r.items.length) box.append(emptyEl('history', 'Ainda não jogou nenhuma partida.'));
    for (const g of r.items) {
      const disc = g.disconnects.you + g.disconnects.opponent;
      box.append(h('a', { class: 'item', href: '#/historico/' + g.id },
        avatarEl({ username: g.opponent.username }),
        h('div', { class: 'grow' }, h('b', { text: 'vs ' + g.opponent.username }),
          h('span', { class: 'small muted', text: `${fmtDate(g.createdAt)} · ${fmtDuration(g.durationMs)} · ${g.color === 'w' ? 'Brancas' : 'Negras'} · ${CAT_NAME[g.category] || 'Torneio'}` }),
          h('span', { class: 'small faint', text: `${g.plies} lances · ${disc} desconex${disc === 1 ? 'ão' : 'ões'}` })),
        h('div', { class: 'meta stack sm' }, g.result ? h('span', { class: 'pill-res ' + g.result, text: RESULT[g.result] }) : null, h('span', { class: 'chip', text: STATUS[g.status] || g.status }))));
    }
  }).catch((e) => box.replaceChildren(errorEl(e)));
}

export function replay(root, [id]) {
  const box = h('div', { class: 'stack' }, loadingEl());
  root.append(box);
  let off = () => {};
  GET('/api/games/' + id).then(({ game: g, moves }) => {
    const board = new Board({ numbers: true });
    board.setOrientation(g.you === 'b' ? 'b' : 'w');
    const states = [E.initialState()];
    for (const m of moves) { const r = E.applyMove(states[states.length - 1], m.path); if (!r.ok) break; states.push(r.state); }
    let n = states.length - 1;
    const list = h('div', { class: 'moves' });
    const info = h('div', { class: 'small muted num' });
    function show(i) {
      n = Math.max(0, Math.min(states.length - 1, i));
      board.render(states[n].board, { last: n ? moves[n - 1].path : null });
      info.textContent = n ? `Lance ${n} de ${states.length - 1}: ${moves[n - 1].notation}` : 'Posição inicial';
      list.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === n)));
    }
    for (let i = 0; i < moves.length; i += 2) {
      list.append(h('span', { class: 'n', text: `${i / 2 + 1}.` }));
      for (const j of [i, i + 1]) list.append(moves[j] ? h('button', { 'data-i': j + 1, type: 'button', text: moves[j].notation, onclick: () => show(j + 1) }) : h('span'));
    }
    const opp = g.you === 'w' ? g.black : g.white;
    const res = g.status === 'finished' ? (g.result === g.you ? 'Vitória' : 'Derrota') : g.status === 'draw' ? 'Empate' : STATUS[g.status];
    const ctrl = h('div', { class: 'replay-controls' },
      ...[['first', 'Início', () => show(0)], ['back', 'Anterior', () => show(n - 1)], ['next', 'Seguinte', () => show(n + 1)], ['last', 'Fim', () => show(states.length - 1)]].map(([ic, label, fn]) => h('button', { class: 'icon-btn', 'aria-label': label, onclick: fn }, icon(ic))));
    const onKey = (e) => { if (e.key === 'ArrowLeft') show(n - 1); if (e.key === 'ArrowRight') show(n + 1); };
    document.addEventListener('keydown', onKey);
    off = () => document.removeEventListener('keydown', onKey);
    box.replaceChildren(
      pageHead(`vs ${opp.username}`, `${res}${g.reason ? ' — ' + REASON[g.reason] : ''} · ${fmtDate(g.createdAt)} · ${g.you === 'w' ? 'Brancas' : 'Negras'} · desconexões: ${g.disconnects.w + g.disconnects.b}`,
        h('a', { class: 'btn sm', href: '#/historico' }, icon('back'), 'Histórico')),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card stack' }, h('div', { class: 'replay-board' }, board.el), info, ctrl),
        h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h2', { text: 'Lances' }), h('button', { class: 'btn sm danger', onclick: () => report(g, opp) }, icon('alert'), 'Denunciar')), moves.length ? list : h('p', { class: 'muted', text: 'Sem lances registados.' }))));
    show(states.length - 1);
  }).catch((e) => box.replaceChildren(errorEl(e)));
  return () => off();
}

function report(g, opp) {
  modal('Denunciar partida', (body, close) => {
    const t = h('textarea', { rows: 4, maxlength: 1000, placeholder: 'Descreva o que aconteceu (mínimo 10 caracteres).' });
    body.append(h('p', { class: 'muted', text: `Partida contra ${opp.username}. A moderação analisa cada denúncia; ninguém é sancionado automaticamente.` }), h('div', { class: 'field' }, t),
      h('button', { class: 'btn primary block', onclick: async () => { try { await POST('/api/reports', { targetUsername: opp.username, gameId: g.id, reason: t.value }); close(); toast('Denúncia enviada. Obrigado.'); } catch (e) { toast(e.message, 'err'); } } }, 'Enviar denúncia'));
  });
}
