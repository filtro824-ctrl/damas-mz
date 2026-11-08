// Perfil, progressão, personalização de tema, notificações e palavra-passe.
import { h, icon, avatarEl, fmtPts, fmtDate, toast } from '/js/ui.js';
import { store, GET, POST, refreshMe, emit } from '/js/api.js';
import { pageHead, CAT_NAME } from '/js/pages/common.js';

const KIND = { XP_INICIAL: 'XP inicial', VITORIA_XP: 'Vitória', EMPATE_XP: 'Empate', PARTICIPACAO_XP: 'Participação', MIGRACAO_XP: 'Progressão anterior convertida', AJUSTE_ADMIN_XP: 'Ajuste administrativo' };
async function resizeToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não foi possível ler a imagem.')); i.src = url; });
    const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    return await new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error('Falha ao preparar a imagem.')), 'image/jpeg', 0.86));
  } finally { URL.revokeObjectURL(url); }
}
export default function profile(root) {
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden', 'aria-label': 'Escolher fotografia' });
  const head = h('div', { class: 'card row wrap' });
  function drawHead() {
    head.replaceChildren(avatarEl(store.me, 'lg'), h('div', { class: 'grow stack sm' }, h('h1', { text: store.me.username }),
      h('div', { class: 'row wrap' }, h('span', { class: 'chip', text: 'ID ' + store.me.id }), h('span', { class: 'chip line', text: 'Membro desde ' + fmtDate(store.me.createdAt).slice(0, 10) }), h('span', { class: 'chip solid', text: store.subscription?.plan?.name || 'Gratuito' })),
      store.me.bio ? h('p', { class: 'muted', text: store.me.bio }) : null,
      h('button', { class: 'btn sm', onclick: () => file.click() }, icon('upload'), 'Alterar fotografia')), file);
  }
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const blob = await resizeToJpeg(f);
      const res = await fetch('/api/me/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
      const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.message || 'Não foi possível guardar a fotografia.');
      await refreshMe(); drawHead(); toast('Fotografia atualizada.');
    } catch (e) { toast(e.message, 'err'); } file.value = '';
  });
  drawHead();
  const stats = h('div', { class: 'card stack' }, h('h2', { text: 'Estatísticas' }), h('p', { class: 'muted', text: 'A carregar…' }));
  const xp = h('div', { class: 'card stack' }, h('h2', { text: 'Progressão virtual' }), h('p', { class: 'muted', text: 'A carregar…' }));
  const details = h('div');
  const bio = h('textarea', { rows: 3, maxlength: 160, placeholder: 'Uma frase sobre si (máximo 160 caracteres).' });
  bio.value = store.me.bio || '';
  const canCustomize = ['premium', 'vip'].includes(store.subscription?.plan?.code);
  bio.readOnly = !canCustomize;
  const bioCard = h('div', { class: 'card stack' }, h('h2', { text: 'Personalizar perfil' }), bio,
    canCustomize ? h('button', { class: 'btn', onclick: async () => { try { const r = await POST('/api/me/bio', { bio: bio.value }); store.me.bio = r.bio; await refreshMe(); drawHead(); toast('Perfil atualizado.'); } catch (e) { toast(e.message, 'err'); } } }, 'Guardar biografia') : h('p', { class: 'small muted' }, 'A biografia personalizada está disponível no Premium e VIP. ', h('a', { href: '#/planos', text: 'Ver planos' })));
  const notes = h('div', { class: 'card stack' }, h('h2', { text: 'Notificações' }), h('p', { class: 'muted', text: 'A carregar…' }));
  const pw = h('form', { class: 'card stack' }); const err = h('div', { class: 'error', role: 'alert' });
  pw.append(h('h2', { text: 'Alterar palavra-passe' }),
    h('div', { class: 'field' }, h('label', { for: 'op', text: 'Palavra-passe atual' }), h('input', { id: 'op', name: 'oldPassword', type: 'password', autocomplete: 'current-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'np', text: 'Nova palavra-passe' }), h('input', { id: 'np', name: 'newPassword', type: 'password', autocomplete: 'new-password', minlength: 8, required: true })), err,
    h('button', { class: 'btn primary', type: 'submit' }, 'Guardar'));
  pw.addEventListener('submit', async (e) => { e.preventDefault(); err.textContent = ''; try { await POST('/api/me/password', Object.fromEntries(new FormData(pw))); pw.reset(); toast('Palavra-passe alterada.'); } catch (ex) { err.textContent = ex.message; } });
  root.append(pageHead('Meu perfil', 'Desempenho e personalização.'), head, bioCard, h('div', { class: 'grid-2' }, stats, xp), details, notes, pw);
  GET('/api/users/' + store.me.id).then((r) => {
    const p = r.progression;
    stats.replaceChildren(h('h2', { text: 'Estatísticas' }),
      h('div', { class: 'stats n4' }, ...[['Rating', p.rating], ['Vitórias', p.wins], ['Derrotas', p.losses], ['Empates', p.draws]].map(([label, value]) => h('div', { class: 'stat' }, h('span', { class: 'small muted', text: label }), h('b', { class: 'num', text: String(value) })))),
      h('p', { class: 'muted', text: `Melhor sequência: ${p.bestStreak} vitória(s) · sequência atual: ${p.winStreak}.` }),
      h('div', { class: 'stack sm' }, h('h3', { text: 'Medalhas e conquistas' }), p.achievements.length ? h('div', { class: 'row wrap' }, ...p.achievements.map((a) => h('span', { class: 'chip', title: a.description, text: a.name }))) : h('p', { class: 'small muted', text: 'Conclua partidas para desbloquear conquistas.' })),
      r.advancedStats ? h('div', { class: 'list' }, ...r.rankings.map((x) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: CAT_NAME[x.category] || x.category }), h('span', { class: 'small muted num', text: `${x.wins}V · ${x.losses}D · ${x.draws}E` })), h('b', { class: 'num', text: String(x.rating) })))) : h('p', { class: 'small muted' }, 'Estatísticas avançadas disponíveis no Premium. ', h('a', { href: '#/planos', text: 'Ver planos' })));
    if (r.detailedStats) {
      const d = r.detailedStats;
      details.replaceChildren(h('div', { class: 'card stack' }, h('h2', { text: 'Estatísticas detalhadas · VIP' }),
        h('div', { class: 'stats n4' }, ...[['Partidas', d.games], ['Vitórias', d.wins], ['Derrotas', d.losses], ['Empates', d.draws]].map(([label, value]) => h('div', { class: 'stat' }, h('span', { class: 'small muted', text: label }), h('b', { class: 'num', text: String(value) })))),
        d.categories.length ? h('div', { class: 'list' }, ...d.categories.map((x) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: CAT_NAME[x.category] || x.category }), h('span', { class: 'small muted', text: `${x.games} partidas · média ${x.averagePlies} lances` })), h('b', { class: 'num', text: `${x.wins}V · ${x.losses}D · ${x.draws}E` })))) : h('p', { class: 'small muted', text: 'Ainda não há partidas concluídas para detalhar.' })));
    }
  }).catch(() => {});
  GET('/api/points').then((r) => {
    const p = store.progression || { level: 1 };
    const themes = [['classic', 'Clássico'], ['night', 'Noite'], ['amber', 'Âmbar · Premium'], ['jade', 'Jade · Premium'], ['obsidian', 'Obsidiana · VIP']];
    const themePicker = h('div', { class: 'row wrap' }, ...themes.map(([id, name]) => h('button', { class: 'btn sm', type: 'button', text: name, onclick: async () => {
      try { const result = await POST('/api/me/theme', { theme: id }); document.body.dataset.profileTheme = result.theme; await refreshMe(); toast('Tema atualizado.'); }
      catch (e) { toast(e.message, 'err'); }
    } })));
    xp.replaceChildren(h('h2', { text: 'Progressão virtual' }), h('div', { class: 'num big', text: `${fmtPts(r.balance)} XP` }),
      h('p', { class: 'muted', text: `Nível ${p.level} · XP acumulado apenas para classificação, progressão e reconhecimento.` }),
      h('h3', { text: 'Temas' }), themePicker,
      h('div', { class: 'list' }, ...r.ledger.map((l) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: KIND[l.kind] || l.kind }), h('span', { class: 'small faint', text: fmtDate(l.createdAt) })), h('b', { class: 'num', text: '+' + fmtPts(l.amount) + ' XP' })))),
      h('p', { class: 'small faint', text: 'XP sem valor monetário; não é transferível, convertível em dinheiro ou trocável por prémios.' }));
  }).catch(() => {});
  GET('/api/notifications').then(async (r) => {
    notes.replaceChildren(h('h2', { text: 'Notificações' }), r.items.length ? h('div', { class: 'list' }, ...r.items.map((n) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { text: n.text }), h('span', { class: 'small faint', text: fmtDate(n.createdAt) })), n.read ? null : h('span', { class: 'dot on', title: 'Nova' })))) : h('p', { class: 'muted', text: 'Sem notificações.' }));
    if (store.unread) { await POST('/api/notifications/read'); store.unread = 0; emit('me', store); }
  }).catch(() => {});
}
