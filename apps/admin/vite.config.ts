import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { proxy: { "/admin/api": "http://localhost:8787" } },
});
