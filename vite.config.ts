import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // หรือพอร์ตอื่นก็ได้
    proxy: {
      "/api": {
        target: "http://localhost:3000", // พอร์ตเดียวกับ server/index.ts
        changeOrigin: true,
      },
    },
  },
});
