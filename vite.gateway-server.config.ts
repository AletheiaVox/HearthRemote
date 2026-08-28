import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    ssr: "src/gateway/server.ts",
    outDir: "out/gateway",
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "server.js" },
    },
  },
  ssr: { external: ["ws"] },
});
