import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

// https://ultrapilled.com — served at the domain root.
export default defineConfig({
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
});

