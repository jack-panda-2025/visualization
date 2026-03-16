import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {},
  },
  optimizeDeps: {
    // VTK.js itself must not be pre-bundled (dynamic imports / conditional
    // requires break esbuild), but its CJS-only transitive deps must be
    // pre-bundled so esbuild can synthesise an ESM default export for them.
    exclude: ['@kitware/vtk.js'],
    include: ['globalthis', 'pako'],
    esbuildOptions: {
      target: 'esnext',
    },
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
