// Servidor WebSocket mínimo (RFC 6455), sem dependências externas.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WSConn(socket);
}

function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

export class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.closed = false;
    this.lastPong = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      try { this.parse(); } catch { this.terminate(1002); }
    });
    socket.on('close', () => this.onClosed());
    socket.on('error', () => this.onClosed());
  }

  parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.terminate(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD) return this.terminate(1009);
      if (!masked) return this.terminate(1002); // o cliente tem de mascarar
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 0x8) { // close
        this.closeFrame(1000);
        return;
      }
      if (opcode === 0x9) { this.raw(frame(0xa, data)); continue; } // ping → pong
      if (opcode === 0xa) { this.lastPong = Date.now(); continue; }
      if (opcode === 0x1 || opcode === 0x2) { this.fragOp = opcode; this.frags = [data]; }
      else if (opcode === 0x0) this.frags.push(data);
      else return this.terminate(1002);
      if (fin) {
        const msg = Buffer.concat(this.frags);
        this.frags = [];
        if (this.fragOp === 0x1) this.emit('message', msg.toString('utf8'));
      }
    }
  }

  raw(buf) {
    if (!this.closed && this.socket.writable) this.socket.write(buf);
  }
  sendRaw(str) { this.raw(frame(0x1, Buffer.from(str, 'utf8'))); }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  ping() { this.raw(frame(0x9, Buffer.alloc(0))); }

  closeFrame(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    this.raw(frame(0x8, p));
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 500).unref();
  }
  close(code = 1000) { this.closeFrame(code); }
  terminate(code = 1002) {
    if (!this.closed) { this.closeFrame(code); }
    this.socket.destroy();
  }
  onClosed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}
