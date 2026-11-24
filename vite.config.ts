import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules"))
            return id.includes("codemirror") ||
              id.includes("@lezer") ||
              id.includes("style-mod")
              ? "editor"
              : "vendor";
        },
      },
    },
  },
});
