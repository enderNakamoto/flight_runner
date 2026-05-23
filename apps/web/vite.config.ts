import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: resolve(__dirname, "../../public"),
  server: { port: 5173, host: "127.0.0.1" },
  build: { target: "es2022", sourcemap: true },
});
