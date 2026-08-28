import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  define: { __HEARTH_WEB__: "false" },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
});
