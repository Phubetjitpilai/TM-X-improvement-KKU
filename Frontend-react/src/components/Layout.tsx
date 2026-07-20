import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useSSE } from "../hooks/useSSE";

// Layout: topbar เดียวใช้ร่วมกันทุก route แทนการ copy topbar markup ซ้ำ 3 ไฟล์
// (index.html/edit.html/export.html เดิม) — ใช้ CSS class จริงจาก index.css
// (.topbar/.topbar-left/.topbar-title/.topbar-nav/.topbar-link/.station-badge)
// แทน inline style เพื่อให้หน้าตาตรงกับต้นฉบับเป๊ะๆ ไม่ใช่แค่ "หน้าตาคล้ายๆ"
//
// ชื่อหน้าใน topbar เปลี่ยนตาม route เหมือนต้นฉบับ (index.html หัวเป็น
// "Dashboard", edit.html หัวเป็น "Database Editor")
//
// <Outlet/> ไม่ถูกครอบด้วย wrapper ที่มี padding ของตัวเอง — แต่ละหน้าใส่
// container ของตัวเอง (.layout > .main สำหรับ Dashboard, .main-edit สำหรับ
// Editor) ให้ตรงกับโครงสร้างเดิมของแต่ละไฟล์ .html เป๊ะๆ
export default function Layout() {
  const status = useSSE();
  const location = useLocation();

  const badgeText =
    status === "online" ? "🟢 Online" : status === "offline" ? "🔴 Offline" : "🟡 Connecting";
  const badgeClass = `station-badge ${status === "online" ? "online" : status === "offline" ? "offline" : "connecting"}`;

  const pageTitle = location.pathname.startsWith("/edit")
    ? "Database Editor"
    : location.pathname.startsWith("/export")
      ? "Export"
      : "Dashboard";

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">
            TM-X <span>{pageTitle}</span>
          </div>
          <nav className="topbar-nav">
            <NavLink to="/" end className={({ isActive }) => `topbar-link${isActive ? " active" : ""}`}>
              Home
            </NavLink>
            <NavLink to="/edit" className={({ isActive }) => `topbar-link${isActive ? " active" : ""}`}>
              Edit
            </NavLink>
            <NavLink to="/export" className={({ isActive }) => `topbar-link${isActive ? " active" : ""}`}>
              Export
            </NavLink>
          </nav>
        </div>
        <span className={badgeClass}>{badgeText}</span>
      </header>

      <Outlet />
    </>
  );
}
