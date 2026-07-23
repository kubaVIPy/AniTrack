import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // <--- This forces relative paths and works on all servers
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
