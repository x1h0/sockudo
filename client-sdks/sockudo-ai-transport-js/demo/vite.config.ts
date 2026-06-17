import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sockudo/client/react":
        "/Users/radudiaconu/Desktop/Code/Rust/sockudo/client-sdks/sockudo-js/react/index.js",
      "@sockudo/client":
        "/Users/radudiaconu/Desktop/Code/Rust/sockudo/client-sdks/sockudo-js/dist/web/sockudo.mjs",
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
