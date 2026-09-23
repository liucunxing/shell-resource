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
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { fluent: ["@fluentui/react-components"] } },
    },
  },
});
