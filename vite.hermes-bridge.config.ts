import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node22",
    ssr: "src/hermes-bridge/server.ts",
    outDir: "out/hermes-bridge",
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "server.js" },
    },
  },
});
