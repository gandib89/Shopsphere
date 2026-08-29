import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Required for Capacitor: assets must use relative paths (file:// protocol on device)
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/jspdf/') || id.includes('/html2canvas/')) return 'pdf-libs';
          if (id.includes('/@react-oauth/google/')) return 'google-auth';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) {
            return 'react-core';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
