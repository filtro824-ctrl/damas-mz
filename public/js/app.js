// DAMAS MZ — casca da aplicação: autenticação, menu ☰, router por hash, ligação em tempo real e retoma de partidas.
import { h, icon, brandMark, toast, avatarEl, clear } from '/js/ui.js';
import { store, GET, on, setMe, refreshMe, wsConnect, wsDisconnect } from '/js/api.js';
import * as prefs from '/js/prefs.js';

prefs.apply();

const app = document.getElementById('app');

const MENU = [
  ['/', 'Início', 'home'],
  ['/jogar', 'Jogar Damas', 'play'],
  ['/salas', 'Salas disponíveis', 'rooms'],
  ['/minhas-salas', 'Minhas salas', 'mine'],
  ['/torneios', 'Torneios', 'trophy'],
  ['/classificacoes', 'Classificações', 'chart'],
  ['/planos', 'Planos e subscrição', 'crown'],
  ['/perfil', 'Meu perfil', 'user'],
  ['/historico', 'Histórico de partidas', 'history'],
  ['/configuracoes', 'Configurações', 'settings'],
  ['/ajuda', 'Ajuda e suporte', 'help'],
];

const ROUTES = [
  [/^\/$/, 'home', 'default'],
  [/^\/jogar$/, 'play', 'default'],
  [/^\/salas$/, 'rooms', 'default'],
  [/^\/minhas-salas$/, 'rooms', 'myRooms'],
  [/^\/torneios$/, 'tournaments', 'default'],
  [/^\/torneios\/(\d+)$/, 'tournaments', 'detail'],
  [/^\/classificacoes$/, 'rankings', 'default'],
  [/^\/planos$/, 'planos', 'default'],
  [/^\/perfil$/, 'profile', 'default'],
  [/^\/historico$/, 'history', 'default'],
  [/^\/historico\/([\w-]+)$/, 'history', 'replay'],
  [/^\/configuracoes$/, 'settings', 'default'],
  [/^\/ajuda$/, 'help', 'default'],
  [/^\/partida\/([\w-]+)$/, 'game', 'default'],
];

let shell = null; // referências aos elementos do casco
let cleanup = null;
let token = 0;
let autoResumed = false;

const currentPath = () => location.hash.replace(/^#/, '') || '/';
const isGameRoute = () => currentPath().startsWith('/partida/');

// ---------------------------------------------------------------- menu ☰
function openMenu() {
  if (!shell) return;
  shell.scrim.classList.add('on');
  shell.drawer.classList.add('on');
  shell.drawer.setAttribute('aria-hidden', 'false');
  shell.menuBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
  shell.main.inert = true;
  shell.closeBtn.focus();
}
function closeMenu(restoreFocus = true) {
  if (!shell || !shell.drawer.classList.contains('on')) return;
  shell.scrim.classList.remove('on');
  shell.drawer.classList.remove('on');
  shell.drawer.setAttribute('aria-hidden', 'true');
  shell.menuBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
  shell.main.inert = false;
  if (restoreFocus) shell.menuBtn.focus();
}
document.addEventListener('keydown', (e) => {
  if (!shell) return;
  if (e.key === 'Escape') { closeMenu(); return; }
  if (e.key === 'Tab' && shell.drawer.classList.contains('on')) {
    const f = [...shell.drawer.querySelectorAll('a[href], button')];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

function buildShell() {
  const menuBtn = h('button', { class: 'icon-btn', type: 'button', id: 'menu-btn', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', 'aria-controls': 'drawer', onclick: openMenu }, icon('menu'));
  const conn = h('span', { class: 'chip line hidden', role: 'status' }, icon('wifi', 16), 'A reconectar…');
  const avatarHost = h('a', { href: '#/perfil', 'aria-label': 'Meu perfil' });
  const topbar = h('header', { class: 'topbar' },
    menuBtn,
    h('a', { class: 'brand', href: '#/', 'aria-label': 'DAMAS MZ — Início' }, brandMark(), h('span', { text: 'DAMAS MZ' })),
    h('div', { class: 'row' }, conn, avatarHost));
  const banner = h('div', { class: 'banner' });

  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar menu', onclick: () => closeMenu() }, icon('close'));
  const userBox = h('div', { class: 'drawer-user' });
  const ul = h('ul', { class: 'menu' });
  const links = new Map();
  for (const [path, label, ic] of MENU) {
    const badge = h('span', { class: 'badge hidden' });
    const a = h('a', { href: '#' + path, onclick: () => closeMenu(false) }, icon(ic), h('span', { text: label }), badge);
    links.set(path, { a, badge });
    ul.append(h('li', {}, a));
  }
  const adminLink = h('a', { href: '/admin', class: 'small hidden' }, 'Painel administrativo');
  const drawer = h('nav', { class: 'drawer', id: 'drawer', 'aria-label': 'Menu principal', 'aria-hidden': 'true' },
    h('div', { class: 'drawer-head' }, h('a', { class: 'brand', href: '#/', onclick: () => closeMenu(false) }, brandMark(), h('span', { text: 'DAMAS MZ' })), closeBtn),
    userBox, ul,
    h('div', { class: 'drawer-foot' }, h('div', { text: 'XP virtual sem valor monetário.' }), adminLink));
  const scrim = h('div', { class: 'scrim', onclick: () => closeMenu() });
  const main = h('main', { id: 'main', tabindex: '-1' });

  clear(app);
  app.append(topbar, banner, main, scrim, drawer);
  shell = { topbar, banner, main, drawer, scrim, menuBtn, closeBtn, userBox, links, conn, avatarHost, adminLink };
  renderUser();
  renderBanner();
}

function renderUser() {
  if (!shell || !store.me) return;
  const u = store.me;
  document.body.dataset.profileTheme = u.theme || 'classic';
  clear(shell.avatarHost).append(avatarEl(u));
  clear(shell.userBox).append(avatarEl(u), h('div', {}, h('b', { text: u.username }), h('span', { class: 'small faint', text: `ID ${u.id}` })));
  shell.adminLink.classList.toggle('hidden', !store.staff);
  const p = shell.links.get('/perfil');
  p.badge.textContent = String(store.unread);
  p.badge.classList.toggle('hidden', !store.unread);
}

function renderBanner() {
  if (!shell) return;
  clear(shell.banner);
  const id = store.activeGames[0];
  if (id && !isGameRoute()) {
    shell.banner.append(
      h('a', { class: 'notice-bar', href: '#/partida/' + id }, icon('swords'),
        h('span', { text: store.activeGames.length > 1 ? `Tem ${store.activeGames.length} partidas em curso.` : 'Tem uma partida em curso.' }),
        h('span', { class: 'chip solid', text: 'Voltar à partida' })));
  }
}

function markCurrent(path) {
  if (!shell) return;
  for (const [p, { a }] of shell.links) {
    const on_ = p === '/' ? path === '/' : path === p || path.startsWith(p + '/');
    if (on_) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// ---------------------------------------------------------------- router
async function route() {
  if (!shell) return;
  const path = currentPath();
  const my = ++token;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  closeMenu(false);
  document.body.classList.remove('expanded');
  clear(shell.main);
  window.scrollTo(0, 0);
  let hit = null;
  for (const [re, file, fn] of ROUTES) {
    const m = re.exec(path);
    if (m) { hit = { file, fn, params: m.slice(1) }; break; }
  }
  if (!hit) { location.hash = '#/'; return; }
  markCurrent(path);
  renderBanner();
  try {
    const mod = await import(`/js/pages/${hit.file}.js`);
    if (my !== token) return;
    const c = mod[hit.fn](shell.main, hit.params);
    if (my !== token) { c?.(); return; }
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    console.error(e);
    clear(shell.main).append(h('div', { class: 'card' }, h('p', { text: 'Não foi possível abrir esta página. Verifique a ligação e tente de novo.' })));
  }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- eventos em tempo real
function addActive(id) {
  if (id && !store.activeGames.includes(id)) store.activeGames.push(id);
}
const FINAL = new Set(['finished', 'draw', 'cancelled']);

on('me', () => { renderUser(); renderBanner(); });
on('ws:status', ({ open }) => { shell?.conn.classList.toggle('hidden', open); });
on('ws:hello', (m) => {
  store.activeGames = m.games || [];
  renderBanner();
  // recarregou a página (ou voltou depois de uma queda) com partida em curso: regressa à mesma partida
  if (!autoResumed) {
    autoResumed = true;
    if (store.activeGames.length && currentPath() === '/') location.hash = '#/partida/' + store.activeGames[0];
  }
});
on('ws:game', ({ game }) => {
  if (!game) return;
  if (FINAL.has(game.status)) {
    store.activeGames = store.activeGames.filter((x) => x !== game.id);
    refreshMe().catch(() => {});
  } else addActive(game.id);
  renderBanner();
});
on('ws:match', (m) => {
  addActive(m.gameId);
  renderBanner();
  if (isGameRoute()) { toast('Nova partida pronta. Abra-a pelo aviso no topo.'); return; }
  toast('Partida pronta!');
  location.hash = '#/partida/' + m.gameId;
});
on('ws:notice', (m) => {
  store.unread++;
  renderUser();
  if (m.kind === 'game_end' || m.kind === 'game_cancelled' || m.kind === 'game_review') refreshMe().catch(() => {});
  if (m.kind !== 'match') toast(m.text);
});
on('unauthorized', () => { if (shell) showAuth(); });

// ---------------------------------------------------------------- arranque
async function showAuth() {
  wsDisconnect();
  shell = null;
  try { cleanup?.(); } catch { /* ignora */ }
  cleanup = null;
  document.body.classList.remove('expanded', 'menu-open');
  store.me = null;
  store.activeGames = [];
  const mod = await import('/js/pages/auth.js');
  mod.default(app, () => { autoResumed = false; enter(); });
}

async function enter() {
  if (!store.config) {
    try { store.config = await GET('/api/config'); } catch { /* repete mais tarde */ }
  }
  buildShell();
  wsConnect();
  if (!location.hash) location.hash = '#/';
  route();
}

async function start() {
  try {
    store.config = await GET('/api/config');
    setMe(await GET('/api/me'));
    await enter();
  } catch (e) {
    if (e.status === 401) showAuth();
    else clear(app).append(h('div', { class: 'auth' }, h('div', { class: 'card auth-card stack' }, h('h2', { text: 'Sem ligação' }), h('p', { class: 'muted', text: e.message }), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Tentar de novo'))));
  }
}

// A aplicação deve abrir como um site normal no navegador, sem modo PWA autónomo.
// Remove registos antigos de service worker para evitar que atalhos/cache antigos interfiram.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((items) => items.forEach((item) => item.unregister())).catch(() => {});
}

start();
