import { h, icon, toast } from '/js/ui.js';
import { store, logout } from '/js/api.js';
import * as prefs from '/js/prefs.js';
import { pageHead } from '/js/pages/common.js';

function choice(label, options, current, onPick) {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const btns = options.map(([v, t]) => h('button', { type: 'button', text: t, 'aria-pressed': String(v === current), onclick: () => { onPick(v); btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v))); } }));
  seg.append(...btns);
  return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: label })), seg);
}

export default function settings(root) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const install = h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: 'Instalar a aplicação' }), h('span', { class: 'small muted', text: standalone ? 'Já está instalada neste dispositivo.' : ios ? 'No Safari: Partilhar → Adicionar ao ecrã principal.' : 'Instale o DAMAS MZ como aplicação (PWA).' })),
    !standalone && !ios ? h('button', { class: 'btn sm', onclick: async () => { const p = window.__installPrompt; if (!p) return toast('Use o menu do navegador: "Instalar aplicação".'); p.prompt(); await p.userChoice; window.__installPrompt = null; } }, 'Instalar') : null);
  root.append(pageHead('Configurações'), h('div', { class: 'stack' },
    h('div', { class: 'card list' },
      choice('Tema', [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']], prefs.get('theme'), (v) => prefs.set('theme', v)),
      choice('Numeração das casas', [[true, 'Mostrar'], [false, 'Ocultar']], prefs.get('numbers'), (v) => prefs.set('numbers', v)),
      choice('Sons', [[true, 'Ligados'], [false, 'Desligados']], prefs.get('sound'), (v) => { prefs.set('sound', v); if (v) prefs.beep('notice'); }),
      install),
    h('div', { class: 'card stack' }, h('h2', { text: 'Conta' }),
      h('p', { class: 'muted', text: `Sessão iniciada como ${store.me.username} (ID ${store.me.id}).` }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: logout }, icon('logout'), 'Terminar sessão'), store.staff ? h('a', { class: 'btn', href: '/admin' }, icon('shield'), 'Painel administrativo') : null)),
    h('div', { class: 'card stack' }, h('h2', { text: 'Sobre' }),
      h('p', { class: 'muted', text: 'DAMAS MZ — versão de demonstração. Regras: Damas Portuguesas (FPDJ, 2025). Pontos fictícios, sem apostas nem pagamentos.' }))));
}
