// DAMAS MZ — motor de Damas Portuguesas.
// Regras: "Regras Básicas do Jogo de Damas Portuguesas" (FPDJ, homologadas em 25/01/2025).
// Módulo puro (sem dependências), partilhado entre servidor (autoridade) e cliente (apenas apresentação).
//
// Representação: tabuleiro = array de 33 posições (índice 0 não usado), casas 1..32.
//   0 = vazia | 1 = peão branco | 2 = dama branca | -1 = peão negro | -2 = dama negra
// Numeração das casas (Diagrama 1): 1 = canto inferior direito das brancas, 32 = canto superior esquerdo.

export const VARIANT = {
  id: 'portuguesa',
  name: 'Damas Portuguesas (FPDJ 2025)',
  noProgressPlies: 40, // regra dos 20 lances por jogador (3.1.1)
  forcedMoves: 12, // regra dos 12 lances (3.1.2) — contados pelo lado dominante
  repetitions: 3, // regra da repetição (3.1.3)
};

// ---------------------------------------------------------------- geometria
const R = [0];
const C = [0];
const AT = new Array(64).fill(0);
for (let r = 0; r < 8; r++) {
  for (let k = 0; k < 4; k++) {
    const c = r % 2 === 0 ? 7 - 2 * k : 6 - 2 * k;
    const sq = 4 * r + k + 1;
    R[sq] = r;
    C[sq] = c;
    AT[r * 8 + c] = sq;
  }
}
const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]; // [dLinha, dColuna]; linha 0 = lado das brancas
const NEIGH = [null];
for (let sq = 1; sq <= 32; sq++) {
  NEIGH[sq] = DIRS.map(([dr, dc]) => {
    const r = R[sq] + dr;
    const c = C[sq] + dc;
    return r < 0 || r > 7 || c < 0 || c > 7 ? 0 : AT[r * 8 + c];
  });
}

export const coords = (sq) => ({ r: R[sq], c: C[sq] });
export const squareAt = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? 0 : AT[r * 8 + c]);
/** Casas do "rio" (diagonal 1–32). */
export const RIVER = [];
for (let sq = 1; sq <= 32; sq++) if (R[sq] + C[sq] === 7) RIVER.push(sq);

export const isKing = (v) => Math.abs(v) === 2;
export const colorOf = (v) => (v > 0 ? 'w' : v < 0 ? 'b' : null);

// ---------------------------------------------------------------- estado
const keyOf = (board, turn) => {
  let s = '';
  for (let i = 1; i <= 32; i++) {
    const v = board[i];
    s += v === 0 ? '.' : v === 1 ? 'w' : v === 2 ? 'W' : v === -1 ? 'b' : 'B';
  }
  return s + turn;
};

export function initialState() {
  const board = new Array(33).fill(0);
  for (let s = 1; s <= 12; s++) board[s] = 1;
  for (let s = 21; s <= 32; s++) board[s] = -1;
  return {
    board,
    turn: 'w', // as brancas iniciam (2.3)
    ply: 0,
    noProgress: 0,
    forced: { active: false, moves: 0 },
    history: [keyOf(board, 'w')],
    result: null, // { winner: 'w'|'b'|null, reason }
  };
}

export function countPieces(board) {
  const n = { wp: 0, wk: 0, bp: 0, bk: 0 };
  for (let i = 1; i <= 32; i++) {
    const v = board[i];
    if (v === 1) n.wp++;
    else if (v === 2) n.wk++;
    else if (v === -1) n.bp++;
    else if (v === -2) n.bk++;
  }
  return n;
}

// ---------------------------------------------------------------- geração de lances
/** Sequências completas de captura (maximais) da peça em `from`. */
function captureSeqs(board, from) {
  const v = board[from];
  const color = v > 0 ? 1 : -1;
  const king = Math.abs(v) === 2;
  const b = board.slice();
  b[from] = 0; // a casa de partida fica livre durante o lance
  const taken = new Set(); // peças já capturadas: continuam no tabuleiro até ao fim do lance
  const path = [from];
  const caps = [];
  const out = [];
  const dfs = (pos) => {
    let extended = false;
    for (let d = 0; d < 4; d++) {
      if (!king) {
        if (DIRS[d][0] !== color) continue; // o peão só captura para a frente (2.7.2.4.1)
        const mid = NEIGH[pos][d];
        if (!mid || b[mid] * color >= 0 || taken.has(mid)) continue;
        const land = NEIGH[mid][d];
        if (!land || b[land] !== 0) continue;
        taken.add(mid); path.push(land); caps.push(mid);
        extended = true;
        dfs(land);
        taken.delete(mid); path.pop(); caps.pop();
      } else {
        let s = NEIGH[pos][d];
        while (s && b[s] === 0) s = NEIGH[s][d];
        if (!s || b[s] * color >= 0 || taken.has(s)) continue; // peça própria, ou já capturada
        let land = NEIGH[s][d];
        while (land && b[land] === 0) {
          taken.add(s); path.push(land); caps.push(s);
          extended = true;
          dfs(land);
          taken.delete(s); path.pop(); caps.pop();
          land = NEIGH[land][d];
        }
      }
    }
    if (!extended && caps.length) out.push({ path: path.slice(), captured: caps.slice() });
  };
  dfs(from);
  return out;
}

/** Todos os lances legais do jogador que tem a vez. Aplica as leis da obrigatoriedade, quantidade e qualidade. */
export function legalMoves(state) {
  const color = state.turn === 'w' ? 1 : -1;
  const board = state.board;
  let caps = [];
  for (let s = 1; s <= 32; s++) {
    if (board[s] * color > 0) {
      for (const m of captureSeqs(board, s)) {
        caps.push({
          path: m.path,
          captured: m.captured,
          capture: true,
          kingsCaptured: m.captured.filter((x) => Math.abs(board[x]) === 2).length,
        });
      }
    }
  }
  if (caps.length) {
    const max = Math.max(...caps.map((m) => m.captured.length)); // lei da quantidade
    caps = caps.filter((m) => m.captured.length === max);
    const maxK = Math.max(...caps.map((m) => m.kingsCaptured)); // lei da qualidade
    return caps.filter((m) => m.kingsCaptured === maxK);
  }
  const moves = [];
  for (let s = 1; s <= 32; s++) {
    const v = board[s];
    if (v * color <= 0) continue;
    for (let d = 0; d < 4; d++) {
      if (Math.abs(v) === 1) {
        if (DIRS[d][0] !== color) continue;
        const n = NEIGH[s][d];
        if (n && board[n] === 0) moves.push({ path: [s, n], captured: [], capture: false, kingsCaptured: 0 });
      } else {
        let n = NEIGH[s][d];
        while (n && board[n] === 0) {
          moves.push({ path: [s, n], captured: [], capture: false, kingsCaptured: 0 });
          n = NEIGH[n][d];
        }
      }
    }
  }
  return moves;
}

const pad2 = (n) => String(n).padStart(2, '0');
export const moveNotation = (path, captured) => path.map(pad2).join(captured && captured.length ? 'x' : '-');

// ---------------------------------------------------------------- aplicar lance
function evaluateForced(st, moverColor) {
  const n = countPieces(st.board);
  const dom = n.wk === 3 && n.bk === 1 && n.wp + n.bp === 0 ? 'w' : n.bk === 3 && n.wk === 1 && n.wp + n.bp === 0 ? 'b' : null;
  if (!dom) {
    st.forced = { active: false, moves: 0 };
    return false;
  }
  if (!st.forced.active) {
    const val = dom === 'w' ? 2 : -2;
    if (RIVER.some((s) => st.board[s] === val)) st.forced = { active: true, moves: 0 }; // a contagem começa no lance seguinte
    return false;
  }
  if (moverColor === dom) st.forced.moves++;
  return st.forced.moves >= VARIANT.forcedMoves;
}

/**
 * Aplica um lance (sequência de casas: origem, aterragens...). Devolve { ok, state, move, notation } ou { ok:false, error }.
 * Não altera o estado recebido.
 */
export function applyMove(state, path) {
  if (state.result) return { ok: false, error: 'game_over' };
  if (!Array.isArray(path) || path.length < 2 || !path.every((s) => Number.isInteger(s) && s >= 1 && s <= 32)) {
    return { ok: false, error: 'illegal_move' };
  }
  const m = legalMoves(state).find((x) => x.path.length === path.length && x.path.every((s, i) => s === path[i]));
  if (!m) return { ok: false, error: 'illegal_move' };

  const color = state.turn === 'w' ? 1 : -1;
  const board = state.board.slice();
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  const piece = board[from];
  const wasPawn = Math.abs(piece) === 1;
  board[from] = 0;
  for (const s of m.captured) board[s] = 0;
  let placed = piece;
  if (wasPawn && ((color === 1 && R[to] === 7) || (color === -1 && R[to] === 0))) placed = 2 * color; // coroação (2.4)
  board[to] = placed;

  const mover = state.turn;
  const next = {
    board,
    turn: mover === 'w' ? 'b' : 'w',
    ply: state.ply + 1,
    noProgress: 0,
    forced: { ...state.forced },
    history: [],
    result: null,
  };
  const progress = wasPawn || m.captured.length > 0;
  next.noProgress = progress ? 0 : state.noProgress + 1;
  next.history = progress ? [] : state.history.slice();
  const k = keyOf(board, next.turn);
  next.history.push(k);

  const n = countPieces(board);
  const oppPieces = mover === 'w' ? n.bp + n.bk : n.wp + n.wk;
  if (oppPieces === 0) next.result = { winner: mover, reason: 'captured' };
  else if (legalMoves(next).length === 0) next.result = { winner: mover, reason: 'blocked' };
  else if (next.history.filter((x) => x === k).length >= VARIANT.repetitions) next.result = { winner: null, reason: 'repetition' };
  else if (next.noProgress >= VARIANT.noProgressPlies) next.result = { winner: null, reason: 'twenty_moves' };
  else if (evaluateForced(next, mover)) next.result = { winner: null, reason: 'twelve_moves' };
  return { ok: true, state: next, move: m, notation: moveNotation(m.path, m.captured) };
}

/** Reconstrói o estado a partir da lista de lances (cada lance = array de casas). */
export function replay(paths) {
  let st = initialState();
  for (const p of paths) {
    const r = applyMove(st, p);
    if (!r.ok) throw new Error('replay inválido: ' + p.join(','));
    st = r.state;
  }
  return st;
}
