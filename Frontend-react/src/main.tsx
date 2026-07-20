import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

// QueryClient ตัวเดียวใช้ทั้งแอป — ตั้ง staleTime ไว้สั้นๆ (ไม่ใช่ 0 เป๊ะ)
// เพราะข้อมูล dropdown (operators/vendors/ฯลฯ) แทบไม่เปลี่ยนบ่อย ไม่จำเป็นต้อง
// refetch ทุกครั้งที่สลับหน้า — ถ้าหน้าไหนต้องการข้อมูลสดจริงๆ (เช่น
// measurements ที่เปลี่ยนบ่อย) ให้ตั้ง staleTime เฉพาะจุดทับค่า default นี้ได้
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
