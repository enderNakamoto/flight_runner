import { defineConfig } from "vite";
import { resolve } from "node:path";

// `global` is Node-only; some transitive deps under @creit.tech/stellar-wallets-kit
// (@hot-wallet/sdk → @near-js/crypto → randombytes) reference it. Aliasing to
// globalThis is the standard escape hatch.
//
// `process.env` is also referenced by stellar-sdk's xdr layer at module init —
// we hand it a tiny shim so dev + prod both boot cleanly.
export default defineConfig({
  publicDir: resolve(__dirname, "../../public"),
  server: { port: 5173, host: "127.0.0.1" },
  build: { target: "es2022", sourcemap: true },
  define: {
    global: "globalThis",
    "process.env": "{}",
  },
  resolve: {
    alias: {
      // Without this Rollup externalises `buffer` for prod builds and the
      // bundle fails with `"Buffer" is not exported by "__vite-browser-external"`.
      // Aliasing to `buffer/` forces the npm buffer polyfill in. Dev was
      // already fine via optimizeDeps' pre-bundling.
      buffer: "buffer/",
    },
  },
  optimizeDeps: {
    // Force Vite to pre-bundle these CJS-heavy deps so the `define` rules
    // above apply consistently in dev as well as prod.
    include: [
      "@creit.tech/stellar-wallets-kit",
      "@stellar/stellar-sdk",
      "buffer",
    ],
  },
});
