import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
  },
  // Let esbuild pre-bundle everything including VTK.js.
  // This resolves all CJS→ESM interop issues at once.
  // Trade-off: first startup is slower (~30s); subsequent startups use cache.
  optimizeDeps: {
    include: ['@kitware/vtk.js'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
});
