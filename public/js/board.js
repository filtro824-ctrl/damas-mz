// Tabuleiro de Damas (8x8, 32 casas escuras numeradas como nas regras FPDJ). Só apresentação e toques:
// a validação das jogadas é sempre do servidor.
import * as E from '/shared/engine.js';
import { h, clear, crownSvg } from '/js/ui.js';

export class Board {
  /** @param {{onSquare?:(sq:number)=>void, numbers?:boolean}} opts */
  constructor({ onSquare, numbers = false } = {}) {
    this.orient = 'w'; // 'w' = brancas em baixo
    this.pieces = new Map(); // casa -> elemento
    this.prev = null;
    this.onSquare = onSquare;
    this.el = h('div', { class: 'board' + (numbers ? '' : ' hide-no'), role: 'application', 'aria-label': 'Tabuleiro de damas' });
    this.grid = h('div', { class: 'grid' });
    this.layer = h('div', { class: 'pieces' });
    this.el.append(this.grid, this.layer);
    this.build();
    this.el.addEventListener('click', (e) => {
      if (!this.onSquare) return;
      const r = this.el.getBoundingClientRect();
      const col = Math.floor(((e.clientX - r.left) / r.width) * 8);
      const row = Math.floor(((e.clientY - r.top) / r.height) * 8);
      const sq = this.sqAt(row, col);
      if (sq) this.onSquare(sq);
    });
  }

  setNumbers(on) { this.el.classList.toggle('hide-no', !on); }

  // linha/coluna de ecrã de uma casa
  rc(sq) {
    const { r, c } = E.coords(sq);
    return this.orient === 'w' ? { row: 7 - r, col: c } : { row: r, col: 7 - c };
  }
  sqAt(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return 0;
    return this.orient === 'w' ? E.squareAt(7 - row, col) : E.squareAt(row, 7 - col);
  }

  build() {
    clear(this.grid);
    this.sqEls = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = this.sqAt(row, col);
        const d = h('div', { class: 'sq' + (sq ? ' d' : '') });
        if (sq) { d.append(h('span', { class: 'no', text: String(sq) })); this.sqEls[sq] = d; }
        this.grid.append(d);
      }
    }
  }

  setOrientation(o) {
    if (o === this.orient) return;
    this.orient = o;
    this.build();
    for (const [sq, el] of this.pieces) { el.classList.add('no-anim'); this.place(el, sq); }
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const el of this.pieces.values()) el.classList.remove('no-anim'); }));
  }

  place(el, sq) {
    const { row, col } = this.rc(sq);
    el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  makePiece(color) {
    const el = h('div', { class: `piece ${color}` }, h('i'));
    el._c = color;
    return el;
  }
  setKing(el, king) {
    if (king === el.classList.contains('king')) return;
    el.classList.toggle('king', king);
    const i = el.firstChild;
    if (king) i.append(crownSvg());
    else i.querySelector('svg')?.remove();
  }
  drop(el) {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 260);
  }

  /** Sincroniza as peças com o array do tabuleiro (índices 1..32). Anima o lance quando é identificável. */
  syncPieces(board) {
    const old = this.prev;
    this.prev = board.slice();
    let anim = null;
    if (old) {
      const van = { w: [], b: [] };
      const app = { w: [], b: [] };
      for (let s = 1; s <= 32; s++) {
        const a = old[s];
        const b = board[s];
        if (a === b) continue;
        if (a !== 0 && Math.sign(a) !== Math.sign(b)) van[a > 0 ? 'w' : 'b'].push(s);
        if (b !== 0 && Math.sign(a) !== Math.sign(b)) app[b > 0 ? 'w' : 'b'].push(s);
      }
      for (const k of ['w', 'b']) if (van[k].length === 1 && app[k].length === 1) anim = { from: van[k][0], to: app[k][0] };
    }
    const next = new Map();
    if (anim) {
      const el = this.pieces.get(anim.from);
      if (el) {
        this.pieces.delete(anim.from);
        next.set(anim.to, el);
        el.classList.add('moving');
        setTimeout(() => el.classList.remove('moving'), 300);
        this.place(el, anim.to);
      }
    }
    for (const [sq, el] of this.pieces) {
      if (!next.has(sq) && board[sq] !== 0 && el._c === (board[sq] > 0 ? 'w' : 'b')) next.set(sq, el);
      else this.drop(el);
    }
    for (let s = 1; s <= 32; s++) {
      const v = board[s];
      if (!v) continue;
      const color = v > 0 ? 'w' : 'b';
      let el = next.get(s);
      if (el && el._c !== color) { this.drop(el); el = null; }
      if (!el) { el = this.makePiece(color); this.layer.append(el); this.place(el, s); next.set(s, el); }
      this.setKing(el, Math.abs(v) === 2);
    }
    this.pieces = next;
  }

  /**
   * @param {number[]} board array (1..32) — 0 vazia, ±1 peão, ±2 dama (positivo = brancas)
   * @param {{last?:number[], via?:number[], selected?:number, movable?:Set<number>, dests?:Set<number>}} o
   */
  render(board, o = {}) {
    this.syncPieces(board);
    const last = o.last && o.last.length ? new Set([o.last[0], o.last[o.last.length - 1]]) : new Set();
    const via = new Set(o.via || []);
    for (let s = 1; s <= 32; s++) {
      const d = this.sqEls[s];
      d.classList.toggle('last', last.has(s) || via.has(s));
      d.classList.toggle('dest', !!o.dests?.has(s));
    }
    for (const [sq, el] of this.pieces) {
      el.classList.toggle('sel', o.selected === sq);
      el.classList.toggle('movable', !!o.movable?.has(sq) && o.selected !== sq);
    }
  }
}
