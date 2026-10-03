import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // MapLibre resolves its worker at runtime. Pre-bundling can leave Vite's
    // generated worker entry stale after an HMR rebuild and blank the map.
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
