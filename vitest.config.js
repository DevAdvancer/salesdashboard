import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  server: {
    // Bind to all IPv4 interfaces for cross-platform compatibility
    host: '0.0.0.0',
    port: 9911,
    open: true,
    // Allow any Host header (useful behind proxies/tunnels)
    allowedHosts: ['sales.silverspace.tech'],
    hmr: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 9911,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
});
