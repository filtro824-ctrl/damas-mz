// Peças de interface partilhadas pelas páginas.
import { h, icon, fmtPts } from '/js/ui.js';

export const pageHead = (title, sub, right) =>
  h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), sub ? h('p', { text: sub }) : null), right || null);

export const loadingEl = (t = 'A carregar…') => h('div', { class: 'empty' }, t);
export const errorEl = (e) => h('div', { class: 'empty' }, icon('alert'), h('p', { text: e?.message || 'Ocorreu um erro.' }));
export const emptyEl = (ic, text) => h('div', { class: 'empty' }, icon(ic), h('p', { text }));

export const CAT_ORDER = ['bronze', 'prata', 'ouro', 'diamante'];
export const CAT_NAME = { geral: 'Geral', bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', diamante: 'Diamante', torneio: 'Torneios' };

export function tier(n) {
  const t = h('span', { class: 'tier' });
  for (let i = 0; i < 4; i++) t.append(h('span', { class: i < n ? 'f' : '' }));
  return t;
}

/** Seletor de categorias (Bronze 100 · Prata 250 · Ouro 500 · Diamante 1.000 — pontos demonstrativos). */
export function catPicker(categories, balance, initial, onChange) {
  const wrap = h('div', { class: 'cats', role: 'group', 'aria-label': 'Categoria' });
  let value = initial || categories[0].id;
  const btns = new Map();
  categories.forEach((c, i) => {
    const b = h('button', {
      type: 'button', class: 'cat', 'aria-pressed': String(c.id === value), disabled: balance < c.entry,
      title: balance < c.entry ? 'Pontos demonstrativos insuficientes' : '',
      onclick: () => { value = c.id; for (const [id, x] of btns) x.setAttribute('aria-pressed', String(id === value)); onChange?.(value); },
    }, tier(i + 1), h('b', { text: c.name }), h('span', { class: 'muted small num', text: `${fmtPts(c.entry)} pts` }));
    btns.set(c.id, b);
    wrap.append(b);
  });
  return { el: wrap, value: () => value };
}

/** Executa fn a cada ms; devolve a função que pára. */
export function every(ms, fn) { const t = setInterval(fn, ms); return () => clearInterval(t); }

export const demoNote = () => h('p', { class: 'small faint', text: 'Pontos demonstrativos: não têm valor real, não são transferíveis nem convertíveis em dinheiro.' });
