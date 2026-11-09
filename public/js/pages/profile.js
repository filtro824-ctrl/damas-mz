// Meu perfil: fotografia, estatísticas, pontos demonstrativos, notificações e palavra-passe.
import { h, icon, avatarEl, fmtPts, fmtDate, toast } from '/js/ui.js';
import { store, GET, POST, refreshMe, emit } from '/js/api.js';
import { pageHead, demoNote, CAT_NAME } from '/js/pages/common.js';

const KIND = { BONUS_INICIAL: 'Bónus inicial', ENTRADA: 'Entrada em partida', PREMIO: 'Vitória', REEMBOLSO_EMPATE: 'Empate (devolução)', REEMBOLSO_CANCELADA: 'Partida cancelada (devolução)', AJUSTE_ADMIN: 'Ajuste da administração' };

async function resizeToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não foi possível ler a imagem.')); i.src = url; });
    const s = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao preparar a imagem.'))), 'image/jpeg', 0.86));
  } finally { URL.revokeObjectURL(url); }
}

export default function profile(root) {
  const u = store.me;
  const head = h('div', { class: 'card row wrap' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden', 'aria-label': 'Escolher fotografia' });
  function drawHead() {
    head.replaceChildren(avatarEl(store.me, 'lg'), h('div', { class: 'grow stack sm' }, h('h1', { text: store.me.username }),
      h('div', { class: 'row wrap' }, h('span', { class: 'chip', text: 'ID ' + store.me.id }), h('span', { class: 'chip line', text: 'Membro desde ' + fmtDate(store.me.createdAt).slice(0, 10) })),
      h('div', {}, h('button', { class: 'btn sm', onclick: () => file.click() }, icon('upload'), 'Alterar fotografia'))), file);
  }
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const blob = await resizeToJpeg(f);
      const res = await fetch('/api/me/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || 'Não foi possível guardar a fotografia.');
      await refreshMe();
      drawHead();
      toast('Fotografia atualizada.');
    } catch (e) { toast(e.message, 'err'); }
    file.value = '';
  });
  drawHead();

  const stats = h('div', { class: 'card stack' }, h('h2', { text: 'Estatísticas' }), h('p', { class: 'muted', text: 'A carregar…' }));
  const pts = h('div', { class: 'card stack' }, h('h2', { text: 'Pontos demonstrativos' }), h('p', { class: 'muted', text: 'A carregar…' }));
  const notes = h('div', { class: 'card stack' }, h('h2', { text: 'Notificações' }), h('p', { class: 'muted', text: 'A carregar…' }));

  const pw = h('form', { class: 'card stack' });
  const err = h('div', { class: 'error', role: 'alert' });
  pw.append(h('h2', { text: 'Alterar palavra-passe' }),
    h('div', { class: 'field' }, h('label', { for: 'op', text: 'Palavra-passe atual' }), h('input', { id: 'op', name: 'oldPassword', type: 'password', autocomplete: 'current-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'np', text: 'Nova palavra-passe' }), h('input', { id: 'np', name: 'newPassword', type: 'password', autocomplete: 'new-password', minlength: 8, required: true })),
    err, h('button', { class: 'btn primary', type: 'submit' }, 'Guardar'));
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try { await POST('/api/me/password', Object.fromEntries(new FormData(pw))); pw.reset(); toast('Palavra-passe alterada.'); } catch (ex) { err.textContent = ex.message; }
  });

  root.append(pageHead('Meu perfil'), h('div', { class: 'stack' }, head, h('div', { class: 'grid-2' }, stats, pts), notes, pw));

  GET('/api/users/' + u.id).then((r) => {
    const rows = r.rankings.filter((x) => x.wins + x.losses + x.draws > 0);
    stats.replaceChildren(h('h2', { text: 'Estatísticas' }), rows.length ? h('div', { class: 'list' }, ...rows.map((x) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: CAT_NAME[x.category] || x.category }), h('span', { class: 'small muted num', text: `${x.wins}V · ${x.losses}D · ${x.draws}E` })), h('b', { class: 'num', text: String(x.rating) })))) : h('p', { class: 'muted', text: 'Ainda sem partidas concluídas.' }));
  }).catch(() => {});
  GET('/api/points').then((r) => {
    pts.replaceChildren(h('h2', { text: 'Pontos demonstrativos' }), h('div', { class: 'num big', text: fmtPts(r.balance) }),
      h('div', { class: 'list' }, ...r.ledger.map((l) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: KIND[l.kind] || l.kind }), h('span', { class: 'small faint', text: fmtDate(l.createdAt) })), h('b', { class: 'num', text: (l.amount > 0 ? '+' : '') + fmtPts(l.amount) })))), demoNote());
  }).catch(() => {});
  GET('/api/notifications').then(async (r) => {
    notes.replaceChildren(h('h2', { text: 'Notificações' }), r.items.length ? h('div', { class: 'list' }, ...r.items.map((n) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: n.text }), h('span', { class: 'small faint', text: fmtDate(n.createdAt) })), n.read ? null : h('span', { class: 'dot on', title: 'Nova' })))) : h('p', { class: 'muted', text: 'Sem notificações.' }));
    if (store.unread) { await POST('/api/notifications/read'); store.unread = 0; emit('me', store); }
  }).catch(() => {});
}
