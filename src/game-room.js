import { DurableObject } from 'cloudflare:workers';
import * as E from '../shared/engine.js';

export class GameRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const url = new URL(request.url); const userId = url.searchParams.get('userId');
    server.serializeAttachment({ userId, joinedAt: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }
  async ensureState(gameId) {
    let state = await this.ctx.storage.get('state');
    if (!state) { state = { gameId, board: E.initialState(), players: {}, sockets: {} }; await this.ctx.storage.put('state', state); }
    return state;
  }
  async webSocketMessage(ws, raw) {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return ws.send(JSON.stringify({ t: 'error', code: 'bad_json' })); }
    const att = ws.deserializeAttachment() || {}; const gameId = this.ctx.id.toString(); const state = await this.ensureState(gameId);
    if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', serverNow: Date.now() }));
    if (msg.t === 'join') { ws.serializeAttachment({ ...att, gameId, joined: true }); return this.broadcast({ t: 'game', game: this.view(state, att.userId) }); }
    if (msg.t !== 'move') return;
    const current = state.board; const r = E.applyMove(current, msg.path);
    if (!r.ok) return ws.send(JSON.stringify({ t: 'ack', moveId: msg.moveId, ok: false, error: r.error, message: 'Lance inválido.' }));
    state.board = r.state; await this.ctx.storage.put('state', state);
    ws.send(JSON.stringify({ t: 'ack', moveId: msg.moveId, ok: true, duplicate: false }));
    return this.broadcast({ t: 'game', game: this.view(state, att.userId) });
  }
  view(state) { return { id: state.gameId, status: state.board.result ? 'finished' : 'active', board: state.board.board, turn: state.board.turn, ply: state.board.ply, result: state.board.result, serverNow: Date.now() }; }
  broadcast(msg) { const out = JSON.stringify(msg); for (const ws of this.ctx.getWebSockets()) try { ws.send(out); } catch {} }
  async webSocketClose() {}
  async webSocketError() {}
}
