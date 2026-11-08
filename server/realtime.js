// Registo de ligações em tempo real e presença ("online") dos utilizadores.
// Um utilizador está online se tiver pelo menos uma ligação WebSocket aberta.
// A passagem a "offline" tem uma pequena tolerância (offlineGraceMs) para não contar como
// desconexão um simples recarregamento da página.
const conns = new Map(); // userId -> Set<WSConn>
const logical = new Set(); // userIds considerados online
const grace = new Map(); // userId -> Timeout
let handlers = { onOnline() {}, onOffline() {}, graceMs: 4000 };

export function configure(h) { handlers = { ...handlers, ...h }; }

export function add(userId, conn) {
  let set = conns.get(userId);
  if (!set) { set = new Set(); conns.set(userId, set); }
  set.add(conn);
  const t = grace.get(userId);
  if (t) { clearTimeout(t); grace.delete(userId); } // voltou dentro da tolerância
  if (!logical.has(userId)) {
    logical.add(userId);
    handlers.onOnline(userId);
  }
}

export function remove(userId, conn) {
  const set = conns.get(userId);
  if (!set) return;
  set.delete(conn);
  if (set.size > 0) return;
  conns.delete(userId);
  const fire = () => {
    grace.delete(userId);
    if (conns.has(userId)) return;
    logical.delete(userId);
    handlers.onOffline(userId);
  };
  if (handlers.graceMs <= 0) fire();
  else {
    const t = setTimeout(fire, handlers.graceMs);
    t.unref?.();
    grace.set(userId, t);
  }
}

export const isOnline = (userId) => logical.has(userId);
export const onlineCount = () => logical.size;
export const connectionsOf = (userId) => conns.get(userId) || new Set();

export function sendUser(userId, msg) {
  const set = conns.get(userId);
  if (!set || set.size === 0) return;
  const str = JSON.stringify(msg);
  for (const c of set) c.sendRaw(str);
}

export function broadcast(msg) {
  const str = JSON.stringify(msg);
  for (const set of conns.values()) for (const c of set) c.sendRaw(str);
}

export function allConns() {
  const out = [];
  for (const set of conns.values()) for (const c of set) out.push(c);
  return out;
}

export function reset() {
  for (const t of grace.values()) clearTimeout(t);
  grace.clear(); conns.clear(); logical.clear();
}
