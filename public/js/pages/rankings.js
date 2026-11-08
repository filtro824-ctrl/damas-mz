import { h, avatarEl } from '/js/ui.js';
import { store, GET } from '/js/api.js';
import { pageHead, loadingEl, errorEl, emptyEl, CAT_NAME } from '/js/pages/common.js';

export default function rankings(root) {
  let cat = 'geral'; let period = 'general'; let token = 0;
  const box = h('div', { class: 'card list' }, loadingEl());
  const catSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Categoria' });
  const periodSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Período' });
  const cats = Object.entries(CAT_NAME).filter(([k]) => ['geral', 'bronze', 'prata', 'ouro', 'diamante'].includes(k));
  const periods = [['general', 'Geral'], ['week', 'Semanal'], ['month', 'Mensal']];
  const catBtns = cats.map(([k, v]) => h('button', { type: 'button', 'aria-pressed': String(k === cat), text: v, onclick: () => { cat = k; catBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(cats[i][0] === cat))); load(); } }));
  const periodBtns = periods.map(([k, v]) => h('button', { type: 'button', 'aria-pressed': String(k === period), text: v, onclick: () => { period = k; periodBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(periods[i][0] === period))); catSeg.classList.toggle('hidden', period !== 'general'); load(); } }));
  catSeg.append(...catBtns); periodSeg.append(...periodBtns);
  root.append(pageHead('Classificações', 'Compita por rating, XP virtual, vitórias e sequência.'), periodSeg, catSeg, box);
  async function load() {
    const mine = ++token; box.replaceChildren(loadingEl());
    try {
      const r = await GET(`/api/rankings?category=${encodeURIComponent(cat)}&period=${period}`);
      if (mine !== token) return;
      box.replaceChildren();
      if (!r.items.length) return box.append(emptyEl('chart', 'Ainda não há pontos de classificação neste período.'));
      for (const p of r.items) box.append(h('div', { class: 'item' + (p.id === store.me.id ? ' me' : '') },
        h('b', { class: 'num', text: String(p.position).padStart(2, '0') }), avatarEl(p, 'sm'),
        h('div', { class: 'grow' }, h('b', { text: p.username + (p.id === store.me.id ? ' (você)' : '') }),
          h('span', { class: 'small muted num', text: `${p.wins}V · ${p.losses}D · ${p.draws}E · sequência ${p.bestStreak || 0}` })),
        h('div', { class: 'meta' }, h('b', { class: 'num', text: period === 'general' ? String(p.rating) : `${p.score} XP` }),
          p.progression ? h('span', { class: 'small muted', text: `nível ${p.progression.level}` }) : null)));
    } catch (e) { if (mine === token) box.replaceChildren(errorEl(e)); }
  }
  load();
}
