import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {},
  },
  optimizeDeps: {
    // VTK.js must not be pre-bundled — it uses dynamic imports and
    // conditional requires that break with esbuild pre-bundling.
    exclude: ['@kitware/vtk.js'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Keep VTK.js in its own chunk to avoid hitting 500kB chunk warnings
        manualChunks: {
          vtk: ['@kitware/vtk.js'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  // VTK.js ships some CommonJS-only transitive deps; allow mixed formats
  resolve: {
    alias: {},
  },
  // Suppress WASM / binary asset size warnings
  assetsInclude: ['**/*.wasm'],
});
