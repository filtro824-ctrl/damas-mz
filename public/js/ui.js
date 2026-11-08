// Utilitários de interface (sem dependências, compatíveis com CSP "self": nada de HTML/estilos inline).
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Cria elementos DOM. Todo o texto entra como nó de texto (sem risco de XSS). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  play: 'M8 5.5v13l11-6.5z',
  rooms: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z',
  mine: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.5 3.6-6 8-6s8 2.5 8 6',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 20h8M10 17h4',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  history: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 21h4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12.5l4.5 4.5L19 7',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  crown: 'M4 17l-1.5-9 5 3.5L12 5l4.5 6.5 5-3.5L20 17zM5 20h14',
  swords: 'M5 19L19 5M14 5h5v5M5 5l14 14M5 10V5h5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  first: 'M17 5l-7 7 7 7M7 5v14',
  last: 'M7 5l7 7-7 7M17 5v14',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
};
export function icon(name, size) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.help);
  s.append(p);
  return s;
}
export function crownSvg() {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'currentColor');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M3 18l-1-11 5.5 4L12 4l4.5 7L22 7l-1 11zM4 20.5h16V22H4z');
  s.append(p);
  return s;
}
export function brandMark() {
  const m = h('span', { class: 'brand-mark' });
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  for (const [x, y, f] of [[3, 3, 1], [12, 12, 1], [12, 3, 0], [3, 12, 0]]) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 9); r.setAttribute('height', 9); r.setAttribute('rx', 2.5);
    r.setAttribute('fill', f ? '#fff' : '#777');
    s.append(r);
  }
  m.append(s);
  return m;
}

// ---------------------------------------------------------------- formatação
const pad = (n) => String(n).padStart(2, '0');
export function fmtClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDuration(ms) {
  if (!ms || ms < 1000) return '—';
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))} min` : `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
}
export const fmtPts = (n) => Number(n).toLocaleString('pt-PT');
export const initials = (name) => String(name || '?').slice(0, 2).toUpperCase();

export const STATUS = {
  waiting_start: 'Aguardando início', active: 'Em andamento', awaiting_reconnect: 'Aguardando reconexão', interrupted: 'Interrompida',
  under_review: 'Em análise', finished: 'Concluída', draw: 'Empate', cancelled: 'Cancelada',
};
export const REASON = {
  captured: 'todas as peças capturadas', blocked: 'peças bloqueadas', time: 'tempo esgotado', repetition: 'repetição de posição (3 vezes)',
  twenty_moves: 'regra dos 20 lances', twelve_moves: 'regra dos 12 lances (forçada)', admin: 'decisão da administração', no_show: 'adversário não entrou',
};
export const ROOM_STATUS = { open: 'Aberta', matched: 'Preenchida', expired: 'Expirada', cancelled: 'Cancelada' };
export const RESULT = { win: 'Vitória', loss: 'Derrota', draw: 'Empate' };

// ---------------------------------------------------------------- toast e modal
let toastBox;
export function toast(text, kind = '') {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: 'toast ' + kind, text });
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5200 : 3600);
}

/** Abre uma janela (folha inferior no telemóvel). Devolve { close, body }. */
export function modal(title, build) {
  const wrap = h('div', { class: 'modal-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const box = h('div', { class: 'modal' });
  const prev = document.activeElement;
  const close = () => { wrap.remove(); document.body.classList.remove('modal-open'); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  box.append(h('div', { class: 'row between' }, h('h2', { text: title }), h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, icon('close'))));
  const body = h('div', { class: 'stack', }, '');
  box.append(h('div', { class: 'stack' }, body));
  wrap.append(box);
  document.body.append(wrap);
  document.body.classList.add('modal-open');
  build?.(body, close);
  return { close, body };
}

export function avatarEl(user, cls = '') {
  const a = h('span', { class: 'avatar ' + cls });
  if (user?.avatar) a.append(h('img', { src: user.avatar, alt: '', loading: 'lazy' }));
  else a.textContent = initials(user?.username);
  return a;
}

export function spinnerText(el, text) { el.textContent = text; }
