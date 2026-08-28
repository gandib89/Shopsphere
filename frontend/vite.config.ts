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
        manualChunks: {
          // Core React (loaded always)
          'react-core': ['react', 'react-dom', 'react-router-dom'],
          // Heavy PDF/canvas libs only loaded when generating bills
          'pdf-libs': ['jspdf', 'html2canvas'],
          // Google OAuth only needed on auth pages
          'google-auth': ['@react-oauth/google'],
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
