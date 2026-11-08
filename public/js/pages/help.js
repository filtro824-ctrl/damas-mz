import { h, toast } from '/js/ui.js';
import { store, POST } from '/js/api.js';
import { pageHead } from '/js/pages/common.js';

const li = (...t) => h('li', { text: t.join('') });

export default function help(root) {
  const c = store.config || {};
  const clock = c.clockMinutes ?? 10;
  const review = c.reviewMinutes ?? 10;
  const form = h('form', { class: 'card stack' });
  const err = h('div', { class: 'error', role: 'alert' });
  form.append(h('h2', { text: 'Denunciar ou pedir suporte' }),
    h('p', { class: 'muted', text: 'Descreva o problema. A moderação analisa cada caso; não há sanções automáticas.' }),
    h('div', { class: 'field' }, h('label', { for: 'ru', text: 'Utilizador envolvido (opcional)' }), h('input', { id: 'ru', name: 'targetUsername', autocomplete: 'off' })),
    h('div', { class: 'field' }, h('label', { for: 'rg', text: 'Código da partida (opcional)' }), h('input', { id: 'rg', name: 'gameId', autocomplete: 'off' })),
    h('div', { class: 'field' }, h('label', { for: 'rr', text: 'O que aconteceu?' }), h('textarea', { id: 'rr', name: 'reason', maxlength: 1000, required: true })),
    err, h('button', { class: 'btn primary', type: 'submit' }, 'Enviar'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const v = Object.fromEntries(new FormData(form));
    for (const k of ['targetUsername', 'gameId']) if (!v[k]?.trim()) delete v[k];
    try { await POST('/api/reports', v); form.reset(); toast('Enviado. Obrigado.'); } catch (ex) { err.textContent = ex.message; }
  });

  root.append(pageHead('Ajuda e suporte', 'Regras, reconexão e contacto.'), h('div', { class: 'stack' },
    h('div', { class: 'card rules' },
      h('h2', { text: 'Regras: Damas Portuguesas' }),
      h('ul', {}, li('Tabuleiro 8×8, 32 casas escuras numeradas de 1 a 32. Cada jogador tem 12 peões. As brancas começam.'),
        li('Peão: avança uma casa na diagonal para a frente. Captura apenas para a frente, saltando uma peça adversária (sem captura para trás).'),
        li('Dama: move-se qualquer número de casas na diagonal, para a frente ou para trás, e captura à distância.'),
        li('A captura é obrigatória. Deve escolher a sequência que captura o maior número de peças (lei da quantidade) e, a igualdade, a que captura mais damas (lei da qualidade).'),
        li('As peças capturadas só saem no fim do lance e a mesma peça não pode ser capturada duas vezes.'),
        li('Um peão que chega à última fila torna-se dama; se passar por lá a meio de uma captura e continuar, não é coroado.'),
        li('Ganha quem capturar todas as peças do adversário, o deixar sem lances, ou lhe esgotar o tempo.'),
        li('Empate: 20 lances de cada jogador só com damas e sem capturas; finais de 3 damas contra 1 após 12 lances; ou a mesma posição 3 vezes.'),
        li(`Relógio: ${clock} minutos por jogador, controlados pelo servidor.`)),
      h('h3', { text: 'Como jogar' }),
      h('p', { text: 'Toque numa peça sua; os destinos possíveis ficam assinalados. Toque no destino para jogar. Em capturas múltiplas, toque em cada casa de aterragem até completar o lance.' })),
    h('div', { class: 'card rules' },
      h('h2', { text: 'Perdi a internet: e agora?' }),
      h('ul', {}, li('A partida não se perde. O servidor guarda a posição, as jogadas e os relógios, e o adversário é avisado.'),
        li('Os relógios param enquanto um dos jogadores estiver desligado. Ninguém ganha por perder a ligação.'),
        li('Volte quando quiser: abra o DAMAS MZ e toque em "Voltar à partida" (ou será levado para ela automaticamente). A posição, a vez e o tempo são recuperados.'),
        li(`Se a interrupção durar mais de ${review} minutos, a partida passa a "Em análise" e a moderação decide com base no registo (vitória, empate, cancelamento ou retoma). Um cancelamento não altera o XP.`),
        li('A tela de jogo não tem botões de desistir ou reiniciar: sair do ecrã não termina a partida.'))),
    h('div', { class: 'card rules' },
      h('h2', { text: 'XP e progressão' }),
      h('p', { text: 'As vitórias, empates e participações concedem XP virtual para classificação, níveis e conquistas. O XP não tem valor monetário, não é transferível e não pode ser convertido nem trocado por recompensas económicas.' })),
    form));
}
