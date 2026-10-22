// Control and media server of the main process.
//  HTTP  :http  GET /            web remote (touch panels, browsers)
//               GET /api/status  POST|GET /api/command (text, or ?c=…)  GET /api/scenes
//               GET /preview.mjpg  /preview.jpg   output preview (small)
//               WS  /control     command lines in, answers and events out
//               WS  /frames      the renderer's frames (local, with token)
//               GET /net.mjpg    network input for the renderer (local)
//  TCP   :tcp   one command per line, answers per line; "subscribe on" sends "EVT …" lines.
//               Made for Crestron TCP/IP Client and Q-SYS TcpSocket.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { writePart } = require('./sinks.cjs');

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

class ControlServer {
  /**
   * @param {{ exec: (line: string) => Promise<string>, sinks: any, network: any, token: string }} o
   */
  constructor(o) {
    this.o = o;
    this.preview = null;
    this.previewClients = new Set();
    this.subscribers = new Set(); // { send(text) }
    this.trackers = new Set(); // clients that asked for tracking data
    this.lastTracking = null;
    this.http = null; this.tcp = null; this.ports = { http: 0, tcp: 0 };
    this.frameSockets = new Set();
  }

  async listen(httpPort, tcpPort, enabled) {
    await this.close();
    const host = enabled ? '0.0.0.0' : '127.0.0.1';
    this.http = http.createServer((req, res) => this.route(req, res));
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
    this.http.on('upgrade', (req, sock, head) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/frames') {
        if (!isLocal(req) || u.searchParams.get('token') !== this.o.token) return sock.destroy();
        wss.handleUpgrade(req, sock, head, (ws) => this.onFrames(ws));
      } else if (u.pathname === '/control') {
        wss.handleUpgrade(req, sock, head, (ws) => this.onControlWs(ws));
      } else sock.destroy();
    });
    await new Promise((ok, bad) => { this.http.once('error', bad); this.http.listen(httpPort, host, ok); });
    this.ports.http = this.http.address().port;
    if (enabled) {
      this.tcp = net.createServer((s) => this.onTcp(s));
      await new Promise((ok, bad) => { this.tcp.once('error', bad); this.tcp.listen(tcpPort, '0.0.0.0', ok); });
      this.ports.tcp = this.tcp.address().port;
    } else this.ports.tcp = 0;
  }

  async close() {
    for (const s of this.frameSockets) s.terminate();
    await Promise.all([this.http, this.tcp].filter(Boolean).map((srv) => new Promise((ok) => { srv.close(() => ok()); srv.closeAllConnections?.(); })));
    this.http = this.tcp = null;
  }

  /** Event from the renderer ("persons 3", "scene 2 tiles" …) to all subscribers. */
  event(text) { for (const s of this.subscribers) s.send(`EVT ${text}`); }

  /** Tracking data from the renderer (≈ 10/s) to clients that sent "tracking on". */
  tracking(data) {
    this.lastTracking = data;
    if (!this.trackers.size) return;
    const line = `TRK ${JSON.stringify(data)}`;
    for (const c of this.trackers) c.send(line);
  }

  pushSinkStatus() {
    const msg = JSON.stringify({ sinks: this.o.sinks.status() });
    for (const ws of this.frameSockets) if (ws.readyState === 1) ws.send(msg);
  }

  onFrames(ws) {
    this.frameSockets.add(ws);
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try { const m = JSON.parse(data.toString()); if (m.type === 'sinks') { this.o.sinks.configure(m); this.pushSinkStatus(); } } catch { /* ignore */ }
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const tag = buf.toString('latin1', 0, 4);
      if (tag === 'LZRF' || tag === 'LZRB') this.o.sinks.frame(buf);
      else if (tag === 'LZJP') { this.preview = buf.subarray(4); for (const r of this.previewClients) writePart(r, this.preview); }
    });
    ws.on('close', () => this.frameSockets.delete(ws));
    ws.send(JSON.stringify({ sinks: this.o.sinks.status() }));
  }

  async handleLine(line, client) {
    const t = line.trim();
    if (!t) return null;
    if (/^tracking(\s|$)/i.test(t)) {
      const on = !/\s(off|0|false|aus)$/i.test(t);
      if (on) this.trackers.add(client); else this.trackers.delete(client);
      return `OK tracking ${on ? 'on' : 'off'}`;
    }
    if (/^subscribe(\s|$)/i.test(t)) {
      const on = !/\s(off|0|false|aus)$/i.test(t);
      if (on) this.subscribers.add(client); else this.subscribers.delete(client);
      return `OK subscribe ${on ? 'on' : 'off'}`;
    }
    return this.o.exec(t);
  }

  onTcp(sock) {
    sock.setNoDelay(true);
    let buf = '';
    const client = { send: (text) => { if (!sock.destroyed) sock.write(`${text}\r\n`); } };
    sock.on('data', async (d) => {
      buf += d.toString('utf8');
      if (buf.length > 65536) buf = '';
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const ans = await this.handleLine(line, client);
        if (ans !== null) client.send(ans.replace(/\n/g, '\r\n'));
      }
    });
    const drop = () => { this.subscribers.delete(client); this.trackers.delete(client); };
    sock.on('close', drop);
    sock.on('error', drop);
  }

  onControlWs(ws) {
    const client = { send: (text) => ws.readyState === 1 && ws.send(text) };
    ws.on('message', async (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        const ans = await this.handleLine(line, client);
        if (ans !== null) client.send(ans);
      }
    });
    ws.on('close', () => { this.subscribers.delete(client); this.trackers.delete(client); });
  }

  async route(req, res) {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(body); };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
      if (u.pathname === '/' || u.pathname === '/remote') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'remote.html')));
      if (u.pathname === '/api/status') return send(200, 'application/json', await this.o.exec('status'));
      if (u.pathname === '/api/scenes') {
        const lines = (await this.o.exec('scenes')).split('\n').filter(Boolean).map((l) => { const [n, id, ...name] = l.split(' '); return { number: Number(n), id, name: name.join(' ') }; });
        return send(200, 'application/json', JSON.stringify(lines));
      }
      if (u.pathname === '/api/command') {
        let line = u.searchParams.get('c') ?? '';
        if (req.method === 'POST') line = await new Promise((ok) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 4096) req.destroy(); }); req.on('end', () => ok(b)); });
        const ans = await this.o.exec(line);
        return send(ans.startsWith('ERR') ? 400 : 200, 'text/plain; charset=utf-8', ans);
      }
      if (u.pathname === '/api/tracking') return send(200, 'application/json', JSON.stringify(this.lastTracking ?? {}));
      if (u.pathname === '/preview.jpg') return this.preview ? send(200, 'image/jpeg', this.preview) : send(503, 'text/plain', 'no picture yet');
      if (u.pathname === '/preview.mjpg') {
        res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=lzrf', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        this.previewClients.add(res);
        if (this.preview) writePart(res, this.preview);
        return res.on('close', () => this.previewClients.delete(res));
      }
      if (u.pathname === '/net.mjpg' && isLocal(req)) return this.o.network.serve(res);
      send(404, 'text/plain', 'not found');
    } catch (e) { send(500, 'text/plain', String(e.message || e)); }
  }
}

module.exports = { ControlServer };
