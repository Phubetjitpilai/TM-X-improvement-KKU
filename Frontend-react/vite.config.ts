import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ตอน dev รัน backend (uvicorn) แยกที่ port 8000 และ Vite dev server ที่ 5173
// proxy /api/* ไปที่ backend ตรงนี้เลย เพื่อให้โค้ดฝั่ง React เรียก fetch("/api/...")
// แบบ relative path ได้เหมือนกันทั้ง dev และ production (ตอน build จริง React
// กับ backend มาจาก origin เดียวกันอยู่แล้ว เพราะ main.py เสิร์ฟไฟล์ build
// เอง — ดู CLAUDE.md หัวข้อ Frontend Framework Migration)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
