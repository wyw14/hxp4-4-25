import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5125,
    strictPort: true,
    open: true
  }
});