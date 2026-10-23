import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// The bot serves the built panel from dist/panel-ui on port 5000.
// `npm run dev:panel` starts Vite with hot reload and forwards API calls to the running bot.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../dist/panel-ui', import.meta.url)),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/auth': 'http://localhost:5000'
    }
  }
});
