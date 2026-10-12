import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API has no CORS, so the browser talks to /api and Vite forwards to Fastify.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
