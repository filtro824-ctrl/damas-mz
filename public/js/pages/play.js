// Matchmaking por categoria e filtros avançados autorizados pelo servidor.
import { h, icon, fmtPts, toast } from '/js/ui.js';
import { store, GET, POST, DEL, on } from '/js/api.js';
import { pageHead, catPicker, every } from '/js/pages/common.js';

export default function play(root) {
  const cfg = store.config; const offs = []; let cat = cfg.categories[0].id; let search = null;
  const box = h('div', { class: 'card stack' });
  root.append(pageHead('Jogar Damas', 'Escolha uma categoria e procure um adversário automaticamente.'), box);
  const premium = () => ['premium', 'vip'].includes(store.subscription?.plan?.code);
  function draw() {
    box.replaceChildren();
    if (search) {
      const c = cfg.categories.find((x) => x.id === search.category); const bar = h('i'); const left = h('span', { class: 'num small muted' });
      box.append(h('h2', { text: 'A procurar adversário…' }), h('p', { class: 'muted', text: `Categoria ${c?.name} · emparelhamento por nível de jogo.` }),
        h('div', { class: 'progress', role: 'progressbar' }, bar), left,
        h('p', { class: 'small faint', text: 'A partida abre automaticamente quando surgir um adversário elegível.' }), h('button', { class: 'btn', onclick: cancel }, 'Cancelar procura'));
      search.bar = bar; search.left = left; tick(); return;
    }
    const picker = catPicker(cfg.categories, store.balance, cat, (v) => { cat = v; });
    const fields = [];
    let min, max, username;
    if (premium()) {
      min = h('input', { type: 'number', min: 0, max: 4000, placeholder: 'Rating mínimo', 'aria-label': 'Rating mínimo' });
      max = h('input', { type: 'number', min: 0, max: 4000, placeholder: 'Rating máximo', 'aria-label': 'Rating máximo' });
      username = h('input', { maxlength: 20, placeholder: 'Nome exato do adversário (opcional)', 'aria-label': 'Nome do adversário' });
      fields.push(h('h3', { text: 'Pesquisa avançada · Premium' }), h('div', { class: 'row wrap' }, min, max), username);
    } else fields.push(h('div', { class: 'card' }, h('b', { text: 'Quer definir rating ou procurar alguém específico?' }),
      h('p', { class: 'small muted', text: 'A pesquisa avançada está disponível no Premium e VIP.' }), h('a', { class: 'btn sm', href: '#/planos', text: 'Ver planos' })));
    box.append(h('h2', { text: 'Categoria' }), picker.el,
      h('p', { class: 'small muted', text: `${fmtPts(store.balance)} XP · sem custo para jogar.` }), ...fields,
      h('button', { class: 'btn primary block', onclick: () => start(picker.value(), { min: min?.value, max: max?.value, username: username?.value }) }, icon('swords'), 'Procurar adversário'),
      h('p', { class: 'small muted' }, 'Também pode ', h('a', { href: '#/salas', text: 'ver salas disponíveis' }), '.'));
  }
  async function start(category, filters) {
    cat = category;
    try {
      const body = { category };
      if (filters.min) body.minRating = Number(filters.min);
      if (filters.max) body.maxRating = Number(filters.max);
      if (filters.username?.trim()) body.username = filters.username.trim();
      const r = await POST('/api/queue', body);
      if (r.matched) { location.hash = '#/partida/' + r.gameId; return; }
      search = { category, since: r.since, timeoutMs: r.timeoutMs, elapsed0: (r.serverNow ?? Date.now()) - r.since, t0: performance.now() }; draw();
    } catch (e) { toast(e.message, 'err'); }
  }
  async function cancel() { search = null; draw(); try { await DEL('/api/queue'); } catch { /* já saiu */ } }
  function tick() {
    if (!search?.bar) return;
    const elapsed = search.elapsed0 + (performance.now() - search.t0); const rest = Math.max(0, search.timeoutMs - elapsed);
    search.bar.style.transform = `scaleX(${rest / search.timeoutMs})`; search.left.textContent = `${Math.ceil(rest / 1000)} s`;
  }
  offs.push(every(250, tick), on('ws:queue', (m) => { if (m.status === 'timeout' && search) { search = null; draw(); toast('Ninguém disponível nesta categoria. Tente de novo ou crie uma sala.'); } }), on('me', () => { if (!search) draw(); }));
  draw();
  GET('/api/queue').then((r) => { if (r.searching) { search = { category: r.category, since: r.since, timeoutMs: r.timeoutMs, elapsed0: r.serverNow - r.since, t0: performance.now() }; draw(); } }).catch(() => {});
  return () => { offs.forEach((f) => f()); if (search) DEL('/api/queue').catch(() => {}); };
}
