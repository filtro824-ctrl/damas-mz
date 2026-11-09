import { h, avatarEl } from '/js/ui.js';
import { store, GET } from '/js/api.js';
import { pageHead, loadingEl, errorEl, emptyEl, CAT_NAME } from '/js/pages/common.js';

export default function rankings(root) {
  let cat = 'geral';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Categoria' });
  const box = h('div', { class: 'card list' }, loadingEl());
  const btns = Object.entries(CAT_NAME).map(([k, v]) => h('button', { type: 'button', 'aria-pressed': String(k === cat), text: v, onclick: () => { cat = k; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(CAT_NAME)[i] === cat))); load(); } }));
  seg.append(...btns);
  root.append(pageHead('Classificações', 'Pontuação por vitórias, derrotas e empates. Estatísticas demonstrativas.'), h('div', { class: 'stack' }, seg, box));
  let token = 0;
  async function load() {
    const my = ++token;
    box.replaceChildren(loadingEl());
    try {
      const r = await GET('/api/rankings?category=' + cat);
      if (my !== token) return;
      box.replaceChildren();
      if (!r.items.length) box.append(emptyEl('chart', 'Ainda não há jogos nesta categoria.'));
      for (const p of r.items) {
        box.append(h('div', { class: 'item' + (p.id === store.me.id ? ' me' : '') },
          h('b', { class: 'num', text: String(p.position).padStart(2, '0') }), avatarEl(p, 'sm'),
          h('div', { class: 'grow' }, h('b', { text: p.username + (p.id === store.me.id ? ' (você)' : '') }), h('span', { class: 'small muted num', text: `${p.wins}V · ${p.losses}D · ${p.draws}E` })),
          h('b', { class: 'num', text: String(p.rating) })));
      }
    } catch (e) { if (my === token) box.replaceChildren(errorEl(e)); }
  }
  load();
}
