// Tela de partida. Regras desta tela (prioridade do projeto):
//  - extremamente limpa: o ÚNICO botão de controlo é "Expandir / Ecrã inteiro"; nada de renunciar, abandonar, reiniciar;
//  - cada jogador só mexe nas peças da sua cor (o servidor atribui a cor e valida identidade, vez e lance);
//  - sair da tela (menu ☰) ou perder a ligação não destrói a partida: ao voltar, o servidor devolve a posição exata,
//    os relógios e a vez, e o cliente retoma por si.
import * as E from '/shared/engine.js';
import { h, icon, avatarEl, fmtClock, toast, STATUS, REASON } from '/js/ui.js';
import { store, GET, wsSend, wsOpen, on } from '/js/api.js';
import { Board } from '/js/board.js';
import * as prefs from '/js/prefs.js';

const FINAL = new Set(['finished', 'draw', 'cancelled']);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
const startsWith = (p, pre) => pre.every((s, i) => p[i] === s);

function isCapture(board, path) {
  const a = E.coords(path[0]);
  const b = E.coords(path[1]);
  const dr = Math.sign(b.r - a.r);
  const dc = Math.sign(b.c - a.c);
  for (let r = a.r + dr, c = a.c + dc; r !== b.r; r += dr, c += dc) if (board[E.squareAt(r, c)] !== 0) return true;
  return false;
}

function strip() {
  const clock = h('span', { class: 'clock num', text: '--:--' });
  const name = h('b');
  const sub = h('span');
  const colour = h('span', { class: 'colour' });
  const av = h('span');
  const el = h('div', { class: 'strip' }, av, h('div', { class: 'who' }, name, sub), colour, clock);
  return { el, clock, name, sub, colour, av };
}

export default function game(root, [id]) {
  const offs = [];
  let g = null;
  let rcv = 0; // instante local (monótono) em que o estado foi recebido
  let sel = null; // casas já escolhidas do lance em construção
  let pending = null; // lance enviado, à espera do estado do servidor
  let disp = null; // tabuleiro otimista enquanto há lance pendente
  let fs = false;
  let wake = null;

  const board = new Board({ onSquare, numbers: prefs.get('numbers') });
  const S = { w: strip(), b: strip() };
  const fsLabel = h('span', { text: 'Expandir' });
  const fsBtn = h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Expandir / ecrã inteiro', onclick: toggleFs }, icon('expand'), fsLabel);
  const top = h('div'); // ranhura da faixa do adversário
  const bottom = h('div'); // ranhura da faixa do jogador
  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  root.append(h('div', { class: 'game-root' }, h('div', { class: 'game' }, h('div', { class: 'game-bar' }, fsBtn), top, board.el, bottom, status)));

  // ---------------------------------------------------------------- estado
  function update(v) {
    if (g && v.ply < g.ply) return; // estado mais antigo que o já conhecido
    const prev = g;
    g = v;
    rcv = performance.now();
    if (pending && v.ply > pending.ply) { clearTimeout(pending.timer); pending = null; }
    if (!pending) disp = null;
    if (!prev || prev.ply !== v.ply || prev.status !== v.status) sel = null;
    if (!prev) {
      board.setOrientation(v.you === 'b' ? 'b' : 'w');
      const topC = v.you === 'w' ? 'b' : v.you === 'b' ? 'w' : 'b';
      top.replaceChildren(S[topC].el);
      bottom.replaceChildren(S[topC === 'w' ? 'b' : 'w'].el);
      for (const c of ['w', 'b']) {
        const p = c === 'w' ? v.white : v.black;
        S[c].av.replaceWith((S[c].av = avatarEl(p, 'sm')));
        S[c].name.textContent = p.username + (v.you === c ? ' (você)' : '');
        S[c].colour.classList.add(c);
        S[c].colour.title = c === 'w' ? 'Brancas' : 'Negras';
      }
    }
    if (prev && v.you) {
      const oc = v.you === 'w' ? 'b' : 'w';
      const was = prev[oc === 'w' ? 'white' : 'black'];
      const now = v[oc === 'w' ? 'white' : 'black'];
      if (!FINAL.has(v.status)) {
        if (was.online && !now.online) toast(`${now.username} perdeu a ligação. A partida ficou em pausa.`);
        if (!was.online && now.online) toast(`${now.username} voltou à partida.`);
      }
      if (v.ply > prev.ply && v.turn === v.you) prefs.beep('opp');
      if (!FINAL.has(prev.status) && FINAL.has(v.status)) prefs.beep('end');
    }
    draw();
  }

  function draw() {
    if (!g) return;
    const myTurn = g.status === 'active' && g.you && g.you === g.turn && store.wsOpen && !pending;
    const legal = myTurn ? g.legal : [];
    const starts = new Set(legal.map((p) => p[0]));
    const dests = new Set();
    if (sel) for (const p of legal) if (p.length > sel.length && startsWith(p, sel)) dests.add(p[sel.length]);
    board.render(disp || g.board, { last: g.lastMove, via: sel ? sel.slice(1) : [], selected: sel?.[0], movable: sel ? new Set() : starts, dests });
    for (const c of ['w', 'b']) {
      S[c].el.classList.toggle('turn', g.status === 'active' && g.turn === c);
      const p = c === 'w' ? g.white : g.black;
      S[c].sub.replaceChildren(h('span', { class: 'dot ' + (p.online ? 'on' : '') }), `${p.rating} · ${p.online ? 'online' : 'desligado'}`);
    }
    tick();
  }

  // ---------------------------------------------------------------- relógios e texto de estado (a cada 250 ms)
  function tick() {
    if (!g) return;
    const el = performance.now() - rcv;
    for (const c of ['w', 'b']) {
      const ms = g.clocks[c] - (g.clocks.running === c ? el : 0);
      S[c].clock.textContent = fmtClock(ms);
      S[c].clock.classList.toggle('low', ms < 30000 && g.status === 'active');
    }
    let text = '';
    let strong = false;
    const opp = g.you ? (g.you === 'w' ? g.black : g.white) : null;
    const left = (ts) => (ts ? fmtClock(ts - (g.serverNow + el)) : '');
    if (!store.wsOpen && !FINAL.has(g.status)) { text = 'Sem ligação. A tentar reconectar…'; strong = true; }
    else if (g.status === 'waiting_start') text = g.joined?.opponent ? 'A iniciar…' : `À espera de ${opp?.username || 'os jogadores'} entrar na partida (${left(g.startDeadline)})`;
    else if (g.status === 'active') {
      if (!g.you) text = 'A observar a partida';
      else if (g.turn === g.you) {
        const mustCapture = g.legal.length && isCapture(g.board, g.legal[0]);
        text = mustCapture ? 'A sua vez — captura obrigatória' : 'A sua vez';
        strong = true;
      } else text = `Vez de ${opp.username}`;
    } else if (g.status === 'awaiting_reconnect' || g.status === 'interrupted') {
      text = opp && !opp.online ? `${opp.username} perdeu a ligação. A partida está em pausa e continua quando voltar.` : 'Partida em pausa. Continua quando os dois estiverem ligados.';
      if (g.reviewDeadline) text += ` (análise em ${left(g.reviewDeadline)})`;
    } else if (g.status === 'under_review') text = 'Partida em análise pela moderação. Nenhum jogador foi penalizado.';
    else if (g.status === 'cancelled') text = 'Partida cancelada: o adversário não entrou a tempo. Entrada devolvida.';
    else if (g.status === 'draw') { text = `Empate — ${REASON[g.reason] || ''}`; strong = true; }
    else if (g.status === 'finished') {
      const won = g.you && g.result === g.you;
      text = g.you ? `${won ? 'Vitória!' : 'Derrota'} — ${REASON[g.reason] || ''}` : `Ganharam as ${g.result === 'w' ? 'brancas' : 'negras'}`;
      strong = true;
    }
    if (FINAL.has(g.status)) text += ' · Abra o menu ☰ para continuar.';
    status.textContent = text;
    status.classList.toggle('strong', strong);
  }

  // ---------------------------------------------------------------- jogada (toque em peça e destinos)
  function onSquare(sq) {
    if (!g || g.status !== 'active' || !g.you || g.you !== g.turn || !store.wsOpen || pending) return;
    const legal = g.legal;
    const cands = new Set();
    if (sel) for (const p of legal) if (p.length > sel.length && startsWith(p, sel)) cands.add(p[sel.length]);
    if (sel && cands.has(sq)) {
      sel = [...sel, sq];
      const full = legal.find((p) => p.length === sel.length && startsWith(p, sel));
      if (full) submit(full); else draw();
      return;
    }
    sel = legal.some((p) => p[0] === sq) ? [sq] : null;
    draw();
  }

  function msg() { return { t: 'move', gameId: id, moveId: pending.moveId, ply: pending.ply, path: pending.path }; }
  function submit(path) {
    pending = { moveId: uuid(), ply: g.ply, path, tries: 1, timer: 0 };
    const r = E.applyMove({ board: g.board.slice(), turn: g.turn, ply: g.ply, noProgress: 0, forced: { active: false, moves: 0 }, history: [], result: null }, path);
    disp = r.ok ? r.state.board : null; // mostra já o lance; o servidor confirma (ou corrige)
    sel = null;
    wsSend(msg());
    prefs.beep('move');
    pending.timer = setTimeout(retry, 2500);
    draw();
  }
  function retry() {
    if (!pending) return;
    if (pending.tries >= 3) { pending = null; disp = null; wsSend({ t: 'join', gameId: id }); draw(); return; }
    pending.tries++;
    wsSend(msg()); // reenvio seguro: o servidor ignora duplicados pelo moveId
    pending.timer = setTimeout(retry, 2500);
  }

  offs.push(on('ws:ack', (m) => {
    if (!pending || m.moveId !== pending.moveId) return;
    if (!m.ok) { clearTimeout(pending.timer); pending = null; disp = null; toast(m.message || 'Lance recusado.', 'err'); draw(); }
  }));
  offs.push(on('ws:game', (m) => { if (m.game?.id === id) update(m.game); }));
  offs.push(on('ws:error', (m) => { if (m.gameId === id || m.code === 'forbidden') toast(m.message || 'Erro na partida.', 'err'); }));
  offs.push(on('ws:status', ({ open }) => {
    if (open) { wsSend({ t: 'join', gameId: id }); if (pending) retry(); } // recupera a posição exata, relógios e vez
    draw();
  }));

  // ---------------------------------------------------------------- ecrã inteiro / expandido (único controlo)
  async function setFs(on_) {
    fs = on_;
    document.body.classList.toggle('expanded', fs);
    fsLabel.textContent = fs ? 'Reduzir' : 'Expandir';
    fsBtn.replaceChild(icon(fs ? 'shrink' : 'expand'), fsBtn.firstChild);
    const de = document.documentElement;
    try {
      if (fs && !document.fullscreenElement) await (de.requestFullscreen?.({ navigationUI: 'hide' }) ?? de.webkitRequestFullscreen?.());
      else if (!fs && document.fullscreenElement) await document.exitFullscreen();
    } catch { /* iPhone/Safari sem API: fica o modo expandido por CSS */ }
  }
  function toggleFs() { setFs(!fs); }
  const onFsChange = () => { if (fs && !document.fullscreenElement && document.body.classList.contains('expanded') && !fsBtn.dataset.pseudo) setFs(false); };
  document.addEventListener('fullscreenchange', onFsChange);

  // manter o ecrã ligado durante a partida (um telemóvel que adormece perde a ligação)
  async function keepAwake() {
    try { if (document.visibilityState === 'visible' && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch { /* sem suporte */ }
  }
  const onVis = () => { if (document.visibilityState === 'visible') { keepAwake(); if (wsOpen()) wsSend({ t: 'join', gameId: id }); } };
  document.addEventListener('visibilitychange', onVis);
  keepAwake();

  const timer = setInterval(tick, 250);

  // ---------------------------------------------------------------- arranque
  GET('/api/games/' + id).then((r) => { update(r.game); if (wsOpen()) wsSend({ t: 'join', gameId: id }); }).catch((e) => {
    root.replaceChildren(h('div', { class: 'card stack' }, h('h2', { text: 'Partida indisponível' }), h('p', { class: 'muted', text: e.message })));
  });
  if (wsOpen()) wsSend({ t: 'join', gameId: id });

  return () => {
    offs.forEach((f) => f());
    clearInterval(timer);
    clearTimeout(pending?.timer);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('visibilitychange', onVis);
    wake?.release?.().catch(() => {});
    document.body.classList.remove('expanded');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
}
