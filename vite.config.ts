import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const appVersion: string = JSON.parse(readFileSync(new URL('./desktop/package.json', import.meta.url), 'utf8')).version;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build de staging publica em /staging/ (mesmo domínio, sem subdomínio novo): o
  // workflow deploy-staging.yml passa VITE_BASE_PATH=/staging/ só nesse build.
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  worker: {
    format: 'es',
  },
});
