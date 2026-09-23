import { defineConfig } from "vite";

// Project site: https://stellanjoh2.github.io/Falldown/
// Dev stays at /. Production build and preview use the Pages path.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/Falldown/" : "/",
}));
