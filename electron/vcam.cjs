// The virtual camera ("LZ Room Frame" in Teams, Zoom, Meet): status and one-time setup.
// Linux: v4l2loopback, loaded through pkexec (the system's admin prompt) and kept for later
// boots. Windows 11: the Media Foundation source DLL, registered through UAC.
const { execFile, execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');

const LINUX_DEVICE = '/dev/video10';
const LINUX_OPTS = 'devices=1 video_nr=10 card_label="LZ Room Frame" exclusive_caps=1';

function linuxInstallHint() {
  const has = (c) => { try { execFileSync('sh', ['-c', `command -v ${c}`], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (has('apt-get')) return 'sudo apt install v4l2loopback-dkms';
  if (has('dnf')) return 'sudo dnf install v4l2loopback';
  if (has('pacman')) return 'sudo pacman -S v4l2loopback-dkms';
  if (has('zypper')) return 'sudo zypper install v4l2loopback-kmp-default';
  return 'v4l2loopback über die Paketverwaltung installieren';
}

/** { ok, setup, error, install?, device? }: ok = ready, setup = one click can make it ready. */
function vcamStatus(helperPath) {
  if (process.platform === 'linux') {
    if (existsSync(LINUX_DEVICE)) return { ok: true, setup: false, error: '', device: LINUX_DEVICE };
    let installed = false;
    try { execFileSync('modinfo', ['v4l2loopback'], { stdio: 'ignore' }); installed = true; } catch { /* missing */ }
    return installed ? { ok: false, setup: true, error: 'Einmal einrichten' } : { ok: false, setup: false, error: 'v4l2loopback ist nicht installiert', install: linuxInstallHint() };
  }
  if (process.platform === 'win32') {
    const p = helperPath('lz-vcam');
    if (!existsSync(p)) return { ok: false, setup: false, error: 'Kamera-Helfer fehlt in diesem Build' };
    try { return JSON.parse(execFileSync(p, ['--probe'], { timeout: 5000 }).toString().trim()); }
    catch (e) { return { ok: false, setup: false, error: String(e.message || e) }; }
  }
  return { ok: false, setup: false, error: 'Auf dem Mac über NDI Virtual Input oder einen HDMI-Capture-Stick' };
}

/** Runs the one-time setup with the system's admin prompt. Resolves with the new status. */
function vcamSetup(helperPath) {
  return new Promise((done) => {
    const after = (err) => done(err ? { ...vcamStatus(helperPath), error: 'Einrichtung abgebrochen oder fehlgeschlagen' } : vcamStatus(helperPath));
    if (process.platform === 'linux') {
      const script = `modprobe v4l2loopback ${LINUX_OPTS} && echo v4l2loopback > /etc/modules-load.d/lz-room-frame.conf && echo 'options v4l2loopback ${LINUX_OPTS}' > /etc/modprobe.d/lz-room-frame.conf`;
      execFile('pkexec', ['sh', '-c', script], { timeout: 120000 }, after);
    } else if (process.platform === 'win32') {
      const exe = helperPath('lz-vcam').replace(/'/g, "''");
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Start-Process -FilePath '${exe}' -ArgumentList '--register' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`], { timeout: 120000, windowsHide: true }, after);
    } else done(vcamStatus(helperPath));
  });
}

module.exports = { vcamStatus, vcamSetup, LINUX_DEVICE };
