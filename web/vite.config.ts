import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = process.env.DCPOINT_BACKEND ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/cdn': backend,
      '/gateway': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  // Chunking is left to Rollup: hand-written manualChunks created a circular
  // import between the react and vendor chunks (blank page in production).
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
