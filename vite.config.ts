import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dev port 4196 (strictPort): the Electron dev window loads exactly this address
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 4196, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130' },
});
