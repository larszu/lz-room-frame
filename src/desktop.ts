// Bridge to the Electron main process (electron/preload.cjs). Undefined in a plain browser,
// where the app still runs with local cameras and the output window, but without NDI,
// streams, network inputs and the control API.

export interface DesktopInfo {
  httpPort: number;
  tcpPort: number;
  token: string;
  platform: 'darwin' | 'win32' | 'linux';
  version: string;
  ndi: { ok: boolean; version?: string; error?: string };
  ffmpeg: boolean;
  addresses: string[];
}

export interface Display { id: number; label: string; width: number; height: number; primary: boolean }

export interface Desktop {
  info(): Promise<DesktopInfo>;
  displays(): Promise<Display[]>;
  onCommand(fn: (line: string) => string): void;
  event(text: string): void;
  tracking(data: unknown): void;
  ptz: { configure(cfg: { protocol: string; host: string; port: number } | null): void; send(packets: number[][]): void; stop(): void; status(): Promise<{ ok: boolean; message: string }> };
  atem: { configure(host: string): void; setBox(ssrc: number, box: number, props: Record<string, number | boolean>): void; status(): Promise<{ ok: boolean; message: string }> };
  network: { start(url: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>; stop(): void };
  openVideoFile(): Promise<string | null>;
  setControl(c: { http: number; tcp: number; enabled: boolean }): Promise<{ ok: boolean; error?: string }>;
  setAutostart(on: boolean, hidden: boolean): Promise<void>;
  openExternal(url: string): void;
  showFolder(what: 'qsys' | 'crestron' | 'docs'): void;
}

export const desktop: Desktop | undefined = (window as unknown as { lzrf?: Desktop }).lzrf;
