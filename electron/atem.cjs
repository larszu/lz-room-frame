// ATEM connection (atem-connection, MIT): sets one SuperSource box from tracking data.
// At most 25 updates per second; only the newest pending value is sent.
let AtemLib = null;

class AtemLink {
  constructor() { this.atem = null; this.host = ''; this.pending = null; this.timer = null; this.state = { ok: false, message: '' }; this.onChange = null; }

  configure(host) {
    if (host === this.host) return;
    this.close();
    this.host = host || '';
    if (!this.host) return;
    AtemLib ??= require('atem-connection');
    const a = new AtemLib.Atem({ disableMultithreaded: true });
    this.atem = a;
    this.state = { ok: false, message: 'verbinde …' };
    a.on('connected', () => { this.state = { ok: true, message: a.state?.info?.productIdentifier || 'verbunden' }; this.onChange?.(); });
    a.on('disconnected', () => { this.state = { ok: false, message: 'getrennt' }; this.onChange?.(); });
    a.on('error', (e) => { this.state = { ok: false, message: String(e) }; });
    a.connect(this.host).catch((e) => { this.state = { ok: false, message: String(e.message || e) }; this.onChange?.(); });
  }

  /** raw box props (atem-connection units) for box `box` of SuperSource `ssrc`. */
  setBox(ssrc, box, props) {
    this.pending = { ssrc, box, props };
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const p = this.pending; this.pending = null;
      if (!p || !this.atem || !this.state.ok) return;
      this.atem.setSuperSourceBoxSettings({ enabled: true, ...p.props }, p.box, p.ssrc).catch((e) => { this.state = { ok: false, message: String(e.message || e) }; });
    }, 40);
  }

  close() {
    clearTimeout(this.timer); this.timer = null;
    const a = this.atem; this.atem = null; this.host = '';
    if (a) a.disconnect().catch(() => {}).finally(() => a.destroy().catch(() => {}));
    this.state = { ok: false, message: '' };
  }
}

module.exports = { AtemLink };
