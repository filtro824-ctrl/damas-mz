// Salas disponíveis e Minhas salas; a contagem é controlada pelo servidor.
import { h, icon, fmtClock, toast, modal, ROOM_STATUS } from '/js/ui.js';
import { store, GET, POST, on } from '/js/api.js';
import { pageHead, catPicker, loadingEl, errorEl, emptyEl, every, CAT_NAME } from '/js/pages/common.js';

function roomsList(root, { mine }) {
  const offs = [];
  const list = h('div', { class: 'card list' }, loadingEl());
  let items = [];
  let t0 = performance.now();
  let refs = new Map();
  let reloadSoon = 0;
  const remaining = (r) => r.status === 'open' ? Math.max(0, r.remainingMs - (performance.now() - t0)) : 0;

  function draw() {
    refs = new Map(); list.replaceChildren();
    if (!items.length) { list.append(emptyEl('rooms', mine ? 'Ainda não criou nem entrou em nenhuma sala.' : 'Sem salas abertas. Crie a primeira!')); return; }
    for (const r of items) {
      const time = h('span', { class: 'num small muted' }); const state = h('span', { class: 'chip' }); const act = h('div', { class: 'meta' });
      refs.set(r.id, { r, time, state, act });
      list.append(h('div', { class: 'item' }, h('span', { class: 'avatar', text: r.creator.username.slice(0, 2).toUpperCase() }),
        h('div', { class: 'grow' }, h('div', { class: 'row wrap' }, h('b', { text: r.title || r.creator.username }), h('span', { class: 'dot ' + (r.creator.online ? 'on' : '') }), r.visibility === 'private' ? h('span', { class: 'chip solid', text: 'Privada' }) : null),
          h('div', { class: 'row wrap small muted' }, h('span', { class: 'chip line', text: `${CAT_NAME[r.category] || r.category} · ${r.minRating == null ? 'sem limite de rating' : `${r.minRating}–${r.maxRating} rating`}` }), state, time)), act));
      paint(refs.get(r.id));
    }
  }
  function paint(x) {
    const r = x.r; const rest = remaining(r); const open = r.status === 'open' && rest > 0;
    x.state.textContent = open ? ROOM_STATUS.open : r.status === 'open' ? ROOM_STATUS.expired : ROOM_STATUS[r.status] || r.status;
    x.time.textContent = open ? `espera ${fmtClock(rest)}` : '';
    x.act.replaceChildren();
    const mineRoom = r.creator.id === store.me.id;
    if (open && !mineRoom && !mine) x.act.append(h('button', { class: 'btn primary sm', onclick: () => join(r) }, 'Entrar'));
    else if (open && mineRoom) x.act.append(h('button', { class: 'btn sm', onclick: () => cancelRoom(r) }, 'Cancelar'));
    else if (r.status === 'matched' && r.gameId) x.act.append(h('a', { class: 'btn sm', href: '#/partida/' + r.gameId }, 'Abrir partida'));
    if (mineRoom && r.inviteCode && r.status === 'open') x.act.append(h('button', { class: 'btn sm', onclick: () => copyCode(r.inviteCode) }, icon('copy'), 'Copiar convite'));
    if (r.status === 'open' && rest <= 0 && !reloadSoon) reloadSoon = setTimeout(() => { reloadSoon = 0; load(); }, 1200);
  }
  async function load() {
    try { const r = await GET(mine ? '/api/rooms/mine' : '/api/rooms'); items = r.items; t0 = performance.now(); draw(); }
    catch (e) { list.replaceChildren(errorEl(e)); }
  }
  async function join(r) { try { const res = await POST(`/api/rooms/${r.id}/join`); location.hash = '#/partida/' + res.gameId; } catch (e) { toast(e.message, 'err'); load(); } }
  async function cancelRoom(r) { try { await POST(`/api/rooms/${r.id}/cancel`); toast('Sala cancelada.'); } catch (e) { toast(e.message, 'err'); } load(); }
  async function copyCode(code) { try { await navigator.clipboard.writeText(code); toast('Código de convite copiado.'); } catch { toast('Código de convite: ' + code); } }
  const createBtn = h('button', { class: 'btn primary', onclick: openCreate }, icon('plus'), 'Criar sala');
  const joinCode = h('input', { maxlength: 16, placeholder: 'Código de convite privado', 'aria-label': 'Código de convite' });
  const joinInvite = h('button', { class: 'btn', onclick: async () => { try { const r = await POST('/api/rooms/invite', { code: joinCode.value }); location.hash = '#/partida/' + r.gameId; } catch (e) { toast(e.message, 'err'); } } }, 'Entrar com convite');
  root.append(mine ? pageHead('Minhas salas', 'Salas criadas, convites e desafios aceites.', createBtn) : pageHead('Salas disponíveis', 'Salas públicas de Damas Portuguesas — sem entrada de pontos.', createBtn),
    !mine ? h('div', { class: 'card row wrap' }, joinCode, joinInvite) : null, list,
    h('p', { class: 'small faint', text: 'As partidas não exigem saldo. Pontos virtuais são concedidos apenas para progressão e classificação.' }));

  function openCreate() {
    modal('Criar sala', (body, close) => {
      let cat = store.config.categories[0].id; let wait = store.config.waits[0];
      const picker = catPicker(store.config.categories, store.balance, cat, (v) => { cat = v; });
      const visibility = h('select', {}, h('option', { value: 'public', text: 'Pública — visível na lista' }), h('option', { value: 'private', text: 'Privada — apenas por convite (VIP)' }));
      const title = h('input', { maxlength: 50, placeholder: 'Título personalizado (Premium)' });
      const min = h('input', { type: 'number', min: 0, max: 4000, placeholder: 'Rating mínimo (Premium)' });
      const max = h('input', { type: 'number', min: 0, max: 4000, placeholder: 'Rating máximo (Premium)' });
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tempo de espera' });
      const btns = store.config.waits.map((w) => h('button', { type: 'button', 'aria-pressed': String(w === wait), text: `${w} segundos`, onclick: () => { wait = w; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(store.config.waits[i] === wait))); } }));
      seg.append(...btns);
      body.append(h('div', { class: 'stack sm' }, h('b', { text: 'Categoria' }), picker.el),
        h('div', { class: 'field' }, h('label', { text: 'Visibilidade' }), visibility),
        h('div', { class: 'field' }, h('label', { text: 'Título personalizado' }), title),
        h('div', { class: 'row wrap' }, min, max),
        h('div', { class: 'stack sm' }, h('b', { text: 'Tempo de espera' }), seg),
        h('p', { class: 'small muted', text: 'Campos personalizados exigem Premium; criar sala privada exige VIP. O backend valida o plano ativo.' }),
        h('button', { class: 'btn primary block', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await POST('/api/rooms', { category: picker.value(), waitSeconds: wait, visibility: visibility.value, title: title.value.trim(), minRating: min.value ? Number(min.value) : null, maxRating: max.value ? Number(max.value) : null }); close(); toast(r.room.inviteCode ? `Sala criada. Código de convite: ${r.room.inviteCode}` : 'Sala publicada.'); location.hash = '#/minhas-salas'; }
          catch (ex) { toast(ex.message, 'err'); e.target.disabled = false; }
        } }, 'Criar sala'));
    });
  }
  offs.push(every(250, () => { for (const x of refs.values()) if (x.r.status === 'open') paint(x); }));
  offs.push(every(15000, load)); offs.push(on('ws:rooms', load)); offs.push(on('ws:notice', (m) => { if (m.kind === 'room_expired') load(); }));
  load(); return () => { offs.forEach((f) => f()); clearTimeout(reloadSoon); };
}
export default (root) => roomsList(root, { mine: false });
export const myRooms = (root) => roomsList(root, { mine: true });
