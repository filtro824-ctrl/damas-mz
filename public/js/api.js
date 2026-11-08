// Cliente HTTP + WebSocket com reconexão automática.
// O estado da partida vive no servidor: ao (re)ligar, a tela da partida pede "join" e recebe a posição exata,
// os relógios e a vez. Nada disto depende do relógio do dispositivo.
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export const store = { me: null, staff: false, balance: 0, rating: null, progression: null, subscription: null, activeGames: [], unread: 0, config: null, wsOpen: false };
const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export function on(type, fn) {
  const f = (e) => fn(e.detail);
  bus.addEventListener(type, f);
  return () => bus.removeEventListener(type, f);
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem ligação à internet. Verifique a rede e tente de novo.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) emit('unauthorized');
    throw new ApiError(res.status, data?.error, data?.message || 'Ocorreu um erro. Tente de novo.');
  }
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b = {}) => api('POST', u, b);
export const DEL = (u) => api('DELETE', u);

export function setMe(m) {
  store.me = m.user;
  store.staff = !!m.staff;
  store.balance = m.balance;
  store.rating = m.rating;
  store.progression = m.progression || null;
  store.subscription = m.subscription || null;
  store.activeGames = m.activeGames || [];
  store.unread = m.unread || 0;
  emit('me', store);
}
export async function refreshMe() {
  const m = await GET('/api/me');
  setMe(m);
  return m;
}
export async function logout() {
  try { await POST('/api/auth/logout'); } catch { /* sessão já terminada */ }
  emit('unauthorized');
}

// ---------------------------------------------------------------- WebSocket
let ws = null;
let wantOpen = false;
let retryTimer = null;
let backoff = 400;
let pingTimer = null;
let pongDeadline = 0;

export const wsOpen = () => ws?.readyState === 1;
export function wsSend(o) {
  if (!wsOpen()) return false;
  ws.send(JSON.stringify(o));
  return true;
}
function setOpen(v) {
  if (store.wsOpen === v) return;
  store.wsOpen = v;
  emit('ws:status', { open: v });
}
export function wsConnect() {
  wantOpen = true;
  clearTimeout(retryTimer);
  if (ws && ws.readyState <= 1) return;
  open();
}
export function wsDisconnect() {
  wantOpen = false;
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  const s = ws;
  ws = null;
  try { s?.close(); } catch { /* já fechado */ }
  setOpen(false);
}
function open() {
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => { backoff = 400; pongDeadline = 0; setOpen(true); startPing(); };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'pong') pongDeadline = 0;
    emit('ws:' + m.t, m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer);
    setOpen(false);
    scheduleRetry();
  };
  sock.onerror = () => {};
}
function scheduleRetry() {
  if (!wantOpen) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(open, backoff);
  backoff = Math.min(Math.round(backoff * 1.8), 5000);
}
/** Ligação morta (sem resposta): abandona-a já e tenta outra, sem esperar pelo fecho do TCP. */
function dead() {
  const s = ws;
  ws = null;
  clearInterval(pingTimer);
  try { s?.close(); } catch { /* ignora */ }
  setOpen(false);
  if (wantOpen) { clearTimeout(retryTimer); retryTimer = setTimeout(open, 150); }
}
function startPing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (pongDeadline && Date.now() > pongDeadline) { dead(); return; }
    wsSend({ t: 'ping' });
    if (!pongDeadline) pongDeadline = Date.now() + 9000;
  }, 7000);
}
function probe() {
  if (!wantOpen) return;
  if (!ws) { clearTimeout(retryTimer); backoff = 400; open(); return; }
  if (wsOpen()) { pongDeadline = Date.now() + 4000; wsSend({ t: 'ping' }); }
}
window.addEventListener('online', probe);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probe(); });
