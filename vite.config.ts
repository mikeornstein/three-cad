import { defineConfig } from "vite";

export default defineConfig({
  // Manifold ships a separate .wasm next to manifold.js; allow Vite to serve it.
  optimizeDeps: {
    exclude: ["manifold-3d"],
  },
  assetsInclude: ["**/*.wasm"],
  server: {
    headers: {
      // Required for some WASM/threading paths; harmless for single-thread Manifold.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
