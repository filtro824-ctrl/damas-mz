// Salas disponíveis e Minhas salas. O tempo de espera é do servidor (remainingMs); aqui só se desenha a contagem.
import { h, icon, fmtPts, fmtClock, toast, modal, avatarEl, ROOM_STATUS } from '/js/ui.js';
import { store, GET, POST, on } from '/js/api.js';
import { pageHead, catPicker, loadingEl, errorEl, emptyEl, every, demoNote, CAT_NAME } from '/js/pages/common.js';

function roomsList(root, { mine }) {
  const offs = [];
  const list = h('div', { class: 'card list' }, loadingEl());
  let items = [];
  let t0 = performance.now();
  let refs = new Map();
  let reloadSoon = 0;

  const remaining = (r) => (r.status === 'open' ? Math.max(0, r.remainingMs - (performance.now() - t0)) : 0);

  function draw() {
    refs = new Map();
    list.replaceChildren();
    if (!items.length) { list.append(emptyEl('rooms', mine ? 'Ainda não criou nem entrou em nenhuma sala.' : 'Sem salas abertas. Crie a primeira!')); return; }
    for (const r of items) {
      const time = h('span', { class: 'num small muted' });
      const bar = h('i');
      const state = h('span', { class: 'chip' });
      const act = h('div', { class: 'meta' });
      refs.set(r.id, { r, time, bar, state, act });
      const row = h('div', { class: 'item' },
        avatarEl({ username: r.creator.username }),
        h('div', { class: 'grow' },
          h('div', { class: 'row wrap' }, h('b', { text: r.creator.username }), h('span', { class: 'dot ' + (r.creator.online ? 'on' : ''), title: r.creator.online ? 'online' : 'offline' })),
          h('div', { class: 'row wrap small muted' }, h('span', { class: 'chip line', text: `${CAT_NAME[r.category] || r.category} · ${fmtPts(r.entry)} pts` }), state, time),
          r.status === 'open' ? h('div', { class: 'progress' }, bar) : null),
        act);
      list.append(row);
      paint(refs.get(r.id));
    }
  }

  function paint(x) {
    const r = x.r;
    const rest = remaining(r);
    const open = r.status === 'open' && rest > 0;
    x.state.textContent = open ? ROOM_STATUS.open : r.status === 'open' ? ROOM_STATUS.expired : ROOM_STATUS[r.status] || r.status;
    x.time.textContent = open ? `espera ${fmtClock(rest)}` : '';
    x.bar.style.transform = `scaleX(${open ? rest / (r.waitSeconds * 1000) : 0})`;
    x.act.replaceChildren();
    const mineRoom = r.creator.id === store.me.id;
    if (open && !mineRoom && !mine) {
      x.act.append(h('button', { class: 'btn primary sm', onclick: () => join(r) }, 'Entrar'));
    } else if (open && mineRoom) {
      x.act.append(h('button', { class: 'btn sm', onclick: () => cancelRoom(r) }, 'Cancelar'));
    } else if (r.status === 'matched' && r.gameId) {
      x.act.append(h('a', { class: 'btn sm', href: '#/partida/' + r.gameId }, 'Abrir partida'));
    }
    if (r.status === 'open' && rest <= 0 && !reloadSoon) reloadSoon = setTimeout(() => { reloadSoon = 0; load(); }, 1200);
  }

  async function load() {
    try {
      const r = await GET(mine ? '/api/rooms/mine' : '/api/rooms');
      items = r.items;
      t0 = performance.now();
      draw();
    } catch (e) { list.replaceChildren(errorEl(e)); }
  }
  async function join(r) {
    try { const res = await POST(`/api/rooms/${r.id}/join`); location.hash = '#/partida/' + res.gameId; } catch (e) { toast(e.message, 'err'); load(); }
  }
  async function cancelRoom(r) {
    try { await POST(`/api/rooms/${r.id}/cancel`); toast('Sala cancelada.'); } catch (e) { toast(e.message, 'err'); }
    load();
  }

  const createBtn = h('button', { class: 'btn primary', onclick: openCreate }, icon('plus'), 'Criar sala');
  root.append(
    mine ? pageHead('Minhas salas', 'As salas que criou ou em que entrou.', createBtn) : pageHead('Salas disponíveis', 'Entre numa sala aberta e aceite o desafio.', createBtn),
    list, h('div', { class: 'stack sm', }, demoNote()));

  function openCreate() {
    modal('Criar sala', (body, close) => {
      let cat = store.config.categories[0].id;
      let wait = store.config.waits[0];
      const picker = catPicker(store.config.categories, store.balance, cat, (v) => { cat = v; });
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tempo de espera' });
      const btns = store.config.waits.map((w) => h('button', { type: 'button', 'aria-pressed': String(w === wait), text: `${w} segundos`, onclick: () => { wait = w; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(store.config.waits[i] === wait))); } }));
      seg.append(...btns);
      body.append(
        h('div', { class: 'stack sm' }, h('b', { text: 'Categoria' }), picker.el),
        h('div', { class: 'stack sm' }, h('b', { text: 'Tempo de espera por adversário' }), seg),
        h('p', { class: 'small muted', text: 'A sala fica publicada durante este tempo, controlado pelo servidor. Se ninguém entrar, fecha sozinha e você recebe um aviso.' }),
        h('button', { class: 'btn primary block', onclick: async (e) => {
          e.target.disabled = true;
          try { await POST('/api/rooms', { category: picker.value(), waitSeconds: wait }); close(); toast('Sala publicada.'); location.hash = '#/minhas-salas'; if (mine) load(); } catch (ex) { toast(ex.message, 'err'); e.target.disabled = false; }
        } }, 'Publicar sala'));
    });
  }

  offs.push(every(250, () => { for (const x of refs.values()) if (x.r.status === 'open') paint(x); }));
  offs.push(every(15000, load));
  offs.push(on('ws:rooms', load));
  offs.push(on('ws:notice', (m) => { if (m.kind === 'room_expired') load(); }));
  load();
  return () => { offs.forEach((f) => f()); clearTimeout(reloadSoon); };
}

export default (root) => roomsList(root, { mine: false });
export const myRooms = (root) => roomsList(root, { mine: true });
