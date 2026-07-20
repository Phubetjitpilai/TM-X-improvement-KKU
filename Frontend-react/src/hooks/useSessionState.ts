import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";

export interface SessionState {
  session_id?: number;
  number_alpl?: number;
  state: "idle" | "running" | "stopped" | "timeout";
  target_count?: number;
  measured_count?: number;
  last_seen?: string;
  started_at?: string;
  ended_at?: string;
}

// useSessionState: poll GET /api/session/state ทุก 4 วิ (เหมือน edit.html เดิม
// ที่ poll เพื่อรู้ว่ามี session running อยู่ที่อื่นไหม) ใช้ทั้งใน EditPage
// (ล็อกปุ่ม Edit/Delete ตอน running) และ DashboardPage (โชว์สถานะ/ปุ่ม
// Start-Stop) — SSE จะมาช่วยอัปเดตให้ไวขึ้นอีกที แต่ poll ไว้เป็น fallback
// เผื่อพลาด event ตอนที่ยังไม่ได้เปิดหน้าเว็บอยู่
export function useSessionState() {
  return useQuery({
    queryKey: ["session-state"],
    queryFn: () => apiGet<SessionState>("/api/session/state"),
    refetchInterval: 4000,
    staleTime: 0,
  });
}
