// Bridge to the main process (typed in src/desktop.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lzrf', {
  info: () => ipcRenderer.invoke('lzrf:info'),
  displays: () => ipcRenderer.invoke('lzrf:displays'),
  /** Control API: the main process hands over command lines, the engine answers. */
  onCommand: (fn) => {
    ipcRenderer.on('lzrf:command', async (_e, { id, line }) => {
      let text;
      try { text = await fn(line); } catch (err) { text = `ERR ${err && err.message ? err.message : err}`; }
      ipcRenderer.send('lzrf:reply', { id, text });
    });
  },
  event: (text) => ipcRenderer.send('lzrf:event', text),
  tracking: (data) => ipcRenderer.send('lzrf:tracking', data),
  ptz: {
    configure: (cfg) => ipcRenderer.send('lzrf:ptz-config', cfg),
    send: (packets) => ipcRenderer.send('lzrf:ptz-send', packets),
    stop: () => ipcRenderer.send('lzrf:ptz-stop'),
    status: () => ipcRenderer.invoke('lzrf:ptz-status'),
  },
  atem: {
    configure: (host) => ipcRenderer.send('lzrf:atem-config', host),
    setBox: (ssrc, box, props) => ipcRenderer.send('lzrf:atem-box', ssrc, box, props),
    status: () => ipcRenderer.invoke('lzrf:atem-status'),
  },
  network: {
    start: (url) => ipcRenderer.invoke('lzrf:net-start', url),
    stop: () => ipcRenderer.send('lzrf:net-stop'),
  },
  openVideoFile: () => ipcRenderer.invoke('lzrf:open-video'),
  setControl: (c) => ipcRenderer.invoke('lzrf:set-control', c),
  setAutostart: (on, hidden) => ipcRenderer.invoke('lzrf:autostart', on, hidden),
  openExternal: (url) => ipcRenderer.send('lzrf:open-external', url),
  showFolder: (what) => ipcRenderer.send('lzrf:show-folder', what),
});
