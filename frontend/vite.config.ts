import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "preserve-customer-prototypes",
      closeBundle() {
        cpSync(
          fileURLToPath(new URL("./prototypes", import.meta.url)),
          fileURLToPath(new URL("./dist/prototypes", import.meta.url)),
          { recursive: true },
        );
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/portal-embed/api": "http://127.0.0.1:8000",
      "/portal-embed/login": "http://127.0.0.1:8000",
      "/portal-embed/logout": "http://127.0.0.1:8000",
    },
  },
  worker: { format: "es" },
  preview: { host: '127.0.0.1', port: 5175, strictPort: true },
  build: {
    rollupOptions: {
      output: { manualChunks: { fluent: ["@fluentui/react-components"] } },
    },
  },
});
