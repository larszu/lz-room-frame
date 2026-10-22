// VISCA sender for PTZ tracking: Sony VISCA over IP (UDP 52381, 8-byte header) or plain
// VISCA over TCP / UDP (PTZOptics, Lumens, BirdDog, Marshall, AVer …). The renderer sends
// packets when the drive changes; without a new one for 1.5 s the camera is stopped, so it
// never keeps panning when the app hangs or tracking is switched off.
const dgram = require('node:dgram');
const net = require('node:net');

const STOP = [[0x81, 0x01, 0x06, 0x01, 0x01, 0x01, 0x03, 0x03, 0xff], [0x81, 0x01, 0x04, 0x07, 0x00, 0xff]];

class Ptz {
  constructor() { this.cfg = null; this.udp = null; this.tcp = null; this.seq = 0; this.watch = null; this.state = { ok: false, message: '' }; }

  configure(cfg) {
    const same = this.cfg && cfg && this.cfg.protocol === cfg.protocol && this.cfg.host === cfg.host && this.cfg.port === cfg.port;
    if (!same) this.close();
    this.cfg = cfg && cfg.host ? cfg : null;
    this.state = this.cfg ? { ok: true, message: `${this.cfg.host}:${this.cfg.port}` } : { ok: false, message: '' };
  }

  send(packets) {
    const c = this.cfg; if (!c) return;
    clearTimeout(this.watch);
    this.watch = setTimeout(() => this.write(STOP), 1500);
    this.write(packets);
  }

  stop() { clearTimeout(this.watch); this.write(STOP); }

  write(packets) {
    const c = this.cfg; if (!c) return;
    try {
      if (c.protocol === 'visca-tcp') {
        if (!this.tcp || this.tcp.destroyed) {
          this.tcp = net.connect(c.port, c.host);
          this.tcp.on('error', (e) => { this.state = { ok: false, message: e.message }; });
          this.tcp.on('connect', () => { this.state = { ok: true, message: `${c.host}:${c.port}` }; });
          this.tcp.on('data', () => {}); // ACK / completion replies are not needed
        }
        for (const p of packets) this.tcp.write(Buffer.from(p));
        return;
      }
      if (!this.udp) { this.udp = dgram.createSocket('udp4'); this.udp.on('error', (e) => { this.state = { ok: false, message: e.message }; }); }
      for (const p of packets) {
        let buf = Buffer.from(p);
        if (c.protocol === 'sony-udp') {
          const h = Buffer.alloc(8);
          h.writeUInt16BE(0x0100, 0); h.writeUInt16BE(p.length, 2); h.writeUInt32BE(this.seq = (this.seq + 1) >>> 0, 4);
          buf = Buffer.concat([h, buf]);
        }
        this.udp.send(buf, c.port, c.host);
      }
    } catch (e) { this.state = { ok: false, message: String(e.message || e) }; }
  }

  close() {
    clearTimeout(this.watch);
    if (this.cfg) this.write(STOP);
    try { this.udp?.close(); } catch { /* closed */ }
    try { this.tcp?.destroy(); } catch { /* closed */ }
    this.udp = null; this.tcp = null;
  }
}

module.exports = { Ptz };
