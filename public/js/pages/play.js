// Jogar Damas: matchmaking automático por categoria.
import { h, icon, fmtPts, toast } from '/js/ui.js';
import { store, GET, POST, DEL, on } from '/js/api.js';
import { pageHead, catPicker, demoNote, every } from '/js/pages/common.js';

export default function play(root) {
  const cfg = store.config;
  const offs = [];
  let cat = cfg.categories[0].id;
  let search = null; // { since, timeoutMs, t0 }
  const box = h('div', { class: 'card stack' });
  root.append(pageHead('Jogar Damas', 'Escolha uma categoria e procure um adversário automaticamente.'), box);

  function draw() {
    box.replaceChildren();
    if (search) {
      const c = cfg.categories.find((x) => x.id === search.category);
      const bar = h('i');
      const left = h('span', { class: 'num small muted' });
      box.append(h('h2', { text: 'A procurar adversário…' }),
        h('p', { class: 'muted', text: `Categoria ${c?.name} · entrada de ${fmtPts(c?.entry || 0)} pontos demonstrativos.` }),
        h('div', { class: 'progress', role: 'progressbar' }, bar), left,
        h('p', { class: 'small faint', text: 'Assim que houver um adversário elegível, a partida abre automaticamente para os dois.' }),
        h('button', { class: 'btn', onclick: cancel }, 'Cancelar procura'));
      search.bar = bar; search.left = left;
      tick();
      return;
    }
    const picker = catPicker(cfg.categories, store.balance, cat, (v) => { cat = v; });
    box.append(h('h2', { text: 'Categoria' }), picker.el,
      h('p', { class: 'small muted', text: `Tem ${fmtPts(store.balance)} pontos demonstrativos.` }),
      h('button', { class: 'btn primary block', onclick: () => start(picker.value()) }, icon('swords'), 'Procurar adversário'),
      h('p', { class: 'small muted' }, 'Prefere escolher o adversário? ', h('a', { href: '#/salas', text: 'Veja as salas disponíveis' }), '.'),
      demoNote());
  }

  async function start(c) {
    cat = c;
    try {
      const r = await POST('/api/queue', { category: c });
      if (r.matched) { location.hash = '#/partida/' + r.gameId; return; }
      search = { category: c, since: r.since, timeoutMs: r.timeoutMs, elapsed0: (r.serverNow ?? Date.now()) - r.since, t0: performance.now() };
      draw();
    } catch (e) { toast(e.message, 'err'); }
  }
  async function cancel() {
    search = null;
    draw();
    try { await DEL('/api/queue'); } catch { /* ignora */ }
  }
  function tick() {
    if (!search?.bar) return;
    const el = search.elapsed0 + (performance.now() - search.t0);
    const rest = Math.max(0, search.timeoutMs - el);
    search.bar.style.transform = `scaleX(${rest / search.timeoutMs})`;
    search.left.textContent = `${Math.ceil(rest / 1000)} s`;
  }

  offs.push(every(250, tick));
  offs.push(on('ws:queue', (m) => {
    if (m.status === 'timeout' && search) { search = null; draw(); toast('Ninguém disponível nesta categoria. Tente de novo ou crie uma sala.'); }
  }));
  offs.push(on('me', () => { if (!search) draw(); }));

  draw();
  GET('/api/queue').then((r) => {
    if (r.searching) { search = { category: r.category, since: r.since, timeoutMs: r.timeoutMs, elapsed0: r.serverNow - r.since, t0: performance.now() }; draw(); }
  }).catch(() => {});

  return () => {
    offs.forEach((f) => f());
    if (search) DEL('/api/queue').catch(() => {});
  };
}
