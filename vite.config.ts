import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// basicSsl() turns on server.https with a self signed certificate.
// host: true exposes the dev server on the LAN so a phone can open it.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
});
