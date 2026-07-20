import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import DashboardPage from "./pages/DashboardPage";
import EditPage from "./pages/EditPage";
import ExportPage from "./pages/ExportPage";

// App: SPA เดียว + React Router ตามที่ตกลงกันไว้ (ดู CLAUDE.md หัวข้อ
// Frontend Framework Migration) route "/", "/edit", "/export" อยู่ใน React
// app เดียวกัน แชร์ Layout/topbar เดียวกัน แทนการแยก build 3 ไฟล์ html แบบเดิม
export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="edit" element={<EditPage />} />
            <Route path="export" element={<ExportPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
