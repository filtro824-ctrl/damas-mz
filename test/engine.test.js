import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../shared/engine.js';

const emptyState = (turn = 'w') => {
  const st = E.initialState();
  st.board = new Array(33).fill(0);
  st.turn = turn;
  st.history = [];
  return st;
};
const put = (st, spec) => {
  for (const [sq, v] of Object.entries(spec)) st.board[Number(sq)] = v;
  return st;
};
const paths = (st) => E.legalMoves(st).map((m) => m.path.join('-')).sort();

test('geometria: numeração, rio e posição inicial (Diagramas 1, 2 e 6)', () => {
  assert.deepEqual(E.RIVER, [1, 5, 10, 14, 19, 23, 28, 32]);
  assert.deepEqual(E.coords(1), { r: 0, c: 7 }); // canto inferior direito das brancas
  assert.deepEqual(E.coords(32), { r: 7, c: 0 }); // canto superior esquerdo
  assert.deepEqual(E.coords(4), { r: 0, c: 1 });
  assert.deepEqual(E.coords(29), { r: 7, c: 6 });
  const st = E.initialState();
  const n = E.countPieces(st.board);
  assert.deepEqual(n, { wp: 12, wk: 0, bp: 12, bk: 0 });
  for (let s = 1; s <= 12; s++) assert.equal(st.board[s], 1);
  for (let s = 13; s <= 20; s++) assert.equal(st.board[s], 0);
  for (let s = 21; s <= 32; s++) assert.equal(st.board[s], -1);
});

test('posição inicial: 7 lances para cada lado, brancas começam', () => {
  const st = E.initialState();
  assert.equal(st.turn, 'w');
  assert.deepEqual(paths(st), ['10-13', '10-14', '11-14', '11-15', '12-15', '12-16', '9-13'].sort());
  st.turn = 'b';
  assert.equal(E.legalMoves(st).length, 7);
});

test('peão move-se só para a frente (Diagrama 7)', () => {
  const st = put(emptyState(), { 3: 1 }); // peão branco em 3
  assert.deepEqual(paths(st), ['3-6', '3-7']);
  const b = put(emptyState('b'), { 30: -1 });
  assert.deepEqual(paths(b), ['30-26', '30-27']);
});

test('dama move-se sem limite nas quatro diagonais (Diagrama 8)', () => {
  const st = put(emptyState(), { 11: 2 });
  const dests = E.legalMoves(st).map((m) => m.path[1]).sort((a, b) => a - b);
  // 11 (linha 2, coluna 3): as quatro diagonais, para a frente e para trás
  assert.deepEqual(dests, [2, 4, 6, 7, 14, 15, 18, 20, 21, 24, 25]);
  assert.equal(new Set(dests).size, dests.length);
  assert.equal(E.legalMoves(st).every((m) => !m.capture), true);
});

test('captura é obrigatória', () => {
  const st = put(emptyState(), { 10: 1, 14: -1, 5: 1 });
  const m = E.legalMoves(st);
  assert.equal(m.length, 1);
  assert.equal(m[0].capture, true);
  assert.deepEqual(m[0].path, [10, 19]);
  assert.equal(E.applyMove(st, [5, 9]).ok, false); // lance sem captura é recusado
});

test('peão não captura para trás (2.7.2.4.1 — sem retro-captura)', () => {
  // Diagrama 12: peão branco em 19, negros em 22 e 15. Só pode capturar para a frente (22).
  const st = put(emptyState(), { 19: 1, 22: -1, 15: -1 });
  assert.deepEqual(paths(st), ['19-26']);
});

test('lei da quantidade (Diagrama 9): tomar o maior número de peças', () => {
  // Peão branco em 2; negros em 5, 9→ ver diagrama: captura correcta 02x09x18x27
  const st = put(emptyState(), { 2: 1, 5: -1, 13: -1, 22: -1, 6: -1, 15: -1 });
  const mv = E.legalMoves(st);
  assert.ok(mv.every((m) => m.captured.length === Math.max(...mv.map((x) => x.captured.length))));
  assert.ok(mv.some((m) => m.path.join('x') === '2x9x18x27'), paths(st).join(' '));
});

test('lei da qualidade (Diagrama 11): prefere a hipótese com dama capturada', () => {
  const st = put(emptyState(), { 2: 1, 6: -1, 5: -1, 15: -1, 13: -2, 21: -1, 23: -1 });
  const mv = E.legalMoves(st);
  assert.equal(mv.length, 1);
  assert.deepEqual(mv[0].path, [2, 9, 18, 25]);
  assert.equal(mv[0].captured.length, 3);
  assert.equal(mv[0].kingsCaptured, 1);
});

test('capturas múltiplas ortogonais da dama (Diagrama 15)', () => {
  const st = put(emptyState(), { 4: 2, 7: -1, 15: -1, 27: -1, 21: -1, 10: -1 });
  const mv = E.legalMoves(st);
  assert.ok(mv.every((m) => m.captured.length === 5));
  assert.ok(mv.some((m) => m.path.join('x') === '4x11x20x30x17x3'), paths(st).join(' '));
});

test('dama captura de longe, em qualquer sentido, mas não salta duas peças seguidas', () => {
  const st = put(emptyState(), { 25: 2, 21: -1 });
  const mv = E.legalMoves(st);
  assert.deepEqual(mv.map((m) => m.path.join('-')).sort(), ['25-18', '25-14', '25-11', '25-7', '25-4'].sort());
  const blocked = put(emptyState(), { 25: 2, 21: -1, 18: -1 });
  assert.equal(E.legalMoves(blocked).every((m) => !m.capture), true);
});

test('peça capturada não pode ser saltada duas vezes e não sai antes do fim do lance', () => {
  // dama em 4; negros formando um circuito — todas as sequências têm peças distintas
  const st = put(emptyState(), { 4: 2, 7: -1, 15: -1, 14: -1, 6: -1 });
  for (const m of E.legalMoves(st)) assert.equal(new Set(m.captured).size, m.captured.length);
});

test('coroação: peão que chega à casa basal torna-se dama (2.4)', () => {
  const st = put(emptyState(), { 25: 1, 1: -1 });
  const r = E.applyMove(st, [25, 29]);
  assert.equal(r.ok, true);
  assert.equal(r.state.board[29], 2);
  const s2 = put(emptyState('b'), { 6: -1, 32: 1 });
  const r2 = E.applyMove(s2, [6, 2]);
  assert.equal(r2.state.board[2], -2);
});

test('vitória por captura de todas as peças e por bloqueio', () => {
  const st = put(emptyState(), { 10: 1, 14: -1 });
  const r = E.applyMove(st, [10, 19]);
  assert.deepEqual(r.state.result, { winner: 'w', reason: 'captured' });
  // bloqueio: peão negro na casa 4 (sem casas à frente) — após qualquer lance das brancas fica sem lances
  const b = put(emptyState(), { 20: 1, 4: -1 });
  const rb = E.applyMove(b, [20, 24]);
  assert.equal(rb.ok, true);
  assert.equal(E.legalMoves(rb.state).length, 0);
  assert.deepEqual(rb.state.result, { winner: 'w', reason: 'blocked' });
});

test('lance ilegal é rejeitado e o estado original não muda', () => {
  const st = E.initialState();
  const copy = JSON.stringify(st);
  assert.equal(E.applyMove(st, [9, 17]).ok, false);
  assert.equal(E.applyMove(st, [1, 5]).ok, false);
  assert.equal(E.applyMove(st, [9]).ok, false);
  assert.equal(E.applyMove(st, [9, 99]).ok, false);
  assert.equal(JSON.stringify(st), copy);
});

test('regra dos 20 lances: 40 meios-lances sem peão movido nem captura = empate', () => {
  let st = put(emptyState(), { 1: 2, 32: -2, 17: 2, 16: -2 });
  // damas a oscilar sem repetir posições 3 vezes não é trivial; testamos o contador directamente
  st.noProgress = 39;
  st.history = [];
  st = put(st, {});
  const r = E.applyMove(st, [1, 5]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.result, { winner: null, reason: 'twenty_moves' });
});

test('regra da repetição: terceira ocorrência da posição = empate', () => {
  let st = put(emptyState(), { 1: 2, 32: -2 });
  st.history = [];
  st.board = new Array(33).fill(0); st.board[4] = 2; st.board[29] = -2; // damas que não se vêem
  const seq = [[4, 8], [29, 25], [8, 4], [25, 29]];
  let result = null;
  let rounds = 0;
  outer: for (let i = 0; i < 4; i++) {
    for (const p of seq) {
      const r = E.applyMove(st, p);
      assert.equal(r.ok, true, p.join('-'));
      st = r.state;
      rounds++;
      if (st.result) { result = st.result; break outer; }
    }
  }
  assert.deepEqual(result, { winner: null, reason: 'repetition' });
  assert.ok(rounds <= 12);
});

test('regra dos 12 lances (forçada): conta a partir da ocupação do rio', () => {
  // 3 damas brancas vs 1 negra, sem peões. Branca em 1 (rio) → contagem começa no lance seguinte.
  let st = put(emptyState(), { 4: 2, 3: 2, 2: 2, 17: -2 });
  st.history = [];
  // lance das brancas: 4 → 14 (ocupa o rio) — activa a contagem
  let r = E.applyMove(st, [4, 14]);
  assert.equal(r.ok, true);
  assert.equal(r.state.forced.active, true);
  assert.equal(r.state.forced.moves, 0);
  st = r.state;
  // simula 11 lances do dominante sem captura: pelo contador
  st.forced.moves = 11;
  st.noProgress = 0;
  st.turn = 'w';
  const r2 = E.applyMove(st, E.legalMoves(st).find((m) => !m.capture).path);
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.state.result, { winner: null, reason: 'twelve_moves' });
});

test('replay reproduz o mesmo estado', () => {
  let st = E.initialState();
  const played = [];
  for (let i = 0; i < 30 && !st.result; i++) {
    const m = E.legalMoves(st)[0];
    played.push(m.path);
    st = E.applyMove(st, m.path).state;
  }
  const again = E.replay(played);
  assert.deepEqual(again.board, st.board);
  assert.equal(again.turn, st.turn);
});

test('partidas aleatórias: nunca lançam excepções, conservam peças e terminam', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const reasons = {};
  for (let g = 0; g < 60; g++) {
    let st = E.initialState();
    let guard = 0;
    while (!st.result && guard++ < 1500) {
      const mv = E.legalMoves(st);
      assert.ok(mv.length > 0);
      const m = mv[rnd(mv.length)];
      const before = E.countPieces(st.board);
      const r = E.applyMove(st, m.path);
      assert.equal(r.ok, true);
      const after = E.countPieces(r.state.board);
      const lost = (before.wp + before.wk + before.bp + before.bk) - (after.wp + after.wk + after.bp + after.bk);
      assert.equal(lost, m.captured.length);
      st = r.state;
    }
    assert.ok(st.result, 'a partida devia ter terminado');
    reasons[st.result.reason] = (reasons[st.result.reason] || 0) + 1;
  }
  console.log('motivos de fim (60 partidas aleatórias):', JSON.stringify(reasons));
});
